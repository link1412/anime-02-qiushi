"""Fast story/timing preview: the composed screen (UI + Z overlay + pointer + menubar) per frame, no camera/optics.
usage: python3 render/preview_flat.py <out.mp4> <clip ids, comma-separated | all> [width]"""
import sys, os, json, subprocess
from multiprocessing import Pool
import numpy as np, cv2
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compose as C

OUT, IDS = sys.argv[1], sys.argv[2]
W = int(sys.argv[3]) if len(sys.argv) > 3 else 1280
H = round(W * 1890 / 3024 / 2) * 2
clips = [c for c in C._tl['clips'] if IDS == 'all' or c['id'] in IDS.split(',')]
frames = [f for c in clips for f in range(round(c['t0'] * C.FPS), round((c['t0'] + c['dur']) * C.FPS))]


def one(f):
    P = C.panel(f)[C.NOTCH:]
    im = cv2.resize(P, (W, H), interpolation=cv2.INTER_AREA)
    cid = next(c['id'] for c in clips if c['t0'] * C.FPS - 0.5 <= f < (c['t0'] + c['dur']) * C.FPS + 0.5)
    cv2.putText(im, f'{cid} f{f} {C.clock_string(f / C.FPS)[-8:]}', (8, H - 10), 0, 0.5, (255, 255, 0), 1, cv2.LINE_AA)
    return im.tobytes()


if __name__ == '__main__':
    tmp = OUT + '.v.mp4'
    p = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(C.FPS),
                          '-i', '-', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', tmp], stdin=subprocess.PIPE)
    with Pool(8) as pool:
        for b in pool.imap(one, frames, chunksize=8):
            p.stdin.write(b)
    p.stdin.close(); p.wait()
    # matching audio: one span per contiguous run of clips
    spans = []
    for c in clips:
        if spans and abs(spans[-1][1] - c['t0']) < 1e-3: spans[-1][1] = c['t0'] + c['dur']
        else: spans.append([c['t0'], c['t0'] + c['dur']])
    flt = ''.join(f'[1:a]atrim={a:.4f}:{b:.4f},asetpts=PTS-STARTPTS[a{i}];' for i, (a, b) in enumerate(spans))
    flt += ''.join(f'[a{i}]' for i in range(len(spans))) + f'concat=n={len(spans)}:v=0:a=1[a]'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', tmp, '-i', f'{C.B}/audio.wav', '-filter_complex', flt,
                    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', OUT], check=True)
    os.remove(tmp)
    print(OUT, len(frames), 'frames')
