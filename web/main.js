// Entry point. Exposes window.renderFrame(frame) -> draws one fully post-processed frame.
// Every value is a pure function of time t = frame / fps (sub-frames add a shutter offset).
import * as THREE from 'three';
import { loadTiming, T } from './timing.js';
import { clamp, lerp, smooth, smoother, easeIn, easeOut, prog, pulse } from './util.js';
import * as W from './world.js';
import { makeStars } from './stars.js';
import { makeEarth } from './earth.js';
import { makeMoon } from './moon.js';
import { makeLaser } from './laser.js';
import { makeTrace } from './trace.js';
import { makeLogo } from './logo.js';
import { makeCameraRig } from './camera.js';
import { makePost } from './post.js';

const Q = new URLSearchParams(location.search);
const layout = Q.get('layout') || 'landscape';
const scale = parseFloat(Q.get('scale') || '1');

async function boot() {
  await loadTiming();
  const L = T.layout[layout];
  const Wd = Math.round(L.width * scale), Ht = Math.round(L.height * scale);
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1); renderer.setSize(Wd, Ht);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // sRGB encode happens in the final pass
  document.body.appendChild(renderer.domElement);

  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const load = (f) => new Promise((res, rej) => loader.load('/assets/textures/' + f, (t) => { t.anisotropy = maxAniso; t.colorSpace = THREE.NoColorSpace; res(t); }, undefined, rej));
  const names = ['earth_day.jpg', 'earth_night.jpg', 'earth_water.png', 'moon_color.jpg', 'moon_disp.jpg'];
  const loaded = await Promise.all(names.map(load));
  const tex = Object.fromEntries(names.map((n, i) => [n.split('.')[0], loaded[i]]));
  const logoAlpha = await new Promise((res) => loader.load('/assets/logo_alpha_4096.png', (t) => { t.anisotropy = maxAniso; t.colorSpace = THREE.NoColorSpace; res(t); }));
  const D = await (await fetch('/assets/logo_paths.json')).json();

  const mapper = W.makeLogoMapper(D);
  // the beam strikes exactly where the first stroke begins
  const p0 = D.paths[0].points[0];
  W.IMPACT_POS.copy(mapper.surface(p0[0], p0[1]));
  const impactNormal = W.IMPACT_POS.clone().sub(W.MOON_C).normalize();
  const laserColor = new THREE.Color(T.colors.laser);   // linear working space

  const trace = makeTrace(D, T.colors.laser);
  const stars = makeStars(), earth = makeEarth(tex), moon = makeMoon(tex, trace.texture, mapper);
  const laser = makeLaser(), logo = makeLogo(logoAlpha, mapper);
  const rig = makeCameraRig(layout);
  const scene = new THREE.Scene(), over = new THREE.Scene();
  scene.add(stars.object, earth.object, moon.object, laser.object, logo.glow);
  over.add(logo.overlay);
  const post = makePost(renderer, Wd, Ht);
  const E = T.events;
  const tmpV = new THREE.Vector3();

  function state(t, cam) {
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const s = { t, laserColor, px: Ht / 1080, projScale: Ht / (2 * tanH), pixAngle: (2 * tanH) / Ht, cityPos: W.CITY_POS, impactPos: W.IMPACT_POS, impactNormal };
    // OPEN: city light pulses
    const pulseEnv = smooth(prog(t, [E.city_pulse_start, E.city_pulse_start + 0.2]));
    s.cityGlow = pulseEnv * (0.55 + 0.45 * Math.cos(2 * Math.PI * (t - E.city_pulse_start) / 0.45)) * (t < E.fire ? 1 : Math.exp(-(t - E.fire) / 0.05)) * 1.4;
    // CHARGE
    const ch = prog(t, [E.charge_start, E.fire]);
    s.charge = (t < E.fire ? Math.pow(ch, 1.6) : Math.exp(-(t - E.fire) / 0.06));
    s.coreI = s.charge * 2.2 * (1 + 0.15 * Math.sin(t * 90));
    const rp = prog(t, E.ring_contract);
    s.ringR = lerp(0.6, 0.02, easeIn(rp, 2)); s.ringI = t >= E.ring_contract[0] && t <= E.ring_contract[1] + 0.03 ? Math.sin(Math.PI * Math.min(1, rp * 1.05)) * 2.2 : 0;
    // FIRE
    s.muzzleI = pulse(t, E.fire, 0.012, 0.09) * 5.0;
    s.flareI = pulse(t, E.flare_kick, 0.01, 0.14) * 1.2;
    const fh = prog(t, E.beam_travel), head = easeIn(fh, 1.4);
    const aimXY = trace.aim(t);
    const aimW = mapper.surface(aimXY[0], aimXY[1], tmpV.copy(W.MOON_C).addScaledVector(W.LOGO_N, -0), new THREE.Vector3());
    let B;
    if (t < E.beam_travel[1]) B = W.CITY_POS.clone().lerp(W.IMPACT_POS, head);
    else B = aimW;
    const cut = easeIn(prog(t, [E.beam_cutoff, E.beam_cutoff + 0.12]), 2);
    s.beamA = W.CITY_POS.clone().lerp(B, cut); s.beamB = B;
    s.beamI = t < E.fire ? 0 : (t < E.beam_cutoff ? 1.0 : (1 - smooth(prog(t, [E.beam_cutoff + 0.06, E.beam_cutoff + 0.16]))));
    s.beamW = 0.03; s.beamTipBoost = t < E.impact ? 3.0 : 0.6;
    s.tipI = t < E.fire ? 0 : (t < E.impact ? 1.4 : 0.9 + 0.12 * Math.sin(t * 157)) * (t < E.beam_cutoff ? 1 : 1 - prog(t, [E.beam_cutoff, E.beam_cutoff + 0.1]));
    s.tipSize = t < E.impact ? 0.18 : 0.1;
    // IMPACT
    s.impactI = pulse(t, E.impact, 0.008, 0.07) * 4.0;
    const wp = prog(t, [E.impact, E.shockwave[1] + 0.2]);
    s.waveR = t < E.impact ? -1 : easeOut(wp, 2.5) * W.MOON_R * 1.6; s.waveI = t < E.impact ? 0 : Math.pow(1 - wp, 1.5) * 2.2;
    s.dustT0 = E.impact;
    s.laserLightPos = B.clone().addScaledVector(B.clone().sub(W.MOON_C).normalize(), 0.05);
    s.laserLightI = t < E.impact - 0.02 ? 0 : (3.0 + s.impactI * 2.0) * s.beamI;
    // TRACE
    s.sparkWindow = [E.trace_start - 0.45, E.beam_cutoff];
    s.sparkSource = (tb, outP, outN) => {
      if (tb < E.impact || tb > E.beam_cutoff) return false;
      const xy = trace.aim(tb); mapper.surface(xy[0], xy[1], W.MOON_C, outP); outN.copy(outP).sub(W.MOON_C).normalize(); return true;
    };
    const flash = pulse(t, E.trace_flash, 0.02, 0.1);
    s.traceFlash = flash * 0.4;
    const fill = smooth(prog(t, E.logo_fill));
    s.traceGain = (t < E.trace_start ? 0 : 3.2 + flash * 1.2) * (1 - fill);
    s.burn = 1 - fill;
    // RESOLVE
    s.logoO = fill;
    s.logoGlow = pulse(t, E.trace_flash, 0.03, 0.2) * 0.6 + fill * 0.04;
    const rec = smoother(prog(t, E.moon_recede));
    s.moonRecede = rec * 3.2; s.moonDim = lerp(1, 0.09, rec);
    // HOLD
    const sw = prog(t, E.light_sweep);
    s.sweepX = lerp(-0.25, 1.6, smooth(sw)); s.sweepI = Math.sin(Math.PI * sw) * 1.1;
    s.starGain = 1.0;
    return s;
  }

  function renderFrame(frame, opts = {}) {
    const sb = T.subframes_boost, tf = frame / T.fps;
    let N = opts.subframes ?? T.subframes, sh = T.shutter;
    if (N > 1 && tf >= sb.window[0] && tf <= sb.window[1]) { N *= sb.factor; sh = sb.shutter; }
    post.beginFrame();
    let last = null;
    for (let i = 0; i < N; i++) {
      const off = N === 1 ? 0 : ((i + 0.5) / N - 0.5) * sh;
      const t = Math.max(0, (frame + off) / T.fps);
      const cam = rig.update(t);
      // sub-pixel jitter (R2 sequence): the motion-blur sub-frames double as supersampling AA
      if (N > 1) { const jx = ((0.5 + 0.7548776662 * (i + 1)) % 1) - 0.5, jy = ((0.5 + 0.5698402910 * (i + 1)) % 1) - 0.5; cam.setViewOffset(Wd, Ht, jx, jy, Wd, Ht); } else cam.clearViewOffset();
      const s = state(t, cam);
      trace.draw(t);
      stars.update(s); earth.update(s); moon.update(s); laser.update(s); logo.update(s);
      post.addSubframe(scene, over, cam, 1 / N);
      last = { s, cam };
    }
    const t = frame / T.fps, { s, cam } = last;
    const fp = W.CITY_POS.clone().project(cam);
    const hold = smooth(prog(t, [E.hold_start - 0.3, E.hold_start + 0.3]));
    post.finish({
      bloom: 0.6, exposure: 1.0, frame, laserColor, flareI: fp.z < 1 ? s.flareI : 0, flarePos: new THREE.Vector2(fp.x * 0.5 + 0.5, fp.y * 0.5 + 0.5),
      grain: lerp(0.032, 0.018, hold), ca: 0.004,
    });
    return true;
  }
  function grab() {
    const gl = renderer.getContext();
    const px = new Uint8Array(Wd * Ht * 4);
    gl.readPixels(0, 0, Wd, Ht, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let bin = ''; const CH = 0x8000;
    for (let i = 0; i < px.length; i += CH) bin += String.fromCharCode.apply(null, px.subarray(i, i + CH));
    return btoa(bin);
  }
  window.renderFrame = renderFrame; window.grab = grab;
  window.sceneInfo = { Wd, Ht, impactFacesEarth: impactNormal.dot(W.MOON_C.clone().negate().normalize()), gl: renderer.getContext().getParameter(renderer.getContext().VERSION) };
  window.ready = true;
}
boot().catch((e) => { window.bootError = String(e && e.stack || e); console.error(e); });
