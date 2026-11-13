// Scene geometry (cheated scale). Every position the camera, laser and trace need lives here.
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const EARTH_R = 1.0;
export const MOON_R = 0.55;
export const MOON_C = V(4.6, 2.5, -5.2);
// direction TOWARD the sun (world space). Sun behind/left of the opening camera:
// Earth shows its night side with a thin lit limb on the left; the Moon's Earth-facing side is side-lit.
export const SUN_DIR = V(-0.9, 0.3, -0.45).normalize();

// Earth orientation: put a real night-lights city at a chosen world direction.
// City: Cairo (30.04 N, 31.24 E) – bright, isolated point on the Nile.
export const CITY_LATLON = [30.04, 31.24];
export const CITY_DIR = V(0.38, 0.42, 0.82).normalize();   // faces the opening camera, upper part of the disc

export function latLonToLocal(latDeg, lonDeg) {
  const la = THREE.MathUtils.degToRad(latDeg), lo = THREE.MathUtils.degToRad(lonDeg);
  // matches the shader mapping in earth.js: lon = 0 faces +z, north = +y
  return V(Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo));
}

function frameQuat(fwd, upHint) {
  const z = fwd.clone().normalize();
  const x = new THREE.Vector3().crossVectors(upHint, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
// local frame of the city (north tangent) -> world frame (world up tangent), with ~20° tilt
const localCity = latLonToLocal(...CITY_LATLON);
const qL = frameQuat(localCity, V(0, 1, 0));
const qW = frameQuat(CITY_DIR, V(Math.sin(0.35), Math.cos(0.35), 0));
export const EARTH_QUAT = qW.clone().multiply(qL.clone().invert());
export const CITY_POS = CITY_DIR.clone().multiplyScalar(EARTH_R * 1.002);

// ----- Logo frame on the Moon ---------------------------------------------------------
const toEarth = new THREE.Vector3().subVectors(new THREE.Vector3(), MOON_C).normalize();
// Face the final camera between "toward Earth" and "toward the sun" so the Moon reads
// as a lit gibbous with a hard terminator on one side.
export const LOGO_N = toEarth.clone().multiplyScalar(0.75).add(SUN_DIR.clone().multiplyScalar(0.45)).add(V(0, 0.05, 0)).normalize();
export const LOGO_UP = V(0, 1, 0).sub(LOGO_N.clone().multiplyScalar(LOGO_N.y)).normalize();
export const LOGO_RIGHT = new THREE.Vector3().crossVectors(LOGO_UP, LOGO_N).normalize();
export const LOGO_INK_W = MOON_R * 1.18;              // world width of the logo's ink box
export const LOGO_ORIGIN = MOON_C.clone().add(LOGO_N.clone().multiplyScalar(MOON_R)); // tangent point

// Impact point: on the Earth-facing side, close to where the first stroke starts.
export const IMPACT_DIR = toEarth.clone().multiplyScalar(0.55).add(LOGO_N.clone().multiplyScalar(0.6)).add(LOGO_UP.clone().multiplyScalar(0.25)).add(LOGO_RIGHT.clone().multiplyScalar(0.12)).normalize();
export const IMPACT_POS = MOON_C.clone().add(IMPACT_DIR.clone().multiplyScalar(MOON_R));

/** ink-box centred logo coords (canvas 0..1) -> point on logo plane */
export function makeLogoMapper(D) {
  const ib = D.ink_bbox, cx = (ib[0] + ib[2]) / 2, cy = (ib[1] + ib[3]) / 2;
  const s = LOGO_INK_W / (ib[2] - ib[0]);               // world units per canvas unit
  return {
    canvasWorldSize: s, cx, cy,
    plane(x, y, out = new THREE.Vector3()) {
      return out.copy(LOGO_ORIGIN).addScaledVector(LOGO_RIGHT, (x - cx) * s).addScaledVector(LOGO_UP, (cy - y) * s);
    },
    /** project plane point along -LOGO_N onto the Moon sphere (moon centre c) */
    surface(x, y, c = MOON_C, out = new THREE.Vector3()) {
      const p = this.plane(x, y, out);
      const d = p.clone().sub(c);
      const along = d.dot(LOGO_N), perp2 = d.lengthSq() - along * along;
      const h = Math.sqrt(Math.max(0, MOON_R * MOON_R - perp2));
      return out.copy(c).addScaledVector(d.sub(LOGO_N.clone().multiplyScalar(along)), 1).addScaledVector(LOGO_N, h);
    },
  };
}
