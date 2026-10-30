"""Clip Z: cut the real Spotlight / Maps take (build/ztake/take.mov) into RGBA layers for compose.
Only the video frames the film uses (ui/zrec/zmap.json segments, 60 fps) are decoded; unchanged frames are
deduplicated. Pixels are mapped back from the capture's display colour to the film's panel colour (per-channel
curve fitted on the static backdrop). usage: python3 render/zlayers.py"""
import os, json, hashlib, subprocess
import numpy as np, cv2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Z = json.load(open(f'{ROOT}/ui/zrec/zmap.json'))
TAKE = f'{ROOT}/build/ztake/take.mov'
BG = f'{ROOT}/build/ztake/backdrop.png'
OUT = f'{ROOT}/build/ztake/layers'
W, H, VFPS = 3024, 1890, 60


def rounded(w, h, r):
    m = np.zeros((h * 4, w * 4), np.uint8)              # 4x supersampled, anti-aliased edge
    R = r * 4
    cv2.rectangle(m, (R, 0), (w * 4 - 1 - R, h * 4 - 1), 255, -1)
    cv2.rectangle(m, (0, R), (w * 4 - 1, h * 4 - 1 - R), 255, -1)
    for cx, cy in [(R, R), (w * 4 - 1 - R, R), (R, h * 4 - 1 - R), (w * 4 - 1 - R, h * 4 - 1 - R)]:
        cv2.circle(m, (cx, cy), R, 255, -1)
    return cv2.resize(m, (w, h), interpolation=cv2.INTER_AREA)


# the real pointer got into the take despite -capture_cursor 0 (1x arrow, from when Mythos's pointer starts moving).
# Film draws its own pointer, so find the real one (template = the real NSCursor art at 1 px/pt) and paint it out.
_ar = cv2.imread(f'{ROOT}/ref/cursor/arrow.png', cv2.IMREAD_UNCHANGED).astype(np.float32) / 255
_ar = cv2.resize(_ar, (17, 23), interpolation=cv2.INTER_AREA)
_TM = _ar[..., :3] * 255
_TA = (_ar[..., 3] > 0.3).astype(np.float32)
_TMASK = cv2.dilate((_ar[..., 3] > 0.02).astype(np.uint8), np.ones((5, 5), np.uint8))
CURSOR_MAX = 15000          # mean squared difference per template pixel; cursor ~9-11k, best background ~24k


def remove_pointer(crop):
    r = cv2.matchTemplate(crop.astype(np.float32), _TM.astype(np.float32), cv2.TM_SQDIFF, mask=np.dstack([_TA] * 3))
    mn, _, loc, _ = cv2.minMaxLoc(r)
    if mn / _TA.sum() > CURSOR_MAX:
        return crop, None
    m = np.zeros(crop.shape[:2], np.uint8)
    x, y = loc; h, w = _TMASK.shape
    m[y:y + h, x:x + w] = _TMASK[:m.shape[0] - y, :m.shape[1] - x] * 255
    return cv2.inpaint(np.ascontiguousarray(crop), m, 3, cv2.INPAINT_TELEA), (x + 4, y + 4)


def frames(t0, t1):
    n = int(round((t1 - t0) * VFPS)) + 2
    p = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-ss', f'{t0:.4f}', '-i', TAKE, '-frames:v', str(n),
                          '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'], stdout=subprocess.PIPE)
    i = 0
    while True:
        b = p.stdout.read(W * H * 3)
        if len(b) < W * H * 3:
            break
        yield int(round(t0 * VFPS)) + i, np.frombuffer(b, np.uint8).reshape(H, W, 3)
        i += 1


def main():
    os.makedirs(OUT, exist_ok=True)
    bg = cv2.imread(BG)
    first = next(frames(0.5, 0.5))[1].copy()                    # before anything opens: backdrop as captured
    lut = np.zeros((3, 256)); inv = np.zeros((3, 256), np.uint8)
    m = np.ones(bg.shape[:2], bool); m[:40] = False; m[1600:] = False
    xs = np.arange(256)
    for c in range(3):
        b = bg[..., c][m].astype(int); t = first[..., c][m].astype(np.float64)
        s = np.bincount(b, weights=t, minlength=256); n = np.bincount(b, minlength=256); ok = n > 20
        lut[c] = np.maximum.accumulate(np.interp(xs, xs[ok], s[ok] / n[ok]))
        inv[c] = np.clip(np.round(np.interp(xs, lut[c] + xs * 1e-6, xs)), 0, 255).astype(np.uint8)
    bgm = np.stack([lut[c][bg[..., c]] for c in range(3)], -1).astype(np.float32)
    sx, sy, sw, sh = Z['sp_src']; mx, my, mw, mh = Z['mp_src']
    sp_a = rounded(sw, sh, Z['sp_r']); mp_a = rounded(mw, mh, Z['mp_r'])
    index, seen = {}, {}

    def save(prefix, rgb, a):
        rgb = np.stack([inv[c][rgb[..., c]] for c in range(3)], -1)
        im = np.dstack([rgb, a])
        h = hashlib.md5(im.tobytes()).hexdigest()[:16]
        if h not in seen:
            name = f'{prefix}_{len(seen):04d}.png'
            cv2.imwrite(f'{OUT}/{name}', im); seen[h] = name
        return seen[h]

    for f0, f1, v0 in Z['segments']:
        for vf, im in frames(v0, v0 + (f1 - f0)):
            fl = im.astype(np.float32)
            sp_on = float(np.median(np.abs(fl[425:470, sx + 20:sx + sw - 20] - bgm[425:470, sx + 20:sx + sw - 20]).max(2))) > 10
            mp_on = float((np.abs(fl[my:my + mh, mx:mx + mw] - bgm[my:my + mh, mx:mx + mw]).max(2) > 10).mean()) > 0.5
            index[str(vf)] = [save('sp', im[sy:sy + sh, sx:sx + sw], sp_a) if sp_on else None,
                              save('mp', remove_pointer(im[my:my + mh, mx:mx + mw])[0], mp_a) if mp_on else None]
    json.dump({'fps': VFPS, 'frames': index}, open(f'{OUT}/index.json', 'w'))
    print('video frames', len(index), 'unique layers', len(seen))


if __name__ == '__main__':
    main()
