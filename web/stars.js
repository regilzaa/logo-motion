// Sparse, subtle starfield: a few thousand points on a far sphere, power-law brightness.
import * as THREE from 'three';
import { rng } from './util.js';

export function makeStars() {
  const N = 2600, R = 400, r = rng(7);
  const pos = new Float32Array(N * 3), mag = new Float32Array(N), tint = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = r() * 2 - 1, th = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([R * s * Math.cos(th), R * u, R * s * Math.sin(th)], i * 3);
    mag[i] = Math.pow(r(), 9.0) * 1.6 + 0.04 + 0.08 * r();   // most stars faint, a handful bright
    const k = r();                                           // spectral tint: warm .. cool
    tint.set(k < 0.2 ? [1.0, 0.82, 0.66] : k < 0.75 ? [1, 1, 1] : [0.78, 0.86, 1.0], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  g.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: 1 }, uGain: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float mag; attribute vec3 tint; uniform float uPx; varying vec3 vC; varying float vS;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_Position = projectionMatrix * mv;
        float size = (1.6 + 2.2*mag) * uPx;          // pixels; never below ~1.6 so stars don't alias
        vS = size; gl_PointSize = size;
        vC = tint * mag;
      }`,
    fragmentShader: /* glsl */`
      uniform float uGain; varying vec3 vC; varying float vS;
      void main(){
        vec2 d = gl_PointCoord*2.0-1.0; float r2 = dot(d,d);
        float a = exp(-r2*4.5);
        if (a < 0.003) discard;
        gl_FragColor = vec4(vC*a*uGain, 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  return { object: pts, update(state) { mat.uniforms.uPx.value = state.px; mat.uniforms.uGain.value = state.starGain; } };
}
