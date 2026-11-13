"""Track the Moon disc (centre, radius) in every frame of a video.
Mask = bright, low-saturation pixels (excludes the pink hands); circle = robust least-squares fit
on the mask boundary away from the frame edges; then smoothed over time with a low-order polynomial."""
import json, subprocess, sys
import numpy as np
from PIL import Image

video, out = sys.argv[1], sys.argv[2]
p = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', video], capture_output=True, text=True).stdout)['streams'][0]
W, H = p['width'], p['height']
S = 4                                                   # analyse at 1/4 resolution
w, h = W // S, H // S
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', video, '-vf', f'scale={w}:{h}', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3).astype(np.float32) / 255

def fit_circle(x, y):
    A = np.c_[2 * x, 2 * y, np.ones_like(x)]
    b = x * x + y * y
    c, *_ = np.linalg.lstsq(A, b, rcond=None)
    return c[0], c[1], np.sqrt(max(c[2] + c[0] ** 2 + c[1] ** 2, 1e-6))

res = []
for i, f in enumerate(fr):
    mx, mn = f.max(2), f.min(2)
    lum = f @ [0.299, 0.587, 0.114]
    sat = (mx - mn) / (mx + 1e-4)
    peak = np.percentile(lum, 99)
    if peak < 0.06:
        res.append(None); continue
    m = (lum > max(0.025, peak * 0.16)) & (sat < 0.30)
    # boundary pixels of the mask
    e = m & ~(np.roll(m, 1, 0) & np.roll(m, -1, 0) & np.roll(m, 1, 1) & np.roll(m, -1, 1))
    ys, xs = np.nonzero(e)
    keep = (xs > 3) & (xs < w - 4) & (ys > 3) & (ys < h - 4)
    xs, ys = xs[keep].astype(float), ys[keep].astype(float)
    if len(xs) < 50:
        res.append(None); continue
    cx, cy, r = fit_circle(xs, ys)
    for _ in range(6):                                   # reject inner holes / hand edges
        d = np.abs(np.hypot(xs - cx, ys - cy) - r)
        k = d < max(2.0, np.percentile(d, 60))
        cx, cy, r = fit_circle(xs[k], ys[k])
    res.append((cx * S, cy * S, r * S, float(m.mean())))

n = len(res)
idx = np.array([i for i, v in enumerate(res) if v is not None])
vals = np.array([res[i][:3] for i in idx])
# smooth: fill gaps (dark opening frames) from the nearest valid fit, then median-3 + 5-tap average
full = np.array([vals[np.argmin(np.abs(idx - i))] for i in range(n)])
for j, i in enumerate(idx): full[i] = vals[j]
med = np.array([np.median(full[max(0, i - 1):i + 2], 0) for i in range(n)])
k = np.array([1, 2, 3, 2, 1], float); k /= k.sum()
pad = np.pad(med, ((2, 2), (0, 0)), mode='edge')
sm = np.stack([np.convolve(pad[:, c], k, 'valid') for c in range(3)], 1)
# the dark fade-in frames give noisy fits: smooth them much harder (window 15), blend to light by frame 30
k2 = np.hanning(17)[1:-1]; k2 /= k2.sum()
pad2 = np.pad(med, ((7, 7), (0, 0)), mode='edge')
sm2 = np.stack([np.convolve(pad2[:, c], k2, 'valid') for c in range(3)], 1)
wgt = np.clip((np.arange(n) - 18) / 12, 0, 1)[:, None]
sm = sm2 * (1 - wgt) + sm * wgt
smooth = [sm[:, 0], sm[:, 1], sm[:, 2]]
track = [{'frame': i, 'cx': float(smooth[0][i]), 'cy': float(smooth[1][i]), 'r': float(smooth[2][i]),
          'raw': None if res[i] is None else [round(v, 1) for v in res[i][:3]]} for i in range(n)]
json.dump({'width': W, 'height': H, 'frames': track}, open(out, 'w'), indent=1)
for t in track[::6]:
    print(t['frame'], round(t['cx']), round(t['cy']), round(t['r']), t['raw'])
