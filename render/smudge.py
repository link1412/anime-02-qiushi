"""Grime on the MacBook's glass: what a used screen actually carries.

    python3 render/smudge.py            # -> build/smudge.png (+ build/smudge_preview.jpg)

No keyboard imprints: the MacBook's keyboard deck is recessed and the lid gap keeps keys off
the glass on this model, so that would be a false detail.
Texture in panel millimetres (0.05 mm / texel, covers the whole 302.4 x 196.4 mm panel):
  R = oil film (fingerprints, cloth-wipe strokes, faint overall film)
  G = particles (dust specks, lint fibres, dried spittle droplets)
Deterministic (fixed seed). render.py and tool/renderer.js sample it on the outer glass plane,
GLASS_GAP mm in front of the pixel plane, so it has its own parallax and defocus.

Physical effects (render.py):
  * forward scatter of the display light through oil/particles -> local haze / halo on text
  * diffuse scatter of room light by oil/particles -> grime shows up mainly where a light source
    (desk lamp, dawn window, lighter flame) is near the specular direction
  * particles also occlude a little (dark specks on white, nearly invisible on dark UI)
"""
import os, sys, math
import numpy as np
import cv2

TEX = 0.05                       # mm per texel
PW_MM, PH_MM = 302.4, 196.4      # panel incl. notch strip (3024 x 1964 px at 0.1 mm)
TW, TH = int(round(PW_MM / TEX)), int(round(PH_MM / TEX))
GLASS_GAP = 0.7                  # mm, outer glass surface in front of the pixel plane
ROOT = os.environ.get('EP1', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = f'{ROOT}/build/smudge.png'


def mm2t(v):
    return v / TEX


def fbm(h, w, scale_t, octaves, rng, gain=0.5):
    """fractal noise in [0,1]-ish, feature size ~scale_t texels."""
    out = np.zeros((h, w), np.float32)
    amp, tot, s = 1.0, 0.0, float(scale_t)
    for _ in range(octaves):
        gh, gw = max(2, int(h / s) + 3), max(2, int(w / s) + 3)
        g = rng.standard_normal((gh, gw)).astype(np.float32)
        up = cv2.resize(g, (int(gw * s), int(gh * s)), interpolation=cv2.INTER_CUBIC)[:h, :w]
        if up.shape != (h, w):
            up = cv2.resize(g, (w, h), interpolation=cv2.INTER_CUBIC)
        out += amp * up; tot += amp
        amp *= gain; s /= 2
        if s < 1.5:
            break
    out /= tot
    return np.clip(out * 0.5 + 0.5, 0, 1)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def add_patch(dst, x0, y0, patch, mode='max'):
    h, w = patch.shape
    xa, ya = max(x0, 0), max(y0, 0)
    xb, yb = min(x0 + w, dst.shape[1]), min(y0 + h, dst.shape[0])
    if xa >= xb or ya >= yb:
        return
    src = patch[ya - y0:yb - y0, xa - x0:xb - x0]
    if mode == 'max':
        np.maximum(dst[ya:yb, xa:xb], src, out=dst[ya:yb, xa:xb])
    else:  # screen-like accumulation (oil layers add but saturate)
        d = dst[ya:yb, xa:xb]
        d[:] = 1 - (1 - d) * (1 - src)


# ---------------------------------------------------------------- fingerprints
def fingerprint(oil, rng, cx, cy, ang, a=7.0, b=9.5, pressure=0.8, smear=None, lam=0.48):
    R = max(a, b) * 1.6 + (np.hypot(*smear) if smear else 0)
    x0, y0 = int(mm2t(cx - R)), int(mm2t(cy - R))
    n = int(mm2t(2 * R))
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    X = (xx + x0 + 0.5) * TEX - cx; Y = (yy + y0 + 0.5) * TEX - cy
    c, s = math.cos(ang), math.sin(ang)
    u = c * X + s * Y; v = -s * X + c * Y
    # domain warp: ridges are never perfect ellipses
    wu = (fbm(n, n, mm2t(4.0), 2, rng) - 0.5) * 0.9
    wv = (fbm(n, n, mm2t(4.0), 2, rng) - 0.5) * 0.9
    uu, vv = u + wu, v + wv
    core_v = rng.uniform(-1.5, 1.0)
    # loop/whorl: elliptical rings around an off-centre core, opened towards the fingertip
    rr = np.sqrt((uu / 0.8) ** 2 + ((vv - core_v) / 1.0) ** 2)
    # loop: above the core the rings open into arches running across the finger
    arch = vv - core_v - 0.18 * uu ** 2 / (1 + 0.15 * np.abs(uu))
    blend = smoothstep(-0.5, 2.5, vv - core_v)
    phase = 2 * np.pi * ((1 - blend) * rr + blend * np.abs(arch) * 1.05) / lam
    ridge = smoothstep(0.15, 0.75, 0.5 + 0.5 * np.cos(phase))
    pores = smoothstep(0.25, 0.5, fbm(n, n, mm2t(0.3), 1, rng))         # breaks along ridges
    rm = np.sqrt((u / a) ** 2 + (v / b) ** 2) + (fbm(n, n, mm2t(2.5), 2, rng) - 0.5) * 0.3
    mask = smoothstep(1.0, 0.7, rm)
    press = smoothstep(1.1, 0.1, rm) ** 0.7
    val = pressure * mask * (0.15 + 0.85 * ridge * pores) * (0.4 + 0.6 * press) * 0.75
    if smear:
        L = np.hypot(*smear); k = max(3, int(mm2t(L)) | 1)
        ker = np.zeros((k, k), np.float32)
        cv2.line(ker, (0, k // 2), (k - 1, k // 2), 1.0, 1)
        M = cv2.getRotationMatrix2D((k / 2 - 0.5, k / 2 - 0.5), -math.degrees(math.atan2(smear[1], smear[0])), 1.0)
        ker = cv2.warpAffine(ker, M, (k, k)); ker /= ker.sum()
        val = 0.6 * cv2.filter2D(val, -1, ker) + 0.25 * val
    add_patch(oil, x0, y0, val.astype(np.float32), 'screen')


# ---------------------------------------------------------------- cloth wipe strokes
def wipe(oil, rng, x, y, heading, length, width=22.0, amp=0.08):
    """one hand-wiped stroke with a cloth: wandering path (curvature noise), width and pressure
    that vary along it, many parallel fibre streaks that break up, fading at both ends."""
    S = 8                                            # cv2 sub-texel shift bits = 3
    n = max(40, int(length / 0.6))
    ks = rng.normal(0, 1, 4); kp = rng.uniform(0, 2 * np.pi, 4)
    pts, hd = [], heading
    for i in range(n):
        u = i / (n - 1)
        pts.append((x, y, hd, u))
        curv = sum(ks[j] * math.sin(2 * np.pi * (j + 1) * 0.6 * u + kp[j]) for j in range(4)) * 0.03
        hd += curv * length / n * 0.6 + rng.normal(0, 0.004)
        hd = heading + float(np.clip(hd - heading, -0.9, 0.9))   # an arm sweep, never a loop
        x += math.cos(hd) * length / n; y += math.sin(hd) * length / n
    P = np.array(pts)
    u = P[:, 3]
    press = np.sin(np.pi * np.clip(u, 0, 1)) ** 0.7 * (0.6 + 0.4 * np.interp(u, np.linspace(0, 1, 7), rng.random(7)))
    wid = width * (0.7 + 0.5 * np.interp(u, np.linspace(0, 1, 5), rng.random(5)))
    can = np.zeros((TH, TW), np.float32)
    nx, ny = -np.sin(P[:, 2]), np.cos(P[:, 2])
    nst = int(width / 0.25)
    for k in range(nst):
        off = (k / (nst - 1) - 0.5)                  # across the cloth, -0.5..0.5
        strength = rng.random() ** 3 * (1 - (2 * off) ** 4)
        if strength < 0.02:
            continue
        # fibre contact comes and goes along the stroke
        on = np.interp(u, np.linspace(0, 1, 12), (rng.random(12) > 0.35).astype(float)) > 0.5
        xs = P[:, 0] + nx * off * wid + rng.normal(0, 0.05)
        ys = P[:, 1] + ny * off * wid + rng.normal(0, 0.05)
        seg = []
        for i in range(n):
            if on[i]:
                seg.append((int(xs[i] / TEX * S), int(ys[i] / TEX * S)))
            elif len(seg) > 1:
                cv2.polylines(can, [np.array(seg, np.int32)], False, float(strength), 1, cv2.LINE_AA, 3); seg = []
            else:
                seg = []
        if len(seg) > 1:
            cv2.polylines(can, [np.array(seg, np.int32)], False, float(strength), 1, cv2.LINE_AA, 3)
    # thin haze where the cloth spread the oil (wider, patchy), then scale by pressure
    band = np.zeros((TH, TW), np.float32)
    for i in range(0, n, 2):
        cv2.circle(band, (int(P[i, 0] / TEX * S), int(P[i, 1] / TEX * S)), int(wid[i] * 0.45 / TEX * S), float(press[i]), -1, cv2.LINE_AA, 3)
    x0 = int(max(0, P[:, 0].min() - width) / TEX); x1 = int(min(PW_MM, P[:, 0].max() + width) / TEX)
    y0 = int(max(0, P[:, 1].min() - width) / TEX); y1 = int(min(PH_MM, P[:, 1].max() + width) / TEX)
    if x1 <= x0 or y1 <= y0:
        return
    bb = cv2.GaussianBlur(band[y0:y1, x0:x1], (0, 0), mm2t(2.5))
    patchy = fbm(y1 - y0, x1 - x0, mm2t(3), 4, rng)
    val = amp * bb * (2.2 * can[y0:y1, x0:x1] + 0.25 * patchy)
    add_patch(oil, x0, y0, val.astype(np.float32), 'screen')


# ---------------------------------------------------------------- particles
def particles(dust, rng):
    S = 8          # draw sub-texel positions with cv2 shift
    # fine specks, mostly sub-texel: deposit coverage directly
    n = int(PW_MM * PH_MM / 100 * 5.5)
    xs = rng.uniform(0, PW_MM, n); ys = rng.uniform(0, PH_MM, n)
    rs = np.clip(rng.lognormal(math.log(0.012), 0.45, n), 0.004, 0.05)
    cov = np.pi * rs ** 2 / TEX ** 2
    ix = np.clip((xs / TEX).astype(int), 0, TW - 1); iy = np.clip((ys / TEX).astype(int), 0, TH - 1)
    np.add.at(dust, (iy, ix), cov.astype(np.float32))
    can = np.zeros((TH, TW), np.uint8)
    # larger grit
    m = int(PW_MM * PH_MM / 100 * 0.12)
    for _ in range(m):
        x, y = rng.uniform(0, PW_MM), rng.uniform(0, PH_MM)
        r = float(np.clip(rng.lognormal(math.log(0.045), 0.5), 0.03, 0.25))
        cv2.circle(can, (int(x / TEX * S), int(y / TEX * S)), max(1, int(r / TEX * S)), int(rng.uniform(90, 200)), -1, cv2.LINE_AA, 3)
    # lint fibres
    for _ in range(10):
        x, y = rng.uniform(5, PW_MM - 5), rng.uniform(5, PH_MM - 5)
        L = rng.uniform(0.6, 3.5); th = rng.uniform(0, 2 * np.pi)
        pts = []
        for i in range(24):
            pts.append((int(x / TEX * S), int(y / TEX * S)))
            th += rng.normal(0, 0.18); x += math.cos(th) * L / 24; y += math.sin(th) * L / 24
        w = rng.uniform(0.010, 0.022)
        cv2.polylines(can, [np.array(pts, np.int32)], False, int(160 * min(1, w / TEX)), 1, cv2.LINE_AA, 3)
    # dried spittle: clusters of tiny droplets with coffee-ring edges (talking at the screen)
    for cx, cy, sg, k in [(150, 105, 16, 28), (178, 118, 10, 14), (120, 92, 9, 9)]:
        for _ in range(k):
            x, y = rng.normal(cx, sg), rng.normal(cy, sg * 0.7)
            r = float(np.clip(rng.lognormal(math.log(0.09), 0.55), 0.04, 0.45))
            c = (int(x / TEX * S), int(y / TEX * S)); rr = max(1, int(r / TEX * S))
            cv2.circle(can, c, rr, 40, -1, cv2.LINE_AA, 3)
            cv2.circle(can, c, rr, 170, max(1, int(rr * 0.25 / S)) if rr > S * 4 else 1, cv2.LINE_AA, 3)
    np.maximum(dust, can.astype(np.float32) / 255, out=dust)
    np.clip(dust, 0, 1, out=dust)


def build(seed=20261030):
    rng = np.random.default_rng(seed)
    oil = np.zeros((TH, TW), np.float32)
    dust = np.zeros((TH, TW), np.float32)
    # faint overall film, a bit heavier toward the bottom (palm side) and edges
    film = fbm(TH, TW, mm2t(35), 5, rng)
    yy = np.linspace(0, 1, TH, dtype=np.float32)[:, None]
    oil += 0.012 + 0.03 * film * (0.6 + 0.6 * yy)
    # lid handling: thumbs at the top edge, fingers on the side edges; pointing at text mid-screen
    for cx, cy, ang, a, b, p, sm in [
        (151, 6.0, 1.75, 7.5, 10, 0.95, None), (139, 9.5, 1.35, 7, 9.5, 0.55, None),
        (163, 4.0, 1.9, 7, 9, 0.4, (3.0, 1.0)),
        (7.5, 42, 0.15, 7, 9.5, 0.7, None), (295, 55, -0.2, 7, 9.5, 0.6, (0.0, 4.0)),
        (206, 96, 0.4, 5.8, 7.8, 0.55, None), (101, 90, 0.25, 6.0, 8.0, 0.5, (1.5, 2.5)), (113, 129, -0.5, 6, 8, 0.45, (9.0, 3.0)),
        (243, 151, 0.9, 6.2, 8.2, 0.32, None), (62, 83, -0.1, 6, 8, 0.25, (2.0, 6.0)),
    ]:
        fingerprint(oil, rng, cx, cy, ang, a, b, p, sm)
    # a few careless cloth wipes, different directions and lengths
    for x, y, hd, L, w, amp in [(18, 150, -0.35, 190, 26, 0.09), (250, 30, 2.6, 140, 20, 0.08),
                                (120, 60, 0.15, 95, 18, 0.07), (60, 175, -1.1, 70, 22, 0.06),
                                (205, 120, 1.9, 85, 16, 0.06), (280, 170, -2.4, 60, 14, 0.05)]:
        wipe(oil, rng, x, y, hd, L, w, amp)
    particles(dust, rng)
    np.clip(oil, 0, 1, out=oil)
    return oil, dust


def save(oil, dust, path=OUT):
    img = np.zeros((TH, TW, 4), np.uint8)
    img[..., 2] = np.clip(oil * 255 + 0.5, 0, 255)      # BGRA: R = oil
    img[..., 1] = np.clip(dust * 255 + 0.5, 0, 255)     # G = particles
    img[..., 3] = 255
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cv2.imwrite(path, img, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    pv = cv2.resize(np.clip(oil * 4, 0, 1) * 0.8 + np.clip(dust, 0, 1) * 0.5, (TW // 4, TH // 4), interpolation=cv2.INTER_AREA)
    cv2.imwrite(path.replace('.png', '_preview.jpg'), np.clip(pv * 255, 0, 255).astype(np.uint8))


_cache = {}


def load(path=OUT):
    """float32 (TH, TW, 2): oil, dust; with a mip pyramid for footprint-filtered lookups."""
    if path not in _cache:
        if not os.path.exists(path):
            save(*build(), path=path)
        im = cv2.imread(path, cv2.IMREAD_UNCHANGED)
        base = np.dstack([im[..., 2], im[..., 1]]).astype(np.float32) / 255
        pyr = [base]
        while min(pyr[-1].shape[:2]) > 64:
            pyr.append(cv2.pyrDown(pyr[-1]))
        _cache[path] = pyr
    return _cache[path]


def sample(X, Y, sigma_tex):
    """oil, dust at glass-plane points X, Y (mm). sigma_tex: filter width in texels (scalar)."""
    pyr = load()
    lv = max(0.0, math.log2(max(sigma_tex, 1e-6) / 0.6))
    l0 = min(int(lv), len(pyr) - 1); l1 = min(l0 + 1, len(pyr) - 1); a = lv - int(lv)
    out = None
    for l, w in ((l0, 1 - a), (l1, a)):
        if w <= 0:
            continue
        sc = 1.0 / (TEX * 2 ** l)
        mx = (X * sc - 0.5).astype(np.float32); my = (Y * sc - 0.5).astype(np.float32)
        s = cv2.remap(pyr[l], mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        out = s * w if out is None else out + s * w
    return out[..., 0], out[..., 1]


if __name__ == '__main__':
    import time
    t0 = time.time()
    oil, dust = build()
    save(oil, dust)
    print(f'{OUT} {TW}x{TH} oil mean {oil.mean():.4f} max {oil.max():.3f} dust mean {dust.mean():.4f} ({time.time() - t0:.1f}s)')
