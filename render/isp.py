"""Phone camera ISP (v2): what happens to the light between the sensor and the .mov.

Motivation (see STATE.md "摩尔纹真实性" for the papers):
  * Yue et al., NeurIPS 2023 (raw screen recapture): moire is simpler in raw; demosaicing
    aggravates aliasing; after the ISP colours mix and green shows the least moire.
  * Dai et al., CVPR 2022 (video demoireing, incl. MacBook Pro + iPhone XR captures): moire
    changes frame to frame with hand shake, and its strength breathes with autofocus.
  * Wronski et al., SIGGRAPH 2019: hand tremor moves the aliasing phase every frame, so merging
    frames (here: video temporal NR) averages part of it away and makes the rest swim.
  * Liu, Shu & Wu 2018 synthesis pipeline: ... demosaic -> denoise -> compression.

Stages (in this order; a simplification of a real ISP, documented where it deviates):
  1. CFA sampling (RGGB) of the optical image at sensor resolution, in camera-raw space
     (white balance not yet applied, so the green channel carries the most signal)
  2. raw noise: Poisson-Gaussian, per photosite, before demosaicing
  3. edge-aware demosaic (OpenCV EA; phones use edge-directed / learned demosaic)
  4. white balance + colour matrix; chroma NR + false-colour suppression at photosite scale
  5. ISP scaler to 1920x1080 (box/area at ~2.1x)
  6. temporal NR, motion compensated with the known camera motion (planar screen ->
     exact homography), with per-pixel rejection of large differences; reset at cuts and
     lens switches (real ISPs do the same). Done at output resolution (simplification).
  7. global tone curve
  8. YCbCr: residual chroma noise blur, mild edge-preserving luma NR
  9. luma sharpening (unsharp mask with overshoot clamp)
"""
import math
import numpy as np
import cv2

OW, OH = 1920, 1080
SENSOR_W, SENSOR_H = 4032, 2268      # 12 MP binned / 2x centre crop, 16:9 readout
# camera spectral sensitivities as a mixing matrix (all positive: real colour filters overlap)
S_CAM = np.array([[0.78, 0.18, 0.04],
                  [0.12, 0.76, 0.12],
                  [0.03, 0.22, 0.75]], np.float32)
S_INV = np.linalg.inv(S_CAM).astype(np.float32)          # the ISP's colour matrix
WB_SENS = np.array([0.52, 1.0, 0.62], np.float32)        # raw channel response to "white"
FULL = 8.0             # linear value that saturates a photosite (headroom above diffuse white)
TNR = dict(w0=0.45, wmax=0.65, k=2.2)
CHROMA = dict(sigma=1.0, fcs=0.4, out_sigma=0.5)
LUMA_NR = dict(d=5, sc=0.035, ss=1.2, mix=0.55)
SHARP = dict(sigma=1.1, amount=0.55, clamp=0.06)


def to_raw(img):
    """scene-referred linear RGB -> camera raw RGB (colour-filter crosstalk, channel response)."""
    return (np.clip(img, 0, None) @ S_CAM.T) * WB_SENS


def mosaic(raw):
    h, w = raw.shape[:2]
    bay = np.empty((h, w), np.float32)
    bay[0::2, 0::2] = raw[0::2, 0::2, 0]
    bay[0::2, 1::2] = raw[0::2, 1::2, 1]
    bay[1::2, 0::2] = raw[1::2, 0::2, 1]
    bay[1::2, 1::2] = raw[1::2, 1::2, 2]
    return bay


def raw_noise(bay, gain, rng, area_scale):
    """Poisson-Gaussian photosite noise. area_scale = photosites per output pixel, so that the
    noise seen after downscaling matches the v1 output-resolution calibration."""
    k = math.sqrt(area_scale)
    sd = np.sqrt(np.clip(bay, 0, None) * 0.0009 * gain + (0.0028 * gain) ** 2) * k
    return bay + sd * rng.standard_normal(bay.shape, dtype=np.float32)


BLACK = 0.08          # black-level pedestal (linear units): keeps negative noise excursions,
                      # otherwise clipping biases the shadows (magenta after WB gains)


def demosaic(bay):
    q = np.clip((bay + BLACK) / (FULL + BLACK), 0, 1)
    b16 = (q * 65535 + 0.5).astype(np.uint16)
    # OpenCV's BG naming == RGGB pattern starting with R at (0,0)
    rgb = cv2.cvtColor(b16, cv2.COLOR_BayerBG2RGB_EA).astype(np.float32) / 65535 * (FULL + BLACK) - BLACK
    return rgb


def develop(raw_rgb):
    """white balance + colour matrix (amplifies noise, as in a real ISP)."""
    return (raw_rgb / WB_SENS) @ S_INV.T


_YC = np.array([[0.2126, 0.7152, 0.0722], [-0.1146, -0.3854, 0.5], [0.5, -0.4542, -0.0458]], np.float32)
_YC_INV = np.linalg.inv(_YC).astype(np.float32)


def chroma_nr_sensor(rgb, gain):
    """at sensor resolution: chroma NR + false-colour suppression where the luma has detail at
    the photosite scale (demosaic false colour lives there). Resolved colour structure a few
    photosites wide (e.g. LCD subpixels in macro) is kept; low-frequency colour moire survives."""
    yc = rgb @ _YC.T
    Y = yc[..., 0]; C = yc[..., 1:]
    Cs = cv2.GaussianBlur(C, (0, 0), CHROMA['sigma'])
    a = float(np.clip(0.5 + 0.25 * gain, 0.5, 0.9))           # noisier -> stronger
    C = C + a * (Cs - C)
    det = cv2.GaussianBlur(np.abs(Y - cv2.GaussianBlur(Y, (0, 0), 0.7)), (0, 0), 1.5)
    lvl = cv2.GaussianBlur(Y, (0, 0), 3.0)
    fcs = np.clip(det / (0.25 * lvl + 0.02), 0, 1) ** 2 * CHROMA['fcs']
    C = C * (1 - fcs[..., None])
    return np.dstack([Y, C]) @ _YC_INV.T


def warp_prev(prev, p_cur, p_prev, fx_cur, fx_prev, intersect, ndc_grid):
    """motion-compensate the previous output frame into the current one (screen plane z=0)."""
    xn, yn = ndc_grid(OW, OH, fx_cur)
    X, Y, _ = intersect(p_cur, xn, yn)
    P = np.stack([X - p_prev['C'][0], Y - p_prev['C'][1], np.broadcast_to(-p_prev['C'][2], X.shape)], -1)
    z = P @ p_prev['fwd']
    u = OW / 2 + fx_prev * (P @ p_prev['right']) / z - 0.5
    v = OH / 2 + fx_prev * (P @ p_prev['down']) / z - 0.5
    return cv2.remap(prev, u.astype(np.float32), v.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def tnr(cur, prev_warped, gain):
    """recursive temporal filter; rejects where the (blurred) difference exceeds the noise."""
    if prev_warped is None:
        return cur
    lum = np.array([0.2126, 0.7152, 0.0722], np.float32)
    d = cv2.GaussianBlur((cur - prev_warped) @ lum, (0, 0), 1.5)
    base = cv2.GaussianBlur(cur @ lum, (0, 0), 1.5)
    sig = np.sqrt(np.clip(base, 0, None) * 0.0009 * gain + (0.0028 * gain) ** 2) + 0.004
    w = TNR['w0'] * (0.6 + 0.4 * min(gain, 2.0)) * np.exp(-(d / (TNR['k'] * sig)) ** 2)
    w = np.minimum(w, TNR['wmax'])[..., None]
    return cur + w * (prev_warped - cur)


def yuv_stage(out):
    """display-referred RGB (0..1): residual chroma noise, luma NR, sharpening."""
    yuv = out @ _YC.T
    Y = yuv[..., 0]; C = yuv[..., 1:]
    C = cv2.GaussianBlur(C, (0, 0), CHROMA['out_sigma'])
    # luma NR (edge preserving), partially mixed back: phones keep some grain in video
    Yd = cv2.bilateralFilter(Y.astype(np.float32), LUMA_NR['d'], LUMA_NR['sc'], LUMA_NR['ss'])
    Y = Y + LUMA_NR['mix'] * (Yd - Y)
    # sharpening with overshoot clamp (phone halos are visible but limited)
    bl = cv2.GaussianBlur(Y, (0, 0), SHARP['sigma'])
    Y = Y + np.clip(SHARP['amount'] * (Y - bl), -SHARP['clamp'], SHARP['clamp'])
    return np.dstack([Y, C]) @ _YC_INV.T
