"""Step-2 review still: trace order + final lock-up framing (16:9 and 9:16)."""
import json, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
Image.MAX_IMAGE_PIXELS = None
T = json.load(open('timing.json')); D = json.load(open('assets/logo_paths.json'))
F = lambda s: ImageFont.truetype('/usr/share/fonts/opentype/inter/Inter-Medium.otf', s)
src = Image.open('logo.png')
alpha = src.getchannel('A')
ib = D['ink_bbox']; inkw = ib[2]-ib[0]

def logo_layer(px_w, color):
    """Original logo alpha, scaled; ink bbox width = px_w."""
    s = px_w / inkw / src.width
    side = round(src.width*s)
    a = alpha.resize((side, side), Image.LANCZOS)
    im = Image.new('RGBA', (side, side), color); im.putalpha(a); return im, s*src.width

def lockup(W, H, frac, center, color):
    fr = Image.new('RGBA', (W, H), (0, 0, 0, 255))
    lg, sc = logo_layer(W*frac, color)
    cx, cy = (ib[0]+ib[2])/2*sc, (ib[1]+ib[3])/2*sc
    fr.alpha_composite(lg, (round(W*center[0]-cx), round(H*center[1]-cy)))
    d = ImageDraw.Draw(fr)
    x0 = W*center[0]-W*frac/2; d.line([(x0, H*0.93), (x0+W*frac, H*0.93)], fill=(0, 229, 255, 160), width=3)
    d.text((W*0.5, H*0.96), f"logo ink width = {int(frac*100)}% of frame width  ({W}x{H})", fill=(0, 229, 255), font=F(int(W*0.018)), anchor='mm')
    return fr

# Panel A: trace order
S = 1000
A = Image.new('RGBA', (S, S), (0, 0, 0, 255))
ghost, _ = logo_layer(S*inkw*0.92/inkw*inkw, (255, 255, 255, 40))
A.alpha_composite(ghost.resize((S, S)))
glow = Image.new('RGBA', (S, S), (0, 0, 0, 0)); g = ImageDraw.Draw(glow)
cols = [(0, 229, 255), (60, 170, 255), (255, 200, 60), (255, 120, 60), (255, 255, 255)]
for p, c in zip(D['paths'], cols):
    P = [(x*S, y*S) for x, y in p['points']]
    g.line(P, fill=c+(255,), width=5)
A.alpha_composite(glow.filter(ImageFilter.GaussianBlur(6))); A.alpha_composite(glow)
d = ImageDraw.Draw(A)
for p, c, tp in zip(D['paths'], cols, T['trace_paths']):
    P = np.array(p['points'])*S
    x, y = P[0]; d.ellipse([x-10, y-10, x+10, y+10], outline=c, width=4)
    v = P[min(25, len(P)-1)] - P[0]; v = v/np.linalg.norm(v)*40
    d.line([tuple(P[0]), tuple(P[0]+v)], fill=c, width=4)
    lx, ly = P[0] + np.array([-v[1], v[0]])*0.9
    d.text((lx, ly), str(p['id']+1), fill=c, font=F(34), anchor='mm')
    d.text((30, 30+44*p['id']), f"{p['id']+1}. {p['name']}   {tp['start']:.2f}s - {tp['end']:.2f}s", fill=c, font=F(26))
d.text((30, S-50), "circle = stroke start, arrow = direction.  Beam arrives from the Moon (upper right).", fill=(180, 180, 180), font=F(22))

L = T['layout']
B = lockup(1920, 1080, L['landscape']['logo_width_frac'], L['landscape']['logo_center'], (255, 255, 255, 255))
C = lockup(1080, 1920, L['portrait']['logo_width_frac'], L['portrait']['logo_center'], (255, 255, 255, 255))
Bs = B.resize((1100, round(1080*1100/1920)), Image.LANCZOS)
Cs = C.resize((round(1080*S/1920), S), Image.LANCZOS)
# Inset: logo exactly as supplied (black) on the same background
Dk = lockup(1920, 1080, L['landscape']['logo_width_frac'], L['landscape']['logo_center'], (0, 0, 0, 255)).resize((540, 304), Image.LANCZOS)

W = S + 1100 + Cs.width + 80
sheet = Image.new('RGBA', (W, S + 120), (24, 24, 28, 255))
sd = ImageDraw.Draw(sheet)
sd.text((20, 20), "A. Trace order (potrace routes, original paths)", fill='white', font=F(30))
sheet.alpha_composite(A, (20, 100))
x = S + 40
sd.text((x, 20), "B. 16:9 lock-up, 35% width", fill='white', font=F(30))
sheet.alpha_composite(Bs, (x, 100))
sd.text((x, 100+Bs.height+30), "Inset: logo as supplied (#000 on space) - invisible", fill=(255, 140, 140), font=F(26))
sheet.alpha_composite(Dk, (x, 100+Bs.height+75))
sd.rectangle([x, 100+Bs.height+75, x+540, 100+Bs.height+75+304], outline=(90, 90, 90), width=2)
x2 = x + 1100 + 20
sd.text((x2, 20), "C. 9:16, 70% width", fill='white', font=F(30))
sheet.alpha_composite(Cs, (x2, 100))
sheet.convert('RGB').save('review/01_trace_order_and_lockup.png')
B.convert('RGB').save('review/lockup_16x9.png'); C.convert('RGB').save('review/lockup_9x16.png')
print(sheet.size)
