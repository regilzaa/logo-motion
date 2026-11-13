// The official logo: the original PNG's alpha, only moved / scaled / revealed, never redrawn.
// Two copies share one plane transform:
//   overlay – crisp, composited AFTER bloom/tonemapping (pure #FFFFFF ink, per the approved treatment)
//   glow    – an emissive ghost inside the HDR scene that feeds bloom (resolve glow + light sweep)
import * as THREE from 'three';
import { LOGO_ORIGIN, LOGO_RIGHT, LOGO_UP, LOGO_N } from './world.js';

export function makeLogo(alphaTex, mapper) {
  const s = mapper.canvasWorldSize;
  // plane covering the whole logo canvas (0..1), placed so the ink-box centre sits on LOGO_ORIGIN
  const centre = mapper.plane(0.5, 0.5);
  const basis = new THREE.Matrix4().makeBasis(LOGO_RIGHT, LOGO_UP, LOGO_N);
  const geo = new THREE.PlaneGeometry(s, s);
  const place = (m) => { m.quaternion.setFromRotationMatrix(basis); m.position.copy(centre).addScaledVector(LOGO_N, 0.002); m.frustumCulled = false; };

  const overlay = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: { tA: { value: alphaTex }, uO: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D tA; uniform float uO; varying vec2 vUv;
      void main(){ float a = texture(tA, vUv).r * uO; gl_FragColor = vec4(vec3(a), a); }`,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  place(overlay);

  const glow = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: { tA: { value: alphaTex }, uI: { value: 0 }, uSweep: { value: -1 }, uSweepI: { value: 0 }, uCol: { value: new THREE.Color() } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D tA; uniform float uI, uSweep, uSweepI; uniform vec3 uCol; varying vec2 vUv;
      void main(){
        float a = textureLod(tA, vUv, 2.0).r;
        float band = exp(-pow(((vUv.x + (1.0 - vUv.y) * 0.45) - uSweep) / 0.06, 2.0));
        vec3 c = a * (uCol * uI + vec3(1.0, 0.98, 0.95) * band * uSweepI);
        gl_FragColor = vec4(c, 1.0); }`,
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  place(glow); glow.renderOrder = 20;

  return {
    overlay, glow,
    update(st) {
      overlay.material.uniforms.uO.value = st.logoO;
      const g = glow.material.uniforms; g.uI.value = st.logoGlow; g.uSweep.value = st.sweepX; g.uSweepI.value = st.sweepI; g.uCol.value.copy(st.laserColor);
      glow.visible = st.logoGlow > 1e-4 || st.sweepI > 1e-4;
      overlay.visible = st.logoO > 1e-4;
    },
  };
}
