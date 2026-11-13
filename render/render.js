// Deterministic frame-by-frame renderer: headless Chrome (puppeteer-core) -> raw RGBA -> ffmpeg.
// usage: node render/render.js --layout landscape|portrait [--scale 1] [--subframes 8]
//        [--from 0 --to 299] [--out out/x.mp4] [--prores out/x.mov] [--png-dir dir] [--png-frames 0,60,299]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a), []));
const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'timing.json'), 'utf8'));
const layout = args.layout || 'landscape';
const scale = parseFloat(args.scale || '1');
const subframes = parseInt(args.subframes || T.subframes, 10);
const from = parseInt(args.from || '0', 10), to = parseInt(args.to ?? String(T.frames - 1), 10);
const W = Math.round(T.layout[layout].width * scale), H = Math.round(T.layout[layout].height * scale);
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--force-color-profile=srgb'],
  protocolTimeout: 0,
});
const page = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error' || args.verbose) console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${port}/web/index.html?layout=${layout}&scale=${scale}`);
await page.waitForFunction('window.ready || window.bootError', { timeout: 0 });
const err = await page.evaluate('window.bootError');
if (err) { console.error(err); process.exit(1); }
console.log('scene', await page.evaluate('JSON.stringify(window.sceneInfo)'), `${W}x${H} subframes=${subframes} frames ${from}-${to}`);

let ff = null;
if (args.out || args.prores) {
  const outs = [];
  if (args.out) { fs.mkdirSync(path.dirname(args.out), { recursive: true }); outs.push('-map', '0:v', '-c:v', 'libx264', '-preset', args.fast ? 'veryfast' : 'slow', '-crf', args.fast ? '20' : '12', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', args.out); }
  if (args.prores) { fs.mkdirSync(path.dirname(args.prores), { recursive: true }); outs.push('-map', '0:v', '-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', args.prores); }
  ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(T.fps), '-i', '-',
    '-vf', 'vflip,scale=out_color_matrix=bt709:out_range=tv', ...outs], { stdio: ['pipe', 'inherit', 'inherit'] });
}
const pngFrames = args['png-frames'] ? new Set(String(args['png-frames']).split(',').map(Number)) : null;
if (args['png-dir']) fs.mkdirSync(args['png-dir'], { recursive: true });

const t0 = Date.now();
const list = args.frames ? String(args.frames).split(',').map(Number) : Array.from({ length: to - from + 1 }, (_, i) => from + i);
for (const f of list) {
  await page.evaluate((fr, n) => window.renderFrame(fr, { subframes: n }), f, subframes);
  const b64 = await page.evaluate('window.grab()');
  const buf = Buffer.from(b64, 'base64');
  if (ff && !ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (args['png-dir'] && (!pngFrames || pngFrames.has(f))) {
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', '-', '-vf', 'vflip', '-frames:v', '1', path.join(args['png-dir'], `f${String(f).padStart(3, '0')}.png`)]);
    p.stdin.end(buf); await new Promise((r) => p.on('close', r));
  }
  const done = list.indexOf(f) + 1;
  if (done % 20 === 0 || done === 1) { const el = (Date.now() - t0) / 1000; console.log(`frame ${f}  ${(el / done).toFixed(2)} s/frame`); }
}
if (ff) { ff.stdin.end(); await new Promise((r) => ff.on('close', r)); }
await browser.close(); server.close();
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
