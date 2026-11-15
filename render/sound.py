"""Synthesised soundtrack for the phone recording (+ the film score from build/music.wav, if present).

Room tone + faint fan, MacBook keyboard from timeline.json key times, phone handling
noise driven by the camera path, a finger tap on "stop", phone-mic colouring.
Deliberate tells (kept on purpose):
  * both Enter presses are the *same* sample, bit-identical, same gain;
  * the last few frames are exact digital zero (a real mic never outputs that).
Only linear processing is applied after the events are placed, so the two Enter
presses stay identical apart from the additive background.
"""
import os, sys, json, math, wave
import numpy as np
from scipy import signal

sys.path.insert(0, os.path.dirname(__file__))
import camera
from camera import TL, FPS, PP

SR = 48000
ROOT = os.environ.get('EP1', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ZERO_AFTER_TAP = 0.05        # digital zero from (stop tap + this) to the end of that clip
BRIDGE = 0.32                # s: room tone crossfades across a montage cut instead of restarting from silence


def db(x):
    return 10 ** (x / 20)


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], btype='band', fs=SR, output='sos')
    return signal.sosfilt(sos, x)


def lp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, btype='high', fs=SR, output='sos'), x)


def pink(n, rng):
    w = rng.standard_normal(n)
    # Voss-ish: 1/f via FFT shaping
    F = np.fft.rfft(w)
    f = np.fft.rfftfreq(n, 1 / SR)
    F[1:] /= np.sqrt(f[1:])
    F[0] = 0
    x = np.fft.irfft(F, n)
    return x / x.std()


def damped(t, f, tau, ph=0.0):
    return np.sin(2 * np.pi * f * t + ph) * np.exp(-t / tau)


def key_sound(rng, kind):
    """MacBook (scissor) key: press tick + body thock, softer release click."""
    L = int(0.20 * SR)
    t = np.arange(L) / SR
    out = np.zeros(L)

    def strike(t0, amp, body_f, body_tau, tick_amp, plate_f):
        i0 = int(t0 * SR)
        tt = t[:L - i0]
        n = rng.standard_normal(len(tt))
        tick = bp(n * np.exp(-tt / 0.0011), 1800, 9000) * tick_amp
        body = sum(a * damped(tt, f, tau, rng.uniform(0, 6.28))
                   for a, f, tau in [(1.0, body_f, body_tau),
                                     (0.45, body_f * rng.uniform(2.6, 3.2), body_tau * 0.5),
                                     (0.30, plate_f, 0.004)])
        body *= (1 - np.exp(-tt / 0.0004))
        out[i0:] += amp * (tick + 0.6 * body)

    if kind == 'letter':
        strike(0.0, 1.0, rng.uniform(260, 340), rng.uniform(0.008, 0.013), rng.uniform(0.8, 1.2), rng.uniform(1200, 1700))
        strike(rng.uniform(0.060, 0.105), rng.uniform(0.30, 0.45), rng.uniform(300, 380), 0.006, 0.7, rng.uniform(1400, 1900))
        g = rng.uniform(0.75, 1.15)
    elif kind == 'backspace':
        strike(0.0, 1.1, rng.uniform(230, 280), 0.013, 1.1, 1300)
        strike(rng.uniform(0.08, 0.11), 0.4, 300, 0.007, 0.8, 1500)
        g = rng.uniform(0.95, 1.1)
    elif kind == 'punct':
        strike(0.0, 0.95, rng.uniform(280, 350), 0.010, 1.0, rng.uniform(1300, 1700))
        strike(rng.uniform(0.07, 0.10), 0.35, 340, 0.006, 0.7, 1600)
        g = rng.uniform(0.8, 1.05)
    elif kind == 'space':
        # longer bar: lower body, stabiliser rattle
        strike(0.0, 1.2, rng.uniform(150, 190), 0.020, 0.9, rng.uniform(800, 1000))
        strike(0.004, 0.35, rng.uniform(170, 210), 0.012, 0.5, 900)
        strike(rng.uniform(0.09, 0.13), 0.5, 200, 0.010, 0.8, 1100)
        g = rng.uniform(0.9, 1.1)
    elif kind == 'click':
        # trackpad click: short, dull, mechanical
        strike(0.0, 0.55, rng.uniform(420, 520), 0.004, 0.6, rng.uniform(2200, 2600))
        g = rng.uniform(0.8, 1.0)
    elif kind == 'enter':
        strike(0.0, 1.25, 205, 0.017, 1.15, 1150)
        strike(0.003, 0.3, 240, 0.010, 0.6, 1000)
        strike(0.112, 0.48, 250, 0.009, 0.8, 1250)
        g = 1.0
    else:
        raise ValueError(kind)
    return out * g


def place(buf, x, t, gain=1.0, delay_r=0):
    i = int(round(t * SR))
    if i >= len(buf):
        return
    n = min(len(x), len(buf) - i)
    buf[i:i + n, 0] += x[:n] * gain
    j = i + delay_r
    n2 = min(len(x), len(buf) - j)
    buf[j:j + n2, 1] += x[:n2] * gain


def room_ir(rng):
    """small furnished room: early reflections + short diffuse tail (RT60 ~0.3 s)."""
    L = int(0.45 * SR)
    t = np.arange(L) / SR
    ir = np.zeros((L, 2))
    for c in range(2):
        tail = rng.standard_normal(L) * np.exp(-t * 6.9 / 0.30)
        tail = lp(tail, 5000)
        ir[:, c] = tail * 0.25
        for d, a in [(0.0031, 0.5), (0.0057, 0.35), (0.0088, 0.3), (0.0123, 0.22), (0.0171, 0.15)]:
            k = int((d + rng.uniform(0, 0.0012)) * SR)
            ir[k, c] += a * rng.choice([-1, 1])
    return ir


def handling_envelope(clip, n):
    """phone handling noise follows hand movement (the clip's keyframed path); tremor and the
    lens-swap viewpoint jump make no sound."""
    cr = 100
    dur = n / SR
    ts = np.arange(0, dur, 1 / cr)
    K = np.array([clip.smooth_interp(t) for t in ts])            # tx,ty (px), d (mm), yaw, pit, rol
    K[:, :2] *= PP
    v = np.gradient(K, 1 / cr, axis=0)
    spd = np.linalg.norm(v[:, :3], axis=1) + 4.0 * np.linalg.norm(v[:, 3:], axis=1)   # mm/s (+deg/s)
    a = np.abs(np.gradient(spd, 1 / cr))
    env = 0.06 + np.clip(spd / 90, 0, 1) * 0.7 + np.clip(a / 400, 0, 0.5)
    env = np.convolve(env, np.ones(15) / 15, mode='same')
    return np.interp(np.arange(n) / SR, ts, env)


_UIX = None


def trackpad_envelope(clip, n):
    """finger friction on the glass trackpad, from the user's own pointer speed (ui_index cursor track): only
    vigorous moves (the shake-to-locate) are loud enough to hear; Mythos' pointer (clip Z, ghost) makes no sound."""
    global _UIX
    if _UIX is None:
        _UIX = json.load(open(f'{ROOT}/build/ui_index.json'))
    cur, s0 = _UIX.get('cursor') or [], _UIX.get('startFrame', 0)
    a = TL['anchors']
    z0 = a.get('Z_START') if clip.id == 'X' else None
    sp = np.zeros(clip.nf)
    for k in range(1, clip.nf):
        f = clip.f0 + k - s0
        if not (0 < f < len(cur)) or not cur[f] or not cur[f - 1]:
            continue
        if z0 is not None and k / FPS >= z0:
            continue
        sp[k] = math.hypot(cur[f][0] - cur[f - 1][0], cur[f][1] - cur[f - 1][1]) * FPS     # css px/s
    env = np.clip((sp - 600) / 2600, 0, 1) ** 0.8
    env = np.convolve(env, np.ones(3) / 3, mode='same')
    return np.interp(np.arange(n) / SR, np.arange(clip.nf) / FPS, env, right=0.0)


_BIRDS = None


def dawn_level(clip):
    d = clip.raw.get('dawn') or 0
    return max(v for _, v in d) if isinstance(d, list) else float(d)


def birds(clip, n, rng):
    """dawn outside the closed window (assets/sfx, CC0): from 05:20 on. Low-passed by the glass, quiet."""
    global _BIRDS
    if _BIRDS is None:
        import soundfile as sf
        _BIRDS, sr_ = sf.read(f'{ROOT}/assets/sfx/dawn_birds_bigsoundbank_1906_100-150s.flac', dtype='float64')
        assert sr_ == SR
    off = int(rng.uniform(0, max(1, len(_BIRDS) - n - 1)))
    x = _BIRDS[off:off + n]
    if len(x) < n:
        x = np.concatenate([x, np.zeros((n - len(x), 2))])
    x = np.stack([lp(hp(x[:, c], 300), 3200, 4) for c in range(2)], 1)
    return x / (np.sqrt((x ** 2).mean()) + 1e-9)


def segment(clip, keys, rng, enter, N, fresh=True):
    """one phone recording: N samples (may run past the clip end for a sound bridge), keys = [(local t, kind)].
    fresh: the recording starts here (mic settles from silence); else the caller crossfades it in."""
    bus_keys = np.zeros((N, 2))
    for t, kind in keys:
        if kind == 'enter':
            place(bus_keys, enter, t, gain=db(-15), delay_r=9)           # identical every time
        else:
            x = key_sound(rng, kind)
            g = -19 + rng.normal(0, 1.2) - (6 if kind == 'click' else 0)
            place(bus_keys, x, t + rng.normal(0, 0.002), gain=db(g), delay_r=9)

    bus_tap = np.zeros((N, 2))
    if clip.stop is not None:
        # stop tap: fingertip on the phone glass, right next to the mic
        tap = np.zeros(int(0.12 * SR)); tt = np.arange(len(tap)) / SR
        tap += damped(tt, 95, 0.018) * 1.0 + damped(tt, 210, 0.008, 1.0) * 0.5
        tap += bp(rng.standard_normal(len(tap)) * np.exp(-tt / 0.002), 1500, 7000) * 0.35
        tap *= (1 - np.exp(-tt / 0.0006))
        place(bus_tap, tap, clip.stop, gain=db(-8), delay_r=3)

    env = handling_envelope(clip, N)
    rum = lp(rng.standard_normal(N), 180, 4) * 3.0
    rus = bp(rng.standard_normal(N), 1500, 6000) * 0.25
    burst = lp(np.abs(rng.standard_normal(N)), 7, 2)
    burst = np.clip(burst / burst.mean(), 0, 3)                  # friction is irregular
    hand = (rum + rus * burst) * env * db(-28)
    bus_hand = np.stack([hand, hand * 0.9], 1)

    room = np.stack([pink(N, rng), pink(N, rng)], 1)
    room = np.stack([lp(hp(room[:, c], 40), 6000) for c in range(2)], 1) * db(-60)
    mod = 1 + 0.15 * np.sin(2 * np.pi * 0.07 * np.arange(N) / SR + rng.uniform(0, 6.28))
    fan = np.stack([bp(rng.standard_normal(N), 250, 2200) for _ in range(2)], 1) * db(-66) * mod[:, None]
    fan += (np.sin(2 * np.pi * 117.3 * np.arange(N) / SR) * db(-74))[:, None]
    hiss = rng.standard_normal((N, 2)) * db(-74)

    # trackpad friction (the shake): broadband swish, irregular, gone the moment the hand stops
    tpe = trackpad_envelope(clip, N)
    if tpe.any():
        sw = bp(rng.standard_normal(N), 700, 5500) * (0.6 + 0.4 * lp(np.abs(rng.standard_normal(N)), 30, 2) / 0.8)
        pad = sw * tpe * db(-43)
        pad = np.stack([pad, pad * 0.92], 1)
    else:
        pad = 0.0
    # dawn outside: H fades in over its first 1.5 s (morning arrives), K keeps it lower under everything
    dl = dawn_level(clip)
    if dl >= 0.25:
        b = birds(clip, N, rng) * db(-52 if clip.id == 'K' else -46)
        if clip.id != 'K':
            r = min(N, int(1.5 * SR)); b[:r] *= np.linspace(0, 1, r)[:, None] ** 2
    else:
        b = 0.0

    ir = room_ir(rng)
    wet = np.stack([signal.fftconvolve(bus_keys[:, c], ir[:, c])[:N] for c in range(2)], 1)
    mix = bus_keys + 0.18 * wet + bus_tap + bus_hand + room + fan + hiss + pad + b
    for c in range(2):                       # phone mic: HPF, presence lift, HF roll-off (linear only)
        x = hp(mix[:, c], 90, 2)
        b, a = signal.iirpeak(3500, 1.2, fs=SR)
        x = x + 0.25 * signal.lfilter(b, a, x)
        mix[:, c] = lp(x, 15000, 4)
    if fresh:
        ramp = int(0.06 * SR)                # recording starts: mic settles over ~60 ms
        mix[:ramp] *= np.linspace(0, 1, ramp)[:, None] ** 2
    if clip.stop is not None:
        z = min(N, int(round((clip.stop + ZERO_AFTER_TAP) * SR)))
        fade = int(0.004 * SR)
        mix[max(0, z - fade):z] *= np.linspace(1, 0, z - max(0, z - fade))[:, None]
        mix[z:] = 0.0
    return mix


def main():
    rig = camera.RIG
    enter = key_sound(np.random.default_rng(7), 'enter')        # ONE sample, reused verbatim
    keys = TL['keys']
    total = int(round(rig.nframes / FPS * SR))
    out = np.zeros((total, 2))
    zero_ranges = []
    nb = int(BRIDGE * SR)
    for i, clip in enumerate(rig.clips):
        s0 = int(round(clip.f0 / FPS * SR)); s1 = int(round((clip.f0 + clip.nf) / FPS * SR))
        ck = [(k['t'] - clip.t0, k['key']) for k in keys if k.get('clip', 'A') == clip.id]
        rng = np.random.default_rng(20261030 + 97 * i)
        prev = rig.clips[i - 1] if i else None
        nxt = rig.clips[i + 1] if i + 1 < len(rig.clips) else None
        fresh = prev is None or prev.stop is not None        # after a stop tap the next recording really starts from silence
        tail = nb if (nxt is not None and clip.stop is None) else 0
        seg = segment(clip, ck, rng, enter, s1 - s0 + tail, fresh=fresh)
        if not fresh:                                         # sound bridge, incoming side: equal-power fade-in
            seg[:nb] *= np.sin(0.5 * np.pi * np.linspace(0, 1, nb))[:, None]
        if tail:                                              # outgoing side: the room carries on past the cut (L-cut)
            seg[s1 - s0:] *= np.cos(0.5 * np.pi * np.linspace(0, 1, tail))[:, None]
        out[s0:s1 + tail] += seg
        # recorded effects for this clip (render/sfx.py -> build/sfx_<clip>.wav, clip-local, 48k stereo float)
        sp = f'{ROOT}/build/sfx_{clip.id}.wav'
        if clip.raw.get('lighter') and os.path.exists(sp):
            import scipy.io.wavfile as wf
            sr_, st = wf.read(sp)
            assert sr_ == SR and st.ndim == 2
            n = min(len(st), s1 - s0)
            out[s0:s0 + n] += st[:n]
            print(f'  + sfx_{clip.id}.wav ({len(st) / SR:.2f}s)')
        if clip.stop is not None:
            zero_ranges.append((s0 + int(round((clip.stop + ZERO_AFTER_TAP) * SR)), s1))
    # film score (music/build.py -> build/music.wav, full film length, 48k stereo float). MUSIC=0 to leave it out.
    mp = f'{ROOT}/build/music.wav'
    if os.environ.get('MUSIC', '1') != '0' and os.path.exists(mp):
        import scipy.io.wavfile as wf
        sr_, mus = wf.read(mp)
        assert sr_ == SR and mus.ndim == 2 and mus.dtype == np.float32, (sr_, mus.shape, mus.dtype)
        if abs(len(mus) - total) > SR // 100:
            print(f'  ! music.wav is {len(mus) / SR:.3f}s but the film is {total / SR:.3f}s: re-run bash music/run.sh')
        n = min(len(mus), total)
        out[:n] += mus[:n]
        print(f'  + music.wav (peak {20 * np.log10(np.abs(mus).max() + 1e-12):.1f} dBFS)')
    for a_, b_ in zero_ranges:                                # after a stop tap nothing survives, score included
        out[a_:b_] = 0.0
    peak = np.abs(out).max()
    print(f'peak {20 * np.log10(peak):.1f} dBFS, dur {total / SR:.3f}s, clips {len(rig.clips)}')
    pcm = np.clip(np.round(out * 32767), -32768, 32767).astype(np.int16)
    for a_, b_ in zero_ranges:
        assert not pcm[a_:b_].any()
    path = f'{ROOT}/build/audio.wav'
    with wave.open(path, 'wb') as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print('enter presses', sum(1 for k in keys if k['key'] == 'enter'), '| digital-zero ranges (s)',
          [(round(a_ / SR, 3), round(b_ / SR, 3)) for a_, b_ in zero_ranges])
    print('wrote', path)


if __name__ == '__main__':
    main()
