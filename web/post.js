// Post: sub-frame accumulation (motion blur) -> bloom (dual-filter mip chain) -> lens flare,
// faint chromatic edge, ACES tonemap, crisp logo overlay, fine film grain, dither.
import * as THREE from 'three';

const FS_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
function pass(frag, uniforms, blending = THREE.NoBlending) {
  const m = new THREE.ShaderMaterial({ vertexShader: FS_VS, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, blending, transparent: blending !== THREE.NoBlending });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  return { m, scene, u: m.uniforms };
}

export function makePost(renderer, W, H) {
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const rt = (w, h, samples = 0) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, samples, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const sceneRT = rt(W, H, 0), overRT = rt(W, H, 0);   // AA comes from jittered sub-frames
  const accum = rt(W, H), accumOver = rt(W, H);
  const LEVELS = 7, mips = [];
  for (let i = 0; i < LEVELS; i++) mips.push(rt(Math.max(1, W >> (i + 1)), Math.max(1, H >> (i + 1))));

  const add = pass(`uniform sampler2D tSrc; uniform float uW; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv) * uW; }`,
    { tSrc: { value: null }, uW: { value: 1 } }, THREE.AdditiveBlending);
  add.m.blending = THREE.CustomBlending; add.m.blendSrc = THREE.OneFactor; add.m.blendDst = THREE.OneFactor;
  add.m.blendSrcAlpha = THREE.OneFactor; add.m.blendDstAlpha = THREE.OneFactor;

  const down = pass(`uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uPre; varying vec2 vUv;
    vec3 pre(vec3 c){ float b = max(c.r, max(c.g, c.b)); return mix(c, c * smoothstep(0.9, 3.0, b), uPre); }
    void main(){ vec2 o = uTexel;
      vec3 c = texture2D(tSrc, vUv).rgb * 4.0 + texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb;
      gl_FragColor = vec4(pre(c / 8.0), 1.0); }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uPre: { value: 0 } });
  const up = pass(`uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
    void main(){ vec2 o = uTexel; vec3 c = vec3(0.0);
      c += texture2D(tSrc, vUv + vec2(-2.0*o.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(2.0*o.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, -2.0*o.y)).rgb + texture2D(tSrc, vUv + vec2(0.0, 2.0*o.y)).rgb;
      c += (texture2D(tSrc, vUv + vec2(-o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, o.y)).rgb + texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb + texture2D(tSrc, vUv + vec2(o.x, -o.y)).rgb) * 2.0;
      gl_FragColor = vec4(c / 12.0, 1.0); }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } }, THREE.AdditiveBlending);
  up.m.blending = THREE.CustomBlending; up.m.blendSrc = THREE.OneFactor; up.m.blendDst = THREE.OneFactor;

  const comp = pass(/* glsl */`
    uniform sampler2D tScene, tBloom, tOver; uniform vec2 uRes; uniform float uBloom, uExposure, uGrain, uFrame, uCA, uVig;
    uniform vec2 uFlarePos; uniform float uFlareI; uniform vec3 uFlareCol;
    varying vec2 vUv;
    vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
    float hash(vec3 p){ p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
    vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
    void main(){
      vec2 uv = vUv, d = uv - 0.5;
      float r2 = dot(d * vec2(uRes.x / uRes.y, 1.0), d * vec2(uRes.x / uRes.y, 1.0));
      // faint chromatic edge: radial, grows toward the frame edge
      vec2 ca = d * uCA * r2;
      vec3 sc = vec3(texture2D(tScene, uv - ca).r, texture2D(tScene, uv).g, texture2D(tScene, uv + ca).b);
      vec3 bl = texture2D(tBloom, uv).rgb;
      vec3 bc = vec3(texture2D(tBloom, uv - ca * 3.0).r, bl.g, texture2D(tBloom, uv + ca * 3.0).b);
      vec3 col = sc + bc * uBloom;
      // lens flare kick: anamorphic streak + two ghosts mirrored through the centre
      if (uFlareI > 0.0) {
        vec2 a = vec2(uRes.x / uRes.y, 1.0);
        vec2 fp = (uv - uFlarePos) * a;
        float streak = exp(-abs(fp.y) * 220.0) * exp(-abs(fp.x) * 1.6);
        float halo = exp(-length(fp) * 9.0);
        vec2 g1 = (uv - (1.0 - uFlarePos) * 1.0 + (uFlarePos - 0.5) * 0.35) * a;
        vec2 g2 = (uv - mix(uFlarePos, vec2(0.5), 1.45)) * a;
        float gh = smoothstep(0.075, 0.06, length(g1)) * 0.25 + smoothstep(0.035, 0.025, length(g2)) * 0.35;
        col += uFlareI * (uFlareCol * streak * 2.0 + vec3(1.0) * halo * 0.6 + uFlareCol * gh * 0.25);
      }
      col *= uExposure;
      col *= 1.0 - uVig * r2;
      col = aces(col);
      // crisp logo overlay (premultiplied, not bloomed, not blurred)
      vec4 ov = texture2D(tOver, uv);
      col = col * (1.0 - ov.a) + ov.rgb;
      vec3 s = toSRGB(clamp(col, 0.0, 1.0));
      // fine film grain (luma-weighted, deterministic per frame) + dither
      float gn = hash(vec3(gl_FragCoord.xy, uFrame)) + hash(vec3(gl_FragCoord.yx + 17.0, uFrame * 1.37)) - 1.0;
      float lum = dot(s, vec3(0.299, 0.587, 0.114));
      s += gn * uGrain * (0.35 + 0.65 * sqrt(lum)) * (1.0 - lum * 0.6);
      s += (hash(vec3(gl_FragCoord.xy * 1.7, uFrame + 3.0)) - 0.5) / 255.0;
      gl_FragColor = vec4(s, 1.0);
    }`, {
    tScene: { value: accum.texture }, tBloom: { value: mips[0].texture }, tOver: { value: accumOver.texture },
    uRes: { value: new THREE.Vector2(W, H) }, uBloom: { value: 0.9 }, uExposure: { value: 1 }, uGrain: { value: 0.03 }, uFrame: { value: 0 },
    uCA: { value: 0.012 }, uVig: { value: 0.22 }, uFlarePos: { value: new THREE.Vector2(0.5, 0.5) }, uFlareI: { value: 0 }, uFlareCol: { value: new THREE.Color() },
  });

  const draw = (p, target) => { renderer.setRenderTarget(target); renderer.render(p.scene, cam); };

  return {
    comp,
    beginFrame() {
      renderer.setRenderTarget(accum); renderer.setClearColor(0x000000, 0); renderer.clear();
      renderer.setRenderTarget(accumOver); renderer.clear();
    },
    addSubframe(scene, overlayScene, camera, weight) {
      renderer.setRenderTarget(sceneRT); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, camera);
      renderer.setRenderTarget(overRT); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(overlayScene, camera);
      renderer.autoClear = false;                      // accumulate, never clear between sub-frames
      add.u.tSrc.value = sceneRT.texture; add.u.uW.value = weight; draw(add, accum);
      add.u.tSrc.value = overRT.texture; draw(add, accumOver);
      renderer.autoClear = true;
    },
    finish(params) {
      // bloom chain
      let src = accum;
      for (let i = 0; i < LEVELS; i++) {
        down.u.tSrc.value = src.texture; down.u.uTexel.value.set(1 / src.width, 1 / src.height); down.u.uPre.value = i === 0 ? 1 : 0;
        draw(down, mips[i]); src = mips[i];
      }
      for (let i = LEVELS - 1; i > 0; i--) {
        up.u.tSrc.value = mips[i].texture; up.u.uTexel.value.set(1 / mips[i].width, 1 / mips[i].height);
        renderer.setRenderTarget(mips[i - 1]); renderer.autoClear = false; renderer.render(up.scene, cam); renderer.autoClear = true;
      }
      Object.assign(comp.u.uBloom, { value: params.bloom });
      comp.u.uExposure.value = params.exposure; comp.u.uGrain.value = params.grain; comp.u.uFrame.value = params.frame;
      comp.u.uFlareI.value = params.flareI; comp.u.uFlarePos.value.copy(params.flarePos); comp.u.uFlareCol.value.copy(params.laserColor);
      comp.u.uCA.value = params.ca;
      draw(comp, null);
    },
  };
}
