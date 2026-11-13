// Full delivery build: sound, then each layout (H.264 + ProRes 422 HQ + final-frame PNG), then audio mux.
// usage: node render/build_all.js [landscape|portrait ...]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const layouts = process.argv.slice(2).length ? process.argv.slice(2) : ['landscape', 'portrait'];
const tag = { landscape: '16x9', portrait: '9x16' };
const run = (cmd, args) => { console.log('>', cmd, args.join(' ')); const r = spawnSync(cmd, args, { stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status || 1); };

fs.mkdirSync('out/deliver', { recursive: true });
if (!fs.existsSync('out/logo_motion_sound.wav')) run('python3', ['sound/make_sound.py']);
fs.copyFileSync('out/logo_motion_sound.wav', 'out/deliver/logo_motion_sound.wav');

for (const L of layouts) {
  const k = tag[L];
  run('node', ['render/render.js', '--layout', L, '--out', `out/_v_${k}.mp4`, '--prores', `out/_v_${k}.mov`, '--png-dir', `out/_png_${k}`, '--png-frames', '299']);
  fs.copyFileSync(`out/_png_${k}/f299.png`, `out/deliver/logo_motion_${k}_final_frame.png`);
  // mux the master WAV: AAC 320k in the MP4, 24-bit PCM in the ProRes master
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', `out/_v_${k}.mp4`, '-i', 'out/logo_motion_sound.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '320k', '-shortest', '-movflags', '+faststart', `out/deliver/logo_motion_${k}.mp4`]);
  run('ffmpeg', ['-y', '-loglevel', 'error', '-i', `out/_v_${k}.mov`, '-i', 'out/logo_motion_sound.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'pcm_s24le', '-shortest', `out/deliver/logo_motion_${k}_ProRes422HQ.mov`]);
}
console.log('deliverables in out/deliver');
