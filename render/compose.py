"""Builds the physical panel image (what the MacBook's LCD shows) for a film frame:
notch strip + desktop (wallpaper, menubar with live clock) + OpenCode window (real UI frame)."""
import json, os, functools
import numpy as np
import cv2

ROOT = os.environ.get('EP1', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
B = f'{ROOT}/build'
PANEL_W, PANEL_H = 3024, 1964
NOTCH = 74                     # rows above the 3024x1890 desktop (unused, black)
WIN_X, WIN_Y = 400, 217        # window origin in desktop coords (CGWindowBounds)
RADIUS = 16

_tl = json.load(open(f'{B}/timeline.json'))
_idx = json.load(open(f'{B}/ui_index.json'))
_clock = json.load(open(f'{B}/clock/meta.json'))
FPS = _tl['FPS']
BATTERY_X0, BATTERY_X1 = 2768, 2842     # desktop x range of "89% [battery]" in the menubar


@functools.lru_cache(maxsize=1)
def desktop_base():
    # clean wallpaper capture (no other windows, nothing private) + status items from the menubar
    d = cv2.cvtColor(cv2.imread(f'{ROOT}/ref/screen_now.png', cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
    mb = cv2.cvtColor(cv2.imread(f'{ROOT}/ref/d1.png', cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB)
    d[0:24, 2600:3024] = mb[0:24, 2600:3024]
    # erase original clock (keep menubar tint)
    d[2:23, 2876:3012] = d[2:23, 2862:2876].mean(axis=1, keepdims=True).astype(np.uint8)
    return d


@functools.lru_cache(maxsize=1)
def window_mask_and_shadow():
    h, w = 1389, 2210
    m = np.zeros((h, w), np.float32)
    cv2.rectangle(m, (RADIUS, 0), (w - 1 - RADIUS, h - 1), 1, -1)
    cv2.rectangle(m, (0, RADIUS), (w - 1, h - 1 - RADIUS), 1, -1)
    for cx, cy in [(RADIUS, RADIUS), (w - 1 - RADIUS, RADIUS), (RADIUS, h - 1 - RADIUS), (w - 1 - RADIUS, h - 1 - RADIUS)]:
        cv2.circle(m, (cx, cy), RADIUS, 1, -1, lineType=cv2.LINE_AA)
    # shadow canvas in desktop coords
    sh = np.zeros((1890, 3024), np.float32)
    big = np.zeros_like(sh)
    big[WIN_Y + 20:WIN_Y + 20 + h, WIN_X:WIN_X + w] = m
    big = cv2.GaussianBlur(big, (0, 0), 30) * 0.55
    tight = np.zeros_like(sh)
    tight[WIN_Y + 2:WIN_Y + 2 + h, WIN_X:WIN_X + w] = m
    tight = cv2.GaussianBlur(tight, (0, 0), 3) * 0.35
    sh = 1 - (1 - big) * (1 - tight)
    # hairline border (light, for dark windows)
    edge = cv2.erode(m, np.ones((3, 3), np.uint8))
    border = np.clip(m - edge, 0, 1)
    return m, sh, border


def _hms(v):
    h, m, sec = v.split(':')
    return int(h) * 3600 + int(m) * 60 + float(sec)


def clip_clock_seconds(clip, u):
    """menubar time (seconds since midnight) for a clip at local time u.
    storyboard clock: "HH:MM:SS" (reading at u=0) or {"at": "HH:MM:SS.s", "t": <time expr>}."""
    import camera
    c = clip.raw.get('clock') or '00:00:00'
    if isinstance(c, dict):
        if c.get('kind') == 'ui_v1':
            return _clock['t0'] + u
        return _hms(c['at']) + (u - camera.tval(c.get('t', 0)))
    return _hms(c) + u


def clock_string_at(clip, u):
    s = int(clip_clock_seconds(clip, u))
    return f'10月30日 {s // 3600 % 24:02d}:{s // 60 % 60:02d}:{s % 60:02d}'


def clock_string(t):
    """clock for global film time t (frame-accurate)."""
    import camera
    c, u = camera.RIG.locate(int(round(t * FPS)))
    return clock_string_at(c, u)


def value_at(v, u):
    if isinstance(v, list):
        if not v:
            return 0.0
        xs = [p[0] for p in v]; ys = [p[1] for p in v]
        return float(np.interp(u, xs, ys))
    return float(v or 0)


def battery_state(f):
    import camera
    c, u = camera.RIG.locate(f)
    return int(round(value_at(c.raw.get('battery', 89), u))), bool(c.raw.get('charging', False))


def dawn(f):
    import camera
    c, u = camera.RIG.locate(f)
    return value_at(c.raw.get('dawn', 0), u)


@functools.lru_cache(maxsize=4)
def _clock_img(name):
    im = cv2.imread(f'{B}/clock/{name}', cv2.IMREAD_UNCHANGED)
    return im  # BGRA


@functools.lru_cache(maxsize=6)
def _ui(name):
    im = cv2.imread(f'{B}/ui_frames/{name}', cv2.IMREAD_COLOR)
    return cv2.cvtColor(im, cv2.COLOR_BGR2RGB)


def _ix(f):
    return min(max(f - _idx['startFrame'], 0), len(_idx['frames']) - 1)


def ui_name(f):
    return _idx['frames'][_ix(f)]


def cursor_at(f):
    """pointer for frame f: (x, y, shape) in css px of the captured window, or None (hidden)."""
    c = _idx.get('cursor')
    if not c:
        return None
    v = c[_ix(f)]
    return tuple(v) if v else None


def subframes(f):
    """screen refreshes during frame f (120 Hz) when something moved: [(ui name, cursor), ...]; None otherwise.
    Sub k is shown from f/FPS + k/(FPS*K) for 1/(FPS*K) s."""
    s = (_idx.get('subframes') or {}).get(str(_ix(f) + _idx['startFrame']))
    return [(n, tuple(c) if c else None) for n, c in s] if s else None


# ---- mouse pointer: real macOS NSCursor artwork (ref/cursor, rendered at 4 px/pt); the panel is 2 px/pt
CSS_SCALE = 1.5                 # captured window: css px -> panel px


@functools.lru_cache(maxsize=16)
def _cursor_sprite(shape, size=1.0):
    """size > 1: macOS "shake to locate" enlargement (redrawn from vector art, so it stays sharp)."""
    meta = json.load(open(f'{ROOT}/ref/cursor/meta.json'))[shape]
    im = cv2.imread(f'{ROOT}/ref/cursor/{shape}.png', cv2.IMREAD_UNCHANGED).astype(np.float32) / 255
    k = 2.0 * size / meta['scale']
    im[..., :3] *= im[..., 3:4]                                # PNG is straight alpha: premultiply before filtering
    im = cv2.resize(im, (round(im.shape[1] * k), round(im.shape[0] * k)), interpolation=cv2.INTER_AREA)
    a = im[..., 3:4]
    rgb = cv2.cvtColor(im[..., :3], cv2.COLOR_BGR2RGB)      # premultiplied
    return rgb * 255, a, meta['hx'] * 2 * size, meta['hy'] * 2 * size


def draw_cursor(P, cur):
    """composite the pointer onto a panel image (uint8 RGB, panel coords incl. notch strip)."""
    if not cur:
        return P
    x, y, shape = cur[:3]
    size = round(float(cur[3]), 3) if len(cur) > 3 else 1.0
    rgb, a, hx, hy = _cursor_sprite(shape, size)
    px = WIN_X + x * CSS_SCALE - hx
    py = NOTCH + WIN_Y + y * CSS_SCALE - hy
    ix, iy = int(np.floor(px)), int(np.floor(py))
    fx_, fy_ = px - ix, py - iy
    M = np.float32([[1, 0, fx_], [0, 1, fy_]])               # sub-pixel placement
    h, w = a.shape[:2]
    rgb = cv2.warpAffine(rgb, M, (w + 1, h + 1)); a = cv2.warpAffine(a[..., 0], M, (w + 1, h + 1))[..., None]
    h, w = a.shape[:2]
    x0, y0 = max(ix, 0), max(iy, NOTCH)
    x1, y1 = min(ix + w, PANEL_W), min(iy + h, PANEL_H)
    if x1 <= x0 or y1 <= y0:
        return P
    P = P.copy()
    sub = P[y0:y1, x0:x1].astype(np.float32)
    s_rgb = rgb[y0 - iy:y1 - iy, x0 - ix:x1 - ix]; s_a = a[y0 - iy:y1 - iy, x0 - ix:x1 - ix]
    P[y0:y1, x0:x1] = np.clip(s_rgb + sub * (1 - s_a), 0, 255).astype(np.uint8)
    return P


@functools.lru_cache(maxsize=16)
def _battery_img(n):
    p = f'{B}/battery/{n}.png'
    return cv2.imread(p, cv2.IMREAD_UNCHANGED) if os.path.exists(p) else None


@functools.lru_cache(maxsize=3)
def panel_cached(uiname, clk, batt=(89, True), screen_on=True):
    P = np.zeros((PANEL_H, PANEL_W, 3), np.uint8)
    if not screen_on:
        return P
    d = desktop_base().copy().astype(np.float32)
    m, sh, border = window_mask_and_shadow()
    d *= (1 - sh[..., None])
    ui = _ui(uiname).astype(np.float32)
    h, w = ui.shape[:2]
    region = d[WIN_Y:WIN_Y + h, WIN_X:WIN_X + w]
    ui = ui * (1 - border[..., None] * 0.22) + 255 * border[..., None] * 0.22
    region[:] = region * (1 - m[..., None]) + ui * m[..., None]
    # clock
    c = _clock_img(clock_file(clk))
    a = c[..., 3:4].astype(np.float32) / 255
    rgb = cv2.cvtColor(c[..., :3], cv2.COLOR_BGR2RGB).astype(np.float32)
    x0 = 3004 - 214
    ch, cw = c.shape[:2]
    sub = d[0:ch, x0:x0 + cw]
    sub[:] = sub * (1 - a) + rgb * a
    # battery (the captured menubar shows 89% on charge; other clips draw their own level)
    if batt != (89, True):
        bi = _battery_img(batt[0])
        if bi is None:
            raise FileNotFoundError(f'build/battery/{batt[0]}.png (run ui/menubar.mjs)')
        d[1:23, BATTERY_X0:BATTERY_X1] = d[1:23, BATTERY_X0 - 14:BATTERY_X0 - 2].mean(axis=1, keepdims=True)
        ba = bi[..., 3:4].astype(np.float32) / 255
        brgb = cv2.cvtColor(bi[..., :3], cv2.COLOR_BGR2RGB).astype(np.float32)
        bh, bw = bi.shape[:2]
        bx = BATTERY_X1 - bw
        sub = d[0:bh, bx:bx + bw]
        sub[:] = sub * (1 - ba) + brgb * ba
    P[NOTCH:, :] = np.clip(d, 0, 255).astype(np.uint8)
    return P


def clock_file(clk):
    m = _clock['meta'].get(clk)
    if m is None:
        raise KeyError(f'no clock image for {clk!r} (run ui/menubar.mjs)')
    return m['file']


def panel(f, sub=None):
    """sub = (ui name, cursor) of one screen refresh inside frame f; default = the frame's own."""
    t = f / FPS
    name, cur = sub if sub else (ui_name(f), cursor_at(f))
    return draw_cursor(panel_cached(name, clock_string(t), battery_state(f)), cur)


if __name__ == '__main__':
    import sys
    f = int(sys.argv[1]) if len(sys.argv) > 1 else 900
    P = panel(f)
    cv2.imwrite('/tmp/panel_%d.png' % f, cv2.cvtColor(P, cv2.COLOR_RGB2BGR))
    print(P.shape, clock_string(f / FPS), ui_name(f))
