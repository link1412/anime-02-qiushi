"""Physically-motivated render of a phone filming a MacBook LCD.

Per frame: rays from a virtual phone camera hit the panel plane; each sample sees one
LCD pixel through an RGB-stripe subpixel aperture (black matrix). The sensor point-samples
that pattern (phones have no optical low-pass filter -> real moire), then Bayer mosaic,
demosaic, downscale, depth-dependent defocus, glass reflection of the room, lens shading,
auto-exposure, sensor noise, tone mapping.
"""
import os, sys, json, math, time, functools
import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(__file__))
import compose
import camera
from camera import PP, FPS

cv2.setNumThreads(2)
OW, OH = 1920, 1080
SS = 2                      # sensor samples per output px (per axis)
SW, SH = OW * SS, OH * SS
RS = 0.022                  # rolling shutter readout (s)
EXPO = 1 / 50               # exposure time (s)
AE_TARGET = 0.045           # metered (centre-weighted, linear) target
MACRO_EXPO_CAP = 0.8
MACRO_SHUTTER = 1 / 240     # macro mode on a bright emissive subject: AE picks a fast shutter


def shutter_time(exposure, macro):
    """AE splits exposure into shutter x gain: dark scenes hold 1/50 and raise gain,
    bright scenes shorten the shutter first."""
    if macro:
        return MACRO_SHUTTER
    return float(np.clip(EXPO * exposure / 1.2, 1 / 250, EXPO))
ROOT = compose.ROOT
OUTDIR = os.environ.get('OUTDIR', f'{ROOT}/build/frames')
# 2 = phone ISP + glass grime + lighter (render_v2); 1 = the original pipeline, bit-identical
ISP = int(os.environ.get('ISP', '2'))
GRIME = float(os.environ.get('GRIME', '1'))     # scale for the smudge/dust layer (0 = clean glass)

# sRGB -> linear LUT
_lut = np.array([((i / 255) / 12.92) if i / 255 <= 0.04045 else (((i / 255) + 0.055) / 1.055) ** 2.4 for i in range(256)], np.float32)


@functools.lru_cache(maxsize=2)
def panel_linear(key):
    f = key
    P = compose.panel(f)
    return _lut[P]  # H,W,3 float32


def panel_for_frame(f):
    # cache key by composed content (ui file + clock string + battery)
    t = f / FPS
    k = (compose.ui_name(f), compose.clock_string(t), compose.battery_state(f))
    return _panel_by_key(k, f)


_pcache = {}
def _panel_by_key(k, f):
    if k not in _pcache:
        if len(_pcache) > 2:
            _pcache.pop(next(iter(_pcache)))
        _pcache[k] = _lut[compose.panel(f)]
    return _pcache[k]


@functools.lru_cache(maxsize=4)
def ndc_grid(w, h, fx):
    u = (np.arange(w, dtype=np.float32) + 0.5) / w * OW
    v = (np.arange(h, dtype=np.float32) + 0.5) / h * OH
    xn = (u - OW / 2) / fx
    yn = (v - OH / 2) / fx
    return xn[None, :], yn[:, None]


def intersect(p, xn, yn):
    """ray (camera ndc) -> panel plane z=0. returns X,Y (mm) and depth along optical axis (mm)."""
    r, d, f, C = p['right'], p['down'], p['fwd'], p['C']
    Dx = r[0] * xn + d[0] * yn + f[0]
    Dy = r[1] * xn + d[1] * yn + f[1]
    Dz = r[2] * xn + d[2] * yn + f[2]
    s = -C[2] / Dz
    X = C[0] + s * Dx
    Y = C[1] + s * Dy
    return X, Y, s  # s = depth along axis (since fwd component of ray dir is 1)


def screen_samples(pose, t, fx, w, h):
    """screen coords for each sample with rolling shutter (rows read top->bottom).
    pose = the clip's pose function, t = clip-local time."""
    xn, yn = ndc_grid(w, h, fx)
    pa = pose(t - RS / 2); pb = pose(t + RS / 2)
    Xa, Ya, Sa = intersect(pa, xn, yn)
    Xb, Yb, Sb = intersect(pb, xn, yn)
    a = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    return Xa * (1 - a) + Xb * a, Ya * (1 - a) + Yb * a, Sa * (1 - a) + Sb * a


def lcd_sample(Plin, X, Y, k_m):
    """LCD emission seen at screen points: pixel colour x RGB-stripe aperture."""
    H, W = Plin.shape[:2]
    px = X / PP; py = Y / PP
    inside = (px >= 0) & (px < W) & (py >= 0) & (py < H)
    ix = np.clip(px.astype(np.int32), 0, W - 1); iy = np.clip(py.astype(np.int32), 0, H - 1)
    col = Plin[iy, ix]                                   # h,w,3
    fxp = px - np.floor(px); fyp = py - np.floor(py)
    sub = fxp * 3.0
    k = np.floor(sub).astype(np.int8); g = sub - k
    # soft rectangular aperture: 74% width (black matrix between stripes), 88% height
    def win(x, lo, hi, e):
        return np.clip((x - lo) / e, 0, 1) * np.clip((hi - x) / e, 0, 1)
    ap = win(g, 0.13, 0.87, 0.06) * win(fyp, 0.06, 0.94, 0.05)
    fill = 0.74 * 0.88
    out = np.empty_like(col)
    for c in range(3):
        m = np.where(k == c, ap * (3.0 / fill), 0.0).astype(np.float32)
        out[..., c] = col[..., c] * (1.0 + k_m * (m - 1.0))
    out *= inside[..., None]
    return out, inside


def env_reflection(p, w, h, fx, dawn=0.0):
    """Room reflected in the glossy glass: dim walls, one warm lamp up-left behind the phone,
    and (dawn > 0) cool window light up-right. No person and no phone in it.
    tool/renderer.js has the same model."""
    xn, yn = ndc_grid(w, h, fx)
    r, d, f = p['right'], p['down'], p['fwd']
    Dx = r[0] * xn + d[0] * yn + f[0]; Dy = r[1] * xn + d[1] * yn + f[1]; Dz = r[2] * xn + d[2] * yn + f[2]
    n = np.sqrt(Dx * Dx + Dy * Dy + Dz * Dz)
    Dx, Dy, Dz = Dx / n, Dy / n, Dz / n
    Rx, Ry, Rz = Dx, Dy, -Dz          # mirror about screen plane, points back into the room
    # lamp direction (upper-left, behind the viewer, ~23 deg off the screen normal so its
    # reflection sits at the top-left edge of the frame)
    L = np.array([-0.25, -0.27, -0.93]); L /= np.linalg.norm(L)
    cosang = Rx * L[0] + Ry * L[1] + Rz * L[2]
    lamp = (np.exp((cosang - 1) / 0.006) * 1.3 + np.exp((cosang - 1) / 0.05) * 0.10) * (1 - 0.75 * dawn)
    ceiling = np.clip(-Ry, 0, 1) ** 1.5 * 0.035
    base = 0.010 + ceiling + 0.03 * dawn
    rgb = np.stack([lamp * 1.0 + base * 1.0, lamp * 0.80 + base * 0.95, lamp * 0.55 + base * 0.9], -1)
    if dawn > 0:
        Wd = np.array([0.16, -0.21, -0.96]); Wd /= np.linalg.norm(Wd)
        cw = Rx * Wd[0] + Ry * Wd[1] + Rz * Wd[2]
        win = (np.exp((cw - 1) / 0.02) * 2.6 + np.exp((cw - 1) / 0.12) * 0.35) * dawn
        rgb = rgb + win[..., None] * np.array([0.78, 0.9, 1.08])
    return rgb.astype(np.float32)


def blur_stack_apply(img, sig):
    """spatially varying gaussian blur by interpolating a stack."""
    levels = [0, 0.8, 1.6, 3.2, 6.4, 12.8, 25.6]
    out = np.zeros_like(img)
    sig = np.clip(sig, 0, levels[-1])
    prev = img
    stack = [img]
    for s in levels[1:]:
        k = int(s * 3) * 2 + 1
        if s > 6:  # blur a downsampled copy for speed
            sc = 4
            small = cv2.resize(img, (img.shape[1] // sc, img.shape[0] // sc), interpolation=cv2.INTER_AREA)
            b = cv2.GaussianBlur(small, (0, 0), s / sc)
            stack.append(cv2.resize(b, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_LINEAR))
        else:
            stack.append(cv2.GaussianBlur(img, (0, 0), s))
    idx = np.searchsorted(levels, sig, side='right') - 1
    idx = np.clip(idx, 0, len(levels) - 2)
    lv = np.array(levels, np.float32)
    a = ((sig - lv[idx]) / (lv[idx + 1] - lv[idx]))[..., None]
    for i in range(len(levels) - 1):
        m = (idx == i)[..., None]
        if m.any():
            out += np.where(m, stack[i] * (1 - a) + stack[i + 1] * a, 0)
    return out


def coc_px(depth, sf, macro):
    """circle of confusion diameter in output px."""
    if macro:
        f, N, sensw = 2.22, 2.2, 1.8    # ultra-wide macro, cropped heavily
    else:
        f, N, sensw = 6.86, 1.78, 4.9   # main lens, 2x crop
    A = (f * f / (N * max(sf - f, 1e-3))) / sensw * OW
    return A * np.abs(depth - sf) / np.maximum(depth, 1e-3)


def tone(x):
    # gentle filmic shoulder, then sRGB
    W = 6.0
    y = x * (1 + x / (W * W)) / (1 + x)
    y = np.clip(y * 1.12, 0, 1)
    y = np.where(y <= 0.0031308, 12.92 * y, 1.055 * np.power(y, 1 / 2.4) - 0.055)
    return y


def render(f, exposure, seed=0, preview=False, panel=None, state=None):
    if ISP >= 2 and not preview:
        return render_v2(f, exposure, seed=seed, panel=panel, state=state)
    clip, t = camera.RIG.locate(f)          # t = clip-local time
    pose = clip.pose
    p = pose(t)
    fx = p['fx']; macro = p['macro']
    sf = camera.RIG.focus[min(f, len(camera.RIG.focus) - 1)]
    Plin = panel_for_frame(f) if panel is None else panel
    sw, sh = (SW, SH) if not preview else (OW, OH)
    # motion blur: number of temporal samples from image-space speed
    shut = shutter_time(exposure, macro)
    p0 = pose(t - shut / 2); p1 = pose(t + shut / 2)
    c0 = intersect(p0, np.array([[0.0]]), np.array([[0.0]])); c1 = intersect(p1, np.array([[0.0]]), np.array([[0.0]]))
    mv = math.hypot((c1[0] - c0[0]).item(), (c1[1] - c0[1]).item()) / p['dist'] * fx  # output px
    nt = int(min(8, max(1, math.ceil(mv / 1.2))))
    acc = None
    for j in range(nt):
        tj = t + (j + 0.5) / nt * shut - shut / 2 if nt > 1 else t
        X, Y, S = screen_samples(pose, tj, fx, sw, sh)
        # residual subpixel contrast after optics/defocus at this sample (prefilter)
        fp = (S / (fx * sw / OW)) / PP                      # screen px per sensor px
        cocs = coc_px(S, sf, macro) * (sw / OW) / 2.4        # sigma in sensor px
        sig = np.sqrt(0.55 ** 2 + cocs ** 2)
        k_m = np.exp(-2 * (math.pi ** 2) * (sig * fp) ** 2).astype(np.float32)[..., None]
        img, inside = lcd_sample(Plin, X, Y, k_m[..., 0])
        acc = img if acc is None else acc + img
    img = acc / nt
    if not preview:
        # lens PSF + pixel aperture, Bayer mosaic and demosaic (false colour on fine detail)
        img = cv2.GaussianBlur(img, (0, 0), 0.6 if not macro else 1.1)
        q = np.clip(img / 8.0, 0, 1)
        bay = np.zeros(q.shape[:2], np.float32)
        bay[0::2, 0::2] = q[0::2, 0::2, 0]
        bay[0::2, 1::2] = q[0::2, 1::2, 1]
        bay[1::2, 0::2] = q[1::2, 0::2, 1]
        bay[1::2, 1::2] = q[1::2, 1::2, 2]
        b16 = (bay * 65535).astype(np.uint16)
        dem = cv2.cvtColor(b16, cv2.COLOR_BayerBG2RGB).astype(np.float32) / 65535 * 8.0  # cv2 naming: RGGB pattern
        img = cv2.resize(dem, (OW, OH), interpolation=cv2.INTER_AREA)
        X, Y, S = screen_samples(pose, t, fx, OW, OH)
    else:
        X, Y, S = screen_samples(pose, t, fx, OW, OH)
    # depth-dependent defocus (content), at output resolution
    sig = coc_px(S, sf, macro) / 2.4
    img = blur_stack_apply(img, sig.astype(np.float32))
    # reflection of the room in the glass (also defocused, it is far away)
    refl = env_reflection(p, OW, OH, fx, dawn=compose.dawn(f))
    rs = cv2.GaussianBlur(refl, (0, 0), 18 if not macro else 40)
    img = img + rs * 0.035
    # veiling glare / halation
    hl = np.clip(img - 0.6, 0, None)
    img = img + cv2.GaussianBlur(hl, (0, 0), 6) * 0.05 + cv2.GaussianBlur(img, (0, 0), 40) * 0.025
    # lens shading + lateral CA
    yy, xx = np.mgrid[0:OH, 0:OW].astype(np.float32)
    rr = ((xx - OW / 2) ** 2 + (yy - OH / 2) ** 2) / ((OW / 2) ** 2 + (OH / 2) ** 2)
    img *= (1 - 0.16 * rr)[..., None]
    for c, sc in [(0, 1.0007), (2, 0.9992)]:
        M = np.array([[sc, 0, (1 - sc) * OW / 2], [0, sc, (1 - sc) * OH / 2]], np.float32)
        img[..., c] = cv2.warpAffine(img[..., c], M, (OW, OH), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    # white balance (screen white reads slightly cool under warm room light) and exposure
    img *= np.array([0.965, 1.0, 1.05], np.float32) * exposure
    # sensor noise (shot + read), with chroma blotches; gain rises with exposure
    rng = np.random.default_rng(1000 + f * 7 + seed)
    gain = exposure / 3.0 * (EXPO / shut)   # analogue gain = exposure / shutter
    sd = np.sqrt(np.clip(img, 0, None) * 0.0009 * gain + (0.0028 * gain) ** 2)
    nl = rng.standard_normal((OH, OW, 1), dtype=np.float32)
    nc = cv2.resize(rng.standard_normal((OH // 3, OW // 3, 3), dtype=np.float32), (OW, OH), interpolation=cv2.INTER_LINEAR)
    img = img + sd * (0.8 * nl + 0.35 * nc)
    out = tone(np.clip(img, 0, None))
    # phone look: slight saturation pull + contrast
    lum = (out * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1, keepdims=True)
    out = lum + (out - lum) * 0.92
    # phone sharpening (luma unsharp mask)
    bl = cv2.GaussianBlur(out, (0, 0), 1.3)
    out = out + 0.45 * (out - bl)
    return (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)


# ====================================================================== v2
# Optical image at sensor resolution -> glass layer (grime haze, room/lamp/window/flame
# reflections and their scatter off the grime) -> lens -> phone ISP (render/isp.py).
import isp as ISPM
import smudge
import lighter

SCALE = ISPM.SENSOR_W / OW          # photosites per output px (per axis)
K_OIL, K_DUST = 0.035, 0.15          # diffuse scatter of room light by oil film / particles
AMB = 0.015                         # room light reaching the glass (lamp-lit room at night)
LOBE_OIL, LOBE_DUST = 0.02, 0.08    # scatter lobe widths (1 - cos), ~11 deg and ~23 deg
WARM = np.array([1.0, 0.82, 0.6], np.float32)
LAMP_DIR = np.array([-0.25, -0.27, -0.93]) / np.linalg.norm([-0.25, -0.27, -0.93])
WIN_DIR = np.array([0.16, -0.21, -0.96]) / np.linalg.norm([0.16, -0.21, -0.96])


def glass_hits(p, w, h, fx):
    """camera rays -> outer glass surface (z = -GLASS_GAP). X, Y (mm), depth, unit ray dirs."""
    xn, yn = ndc_grid(w, h, fx)
    r, d, fw, C = p['right'], p['down'], p['fwd'], p['C']
    Dx = r[0] * xn + d[0] * yn + fw[0]; Dy = r[1] * xn + d[1] * yn + fw[1]; Dz = r[2] * xn + d[2] * yn + fw[2]
    s = (-smudge.GLASS_GAP - C[2]) / Dz
    n = np.sqrt(Dx * Dx + Dy * Dy + Dz * Dz)
    return C[0] + s * Dx, C[1] + s * Dy, s, (Dx / n, Dy / n, Dz / n)


def scatter_lobes(X, Y, D, dawn, lights, w):
    """light arriving near the specular direction, spread by a scatter lobe of width w."""
    Rx, Ry, Rz = D[0], D[1], -D[2]
    out = np.zeros(X.shape + (3,), np.float32)
    ca = Rx * LAMP_DIR[0] + Ry * LAMP_DIR[1] + Rz * LAMP_DIR[2]
    out += (np.exp((ca - 1) / w) * (1 - 0.75 * dawn))[..., None] * np.array([1.0, 0.8, 0.55], np.float32)
    if dawn > 0:
        cw = Rx * WIN_DIR[0] + Ry * WIN_DIR[1] + Rz * WIN_DIR[2]
        out += (np.exp((cw - 1) / w) * 1.6 * dawn)[..., None] * np.array([0.78, 0.9, 1.08], np.float32)
    for F, rgb in lights:
        vx, vy, vz = F[0] - X, F[1] - Y, F[2] + smudge.GLASS_GAP
        n = np.sqrt(vx * vx + vy * vy + vz * vz)
        c = (Rx * vx + Ry * vy + Rz * vz) / n
        out += np.exp((c - 1) / w)[..., None] * (np.asarray(rgb, np.float32) * 1.5)
    return out


def awb_drift(clip, t):
    """slow auto-white-balance wander, ~±1.5% (Yue et al. had to lock AWB to stop it)."""
    s = int(clip.raw.get('seed', 0))
    return np.array([1 + 0.015 * lighter._n(t, 50 + s, [0.11, 0.23]), 1.0,
                     1 + 0.015 * lighter._n(t, 70 + s, [0.09, 0.19])], np.float32)


def render_v2(f, exposure, seed=0, panel=None, state=None):
    """state: dict carried between consecutive frames (temporal NR). None = no TNR."""
    clip, t = camera.RIG.locate(f)
    pose = clip.pose
    p = pose(t)
    fx = p['fx']; macro = p['macro']
    sf = camera.RIG.focus[min(f, len(camera.RIG.focus) - 1)]
    Plin = panel_for_frame(f) if panel is None else panel
    sw, sh = ISPM.SENSOR_W, ISPM.SENSOR_H
    shut = shutter_time(exposure, macro)
    p0 = pose(t - shut / 2); p1 = pose(t + shut / 2)
    c0 = intersect(p0, np.array([[0.0]]), np.array([[0.0]])); c1 = intersect(p1, np.array([[0.0]]), np.array([[0.0]]))
    mv = math.hypot((c1[0] - c0[0]).item(), (c1[1] - c0[1]).item()) / p['dist'] * fx
    nt = int(min(8, max(1, math.ceil(mv / 1.2))))
    acc = None
    for j in range(nt):
        tj = t + (j + 0.5) / nt * shut - shut / 2 if nt > 1 else t
        X, Y, S = screen_samples(pose, tj, fx, sw, sh)
        fp = (S / (fx * sw / OW)) / PP
        cocs = coc_px(S, sf, macro) * (sw / OW) / 2.4
        sig = np.sqrt(0.55 ** 2 + cocs ** 2)
        k_m = np.exp(-2 * (math.pi ** 2) * (sig * fp) ** 2).astype(np.float32)
        img, _ = lcd_sample(Plin, X, Y, k_m)
        acc = img if acc is None else acc + img
    img = acc / nt
    # optical defocus happens before the sensor samples anything
    sigS = (coc_px(S, sf, macro) / 2.4 * (sw / OW)).astype(np.float32)
    if float(sigS.max()) > 0.35:
        img = blur_stack_apply(img, sigS)
    img = cv2.GaussianBlur(img, (0, 0), (0.6 if not macro else 1.1) * SCALE / 2)

    # ---- glass layer (output resolution, upsampled: all of it is smooth at sensor scale)
    dawn = compose.dawn(f)
    st = lighter.state(clip.raw.get('lighter'), t, camera.tval)
    Xg, Yg, Sg, D = glass_hits(p, OW, OH, fx)
    depth_c = float(np.median(Sg))
    fpt = depth_c / fx / smudge.TEX                                   # texels per output px
    cocg = float(coc_px(np.array(depth_c), sf, macro))               # glass is ~0.7 mm nearer
    if not macro:
        cocg = max(cocg, float(coc_px(np.array(depth_c - smudge.GLASS_GAP), sf, macro)))
    oil, dust = smudge.sample(Xg, Yg, math.hypot(0.5 * fpt, cocg / 2.4 * fpt))
    oil = oil * GRIME; dust = dust * GRIME
    small = cv2.resize(img, (OW, OH), interpolation=cv2.INTER_AREA)
    # forward scatter of the display's own light through the grime (~0.6 mm spread)
    h = np.clip(0.30 * oil + 0.35 * dust, 0, 0.6)[..., None]
    if GRIME > 0:
        Eb = cv2.GaussianBlur(small, (0, 0), max(0.6 * fx / depth_c, 0.5))
        hu = cv2.resize(h, (sw, sh), interpolation=cv2.INTER_LINEAR)[..., None]
        img = img * (1 - hu) + cv2.resize(Eb * h, (sw, sh), interpolation=cv2.INTER_LINEAR)
    # specular room reflection (as v1) + the flame's warm spill on the room
    refl = env_reflection(p, OW, OH, fx, dawn=dawn)
    R_out = cv2.GaussianBlur(refl, (0, 0), 18 if not macro else 40) * 0.035
    R_out += lighter.ambient_boost(st) * WARM
    if st:
        lighter.splat(R_out, p, st, fx, lambda z, s: coc_px(z, s, macro), sf)
    # diffuse scatter of room light / lamp / window / flame by the grime
    if GRIME > 0:
        lights = lighter.lobe_light(st)
        amb = (AMB * (1 + 3 * dawn) + 3 * lighter.ambient_boost(st)) * WARM
        R_out += K_OIL * oil[..., None] * (amb + scatter_lobes(Xg, Yg, D, dawn, lights, LOBE_OIL))
        R_out += K_DUST * dust[..., None] * (amb + scatter_lobes(Xg, Yg, D, dawn, lights, LOBE_DUST))
        # particles also block a little of the display light
        img *= 1 - 0.25 * cv2.resize(dust, (sw, sh), interpolation=cv2.INTER_LINEAR)[..., None]
    small = small + R_out
    hl = np.clip(small - 0.6, 0, None)
    glare = cv2.GaussianBlur(hl, (0, 0), 6) * 0.05 + cv2.GaussianBlur(small, (0, 0), 40) * 0.025
    # very hot sources (the flame core): wider bloom + the phone lens ghost, a dim green-cyan
    # copy mirrored through the image centre (internal reflection between lens and IR filter)
    hot = np.clip(small * exposure - 2.5, 0, None) / max(exposure, 1e-3)
    if float(hot.max()) > 0:
        glare += cv2.GaussianBlur(hot, (0, 0), 22) * 0.06
        gh = cv2.GaussianBlur(hot[::-1, ::-1], (0, 0), 5) * 0.03
        glare += (gh @ np.array([0.3, 0.33, 0.37], np.float32))[..., None] * np.array([0.55, 1.0, 0.75], np.float32)
    img += cv2.resize(R_out + glare, (sw, sh), interpolation=cv2.INTER_LINEAR)
    # ---- lens shading + lateral CA (sensor resolution)
    yy, xx = np.mgrid[0:sh, 0:sw].astype(np.float32)
    rr = ((xx - sw / 2) ** 2 + (yy - sh / 2) ** 2) / ((sw / 2) ** 2 + (sh / 2) ** 2)
    img *= (1 - 0.16 * rr)[..., None]
    del xx, yy, rr
    for c, sc in [(0, 1.0007), (2, 0.9992)]:
        M = np.array([[sc, 0, (1 - sc) * sw / 2], [0, sc, (1 - sc) * sh / 2]], np.float32)
        img[..., c] = cv2.warpAffine(img[..., c], M, (sw, sh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    img *= np.array([0.965, 1.0, 1.05], np.float32) * awb_drift(clip, t) * exposure
    # ---- phone ISP
    rng = np.random.default_rng(1000 + f * 7 + seed)
    gain = exposure / 3.0 * (EXPO / shut)
    bay = ISPM.mosaic(ISPM.to_raw(img))
    del img
    bay = ISPM.raw_noise(bay, gain, rng, SCALE * SCALE)
    rgb = ISPM.chroma_nr_sensor(ISPM.develop(ISPM.demosaic(bay)), gain)
    del bay
    out_lin = cv2.resize(rgb, (OW, OH), interpolation=cv2.INTER_AREA)
    del rgb
    if state is not None:
        ok = state.get('prev') is not None and state.get('f') == f - 1 and state.get('clip') == clip.id \
            and state.get('macro') == macro
        if ok:
            pw = ISPM.warp_prev(state['prev'], p, state['pose'], fx, state['fx'], intersect, ndc_grid)
            out_lin = ISPM.tnr(out_lin, pw, gain)
        state.update(prev=out_lin, f=f, clip=clip.id, macro=macro, pose=p, fx=fx)
    out = tone(np.clip(out_lin, 0, None)).astype(np.float32)
    out = ISPM.yuv_stage(out)
    lum = (out * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1, keepdims=True)
    out = lum + (out - lum) * 0.92
    return (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)


_MW = None


def flame_meter(f):
    """centre-weighted luma the lighter reflection adds to the AE metering (v2)."""
    global _MW
    clip, t = camera.RIG.locate(f)
    st = lighter.state(clip.raw.get('lighter'), t, camera.tval)
    if not st:
        return 0.0
    p = clip.pose(t)
    sf = camera.RIG.focus[min(f, len(camera.RIG.focus) - 1)]
    im = np.zeros((OH, OW, 3), np.float32)
    lighter.splat(im, p, st, p['fx'], lambda z, s: coc_px(z, s, p['macro']), sf)
    if _MW is None:
        yy, xx = np.mgrid[0:OH, 0:OW].astype(np.float32)
        _MW = np.exp(-(((xx - OW / 2) / (OW * 0.4375)) ** 2 + ((yy - OH / 2) / (OH / 2)) ** 2))
        _MW /= _MW.sum()
    return float(((im @ np.array([0.2126, 0.7152, 0.0722], np.float32)) * _MW).sum())


def scene_luma(f, panel=None):
    """cheap metering pass for auto-exposure."""
    clip, t = camera.RIG.locate(f)
    p = clip.pose(t)
    Plin = panel_for_frame(f) if panel is None else panel
    X, Y, S = screen_samples(clip.pose, t, p['fx'], 160, 90)
    H, W = Plin.shape[:2]
    px = np.clip((X / PP).astype(int), 0, W - 1); py = np.clip((Y / PP).astype(int), 0, H - 1)
    inside = (X / PP >= 0) & (X / PP < W) & (Y / PP >= 0) & (Y / PP < H)
    col = Plin[py, px] * inside[..., None]
    lum = (col * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(-1)
    # center-weighted
    yy, xx = np.mgrid[0:90, 0:160]
    wgt = np.exp(-(((xx - 80) / 70) ** 2 + ((yy - 45) / 45) ** 2))
    return float((lum * wgt).sum() / wgt.sum())


def exposure_sig():
    """what the AE track depends on: camera paths, screen content, AE parameters."""
    import hashlib
    sb = camera.RIG.sb
    cam = [[c.get(k) for k in ('id', 'dur', 'keys', 'macro', 'stop_tap', 'seed', 'clock', 'battery')] for c in sb['clips']]
    if ISP >= 2:   # v2 meters the lighter reflection too
        cam.append([c.get('lighter') for c in sb['clips']])
    idx = open(f'{ROOT}/build/ui_index.json', 'rb').read()
    h = hashlib.md5(json.dumps([cam, AE_TARGET, MACRO_EXPO_CAP], sort_keys=True).encode() + idx)
    return h.hexdigest()


def exposure_track(nf=None):
    """per-frame AE; every clip is a new recording: starts over-exposed, then settles."""
    nf = nf or nframes()
    path = f'{ROOT}/build/exposure.json'
    sig = exposure_sig()
    if os.path.exists(path):
        d = json.load(open(path))
        if isinstance(d, dict) and d.get('sig') == sig and len(d['e']) >= nf:
            return d['e']
    e = []; cur = None; last_clip = None
    for f in range(nf):
        clip, t = camera.RIG.locate(f)
        L = scene_luma(f) + (flame_meter(f) if ISP >= 2 else 0.0)
        target = float(np.clip(AE_TARGET / max(L, 1e-4), 0.55, 3.4))
        if clip.pose(t)['macro']:
            # highlight protection: at macro scale lit subpixels are ~4.6x the pixel value;
            # keep them coloured instead of clipping to white
            target = min(target, MACRO_EXPO_CAP)
        if clip is not last_clip:
            cur = target * 2.2  # recording starts over-exposed, then AE settles
            last_clip = clip
        cur = cur * math.exp(math.log(target / cur) * (1 - math.exp(-(1 / FPS) / 0.33)))
        e.append(cur)
    json.dump({'sig': sig, 'e': e}, open(path, 'w'))
    return e


def exposure_cached():
    """the stored AE track if it matches the current storyboard/screen, else None (no compute)."""
    path = f'{ROOT}/build/exposure.json'
    if not os.path.exists(path):
        return None
    d = json.load(open(path))
    return d['e'] if isinstance(d, dict) and d.get('sig') == exposure_sig() else None


def nframes():
    return camera.RIG.nframes


if __name__ == '__main__':
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--frames', default='')
    ap.add_argument('--start', type=int, default=0)
    ap.add_argument('--end', type=int, default=-1)
    ap.add_argument('--step', type=int, default=1)
    ap.add_argument('--offset', type=int, default=0)
    ap.add_argument('--preview', action='store_true')
    a = ap.parse_args()
    os.makedirs(OUTDIR, exist_ok=True)
    nf = nframes()
    if a.frames and exposure_cached() is None:
        ex = {}   # single-frame check: approximate AE instead of metering the whole film
        for f in [int(x) for x in a.frames.split(',')]:
            clip, t = camera.RIG.locate(f)
            L = scene_luma(f) + (flame_meter(f) if ISP >= 2 else 0.0)
            target = float(np.clip(AE_TARGET / max(L, 1e-4), 0.55, 3.4))
            if clip.pose(t)['macro']:
                target = min(target, MACRO_EXPO_CAP)
            ex[f] = target * (1 + 1.2 * math.exp(-t / 0.33))
    else:
        ex = exposure_track(nf)
    frames = [int(x) for x in a.frames.split(',')] if a.frames else list(range(a.start + a.offset, nf if a.end < 0 else a.end, a.step))
    # temporal NR (v2) needs the previous frame: render contiguous ranges (--step 1); a frame
    # whose predecessor was not just rendered gets TNR_WARMUP unsaved frames first (same clip)
    WARM = int(os.environ.get('TNR_WARMUP', '3'))
    tnr_state = {} if (ISP >= 2 and not a.preview) else None

    def ex_at(g):
        if isinstance(ex, dict) and g not in ex:
            c, u = camera.RIG.locate(g)
            L = scene_luma(g) + flame_meter(g)
            tg = float(np.clip(AE_TARGET / max(L, 1e-4), 0.55, 3.4))
            ex[g] = (min(tg, MACRO_EXPO_CAP) if c.pose(u)['macro'] else tg) * (1 + 1.2 * math.exp(-u / 0.33))
        return ex[g]

    for f in frames:
        out = f'{OUTDIR}/f_{f:05d}.png'
        if os.path.exists(out) and not a.frames:
            continue
        t0 = time.time()
        if tnr_state is not None and tnr_state.get('f') != f - 1:
            c = camera.RIG.locate(f)[0]
            for g in range(max(c.f0, f - WARM), f):
                render(g, ex_at(g), state=tnr_state)
        im = render(f, ex_at(f), preview=a.preview, state=tnr_state)
        tmp = out + '.tmp.png'
        cv2.imwrite(tmp, cv2.cvtColor(im, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_PNG_COMPRESSION, 1])
        os.replace(tmp, out)
        print(f'frame {f} {time.time() - t0:.2f}s', flush=True)
