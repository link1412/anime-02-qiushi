"""Handheld phone camera, driven by storyboard.json.

The film is a list of clips (separate phone recordings joined with hard cuts). Each clip has
keyframed framing, human motion noise (seeded per clip), lens switches (macro), autofocus
with hunts, and an optional "stop" tap at the end.

tool/pose.js is a line-by-line port of this file for the browser preview; keep them in sync
(tool/test_pose.py checks the two agree).
"""
import json, math, os, re, functools
import numpy as np

ROOT = os.environ.get('EP1', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TL = json.load(open(f'{ROOT}/build/timeline.json'))
FPS = TL['FPS']
PP = 0.1           # panel pixel pitch, mm (14" MacBook Pro, 254 ppi)
FX_MAIN = 2760.0   # output-px focal length, 2x lens (52mm eq.)
FX_MACRO = 2760.0  # ultra-wide macro, cropped to the main lens' field of view (no zoom jump at the switch, like iOS)
LENS_DX, LENS_DY, LENS_XFADE = 1.4, -0.65, 0.18   # mm viewpoint shift at a lens switch, eased over LENS_XFADE s

LOW = [0.13, 0.23, 0.41, 0.67, 1.1, 1.7]
LOWA = [1.0, 0.8, 0.55, 0.35, 0.2, 0.1]
TRE = [7.3, 8.9, 10.7]
TREA = [1, 0.7, 0.5]
# name, base seed, freqs, amps
NOISES = [('x', 11, LOW, LOWA), ('y', 12, LOW, LOWA), ('z', 13, LOW[:4], LOWA[:4]),
          ('yaw', 21, LOW, LOWA), ('pit', 22, LOW, LOWA), ('rol', 23, LOW, LOWA),
          ('tyaw', 31, TRE, TREA), ('tpit', 32, TRE, TREA)]


def anchors():
    """named times from the UI capture (build/timeline.json); clip-local seconds."""
    if 'anchors' in TL:
        return dict(TL['anchors'])
    a = {'E1': TL['T_ENTER1'], 'E2': TL['T_ENTER2'], 'T_TYPE1': TL['T_TYPE1'], 'T_TYPE2': TL['T_TYPE2']}
    for r in ('R1', 'R2'):
        for k, v in TL[r].items():
            a[f'{r}_{k}'] = v
    return a


ANCHORS = anchors()
_EXPR = re.compile(r'^\s*([A-Za-z_][A-Za-z0-9_]*)\s*([+-])\s*([0-9.]+)\s*$')


def tval(v):
    """number, or 'ANCHOR+offset' / 'ANCHOR-offset'."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = _EXPR.match(v)
    if not m:
        raise ValueError(f'bad time expression {v!r}')
    if m.group(1) not in ANCHORS:
        raise ValueError(f'unknown anchor {m.group(1)!r} (known: {", ".join(ANCHORS)})')
    base = ANCHORS[m.group(1)]
    off = float(m.group(3))
    return base + off if m.group(2) == '+' else base - off


class Noise1D:
    def __init__(self, seed, freqs, amps):
        r = np.random.RandomState(seed)
        self.f = np.array(freqs); self.a = np.array(amps); self.p = r.uniform(0, 2 * np.pi, len(freqs))
        self.f = self.f * r.uniform(0.85, 1.15, len(freqs))

    def __call__(self, t):
        return float(np.sum(self.a * np.sin(2 * np.pi * self.f * t + self.p)))

    def params(self):
        return {'f': self.f.tolist(), 'a': self.a.tolist(), 'p': self.p.tolist()}


def steadiness(t, dist):
    # more bracing when very close; slightly calmer while just watching
    s = 1.0
    if dist < 80:
        s = 0.18 + 0.82 * (dist - 18) / 62 if dist > 18 else 0.18
    return max(0.15, s)


class Clip:
    def __init__(self, c, start_frame):
        self.raw = c
        self.id = c['id']
        self.dur = tval(c['dur'])
        self.nf = int(round(self.dur * FPS))
        self.f0 = start_frame
        self.t0 = start_frame / FPS
        keys = sorted(c['keys'], key=lambda k: tval(k['t']))
        self.KT = np.array([tval(k['t']) for k in keys])
        self.KV = np.array([[k['x'], k['y'], k['d'], k['yaw'], k['pitch'], k['roll']] for k in keys], dtype=np.float64)
        self.FLOW = [bool(k.get('flow')) for k in keys]   # pass through this key without stopping (see smooth_interp)
        self.macro = [(tval(a), tval(b)) for a, b in c.get('macro', [])]
        self.stop = tval(c.get('stop_tap'))
        seed = int(c.get('seed', 0))
        self.noise = {n: Noise1D(s + 100 * seed, fr, am) for n, s, fr, am in NOISES}
        af = c.get('af', {})
        self.af_start = af.get('start', 2000)
        self.af_intro = af.get('intro')
        self.hunts = [(tval(h['t']), h['pts']) for h in af.get('hunts', [])]

    # --- framing -------------------------------------------------------------------------
    def move_span(self, i):
        """keys a..b of the move containing segment i: a run of segments joined by "flow" keys."""
        a, b = i, i + 1
        while a > 0 and self.FLOW[a]:
            a -= 1
        while b < len(self.KT) - 1 and self.FLOW[b]:
            b += 1
        return a, b

    def flow_interp(self, t, a, b):
        """one move through several keys: a single ease-in/out over the whole move, C1 Hermite spline
        through the keys in (warped) time, distance in log space (a push-in zooms at an even rate)."""
        KT = self.KT
        P = self.KV.copy(); P[:, 2] = np.log(P[:, 2])
        u = float(np.clip((t - KT[a]) / (KT[b] - KT[a]), 0, 1))
        s = KT[a] + (KT[b] - KT[a]) * u * u * (3 - 2 * u)
        j = int(np.clip(np.searchsorted(KT, s) - 1, a, b - 1))
        h = KT[j + 1] - KT[j]
        def tan(k):
            lo, hi = max(k - 1, a), min(k + 1, b)
            return (P[hi] - P[lo]) / (KT[hi] - KT[lo])
        x = (s - KT[j]) / h
        h00 = 2 * x ** 3 - 3 * x ** 2 + 1; h10 = x ** 3 - 2 * x ** 2 + x; h01 = -2 * x ** 3 + 3 * x ** 2; h11 = x ** 3 - x ** 2
        v = h00 * P[j] + h10 * h * tan(j) + h01 * P[j + 1] + h11 * h * tan(j + 1)
        v[2] = math.exp(v[2])
        return v

    def smooth_interp(self, t):
        KT, KV = self.KT, self.KV
        if len(KT) == 1:
            return KV[0].copy()
        i = int(np.clip(np.searchsorted(KT, t) - 1, 0, len(KT) - 2))
        a, b = self.move_span(i)
        if b - a > 1:
            return self.flow_interp(t, a, b)
        t0, t1 = KT[i], KT[i + 1]
        a = (t - t0) / (t1 - t0) if t1 > t0 else 0
        a = float(np.clip(a, 0, 1))
        # Catmull-Rom on values with eased parameter for human-like accel/decel
        e = a * a * (3 - 2 * a)
        p0 = KV[max(i - 1, 0)]; p1 = KV[i]; p2 = KV[i + 1]; p3 = KV[min(i + 2, len(KV) - 1)]
        cr = 0.5 * ((2 * p1) + (-p0 + p2) * e + (2 * p0 - 5 * p1 + 4 * p2 - p3) * e * e + (-p0 + 3 * p1 - 3 * p2 + p3) * e ** 3)
        lin = p1 + (p2 - p1) * e
        return 0.35 * cr + 0.65 * lin

    def is_macro(self, t):
        return any(a <= t < b for a, b in self.macro)

    def lens_jump(self, t):
        """Viewpoint jump when the phone swaps lenses (lens modules are ~10mm apart)."""
        dx = dy = 0.0
        ev = []
        for a, b in self.macro:
            ev += [(a, LENS_DX, LENS_DY), (b, -LENS_DX, -LENS_DY)]
        for ts, sx, sy in ev:
            if t >= ts:
                u = t - ts
                r = min(1.0, u / LENS_XFADE); r = r * r * (3 - 2 * r)   # the phone cross-fades the two lenses
                k = r * math.exp(-u / 0.55)                              # then the user re-centres
                dx += sx * k; dy += sy * k
        return dx, dy

    def tap_jolt(self, t):
        if self.stop is None or t < self.stop:
            return 0, 0, 0
        u = t - self.stop
        k = math.exp(-u / 0.07) * math.sin(u * 2 * math.pi * 6)
        return 0.9 * k, 2.4 * k, 1.5 * k  # pitch deg, z mm, y mm

    def pose(self, t):
        """local time t -> dict: C (mm), right/down/fwd, fx, macro(bool), dist"""
        N = self.noise
        tx, ty, d, yaw, pit, rol = self.smooth_interp(t)
        s = steadiness(t, d)
        tx_mm = tx * PP + 0.9 * s * N['x'](t)
        ty_mm = ty * PP + 0.9 * s * N['y'](t)
        d = d + 2.0 * s * N['z'](t) * (d / 250)
        yaw = yaw + 0.28 * s * N['yaw'](t) + 0.010 * N['tyaw'](t)
        pit = pit + 0.28 * s * N['pit'](t) + 0.010 * N['tpit'](t)
        rol = rol + 0.35 * s * N['rol'](t)
        jx, jy = self.lens_jump(t)
        tx_mm += jx; ty_mm += jy
        jp, jz, jyy = self.tap_jolt(t)
        pit += jp; d += jz; ty_mm += jyy
        cy, sy_ = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
        cp, sp = math.cos(math.radians(pit)), math.sin(math.radians(pit))
        cr, sr = math.cos(math.radians(rol)), math.sin(math.radians(rol))
        Ry = np.array([[cy, 0, sy_], [0, 1, 0], [-sy_, 0, cy]])
        Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
        Rz = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
        M = Ry @ Rx @ Rz            # camera->world
        right, down, fwd = M[:, 0], M[:, 1], M[:, 2]
        T = np.array([tx_mm, ty_mm, 0.0])
        C = T - d * fwd
        macro = self.is_macro(t)
        fx = FX_MACRO if macro else FX_MAIN
        return {'C': C, 'right': right, 'down': down, 'fwd': fwd, 'fx': fx, 'macro': macro, 'dist': d}

    # --- autofocus -----------------------------------------------------------------------
    def focus(self, n):
        """per local frame: lagging follower of true distance + scripted hunts."""
        sf = np.zeros(n)
        st = self.af_start
        if isinstance(st, str) and st.startswith('x'):
            st = self.pose(0.0)['dist'] * float(st[1:])
        st = float(st)
        cur = st
        for i in range(n):
            t = i / FPS
            true = self.pose(t)['dist']
            cur += (true - cur) * (1 - math.exp(-(1 / FPS) / 0.12))
            err = 0.0
            for t0, pts in self.hunts:
                u = t - t0
                if 0 <= u <= pts[-1][0]:
                    xs = [q[0] for q in pts]; ys = [q[1] for q in pts]
                    err += float(np.interp(u, xs, ys))
            sf[i] = cur * (1 + err) if t > 0.0 else st
            if self.af_intro and t < self.af_intro[2]:
                sf[i] = true * (1 + self.af_intro[0] - self.af_intro[1] * t)
        return sf


class Rig:
    def __init__(self, sb):
        self.sb = sb
        self.clips = []
        f = 0
        for c in sb['clips']:
            cl = Clip(c, f)
            self.clips.append(cl)
            f += cl.nf
        self.nframes = f

    def locate(self, f):
        """global frame -> (clip, local time)"""
        for c in self.clips:
            if f < c.f0 + c.nf:
                return c, (f - c.f0) / FPS
        c = self.clips[-1]
        return c, (f - c.f0) / FPS

    @functools.cached_property
    def focus(self):
        # each clip gets 2 spare frames past its end (motion-blur / rolling-shutter lookups)
        out = []
        for c in self.clips:
            out.append(c.focus(c.nf + 2)[:c.nf] if c is not self.clips[-1] else c.focus(c.nf + 2))
        return np.concatenate(out)


def load(path=None):
    return json.load(open(path or f'{ROOT}/storyboard.json'))


RIG = Rig(load())
CLIP_A = RIG.clips[0]

# --- back-compat module API (clip A = the recorded take, global t == local t) ----------
T_STOP = CLIP_A.stop
T_CUT = CLIP_A.dur
E1, E2 = TL['T_ENTER1'], TL['T_ENTER2']
MACRO_ON, MACRO_OFF = CLIP_A.macro[0]


def _smooth_interp(t):
    return CLIP_A.smooth_interp(t)


def pose(t):
    return CLIP_A.pose(t)


@functools.lru_cache(maxsize=1)
def focus_track():
    """clip A only, same length as before (ceil(T_CUT*FPS)+2)."""
    return CLIP_A.focus(int(math.ceil(T_CUT * FPS)) + 2)


if __name__ == '__main__':
    print('clips', [(c.id, c.nf, round(c.t0, 3)) for c in RIG.clips], 'total frames', RIG.nframes, 'dur', RIG.nframes / FPS)
    for t in [x for x in [0, 3, 12, 20, 30, 33, 40, 50, 60, 68, 69.4] if x < T_CUT]:
        p = pose(t)
        print(t, np.round(p['C'], 1), p['fx'], p['macro'], round(p['dist'], 1), round(focus_track()[int(t * FPS)], 1))
