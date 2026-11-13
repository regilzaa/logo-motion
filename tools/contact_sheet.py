"""Contact sheet from a rendered video: one frame every `step` seconds (default 0.25 s)."""
import subprocess, sys, json, os
from PIL import Image, ImageDraw, ImageFont
video, out = sys.argv[1], sys.argv[2]
frames = [int(x) for x in sys.argv[3].split(',')] if len(sys.argv) > 3 else [min(299, i * 15) for i in range(21)]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 7
thumb_w = int(sys.argv[5]) if len(sys.argv) > 5 else 480
probe = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', video], capture_output=True, text=True).stdout)['streams'][0]
W, H = probe['width'], probe['height']
raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', video, '-vf', 'select=' + '+'.join(f'eq(n\\,{f})' for f in frames), '-vsync', '0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True).stdout
th = round(H * thumb_w / W)
F = ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-Medium.otf', 16)
rows = (len(frames) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (thumb_w + 6) + 6, rows * (th + 30) + 6), (22, 22, 26))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(frames):
    im = Image.frombytes('RGB', (W, H), raw[i * W * H * 3:(i + 1) * W * H * 3]).resize((thumb_w, th), Image.LANCZOS)
    x, y = 6 + (i % cols) * (thumb_w + 6), 6 + (i // cols) * (th + 30)
    d.text((x + 2, y + 4), f'{f / 60:.2f} s  (f{f})', fill=(220, 220, 220), font=F)
    sheet.paste(im, (x, y + 26))
sheet.save(out)
print(out, sheet.size)
