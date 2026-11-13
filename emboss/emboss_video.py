"""Emboss the logo onto the Moon in a video.

The logo is the original logo.png alpha (never redrawn). It is treated as a height map, wrapped onto
the tracked Moon sphere (arc-length mapping, so it bends toward the limb), and shaded as raised relief:
lit edge toward the light, shaded edge + soft contact shadow away from it. Shading is multiplicative,
so the emboss follows the video's own exposure (fade-in from black, lamp glow) and never adds light
that isn't there. Pink hands / background are masked out.

usage: python3 emboss/emboss_video.py IN.mp4 TRACK.json OUT.mp4 [--size 0.95] [--depth 1.0]
       [--light -0.6,-0.8] [--still frame:png]
"""
import argparse, json, subprocess
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates

ap = argparse.ArgumentParser()
ap.add_argument('video'); ap.add_argument('track'); ap.add_argument('out')
ap.add_argument('--logo', default='logo.png')
ap.add_argument('--size', type=float, default=0.95, help='logo ink width as a fraction of the Moon radius x2 ... (1.0 = one radius)')
ap.add_argument('--depth', type=float, default=1.0, help='relief strength')
ap.add_argument('--light', default='-0.55,-0.83', help='screen-space light direction (x right, y down)')
ap.add_argument('--still', action='append', default=[], help='frame:path.png to also save stills')
a = ap.parse_args()

T = json.load(open(a.track))
W, H = T['width'], T['height']
probe = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'json', a.video], capture_output=True, text=True).stdout)
fps = probe['streams'][0]['r_frame_rate']

# ---- logo texture: original alpha, cropped to the ink box, at 2048 px wide -------------------------
Image.MAX_IMAGE_PIXELS = None
al = Image.open(a.logo).getchannel('A')
bb = al.getbbox()
al = al.crop(bb)
TW = 2048
TH = round(al.height * TW / al.width)
alpha = np.asarray(al.resize((TW, TH), Image.LANCZOS), np.float32) / 255
PAD = 96                                                     # room for the soft shadow
alpha = np.pad(alpha, PAD)
# height: rounded bevel (blurred alpha), plus a wide skirt for the contact shadow
h_bevel = gaussian_filter(alpha, TW * 0.0045)
skirt = gaussian_filter(alpha, TW * 0.016)
gy, gx = np.gradient(h_bevel)                               # texture-space slope (per texel)
gx *= TW * 0.0045 * 2.5; gy *= TW * 0.0045 * 2.5            # normalise so bevel slopes are ~O(1)
L = np.array([float(v) for v in a.light.split(',')]); L /= np.linalg.norm(L)
# lambert-ish relief term: + on edges facing the light, - on edges facing away
relief = -(gx * L[0] + gy * L[1])
shadow = np.roll(np.roll(skirt, int(round(L[0] * -TW * 0.012)), 1), int(round(L[1] * -TW * 0.012)), 0)
texH, texW = alpha.shape

def sample(img, tx, ty):
    return map_coordinates(img, [ty, tx], order=1, mode='constant', cval=0.0)

# ---- per-frame compositing ---------------------------------------------------------------------
raw = subprocess.Popen(['ffmpeg', '-v', 'error', '-i', a.video, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
enc = subprocess.Popen(['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', fps, '-i', '-',
                        '-i', a.video, '-map', '0:v', '-map', '1:a?', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14',
                        '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
                        '-c:a', 'copy', '-movflags', '+faststart', a.out], stdin=subprocess.PIPE)
stills = {int(s.split(':')[0]): s.split(':', 1)[1] for s in a.still}
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
i = 0
while True:
    buf = raw.stdout.read(W * H * 3)
    if len(buf) < W * H * 3:
        break
    img = np.frombuffer(buf, np.uint8).reshape(H, W, 3).astype(np.float32) / 255
    f = T['frames'][min(i, len(T['frames']) - 1)]
    cx, cy, r = f['cx'], f['cy'], f['r']
    u, v = (xx - cx) / r, (yy - cy) / r
    rho2 = u * u + v * v
    inside = rho2 < 0.985
    z = np.sqrt(np.clip(1 - rho2, 0, 1))
    # arc length on the sphere (in radii) -> logo texture coordinates
    sx = np.arcsin(np.clip(u / np.sqrt(np.clip(1 - v * v, 1e-4, 1)), -1, 1))
    sy = np.arcsin(np.clip(v, -1, 1))
    texel = (TW / (a.size * 1.0))                           # texels per radius of arc
    tx = sx * texel + texW / 2
    ty = sy * texel + texH / 2
    rel = sample(relief, tx, ty)
    shd = sample(shadow, tx, ty)
    alp = sample(alpha, tx, ty)
    # strength: fade toward the limb (foreshortening) and away from saturated (hand) pixels
    mx, mn = img.max(2), img.min(2)
    sat = (mx - mn) / (mx + 1e-4)
    k = inside * np.clip((z - 0.12) / 0.3, 0, 1) * np.clip((0.42 - sat) / 0.15, 0, 1) * a.depth
    shade = 1 + k * (0.55 * rel - 0.16 * shd * (1 - alp) + 0.035 * alp)
    out = np.clip(img * shade[..., None], 0, 1)
    o8 = (out * 255 + 0.5).astype(np.uint8)
    enc.stdin.write(o8.tobytes())
    if i in stills:
        Image.fromarray(o8).save(stills[i])
    i += 1
enc.stdin.close(); enc.wait(); raw.wait()
print('frames', i, '->', a.out)
