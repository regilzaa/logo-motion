// ONE continuous camera move. Keys are C1-continuous (Hermite, non-uniform Catmull-Rom tangents)
// for position, look-at target, roll and fov. Each layout has its own framing keys.
import * as THREE from 'three';
import { T } from './timing.js';
import { noise1, smooth, clamp } from './util.js';
import { MOON_C, MOON_R, CITY_POS, IMPACT_POS, LOGO_N, LOGO_UP, LOGO_RIGHT, LOGO_ORIGIN, LOGO_INK_W } from './world.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function finalDistance(layout, fov, aspect) {
  const L = T.layout[layout];
  const hHalf = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect;
  return LOGO_INK_W / (L.logo_width_frac * 2 * hHalf);
}

/** direction on a great arc between two unit vectors */
const slerpDir = (a, b, f) => { const q = new THREE.Quaternion().setFromUnitVectors(a, b); return a.clone().applyQuaternion(new THREE.Quaternion().slerp(q, f)); };

export function buildKeys(layout) {
  const land = layout === 'landscape';
  const aspect = land ? 16 / 9 : 9 / 16;
  const fovOpen = land ? 30 : 40, fovEnd = land ? 30 : 40;
  const open = land ? { p: V(1.36, 0.544, 5.895), t: V(1.41, 0.794, -3.023) } : { p: V(0.353, 1.349, 8.426), t: V(1.498, 0.847, -1.759) };
  // 9:16 opens rolled ~35° so the Earth->Moon diagonal stacks vertically, then unrolls through the whip
  const r0 = land ? 0 : -0.613;
  const toCity = CITY_POS.clone();
  const beamDir = IMPACT_POS.clone().sub(CITY_POS).normalize();

  // push toward the city light, then a small anticipation pull-back
  const pPush = open.p.clone().lerp(toCity.clone().multiplyScalar(2.6), 0.30);
  const tPush = open.t.clone().lerp(CITY_POS, 0.42);
  const pBack = pPush.clone().addScaledVector(pPush.clone().sub(CITY_POS).normalize(), 0.22);
  const tBack = tPush.clone().lerp(CITY_POS, 0.08);

  // whip: from just above the emitter, look down the beam, then race alongside it to the Moon
  const side = new THREE.Vector3().crossVectors(beamDir, V(0, 1, 0)).normalize();
  const cityN = CITY_POS.clone().normalize();
  const pLaunch = CITY_POS.clone().addScaledVector(cityN, land ? 1.25 : 1.4).addScaledVector(beamDir, -0.55).addScaledVector(side, land ? 0.35 : 0.25);
  const tLaunch = CITY_POS.clone().addScaledVector(beamDir, 2.2);
  const pWhip = CITY_POS.clone().lerp(IMPACT_POS, 0.36).addScaledVector(side, land ? 0.5 : 0.4).addScaledVector(V(0, 1, 0), 0.22);
  const tWhip = IMPACT_POS.clone();
  // Moon side: approach from the Earth side, then arc round to face the logo straight on
  const dFinal = finalDistance(layout, fovEnd, aspect);
  const L = T.layout[layout];
  const visH = 2 * dFinal * Math.tan(THREE.MathUtils.degToRad(fovEnd / 2));
  const tFinal = LOGO_ORIGIN.clone().addScaledVector(LOGO_UP, (L.logo_center[1] - 0.5) * visH); // logo above centre in 9:16
  const toEarthDir = MOON_C.clone().negate().normalize();
  const approachDir = slerpDir(LOGO_N, toEarthDir, 0.62).addScaledVector(LOGO_UP, 0.12).normalize();
  const arcAt = (f, dist) => MOON_C.clone().addScaledVector(slerpDir(approachDir, LOGO_N, f), MOON_R + dist);
  const tImpact = IMPACT_POS.clone();

  const keys = [
    { t: 0.00, p: open.p, tg: open.t, roll: r0, fov: fovOpen },
    { t: 1.05, p: pPush, tg: tPush, roll: r0 * 0.92 + 0.01, fov: fovOpen },
    { t: 1.20, p: pBack, tg: tBack, roll: r0 * 0.9, fov: fovOpen },
    { t: 1.36, p: pLaunch, tg: tLaunch, roll: land ? -0.06 : -0.4, fov: fovOpen + 4 },
    { t: 1.58, p: pWhip, tg: tWhip, roll: land ? -0.10 : -0.2, fov: fovOpen + 6 },
    { t: 1.80, p: arcAt(0.0, 1.55), tg: tImpact, roll: -0.03, fov: fovOpen },
    { t: 2.20, p: arcAt(0.12, 1.50 + 0.15), tg: tImpact.clone().lerp(LOGO_ORIGIN, 0.35), roll: 0.0, fov: fovEnd },
    { t: 2.90, p: arcAt(0.62, (dFinal - MOON_R) * 0.9 + 0.12), tg: tImpact.clone().lerp(tFinal, 0.85), roll: 0, fov: fovEnd },
    { t: 3.60, p: tFinal.clone().addScaledVector(LOGO_N, dFinal * 1.012), tg: tFinal, roll: 0, fov: fovEnd },
    { t: 4.20, p: tFinal.clone().addScaledVector(LOGO_N, dFinal * 1.006), tg: tFinal, roll: 0, fov: fovEnd },
    { t: 5.00, p: tFinal.clone().addScaledVector(LOGO_N, dFinal * 0.985), tg: tFinal, roll: 0, fov: fovEnd },
  ];
  // the final hold is a straight, constant-speed push-in (1.5 %)
  const n = keys.length;
  const vHold = keys[n - 1].p.clone().sub(keys[n - 2].p).divideScalar(keys[n - 1].t - keys[n - 2].t);
  keys[n - 2].v = vHold; keys[n - 1].v = vHold;
  keys[n - 2].vt = V(0, 0, 0); keys[n - 1].vt = V(0, 0, 0); keys[n - 3].vt = V(0, 0, 0);
  return { keys, aspect };
}

function hermite(keys, t, get, getV) {
  const n = keys.length;
  if (t <= keys[0].t) return get(keys[0]).clone();
  if (t >= keys[n - 1].t) return get(keys[n - 1]).clone().add(getV(n - 1).clone().multiplyScalar(t - keys[n - 1].t));
  let i = 0; while (keys[i + 1].t < t) i++;
  const k0 = keys[i], k1 = keys[i + 1], h = k1.t - k0.t, s = (t - k0.t) / h;
  const m0 = getV(i).clone().multiplyScalar(h), m1 = getV(i + 1).clone().multiplyScalar(h);
  const s2 = s * s, s3 = s2 * s;
  return get(k0).clone().multiplyScalar(2 * s3 - 3 * s2 + 1).add(m0.multiplyScalar(s3 - 2 * s2 + s))
    .add(get(k1).clone().multiplyScalar(-2 * s3 + 3 * s2)).add(m1.multiplyScalar(s3 - s2));
}
function tangent(keys, i, get, field) {
  if (keys[i][field]) return keys[i][field];
  const n = keys.length;
  if (i === 0) return get(keys[1]).clone().sub(get(keys[0])).divideScalar(keys[1].t - keys[0].t).multiplyScalar(0.5);
  if (i === n - 1) return new THREE.Vector3();
  const a = keys[i - 1], b = keys[i], c = keys[i + 1];
  const d0 = get(b).clone().sub(get(a)).divideScalar(b.t - a.t), d1 = get(c).clone().sub(get(b)).divideScalar(c.t - b.t);
  return d0.multiplyScalar((c.t - b.t) / (c.t - a.t)).add(d1.multiplyScalar((b.t - a.t) / (c.t - a.t)));
}

export function makeCameraRig(layout) {
  const { keys, aspect } = buildKeys(layout);
  const cam = new THREE.PerspectiveCamera(keys[0].fov, aspect, 0.01, 2000);
  const gP = (k) => k.p, gT = (k) => k.tg, gS = (k) => V(k.roll, k.fov, 0);
  const vP = keys.map((_, i) => tangent(keys, i, gP, 'v'));
  const vT = keys.map((_, i) => tangent(keys, i, gT, 'vt'));
  const vS = keys.map((_, i) => tangent(keys, i, gS, 'vs'));
  return {
    camera: cam, keys,
    update(t) {
      const p = hermite(keys, t, gP, (i) => vP[i]);
      const tg = hermite(keys, t, gT, (i) => vT[i]);
      const s = hermite(keys, t, gS, (i) => vS[i]);
      // impact shake: 2–3 frames, subtle, decays
      const [s0, s1] = T.events.camera_shake;
      const sh = t >= s0 && t < s1 + 0.05 ? Math.exp(-(t - s0) / 0.03) * 0.006 : 0;
      if (sh > 0) { tg.x += noise1(t * 90, 1) * sh; tg.y += noise1(t * 90, 2) * sh; }
      cam.position.copy(p); cam.fov = s.y; cam.up.set(0, 1, 0); cam.lookAt(tg);
      cam.rotateZ(s.x);
      cam.updateProjectionMatrix(); cam.updateMatrixWorld();
      return cam;
    },
  };
}
