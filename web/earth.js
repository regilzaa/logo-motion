// Earth: NASA Blue Marble day + night lights, terminator, water specular, atmosphere rim.
import * as THREE from 'three';
import { EARTH_R, EARTH_QUAT, SUN_DIR, CITY_DIR } from './world.js';

const SPHERE_UV = /* glsl */`
  // equirect lookup from an object-space direction; Tarini seam fix so mips never pop at lon=180
  vec2 dirUV(vec3 n){ return vec2(atan(n.x, n.z) / 6.2831853 + 0.5, asin(clamp(n.y,-1.0,1.0)) / 3.1415927 + 0.5); }
  vec4 sph(sampler2D tex, vec3 n){
    vec2 uv = dirUV(n);
    float ua = uv.x, ub = fract(uv.x + 0.5) - 0.5;
    vec2 dxa = vec2(dFdx(ua), dFdx(uv.y)), dya = vec2(dFdy(ua), dFdy(uv.y));
    vec2 dxb = vec2(dFdx(ub), dFdx(uv.y)), dyb = vec2(dFdy(ub), dFdy(uv.y));
    bool useB = abs(dxb.x)+abs(dyb.x) < abs(dxa.x)+abs(dya.x);
    return textureGrad(tex, uv, useB ? dxb : dxa, useB ? dyb : dya);
  }`;
export { SPHERE_UV };

export function makeEarth(tex) {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(EARTH_R, 192, 128);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tDay: { value: tex.earth_day }, tNight: { value: tex.earth_night }, tWater: { value: tex.earth_water },
      uSun: { value: SUN_DIR.clone() }, uCity: { value: CITY_DIR.clone() }, uCharge: { value: 0 }, uCityGlow: { value: 0 },
      uLaser: { value: new THREE.Color() },
    },
    vertexShader: /* glsl */`
      varying vec3 vObjN; varying vec3 vN; varying vec3 vW;
      void main(){ vObjN = normal; vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz;
        gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tDay, tNight, tWater; uniform vec3 uSun, uCity, uLaser; uniform float uCharge, uCityGlow;
      varying vec3 vObjN; varying vec3 vN; varying vec3 vW;
      ${SPHERE_UV}
      void main(){
        vec3 n = normalize(vN), v = normalize(cameraPosition - vW), on = normalize(vObjN);
        float ndl = dot(n, uSun);
        vec3 day = pow(sph(tDay, on).rgb, vec3(2.2));            // sRGB -> linear
        vec3 nightTex = pow(sph(tNight, on).rgb, vec3(2.2));
        float water = sph(tWater, on).r;
        // The night map carries a dim blue base; keep only the warm city lights.
        float lum = dot(nightTex, vec3(0.35, 0.55, 0.10));
        vec3 lights = nightTex * smoothstep(0.03, 0.065, lum) * vec3(1.3, 0.95, 0.6) * 26.0;
        float dayAmt = smoothstep(-0.06, 0.20, ndl);
        vec3 col = day * max(ndl, 0.0) * 2.4;
        // warm terminator band
        col += day * vec3(1.0, 0.45, 0.2) * 0.35 * exp(-pow((ndl - 0.02) / 0.06, 2.0));
        // ocean glint
        vec3 h = normalize(uSun + v);
        col += water * pow(max(dot(n, h), 0.0), 90.0) * 1.6 * vec3(1.0, 0.95, 0.85) * step(0.0, ndl);
        col += lights * (1.0 - dayAmt);
        // faint earthshine/ambient on the night side so the disc reads against space
        col += day * 0.003 * (1.0 - dayAmt);
        // energy gathering at the city: lights the ground around the emitter
        float dc = acos(clamp(dot(n, uCity), -1.0, 1.0));
        col += uLaser * (uCharge * 0.6 * exp(-dc * 38.0) + uCityGlow * 0.4 * exp(-dc * 70.0));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const earth = new THREE.Mesh(geo, mat);
  earth.quaternion.copy(EARTH_QUAT);
  group.add(earth);

  // Atmosphere: back-face shell, fresnel rim lit by the sun; faint shimmer above the city while charging.
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(EARTH_R * 1.035, 128, 96), new THREE.ShaderMaterial({
    uniforms: { uSun: { value: SUN_DIR.clone() }, uCity: { value: CITY_DIR.clone() }, uCharge: { value: 0 }, uTime: { value: 0 }, uLaser: { value: new THREE.Color() } },
    vertexShader: /* glsl */`varying vec3 vN; varying vec3 vW;
      void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSun, uCity, uLaser; uniform float uCharge, uTime; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 n = normalize(vN), v = normalize(cameraPosition - vW);
        float fr = 1.0 - abs(dot(n, v));
        float rim = pow(fr, 4.0);
        float lit = smoothstep(-0.35, 0.45, dot(n, uSun));
        vec3 sky = vec3(0.30, 0.55, 1.0);
        vec3 col = sky * rim * (lit * 2.2 + 0.03);
        col += vec3(1.0, 0.55, 0.25) * rim * 0.6 * exp(-pow(dot(n, uSun) / 0.18, 2.0)); // sunset tint at the terminator
        // shimmer: rippling veil above the emitter
        float dc = acos(clamp(dot(n, uCity), -1.0, 1.0));
        float rip = 0.6 + 0.4 * sin(dc * 160.0 - uTime * 40.0);
        col += uLaser * uCharge * exp(-dc * 9.0) * rip * (0.25 + rim) * 0.9;
        float a = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.FrontSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  group.add(atmo);
  return {
    object: group,
    update(s) {
      mat.uniforms.uCharge.value = s.charge; mat.uniforms.uCityGlow.value = s.cityGlow; mat.uniforms.uLaser.value.copy(s.laserColor);
      atmo.material.uniforms.uCharge.value = s.charge; atmo.material.uniforms.uTime.value = s.t; atmo.material.uniforms.uLaser.value.copy(s.laserColor);
    },
  };
}
