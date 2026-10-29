"""Lighter flame (and cigarette ember) seen as a reflection in the MacBook's glass.

Storyboard (per clip, optional):
  "lighter": {
    "strike": "C_ENTER+1.3",        # flint wheel; sparks for ~2 frames, flame from strike+0.03
    "out": "C_ENTER+3.45",          # thumb released: flame gone over ~2 frames
    "drag": ["C_ENTER+2.0", "C_ENTER+3.1"],   # inhale: flame pulled up into the cigarette
    "exhale": "C_ENTER+5.0",        # sound only (and the ember dims)
    "pos": [50, 58, -460],          # flame position, mm, panel frame (x right, y down, z<0 = room side)
    "ember": 1.0,                   # ember brightness scale (0 = none)
    "gain": 1.0                     # flame brightness scale
  }

The person (and their face lit by the flame) is deliberately absent from the reflection,
like the phone itself: same tell as the lamp-lit room with nobody in it.

All randomness is a deterministic function of time, so render.py and tool/lighter.js agree.
"""
import math
import numpy as np

FLAME_W, FLAME_H = 7.0, 22.0         # mm, luminous (yellow) region of a butane flame
FLAME_PEAK = 1.9                      # panel-linear radiance after glass reflectance (~1.5% x ~1e4 nit / white)
EMBER_PEAK = 0.55
FLAME_RGB = np.array([1.0, 0.52, 0.16], np.float32)
CORE_RGB = np.array([1.0, 0.78, 0.42], np.float32)
BLUE_RGB = np.array([0.25, 0.38, 1.0], np.float32)
EMBER_RGB = np.array([1.0, 0.30, 0.06], np.float32)
SPARK_RGB = np.array([1.0, 0.85, 0.6], np.float32)


def _n(t, seed, freqs):
    """smooth deterministic noise in ~[-1, 1] (sum of sines, fixed phases)."""
    v = 0.0
    for i, f in enumerate(freqs):
        ph = math.sin(seed * 12.9898 + i * 78.233) * 43758.5453
        ph = (ph - math.floor(ph)) * 2 * math.pi
        v += math.sin(2 * math.pi * f * t + ph) / (i + 1)
    return v / sum(1 / (i + 1) for i in range(len(freqs)))


def _smooth(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def state(cfg, t, tval):
    """flame/ember/sparks at clip-local time t. tval resolves time expressions.
    Returns dict or None. Positions in mm (panel frame)."""
    if not cfg:
        return None
    ts = tval(cfg['strike']); to = tval(cfg['out'])
    d0, d1 = (tval(cfg['drag'][0]), tval(cfg['drag'][1])) if cfg.get('drag') else (None, None)
    tex = tval(cfg['exhale']) if cfg.get('exhale') else None
    P = np.array(cfg.get('pos', [50, 58, -460]), np.float64)
    gain = float(cfg.get('gain', 1.0))
    out = {'flame': 0.0, 'pos': P.copy(), 'h': FLAME_H, 'w': FLAME_W, 'lean': 0.0,
           'ember': 0.0, 'ember_pos': P + np.array([0.0, -FLAME_H * 0.75, 6.0]), 'sparks': []}
    # hand: lighter comes up a little while lit, slow drift
    hand = np.array([2.5 * _n(t, 1, [0.35, 0.8]), 2.0 * _n(t, 2, [0.3, 0.7]), 4.0 * _n(t, 3, [0.25])])
    out['pos'] = P + hand
    # sparks (flint): two frames of tiny hot points just after the strike
    if ts <= t < ts + 0.07:
        u = (t - ts) / 0.07
        for k in range(5):
            a = math.sin(k * 91.7 + 3.1) * 0.5 + 0.5
            b = math.sin(k * 47.3 + 1.7) * 0.5 + 0.5
            sp = P + np.array([(a - 0.5) * 14, -4 - b * 8 + 30 * u * u, (b - 0.5) * 6])
            out['sparks'].append((sp, (1 - u) * (0.6 + 0.4 * a) * 40.0 * gain))
    # flame
    if ts + 0.03 <= t < to + 0.07:
        grow = _smooth((t - ts - 0.03) / 0.12)
        die = 1 - _smooth((t - to) / 0.07) if t >= to else 1.0
        flick = 1 + 0.10 * _n(t, 4, [6.3, 9.1, 13.7]) + 0.05 * _n(t, 5, [17.0, 23.0])
        h = FLAME_H * (0.55 + 0.45 * grow) * (1 + 0.12 * _n(t, 6, [4.1, 7.7, 11.3]))
        lean = 0.10 * _n(t, 7, [1.3, 2.9])
        if d0 is not None and d0 <= t < d1:
            # inhale: flame drawn up into the tip, taller and more agitated, small gulps
            k = _smooth((t - d0) / 0.25) * (1 - _smooth((t - d1 + 0.25) / 0.25))
            gulp = 0.5 + 0.5 * math.sin(2 * math.pi * 3.2 * (t - d0))
            h *= 1 + k * (0.35 + 0.15 * gulp)
            lean += k * 0.25 * _n(t, 8, [5.0, 8.0])
            flick *= 1 + k * 0.12 * _n(t, 9, [11.0, 19.0])
        out.update(flame=grow * die * flick * gain, h=h, lean=lean)
    # ember: lit once the drag starts; brightens while drawing, then smoulders
    if d0 is not None and t >= d0:
        if t < d1:
            e = 0.25 + 0.75 * _smooth((t - d0) / 0.5)
        else:
            e = 0.25 + 0.75 * math.exp(-(t - d1) / 0.6)
        if tex is not None and t >= tex:
            e *= 0.8
        out['ember'] = e * float(cfg.get('ember', 1.0)) * (1 + 0.08 * _n(t, 10, [2.0, 3.7]))
    if out['flame'] <= 0 and out['ember'] <= 0 and not out['sparks']:
        return None
    return out


def ambient_boost(st):
    """warm light the flame throws on the room (walls/ceiling seen in the glass)."""
    if not st:
        return 0.0
    return 0.010 * st['flame'] + 0.0008 * st['ember']


def project(p, X, fx, OW, OH):
    """world point -> (u, v, depth) in output px for camera pose p."""
    v = X - p['C']
    z = float(np.dot(v, p['fwd']))
    return OW / 2 + fx * float(np.dot(v, p['right'])) / z, OH / 2 + fx * float(np.dot(v, p['down'])) / z, z


def mirror(X):
    """virtual image of a room point in the screen plane z=0."""
    return np.array([X[0], X[1], -X[2]])


def _disc(r):
    r = max(r, 0.5)
    n = int(math.ceil(r)) * 2 + 3
    y, x = np.mgrid[0:n, 0:n] - (n - 1) / 2
    k = np.clip(r + 0.5 - np.sqrt(x * x + y * y), 0, 1).astype(np.float32)
    # slight bright rim (spherical aberration "soap bubble" bokeh of phone lenses)
    k *= 1 + 0.25 * np.clip(np.sqrt(x * x + y * y) / r, 0, 1) ** 4
    return k / k.sum()


def splat(img, p, st, fx, coc_fn, focus):
    """add the reflected flame/ember/sparks to img (OH, OW, 3 linear, output res) in place.
    coc_fn(depth_mm, focus_mm) -> blur diameter in output px."""
    import cv2
    OH, OW = img.shape[:2]
    srcs = []
    if st['flame'] > 0:
        srcs.append(('flame', st['pos'], st['flame']))
    if st['ember'] > 0:
        srcs.append(('ember', st['ember_pos'], st['ember']))
    for sp, a in st['sparks']:
        srcs.append(('spark', sp, a))
    for kind, X, a in srcs:
        u, v, z = project(p, mirror(X), fx, OW, OH)
        if z <= 1:
            continue
        s = fx / z                      # px per mm at the virtual image
        coc = float(coc_fn(np.array(z), focus))
        if kind == 'flame':
            w, h = st['w'] * s, st['h'] * s
            half = int(math.ceil(max(w, h) * 0.9 + coc + 6))
        else:
            half = int(math.ceil(coc + 6 + 3 * s))
        x0, y0 = int(u) - half, int(v) - half
        n = 2 * half + 1
        if x0 + n < 0 or y0 + n < 0 or x0 >= OW or y0 >= OH:
            continue
        yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
        dx = xx + x0 - u; dy = yy + y0 - v
        patch = np.zeros((n, n, 3), np.float32)
        if kind == 'flame':
            # teardrop: wide round bottom, tapering tip, leaning with the draught
            yl = -dy / max(h, 1e-3)                    # 0 at base, 1 at tip (up = -y)
            dxl = dx - st['lean'] * yl * h
            width = w * 0.5 * np.clip(np.sqrt(np.clip(1 - yl, 0, 1)) * np.clip(yl * 4 + 0.6, 0, 1), 0, 1)
            body = np.clip(1 - (dxl / np.maximum(width, 0.3)) ** 2, 0, 1) * ((yl > -0.08) & (yl < 1))
            body *= np.clip((yl + 0.08) / 0.15, 0, 1)
            core = np.exp(-((dxl / (w * 0.18 + 0.5)) ** 2 + ((yl - 0.25) / 0.22) ** 2))
            blue = np.exp(-((dxl / (w * 0.45 + 0.5)) ** 2 + ((yl + 0.03) / 0.06) ** 2))
            patch += body[..., None] * FLAME_RGB + core[..., None] * CORE_RGB * 0.8 + blue[..., None] * BLUE_RGB * 0.15
            patch *= FLAME_PEAK * a
        elif kind == 'ember':
            r = 3.0 * s * 0.5
            patch += (np.exp(-(dx * dx + dy * dy) / max(r * r, 0.25)))[..., None] * EMBER_RGB * EMBER_PEAK * a
        else:
            patch += (np.exp(-(dx * dx + dy * dy) / 0.6))[..., None] * SPARK_RGB * a
        if coc > 1.0:
            k = _disc(coc / 2)
            patch = cv2.filter2D(patch, -1, k, borderType=cv2.BORDER_CONSTANT)
        xa, ya = max(x0, 0), max(y0, 0)
        xb, yb = min(x0 + n, OW), min(y0 + n, OH)
        img[ya:yb, xa:xb] += patch[ya - y0:yb - y0, xa - x0:xb - x0]
    return img


def lobe_light(st):
    """point lights for the smudge scatter lobe: list of (pos_mm, rgb intensity)."""
    if not st:
        return []
    out = []
    if st['flame'] > 0:
        out.append((st['pos'] + np.array([0, -st['h'] * 0.35, 0]), FLAME_RGB * st['flame'] * 3.0))
    if st['ember'] > 0:
        out.append((st['ember_pos'], EMBER_RGB * st['ember'] * 0.06))
    return out
