// Moon: CGI Moon Kit colour + height, hard sunlight, laser light, shockwave, engraved trace decal.
import * as THREE from 'three';
import { MOON_R, MOON_C, SUN_DIR, LOGO_N, LOGO_UP, LOGO_RIGHT, LOGO_ORIGIN } from './world.js';
import { SPHERE_UV } from './earth.js';

export function makeMoon(tex, traceTex, mapper) {
  const geo = new THREE.SphereGeometry(MOON_R, 256, 192);
  const U = {
    tColor: { value: tex.moon_color }, tHeight: { value: tex.moon_disp }, tTrace: { value: traceTex },
    uSun: { value: SUN_DIR.clone() }, uDim: { value: 1 },
    uLaserPos: { value: new THREE.Vector3() }, uLaserI: { value: 0 }, uLaser: { value: new THREE.Color() },
    uImpact: { value: new THREE.Vector3() }, uWaveR: { value: -1 }, uWaveI: { value: 0 },
    uDecalO: { value: LOGO_ORIGIN.clone() }, uDecalR: { value: LOGO_RIGHT.clone() }, uDecalU: { value: LOGO_UP.clone() }, uDecalN: { value: LOGO_N.clone() },
    uDecalScale: { value: mapper.canvasWorldSize }, uDecalC: { value: new THREE.Vector2(mapper.cx, mapper.cy) },
    uTraceGain: { value: 0 }, uCentre: { value: MOON_C.clone() }, uBurn: { value: 0 }, uHeightAmp: { value: MOON_R * 0.012 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */`
      uniform sampler2D tHeight; uniform float uHeightAmp;
      varying vec3 vObjN; varying vec3 vW; varying vec3 vN;
      vec2 dirUVv(vec3 n){ return vec2(atan(n.x, n.z) / 6.2831853 + 0.5, asin(clamp(n.y,-1.0,1.0)) / 3.1415927 + 0.5); }
      void main(){
        vObjN = normal;
        float h = textureLod(tHeight, dirUVv(normal), 1.0).r;
        vec3 p = position + normal * (h - 0.5) * uHeightAmp;
        vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tColor, tHeight, tTrace; uniform vec3 uSun, uLaserPos, uImpact, uLaser;
      uniform float uDim, uLaserI, uWaveR, uWaveI, uTraceGain, uBurn, uDecalScale;
      uniform vec3 uDecalO, uDecalR, uDecalU, uDecalN, uCentre; uniform vec2 uDecalC;
      varying vec3 vObjN; varying vec3 vW; varying vec3 vN;
      ${SPHERE_UV}
      float H(vec3 d){ return sph(tHeight, d).r; }
      void main(){
        vec3 on = normalize(vObjN);
        // bump from the height map (finite differences on the sphere)
        vec3 t1 = normalize(cross(abs(on.y) > 0.99 ? vec3(1,0,0) : vec3(0,1,0), on)), t2 = cross(on, t1);
        float e = 0.004;
        float h0 = H(on), hx = H(normalize(on + t1 * e)), hy = H(normalize(on + t2 * e));
        vec3 bn = normalize(on - (t1 * (hx - h0) + t2 * (hy - h0)) * 2.2);
        vec3 n = bn;                                  // moon mesh is never rotated
        vec3 gn = normalize(vN);
        vec3 alb = pow(sph(tColor, on).rgb, vec3(2.2));
        // hard sunlight: Lambert / Lommel-Seeliger mix, crisp terminator, no ambient
        float ndl = max(dot(n, uSun), 0.0);
        vec3 v = normalize(cameraPosition - vW);
        float ndv = max(dot(gn, v), 0.05);
        float ls = ndl / (ndl + ndv);
        vec3 col = alb * mix(ndl, ls * 2.0, 0.35) * 1.45 * smoothstep(-0.02, 0.06, dot(gn, uSun));
        // laser light (point light just above the surface)
        vec3 L = uLaserPos - vW; float d = length(L); L /= d;
        col += alb * uLaser * uLaserI * max(dot(n, L), 0.0) / (1.0 + 900.0 * d * d);
        // shockwave ring across the surface + coloured craters in its wake
        vec3 c = uCentre;
        float g = acos(clamp(dot(normalize(vW - c), normalize(uImpact - c)), -1.0, 1.0)) * ${MOON_R.toFixed(4)};
        float ring = exp(-pow((g - uWaveR) / 0.012, 2.0));
        float wake = smoothstep(uWaveR, 0.0, g) * step(0.0, uWaveR);
        col += uLaser * uWaveI * (ring * 1.6 * (0.5 + 0.8 * max(dot(n, normalize(uImpact - c)), 0.0)) + wake * 0.25 * alb * 4.0 * (1.0 + 6.0 * max(hx - h0, 0.0)));
        // engraved trace: planar decal along the final camera axis, front hemisphere only
        vec3 rel = vW - uDecalO;
        vec2 duv = vec2(dot(rel, uDecalR), -dot(rel, uDecalU)) / uDecalScale + uDecalC;
        float front = smoothstep(0.15, 0.4, dot(gn, uDecalN));
        vec4 tr = texture(tTrace, vec2(duv.x, 1.0 - duv.y)) * front;
        col *= 1.0 - uBurn * tr.a * 0.85;              // burnt groove
        col += tr.rgb * uTraceGain;
        gl_FragColor = vec4(col * uDim, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const group = new THREE.Group();
  group.add(mesh);
  group.position.copy(MOON_C);
  return {
    object: group, uniforms: U,
    update(s) {
      group.position.copy(MOON_C).addScaledVector(LOGO_N, -s.moonRecede);
      U.uCentre.value.copy(group.position); U.uDim.value = s.moonDim; U.uLaserPos.value.copy(s.laserLightPos); U.uLaserI.value = s.laserLightI; U.uLaser.value.copy(s.laserColor);
      U.uImpact.value.copy(s.impactPos).addScaledVector(LOGO_N, -s.moonRecede); U.uWaveR.value = s.waveR; U.uWaveI.value = s.waveI;
      U.uDecalO.value.copy(LOGO_ORIGIN).addScaledVector(LOGO_N, -s.moonRecede);
      U.uTraceGain.value = s.traceGain; U.uBurn.value = s.burn;
    },
  };
}
