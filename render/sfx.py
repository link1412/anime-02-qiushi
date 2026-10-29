"""Clip sound effects from CC0 recordings (assets/sfx, see assets/sfx/SOURCES.md).

    python3 render/sfx.py C        # -> build/sfx_C.wav (stem) + build/sfx_C_preview.wav (with room bed)

Clip "lighter" (storyboard) drives it, so picture and sound share the same times:
  strike  -> lighter take: flint-wheel strike lands on the frame the sparks appear, the flame
             hiss tail runs to "out"
  drag    -> cigarette draw with ember crackle
  exhale  -> long breath out (unvoiced)
The recordings are close-miked and dry. Here they are placed ~35-45 cm from the phone, given the
same small-room reflections as the keyboard, and run through the same phone-mic colouring as
render/sound.py (linear processing only). Stem is clip-local time, 48 kHz stereo float WAV.
"""
import os, sys, json, math
import numpy as np
import scipy.io.wavfile as wf
from scipy import signal

sys.path.insert(0, os.path.dirname(__file__))
import camera
from sound import SR, db, hp, lp, bp, room_ir, pink

ROOT = camera.ROOT
SFX = f'{ROOT}/assets/sfx'

# file, (start, end) seconds used, onset within that file (s), gain dB
TAKES = {
    'lighter_bigsoundbank_2131': dict(seg=(0.0, 3.07), onset=0.1296, gain=-17.0),
    'bonus_drag_bigsoundbank_2132': dict(seg=(0.0, 1.79), onset=0.062, gain=-19.0),
    'exhale_bigsoundbank_1405': dict(seg=(1.86, 4.45), onset=0.12, gain=-16.0),
    'exhale_freesound_434830': dict(seg=(4.95, 5.85), onset=0.09, gain=14.0),
    'lighter_freesound_650745': dict(seg=(0.45, 0.95), onset=0.09, gain=0.0),
}


def load(name):
    import subprocess, tempfile
    src = next(f'{SFX}/{f}' for f in os.listdir(SFX) if f.startswith(name + '.'))
    cache = f'{ROOT}/build/sfx/{name}.wav'
    if not os.path.exists(cache) or os.path.getmtime(cache) < os.path.getmtime(src):
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', src, '-ac', '1', '-ar', str(SR),
                        '-c:a', 'pcm_f32le', cache], check=True)
    sr, x = wf.read(cache)
    assert sr == SR
    return x.astype(np.float64)


def take(name):
    cfg = TAKES[name]
    x = load(name)
    a, b = cfg['seg']
    y = x[int(a * SR):int(b * SR)].copy()
    f = int(0.012 * SR)
    y[:f] *= np.linspace(0, 1, f) ** 2
    y[-f * 3:] *= np.linspace(1, 0, f * 3) ** 2
    return y * db(cfg['gain']), cfg['onset']


def place(buf, x, t, onset, gain=1.0, delay_r=0):
    i = int(round((t - onset) * SR))
    if i < 0:
        x = x[-i:]; i = 0
    if i >= len(buf):
        return
    n = min(len(x), len(buf) - i)
    buf[i:i + n, 0] += x[:n] * gain
    j = i + delay_r
    n2 = min(len(x), len(buf) - j)
    if n2 > 0:
        buf[j:j + n2, 1] += x[:n2] * gain


def phone_mic(mix):
    for c in range(2):
        x = hp(mix[:, c], 90, 2)
        b, a = signal.iirpeak(3500, 1.2, fs=SR)
        x = x + 0.25 * signal.lfilter(b, a, x)
        mix[:, c] = lp(x, 15000, 4)
    return mix


def main(clip_id='C'):
    clip = next(c for c in camera.RIG.clips if c.id == clip_id)
    L = clip.raw.get('lighter')
    if not L:
        raise SystemExit(f'clip {clip_id} has no "lighter"')
    snd = L.get('sound', {})
    n = int(round(clip.dur * SR))
    bus = np.zeros((n, 2))
    tv = camera.tval
    x, on = take(snd.get('lighter', 'lighter_bigsoundbank_2131'))
    # the flame hiss stops when the thumb lets go
    out = tv(L['out']) - tv(L['strike'])
    k = int((on + out) * SR)
    if k < len(x):
        f = int(0.05 * SR)
        x[k:k + f] *= np.linspace(1, 0, len(x[k:k + f]))
        x[k + f:] = 0
    place(bus, x, tv(L['strike']), on, delay_r=11)          # lighter: in the right hand, ~35 cm
    if L.get('drag') and snd.get('drag', 'bonus_drag_bigsoundbank_2132'):
        x, on = take(snd.get('drag', 'bonus_drag_bigsoundbank_2132'))
        place(bus, x, tv(L['drag'][0]), on, delay_r=14)    # mouth, ~45 cm
    if L.get('exhale'):
        x, on = take(snd.get('exhale', 'exhale_bigsoundbank_1405'))
        place(bus, x, tv(L['exhale']), on, delay_r=14)
    rng = np.random.default_rng(int(clip.raw.get('seed', 0)) + 300)
    ir = room_ir(rng)
    wet = np.stack([signal.fftconvolve(bus[:, c], ir[:, c])[:n] for c in range(2)], 1)
    stem = phone_mic(bus + 0.22 * wet)
    pk = np.abs(stem).max()
    os.makedirs(f'{ROOT}/build', exist_ok=True)
    wf.write(f'{ROOT}/build/sfx_{clip_id}.wav', SR, stem.astype(np.float32))
    # audition copy with the room bed of render/sound.py (room tone, fan, hiss)
    room = np.stack([pink(n, rng), pink(n, rng)], 1)
    room = np.stack([lp(hp(room[:, c], 40), 6000) for c in range(2)], 1) * db(-60)
    fan = np.stack([bp(rng.standard_normal(n), 250, 2200) for _ in range(2)], 1) * db(-66)
    bed = phone_mic(room + fan) + rng.standard_normal((n, 2)) * db(-74)
    wf.write(f'{ROOT}/build/sfx_{clip_id}_preview.wav', SR, (stem + bed).astype(np.float32))
    print(f'build/sfx_{clip_id}.wav  {clip.dur:.3f}s  peak {20 * math.log10(pk):.1f} dBFS  '
          f'strike {tv(L["strike"]):.3f}  out {tv(L["out"]):.3f}  drag {tv(L["drag"][0]):.3f}  exhale {tv(L["exhale"]):.3f}')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'C')
