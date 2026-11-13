// Pure, deterministic helpers. No wall-clock time anywhere.
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const smoother = (t) => { t = clamp(t); return t * t * t * (t * (t * 6 - 15) + 10); };
export const easeOut = (t, p = 3) => 1 - Math.pow(1 - clamp(t), p);
export const easeIn = (t, p = 3) => Math.pow(clamp(t), p);
export const easeInOut = (t, p = 3) => { t = clamp(t); return t < 0.5 ? Math.pow(2 * t, p) / 2 : 1 - Math.pow(2 - 2 * t, p) / 2; };
/** progress of t through [a,b] */
export const prog = (t, ab) => clamp((t - ab[0]) / (ab[1] - ab[0]));
/** 0 outside window, attack/decay envelope inside */
export const pulse = (t, t0, attack, decay) => t < t0 ? 0 : t < t0 + attack ? (t - t0) / attack : Math.exp(-(t - t0 - attack) / decay);
export function rng(seed) {           // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** smooth value noise in 1D, deterministic */
export function noise1(x, seed = 0) {
  const h = (i) => { const r = rng((i * 374761393 + seed * 668265263) >>> 0); return r() * 2 - 1; };
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u);
}
