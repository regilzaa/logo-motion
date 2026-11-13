// Laser: charge core + contracting ring, beam (hot core / coloured falloff), tip, muzzle and
// impact flashes, sparks off the tip, and the impact dust plume. All camera-facing, HDR additive.
import * as THREE from 'three';
import { rng } from './util.js';

const BILLBOARD_VS = /* glsl */`
  uniform vec3 uPos; uniform float uSize;
  varying vec2 vUv;
  void main(){
    vUv = uv * 2.0 - 1.0;
    vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 p = uPos + (r * position.x + u * position.y) * uSize;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

function sprite(kind) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uPos: { value: new THREE.Vector3() }, uSize: { value: 1 }, uI: { value: 0 }, uCol: { value: new THREE.Color() }, uRing: { value: 0.5 }, uW: { value: 0.04 } },
    vertexShader: BILLBOARD_VS,
    fragmentShader: kind === 'ring' ? /* glsl */`
      uniform float uI, uRing, uW; uniform vec3 uCol; varying vec2 vUv;
      void main(){ float r = length(vUv); float a = exp(-pow((r - uRing) / uW, 2.0)); gl_FragColor = vec4(uCol * a * uI, 1.0); }` : /* glsl */`
      uniform float uI; uniform vec3 uCol; varying vec2 vUv;
      void main(){
        float r = length(vUv); if (r > 1.0) discard;
        float core = exp(-r * r * 160.0);                 // white-hot pinpoint
        float glow = exp(-r * r * 14.0) * 0.5 + 0.06 * (1.0 - r) / (r * 12.0 + 0.4);
        vec3 c = vec3(1.0) * core * 3.0 + uCol * glow;
        gl_FragColor = vec4(c * uI, 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
  mesh.frustumCulled = false; mesh.renderOrder = 10;
  if (kind === 'ring' || kind === 'nodepth') m.depthTest = false;
  return mesh;
}

function beam() {
  const SEG = 160, pos = [], aT = [], aS = [], idx = [];
  for (let i = 0; i <= SEG; i++) for (const s of [-1, 1]) { pos.push(0, 0, 0); aT.push(i / SEG); aS.push(s); }
  for (let i = 0; i < SEG; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
  g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    uniforms: { uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uW: { value: 0.02 }, uI: { value: 0 }, uCol: { value: new THREE.Color() }, uPix: { value: 0.001 }, uTip: { value: 1 }, uLen: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float aT; attribute float aS; uniform vec3 uA, uB; uniform float uW, uPix;
      varying float vT; varying float vS; varying float vE;
      void main(){
        vec3 P = mix(uA, uB, aT);
        vec3 d = normalize(uB - uA + 1e-6);
        vec3 toCam = cameraPosition - P;
        vec3 side = normalize(cross(d, toCam));
        float dist = length(toCam);
        float w = min(max(uW, 6.0 * uPix * dist), 0.04 * dist);   // cap apparent width when the camera rides the beam          // never thinner than ~6 px of glow: no aliasing
        vE = min(uW / w, 1.0);                                    // energy conservation when widened
        vT = aT; vS = aS;
        gl_Position = projectionMatrix * viewMatrix * vec4(P + side * aS * w, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uI, uTip, uLen; uniform vec3 uCol; varying float vT; varying float vS; varying float vE;
      void main(){
        float s = abs(vS);
        float core = exp(-s * s * 90.0);
        float glow = exp(-s * s * 7.0);
        float fringe = exp(-pow((s - 0.55) / 0.18, 2.0));      // faint chromatic edge
        float tipB = 1.0 + uTip * exp(-(1.0 - vT) * uLen / 0.35);
        float tailFade = smoothstep(0.0, 0.015, vT);
        vec3 c = vec3(1.0) * core * 2.2 + uCol * glow * 0.55 + vec3(0.55, 0.15, 1.0) * fringe * 0.06;
        gl_FragColor = vec4(c * uI * tipB * tailFade * mix(1.0, vE, 0.6), 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 11;
  return mesh;
}

function particles(N, soft) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('col', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('size', new THREE.BufferAttribute(new Float32Array(N), 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uProj: { value: 500 }, uPx: { value: 1 } },
    vertexShader: /* glsl */`
      attribute vec3 col; attribute float size; uniform float uProj, uPx; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        float px = size * uProj / -mv.z; float ps = max(px, 1.8 * uPx);
        vC = col * (px * px) / (ps * ps); gl_PointSize = ps; }`,
    fragmentShader: soft ? /* glsl */`varying vec3 vC; void main(){ vec2 d = gl_PointCoord * 2.0 - 1.0; float a = exp(-dot(d, d) * 2.5) - 0.082; if (a <= 0.0) discard; gl_FragColor = vec4(vC * a, 1.0); }`
      : /* glsl */`varying vec3 vC; void main(){ vec2 d = gl_PointCoord * 2.0 - 1.0; float a = exp(-dot(d, d) * 5.0); gl_FragColor = vec4(vC * a, 1.0); }`,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true,
  });
  const p = new THREE.Points(g, m); p.frustumCulled = false; p.renderOrder = 12;
  return p;
}

export function makeLaser() {
  const group = new THREE.Group();
  const parts = {
    cityPulse: sprite('nodepth'), core: sprite('nodepth'), ring: sprite('ring'), muzzle: sprite('nodepth'),
    tip: sprite('glow'), impact: sprite('glow'), beam: beam(),
    sparks: particles(700, false), dust: particles(420, true),
  };
  Object.values(parts).forEach((o) => group.add(o));

  // deterministic particle seeds
  const R = rng(1234);
  const sparkSeeds = Array.from({ length: 700 }, () => [R(), R(), R(), R(), R()]);
  const dustSeeds = Array.from({ length: 420 }, () => [R(), R(), R(), R(), R()]);

  const set = (m, pos, size, I, col) => { const u = m.material.uniforms; u.uPos.value.copy(pos); u.uSize.value = size; u.uI.value = I; u.uCol.value.copy(col); m.visible = I > 1e-4; };
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const WHITE = new THREE.Color(1, 1, 1), WHITEISH = new THREE.Color();

  return {
    object: group,
    update(s) {
      const c = s.laserColor;
      set(parts.cityPulse, s.cityPos, 0.09, s.cityGlow, c);
      set(parts.core, s.cityPos, 0.16, s.coreI, c);
      set(parts.ring, s.cityPos, 0.5, s.ringI, c);
      parts.ring.material.uniforms.uRing.value = s.ringR; parts.ring.material.uniforms.uW.value = 0.035;
      set(parts.muzzle, s.cityPos, 0.6, s.muzzleI, c);
      set(parts.tip, s.beamB, s.tipSize, s.tipI, c);
      set(parts.impact, s.impactPos, 0.4, s.impactI, WHITEISH.copy(c).lerp(WHITE, 0.7));
      const bu = parts.beam.material.uniforms;
      bu.uA.value.copy(s.beamA); bu.uB.value.copy(s.beamB); bu.uI.value = s.beamI; bu.uW.value = s.beamW; bu.uCol.value.copy(c);
      bu.uPix.value = s.pixAngle; bu.uTip.value = s.beamTipBoost; bu.uLen.value = Math.max(1e-3, s.beamA.distanceTo(s.beamB));
      parts.beam.visible = s.beamI > 1e-4;

      // sparks: born at the tip during the trace, ballistic, pulled back toward the Moon
      {
        const g = parts.sparks.geometry, P = g.attributes.position.array, C = g.attributes.col.array, Z = g.attributes.size.array;
        const [t0, t1] = s.sparkWindow, N = sparkSeeds.length;
        for (let i = 0; i < N; i++) {
          const sd = sparkSeeds[i];
          const tb = t0 + (i + sd[0] * 0.8) / N * (t1 - t0);
          const life = 0.22 + sd[1] * 0.4, a = s.t - tb;
          if (a < 0 || a > life || !s.sparkSource(tb, tmp, tmp2)) { Z[i] = 0; C[3 * i] = C[3 * i + 1] = C[3 * i + 2] = 0; P[3 * i] = P[3 * i + 1] = P[3 * i + 2] = 0; continue; }
          // tmp = tip position at birth, tmp2 = outward surface normal there
          const th = sd[2] * Math.PI * 2, sp = 0.35 + sd[3] * 0.9;
          const tA = new THREE.Vector3().crossVectors(tmp2, Math.abs(tmp2.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize();
          const tB = new THREE.Vector3().crossVectors(tmp2, tA);
          const v = tmp2.clone().multiplyScalar(0.55).addScaledVector(tA, Math.cos(th) * 0.8).addScaledVector(tB, Math.sin(th) * 0.8).normalize().multiplyScalar(sp);
          const p = tmp.clone().addScaledVector(tmp2, 0.004).addScaledVector(v, a).addScaledVector(tmp2, -2.2 * a * a);
          P[3 * i] = p.x; P[3 * i + 1] = p.y; P[3 * i + 2] = p.z;
          const k = a / life, heat = Math.exp(-k * 3.0), fade = (1 - k) * (1 - k);
          C[3 * i] = (c.r * 0.8 + heat) * fade * 2.2; C[3 * i + 1] = (c.g * 0.8 + heat * 0.9) * fade * 2.2; C[3 * i + 2] = (c.b * 0.8 + heat * 0.8) * fade * 2.2;
          Z[i] = 0.0035 * (0.6 + sd[4]);
        }
        g.attributes.position.needsUpdate = g.attributes.col.needsUpdate = g.attributes.size.needsUpdate = true;
        parts.sparks.material.uniforms.uProj.value = s.projScale; parts.sparks.material.uniforms.uPx.value = s.px;
      }
      // dust plume from the impact: fast ejecta, strong drag, expanding, sunlit grey with a laser tint
      {
        const g = parts.dust.geometry, P = g.attributes.position.array, C = g.attributes.col.array, Z = g.attributes.size.array;
        const n = s.impactNormal, N = dustSeeds.length;
        const tA = new THREE.Vector3().crossVectors(n, new THREE.Vector3(0, 1, 0)).normalize(), tB = new THREE.Vector3().crossVectors(n, tA);
        for (let i = 0; i < N; i++) {
          const sd = dustSeeds[i];
          const tb = s.dustT0 + sd[0] * 0.06, a = s.t - tb, life = 0.5 + sd[1] * 0.5;
          if (a < 0 || a > life) { Z[i] = 0; C[3 * i] = C[3 * i + 1] = C[3 * i + 2] = 0; continue; }
          const th = sd[2] * Math.PI * 2, spread = 0.25 + sd[3] * 0.75;
          const dir = n.clone().multiplyScalar(1.0).addScaledVector(tA, Math.cos(th) * spread).addScaledVector(tB, Math.sin(th) * spread).normalize();
          const sp = 0.25 + sd[4] * 0.55, drag = 5.0, dist = sp * (1 - Math.exp(-drag * a)) / drag;
          const p = s.impactPos.clone().addScaledVector(dir, dist);
          P[3 * i] = p.x; P[3 * i + 1] = p.y; P[3 * i + 2] = p.z;
          const k = a / life, f = Math.pow(1 - k, 2) * Math.min(1, a / 0.03) * 0.09;
          const heat = Math.exp(-a / 0.1);
          C[3 * i] = (0.75 + c.r * heat * 3) * f; C[3 * i + 1] = (0.72 + c.g * heat * 3) * f; C[3 * i + 2] = (0.68 + c.b * heat * 3) * f;
          Z[i] = 0.02 + 0.07 * k * (0.5 + sd[1]);
        }
        g.attributes.position.needsUpdate = g.attributes.col.needsUpdate = g.attributes.size.needsUpdate = true;
        parts.dust.material.uniforms.uProj.value = s.projScale; parts.dust.material.uniforms.uPx.value = s.px;
        parts.dust.visible = s.t >= s.dustT0 && s.t < s.dustT0 + 1.2;
      }
    },
  };
}
