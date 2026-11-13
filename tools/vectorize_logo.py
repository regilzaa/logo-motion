"""Vectorise logo.png with potrace ONLY to obtain laser-trace routes.
The final resolved logo is always the original PNG, never this output.
Writes assets/logo_paths.json: closed polylines in normalised logo coords
(0..1 over the full 8333x8333 canvas), ordered for drawing."""
import json, math, sys
import numpy as np
from PIL import Image
import potrace

def V(p):
    return np.array([p.x, p.y], float) if hasattr(p, 'x') else np.array(p, float)

Image.MAX_IMAGE_PIXELS = None
SRC = sys.argv[1] if len(sys.argv) > 1 else 'logo.png'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'assets/logo_paths.json'
N = 2048
im = Image.open(SRC)
W = im.width
a = np.array(im.getchannel('A').resize((N, N), Image.LANCZOS)) > 127
plist = potrace.Bitmap(a).trace(turdsize=20, alphamax=1.0, opticurve=True, opttolerance=0.2)

def bez(p0, p1, p2, p3, n):
    t = np.linspace(0, 1, n, endpoint=False)[:, None]
    return ((1-t)**3)*p0 + 3*((1-t)**2)*t*p1 + 3*(1-t)*t*t*p2 + t**3*p3

paths = []
for curve in plist:
    pts = []
    start = V(curve.start_point)
    cur = start
    for seg in curve.segments:
        end = V(seg.end_point)
        if seg.is_corner:
            c = V(seg.c)
            for q in (cur, c):
                pts.append(q)
        else:
            c1, c2 = V(seg.c1), V(seg.c2)
            L = np.linalg.norm(c1-cur)+np.linalg.norm(c2-c1)+np.linalg.norm(end-c2)
            pts.extend(bez(cur, c1, c2, end, max(4, int(L/4))))
        cur = end
    pts.append(pts[0])
    P = np.array(pts) / N
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    x, y = P[:, 0], P[:, 1]
    area = 0.5*np.sum(x[:-1]*y[1:]-x[1:]*y[:-1])
    paths.append(dict(points=P.round(5).tolist(), length=float(seg.sum()),
                      area=float(abs(area)), centroid=P.mean(0).round(4).tolist(),
                      bbox=[float(x.min()), float(y.min()), float(x.max()), float(y.max())]))

# Drop potrace's canvas-border loop.
paths = [p for p in paths if p['area'] < 0.9]
# Drawing order: outer outline shapes first (largest), then the small edge fragments
# top-to-bottom, and the most circular inner shape (the dot) last.
for p in paths:
    p['circularity'] = 4*math.pi*p['area']/p['length']**2
dot = max(paths, key=lambda p: p['circularity'])
rest = sorted([p for p in paths if p is not dot], key=lambda p: -p['area'])
big, small = rest[:2], sorted(rest[2:], key=lambda p: p['centroid'][1])
big.sort(key=lambda p: p['centroid'][0])          # left arc, then right arc
paths = big + small + [dot]
names = ['outer arc left', 'outer arc right'] + [f'fragment {i+1}' for i in range(len(small))] + ['centre dot']
for p, n in zip(paths, names):
    p['name'] = n
for i, p in enumerate(paths):
    p['id'] = i
# Rotate each closed loop so it starts at the point nearest the previous path's end
# (first path: nearest the upper-right, where the beam arrives from the Moon impact).
prev = np.array([1.0, 0.0])
for p in paths:
    P = np.array(p['points'][:-1])
    k = int(np.argmin(np.linalg.norm(P - prev, axis=1)))
    P = np.vstack([P[k:], P[:k], P[k:k+1]])
    p['points'] = P.round(5).tolist()
    prev = P[-1]
ys, xs = np.where(a)
meta = dict(source=SRC, source_px=W, trace_res=N,
            ink_bbox=[xs.min()/N, ys.min()/N, (xs.max()+1)/N, (ys.max()+1)/N], paths=paths)
json.dump(meta, open(OUT, 'w'))
for p in paths:
    print(p['id'], 'pts', len(p['points']), 'len %.3f area %.4f' % (p['length'], p['area']), p['centroid'])
