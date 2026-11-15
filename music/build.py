#!/usr/bin/env python3
"""Film score builder: music/cues.json + build/timeline.json -> build/music.wav (full film length).

Nothing here hard-codes film seconds. Every cue is pinned to timeline anchors, so when the cut changes
(re-capture -> new timeline.json) a re-run re-fits the tempo and only re-renders cues whose notes moved.

  python3 music/build.py --plan                    # resolve anchors, print the cue sheet (no rendering)
  python3 music/build.py                           # render (Mac mini: needs bin/khost + Keyscape) and mix

Options: --timeline PATH  --cues PATH  --out PATH  --only id,id  --force

Cue fields (cues.json; see the file for live examples)
  id, score            MIDI file (relative to music/), read by score.py as beats
  from, to             source range: "17" = bar 17, "16+1.5" = bar 16 + 1.5 quarter notes, "b64" = beat 64
  pins                 [[position, anchor-expr, shape?], ...]: that score position lands on that film time.
                       Between pins the tempo is fitted (shape "accel:2" = ends 2x faster, "rit:1.5").
                       One pin + "bpm" = free tempo from that point.
  rit                  {"beats": n, "amount": a}: final ritardando inside the last pinned span (end stays put)
  dyn                  {"base", "tracks": {track: dv}, "downbeat", "random", "seed", "curve": [[pos, dv], ...]}
  legato               duration factor (1 = as written)
  pedal                "none" | "beat" | "bar" | "half", "pedal_value" (CC64 depth)
  humanize_ms          onset jitter (seeded)
  stop                 {"at": expr, "mode": "release"} = no new notes, keys up + pedal up at that instant;
                       the piano's own damping is the end (rendered, not faded)
  fade_in, fade_out    seconds / {"at": expr, "dur": s}
  gain_db, patch, enabled
Anchor expressions: NAME(+/-NUMBER|NAME)*.  NAME = any timeline anchor (take-local; resolved to film time
via the part it belongs to), PART_START/PART_END, T_END, or a number in film seconds.
Global: master_db, duck {"keys": [...], "db", "attack", "hold", "release"}, credit.
"""
import argparse, hashlib, json, math, os, random, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import score as S  # noqa: E402

SR = 48000


# ---------------------------------------------------------------- anchors
class Timeline:
    def __init__(self, path):
        self.tl = json.load(open(path))
        self.part_t0 = {}
        for c in self.tl['clips']:
            for p in c.get('parts', [{'id': c['id'], 't0': c['t0']}]):
                self.part_t0[p['id']] = c['t0']           # anchors are take-local -> offset by the take start
        self.anchors = self.tl.get('anchors', {})
        self.T_END = self.tl['T_END']

    def name(self, n):
        if n == 'T_END':
            return self.T_END
        if n not in self.anchors:
            raise KeyError(f'unknown anchor {n!r}')
        v = self.anchors[n]
        part = n.split('_')[0]
        if part in self.part_t0:
            return self.part_t0[part] + v
        return v                                          # A-section names (E1, R1_start, T_TYPE1 ...) are clip A = film time

    def expr(self, e):
        if isinstance(e, (int, float)):
            return float(e)
        toks = re.findall(r'[+-]|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?', e.replace(' ', ''))
        total, sign = 0.0, 1
        for t in toks:
            if t in '+-':
                sign = 1 if t == '+' else -1
                continue
            total += sign * (float(t) if t[0].isdigit() else self.name(t))
            sign = 1
        return total


# ---------------------------------------------------------------- score positions
def pos(sc, p):
    p = str(p)
    if p.startswith('b'):
        return float(p[1:])
    m = re.fullmatch(r'(\d+)(?:\+(\d+(?:\.\d+)?))?', p)
    if not m:
        raise ValueError(f'bad score position {p!r}')
    return sc.bar_beat(int(m.group(1)), float(m.group(2) or 0))


# ---------------------------------------------------------------- tempo map: beats -> film seconds
def tempo_map(cue, sc, tl, b_from, b_to):
    """Piecewise map from pins. Within a span, beat durations follow a weight w(b) (shape / rit) and are
    scaled so the span exactly fills its film interval. Returns f(beat) -> seconds (film time)."""
    pins = [(pos(sc, p[0]), tl.expr(p[1]), p[2] if len(p) > 2 else None) for p in cue['pins']]
    pins.sort()
    if len(pins) == 1:
        bpm = cue['bpm']
        b0, t0, _ = pins[0]
        spans = []
        sp_lo, sp_hi = min(b_from, b0), max(b_to, b0) + 8
        pins = [(sp_lo, t0 - (b0 - sp_lo) * 60 / bpm, None), (sp_hi, t0 + (sp_hi - b0) * 60 / bpm, None)]
    rit = cue.get('rit')
    STEP = 1 / 96
    spans = []
    for (b0, t0, _), (b1, t1, shape) in zip(pins, pins[1:]):
        if t1 <= t0 or b1 <= b0:
            raise ValueError(f'cue {cue["id"]}: pins out of order ({b0}->{b1}, {t0:.2f}->{t1:.2f})')
        n = max(1, int(round((b1 - b0) / STEP)))
        grid = [b0 + (b1 - b0) * i / n for i in range(n + 1)]
        w = []
        for i in range(n):
            u = (i + 0.5) / n
            bm = (grid[i] + grid[i + 1]) / 2
            x = 1.0
            if shape:
                kind, k = shape.split(':'); k = float(k)
                x *= (1 + u * (1 / k - 1)) if kind == 'accel' else (1 + u * (k - 1))
            if rit and (b1 == pins[-1][0]) and bm > b1 - rit['beats']:
                x *= 1 + rit['amount'] * ((bm - (b1 - rit['beats'])) / rit['beats']) ** 1.5
            w.append(x)
        tot = sum(w)
        cum = [0.0]
        for x in w:
            cum.append(cum[-1] + x)
        ts = [t0 + (t1 - t0) * c / tot for c in cum]
        spans.append((grid, ts))

    def f(b):
        for grid, ts in spans:
            if b <= grid[-1] + 1e-9:
                if b < grid[0]:                           # before the first pin: extrapolate the first span's tempo
                    return ts[0] - (grid[0] - b) * (ts[1] - ts[0]) / (grid[1] - grid[0])
                i = min(int((b - grid[0]) / (grid[1] - grid[0])), len(grid) - 2)
                a = (b - grid[i]) / (grid[i + 1] - grid[i])
                return ts[i] + a * (ts[i + 1] - ts[i])
        grid, ts = spans[-1]
        return ts[-1] + (b - grid[-1]) * (ts[-1] - ts[-2]) / (grid[-1] - grid[-2])
    return f


def interp(curve, x):
    if not curve:
        return 0.0
    if x <= curve[0][0]:
        return curve[0][1]
    for (x0, y0), (x1, y1) in zip(curve, curve[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return curve[-1][1]


def resolve_auto_end(cue, sc, tl, b_from):
    """"to": {"auto": true, "bpm": 140, "min": "20", "max": "33"} -> pick the end bar whose fitted mean tempo is
    closest to bpm (so a longer/shorter shot gets more/fewer bars instead of a different tempo). Pins may use "END"."""
    to = cue['to']
    if not isinstance(to, dict):
        return cue
    lo, hi = int(to['min']), int(to['max'])
    best = None
    for bar in range(lo, hi + 1):
        c = dict(cue, to=str(bar), pins=[[str(bar) if p[0] == 'END' else p[0]] + list(p[1:]) for p in cue['pins']])
        b_to = pos(sc, c['to'])
        f = tempo_map(c, sc, tl, b_from, b_to)
        bpm = 60 * (b_to - b_from) / (f(b_to) - f(b_from))
        if best is None or abs(math.log(bpm / to['bpm'])) < best[0]:
            best = (abs(math.log(bpm / to['bpm'])), c)
    return best[1]


# ---------------------------------------------------------------- performance
def perform(cue, tl):
    """-> (t_origin film seconds, events [[t_local, status, d1, d2]], info)"""
    sc = S.read(os.path.join(HERE, cue['score']))
    b_from = pos(sc, cue['from'])
    cue = resolve_auto_end(cue, sc, tl, b_from)
    b_to = pos(sc, cue['to'])
    f = tempo_map(cue, sc, tl, b_from, b_to)
    dyn = cue.get('dyn', {})
    rng = random.Random(dyn.get('seed', 1))
    jit = random.Random(cue.get('seed', 7))
    curve = [(pos(sc, p), dv) for p, dv in dyn.get('curve', [])]
    legato = cue.get('legato', 1.0)
    hum = cue.get('humanize_ms', 0) / 1000
    stop = tl.expr(cue['stop']['at']) if cue.get('stop') else None

    notes = []
    for n in sc.notes:
        if not (b_from - 1e-6 <= n.beat < b_to - 1e-6):
            continue
        on = f(n.beat) + (jit.uniform(-hum, hum) if hum else 0)
        end_b = min(n.beat + n.dur * legato, b_to) if not cue.get('ring_last') else n.beat + n.dur * legato
        off = max(f(end_b), on + 0.03)
        if stop is not None:
            if on >= stop - 1e-4:
                continue
            off = min(off, stop)
        v = dyn.get('base', 60) + dyn.get('tracks', {}).get(str(n.track), 0)
        if sc.beat_in_bar(n.beat) < 1e-6:
            v += dyn.get('downbeat', 0)
        v += interp(curve, n.beat) + rng.uniform(-1, 1) * dyn.get('random', 0)
        notes.append((on, off, n.pitch, int(max(1, min(127, round(v))))))

    if not notes:
        raise ValueError(f'cue {cue["id"]}: no notes in range')
    t_origin = min(n[0] for n in notes) - 0.05
    ev = []
    for on, off, p, v in notes:
        ev.append([on - t_origin, 0x90, p, v])
        ev.append([off - t_origin, 0x80, p, 0])

    # sustain pedal: lift at each change point, re-catch 60 ms later (legato pedalling)
    mode = cue.get('pedal', 'none')
    if mode != 'none':
        val = cue.get('pedal_value', 100)
        step = {'beat': 1.0, 'half': sc.bar_len(b_from) / 2, 'bar': sc.bar_len(b_from)}[mode]
        b = b_from
        while b < b_to - 1e-6:
            t = f(b) - t_origin
            if stop is not None and f(b) >= stop:
                break
            ev.append([max(0.0, t - 0.005), 0xB0, 64, 0])
            ev.append([t + 0.06, 0xB0, 64, val])
            b += step
        t_end = (stop if stop is not None else f(b_to)) - t_origin
        ev.append([t_end, 0xB0, 64, 0])
    if stop is not None:
        ev.append([stop - t_origin, 0xB0, 64, 0])        # all keys up at the stop: the dampers end it
    ev.sort(key=lambda e: (e[0], 0 if e[1] == 0x80 else 1))
    info = dict(t_start=f(b_from), t_end=f(b_to), t_origin=t_origin, n_notes=len(notes),
                bpm_start=60 / max(1e-6, (f(b_from + 1) - f(b_from))),
                bpm_end=60 / max(1e-6, (f(b_to) - f(b_to - 1))), stop=stop)
    return t_origin, ev, info


# ---------------------------------------------------------------- rendering (Mac mini)
def patch_state(patch):
    slug = re.sub(r'[^A-Za-z0-9]+', '_', patch).strip('_')
    p = os.path.join(HERE, 'work', f'state_{slug}.plist')
    if not os.path.exists(p):
        tmpl = os.path.join(HERE, 'work', 'default_state.plist')
        if not os.path.exists(tmpl):
            subprocess.run([os.path.join(HERE, 'bin', 'khost'), '--dump-state', tmpl], check=True)
        subprocess.run(['/usr/bin/python3', os.path.join(HERE, 'keyscape.py'), 'state', patch, p], check=True)
    return p


def render(cue, ev, patch, force=False):
    khost = os.path.join(HERE, 'bin', 'khost')
    payload = json.dumps({'events': [[round(e[0], 6)] + e[1:] for e in ev]}, separators=(',', ':'))
    kh = hashlib.sha256(open(khost, 'rb').read()).hexdigest()[:12]
    h = hashlib.sha256((payload + '|' + patch + '|' + kh + f'|{SR}').encode()).hexdigest()[:16]
    os.makedirs(os.path.join(HERE, 'cache'), exist_ok=True)
    wav = os.path.join(HERE, 'cache', f'{cue["id"]}-{h}.wav')
    if os.path.exists(wav) and not force:
        return wav, False
    evp = wav[:-4] + '.events.json'
    open(evp, 'w').write(payload)
    tmp = wav + '.tmp.wav'
    for attempt in range(3):                              # Keyscape loads samples asynchronously; a too-early start is silent
        subprocess.run([khost, '--state', patch_state(patch), '--events', evp, '--out', tmp,
                        '--sr', str(SR), '--warm', str(8 + 6 * attempt), '--tail', str(cue.get('tail', 6))], check=True)
        import numpy as np
        x = read_wav(tmp)
        first_on = min(e[0] for e in ev if e[1] == 0x90)
        seg = x[int(first_on * SR): int((first_on + 1.0) * SR)]
        if np.abs(seg).max() > 10 ** (-40 / 20):
            os.replace(tmp, wav)
            return wav, True
        print(f'  {cue["id"]}: silent first second (samples not loaded yet), retrying with a longer warm-up')
    raise RuntimeError(f'cue {cue["id"]}: render stayed silent')


def read_wav(p):
    import numpy as np
    d = open(p, 'rb').read()
    assert d[:4] == b'RIFF' and d[8:12] == b'WAVE'
    i, fmt = 12, None
    while i < len(d):
        cid, ln = d[i:i + 4], int.from_bytes(d[i + 4:i + 8], 'little')
        if cid == b'fmt ':
            fmt = int.from_bytes(d[i + 8:i + 10], 'little'), int.from_bytes(d[i + 10:i + 12], 'little')
        if cid == b'data':
            assert fmt == (3, 2), fmt
            return np.frombuffer(d[i + 8:i + 8 + ln], dtype='<f4').reshape(-1, 2).astype(np.float64)
        i += 8 + ln + (ln & 1)
    raise ValueError(p)


def write_wav(p, x):
    import numpy as np
    a = np.ascontiguousarray(x.astype('<f4'))
    hdr = b'RIFF' + (36 + a.nbytes).to_bytes(4, 'little') + b'WAVE' + b'fmt ' + (16).to_bytes(4, 'little') + \
        (3).to_bytes(2, 'little') + (2).to_bytes(2, 'little') + SR.to_bytes(4, 'little') + (SR * 8).to_bytes(4, 'little') + \
        (8).to_bytes(2, 'little') + (32).to_bytes(2, 'little') + b'data' + a.nbytes.to_bytes(4, 'little')
    open(p, 'wb').write(hdr + a.tobytes())


# ---------------------------------------------------------------- mix
def mix(cfg, tl, rendered, out):
    import numpy as np
    n = int(round(tl.T_END * SR))
    bus = np.zeros((n, 2))
    report = []
    for cue, t_origin, wav, info in rendered:
        x = read_wav(wav) * 10 ** ((cue.get('gain_db', 0)) / 20)
        g = np.ones(len(x))
        fi = cue.get('fade_in', 0)
        s_on = int(round((info['t_start'] - t_origin) * SR))
        if fi:
            k = int(fi * SR); g[:s_on] = 0; g[s_on:s_on + k] *= np.sin(0.5 * np.pi * np.linspace(0, 1, min(k, len(g) - s_on)))
        fo = cue.get('fade_out')
        if fo:
            a = int(round((tl.expr(fo['at']) - t_origin) * SR)); k = max(1, int(fo['dur'] * SR))
            if a < len(g):
                seg = g[a:a + k]; seg *= np.cos(0.5 * np.pi * np.linspace(0, 1, k))[:len(seg)]; g[a + k:] = 0
        x *= g[:, None]
        s0 = int(round(t_origin * SR))
        a, b = max(0, s0), min(n, s0 + len(x))
        if b > a:
            bus[a:b] += x[a - s0:b - s0]
        pk = 20 * np.log10(np.abs(x).max() + 1e-12)
        report.append(dict(id=cue['id'], wav=os.path.basename(wav), peak_db=round(pk, 1), **{k: (round(v, 3) if isinstance(v, float) else v) for k, v in info.items()}))
    duck = cfg.get('duck')
    if duck:
        env = np.ones(n)
        A, H, R = duck.get('attack', 0.03), duck.get('hold', 0.25), duck.get('release', 0.4)
        lo = 10 ** (duck['db'] / 20)
        for k in tl.tl.get('keys', []):
            if k['key'] in duck['keys']:
                t = k['t']; i0 = int((t - A) * SR); i1 = int(t * SR); i2 = int((t + H) * SR); i3 = int((t + H + R) * SR)
                ramp = lambda u: 1 - (1 - lo) * u
                for i, j, u0, u1 in ((i0, i1, 0, 1), (i1, i2, 1, 1), (i2, i3, 1, 0)):
                    i, j = max(0, i), min(n, j)
                    if j > i:
                        env[i:j] = np.minimum(env[i:j], ramp(np.linspace(u0, u1, j - i)))
        bus *= env[:, None]
    bus *= 10 ** (cfg.get('master_db', 0) / 20)
    write_wav(out, bus)
    pk = 20 * np.log10(np.abs(bus).max() + 1e-12)
    nz = np.flatnonzero(np.abs(bus).max(1) > 1e-6)
    summary = dict(out=out, dur=round(n / SR, 3), peak_db=round(pk, 1),
                   audible=[round(float(nz[0]) / SR, 3), round(float(nz[-1]) / SR, 3)] if len(nz) else None, cues=report)
    json.dump(summary, open(out[:-4] + '_report.json', 'w'), indent=1, ensure_ascii=False)
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--timeline', default=os.path.join(ROOT, 'build', 'timeline.json'))
    ap.add_argument('--cues', default=os.path.join(HERE, 'cues.json'))
    ap.add_argument('--out', default=os.path.join(ROOT, 'build', 'music.wav'))
    ap.add_argument('--plan', action='store_true')
    ap.add_argument('--only', default='')
    ap.add_argument('--force', action='store_true')
    a = ap.parse_args()
    tl = Timeline(a.timeline)
    cfg = json.load(open(a.cues))
    only = set(filter(None, a.only.split(',')))
    print(f'timeline: {a.timeline}  T_END {tl.T_END:.3f}s')
    rendered = []
    for cue in cfg['cues']:
        if not cue.get('enabled', True) or (only and cue['id'] not in only):
            continue
        t_origin, ev, info = perform(cue, tl)
        stop = f"  stop {info['stop']:.2f}" if info['stop'] is not None else ''
        print(f"  {cue['id']:<12} {info['t_start']:7.2f} -> {info['t_end']:7.2f}s  "
              f"q={info['bpm_start']:.0f}->{info['bpm_end']:.0f}  {info['n_notes']} notes{stop}")
        if a.plan:
            continue
        wav, fresh = render(cue, ev, cue.get('patch', cfg['patch']), a.force)
        print(f"    {'rendered' if fresh else 'cached  '} {os.path.relpath(wav, HERE)}")
        rendered.append((cue, t_origin, wav, info))
    if not a.plan:
        s = mix(cfg, tl, rendered, a.out)
        print(f"wrote {a.out}  {s['dur']}s  peak {s['peak_db']} dBFS  audible {s['audible']}")


if __name__ == '__main__':
    main()
