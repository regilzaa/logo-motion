// Laser trace: reveals the logo's own (potrace) paths stroke by stroke, dash-offset style,
// into a canvas that the Moon shader engraves. Also answers "where is the beam tip at time t".
import * as THREE from 'three';
import { T } from './timing.js';
import { clamp } from './util.js';

export function makeTrace(D, laserHex) {
  const S = 1536;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;

  const paths = D.paths.map((p, i) => {
    const P = p.points; const cum = [0];
    for (let k = 1; k < P.length; k++) cum.push(cum[k - 1] + Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]));
    const tp = T.trace_paths[i];
    return { P, cum, len: cum[cum.length - 1], t0: tp.start, t1: tp.end };
  });
  const lc = new THREE.Color(laserHex);
  const cool = [lc.r, lc.g, lc.b];

  // constant-speed reveal within each path: fraction of length drawn at time t
  const frac = (p, t) => clamp((t - p.t0) / (p.t1 - p.t0));
  function pointAt(p, u) {               // u in 0..1 of arc length
    const L = u * p.len; let k = 1;
    while (k < p.cum.length - 1 && p.cum[k] < L) k++;
    const a = p.P[k - 1], b = p.P[k], seg = (p.cum[k] - p.cum[k - 1]) || 1;
    const f = clamp((L - p.cum[k - 1]) / seg);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  /** active tip in logo canvas coords, or null between strokes */
  function tip(t) {
    for (const p of paths) if (t >= p.t0 && t <= p.t1) return { xy: pointAt(p, frac(p, t)), path: p };
    return null;
  }
  /** where the beam is aimed during the whole trace window (bridges gaps between strokes) */
  function aim(t) {
    const tp = tip(t); if (tp) return tp.xy;
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i], n = paths[i + 1];
      if (n && t > p.t1 && t < n.t0) {            // quick jump to the next start
        const a = pointAt(p, 1), b = pointAt(n, 0), f = clamp((t - p.t1) / (n.t0 - p.t1));
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      }
    }
    return t < paths[0].t0 ? pointAt(paths[0], 0) : pointAt(paths[paths.length - 1], 1);
  }

  // Strokes cool from white-hot to the laser colour. Anything older than COOL_AGE is drawn at the
  // final cooled colour into a static layer; because 'lighten' is an order-independent max, adding
  // segments incrementally gives exactly the same pixels as redrawing from scratch (deterministic).
  const TAU = 0.2, COOL_AGE = 0.6;
  const st = document.createElement('canvas'); st.width = st.height = S;
  const sctx = st.getContext('2d');
  let staticUpTo = -1;                       // static layer contains all segments drawn before this time
  const segColor = (heat) => {
    const r = cool[0] * 0.7 + heat * 0.6, g = cool[1] * 0.7 + heat * 0.6, b = cool[2] * 0.7 + heat * 0.6;
    return (a) => `rgb(${Math.round(255 * clamp(r * a))},${Math.round(255 * clamp(g * a))},${Math.round(255 * clamp(b * a))})`;
  };
  function strokeChunks(c, t, tFrom, tTo, heatFn) {
    c.globalCompositeOperation = 'lighten'; c.lineCap = 'round'; c.lineJoin = 'round';
    for (const p of paths) {
      const f = frac(p, t); if (f <= 0) continue;
      const Lmax = f * p.len, CH = 5;
      for (let k = 0; k < p.P.length - 1 && p.cum[k] < Lmax; k += CH) {
        const drawnAt = p.t0 + (p.cum[k] / p.len) * (p.t1 - p.t0);
        if (drawnAt < tFrom || drawnAt >= tTo) continue;
        const end = Math.min(k + CH, p.P.length - 1);
        const pts = [];
        for (let j = k; j <= end; j++) {
          if (p.cum[j] <= Lmax) pts.push(p.P[j]);
          else { pts.push(pointAt(p, f)); break; }
        }
        if (pts.length < 2) continue;
        const col = segColor(heatFn(t - drawnAt));
        c.beginPath(); c.moveTo(pts[0][0] * S, pts[0][1] * S);
        for (let j = 1; j < pts.length; j++) c.lineTo(pts[j][0] * S, pts[j][1] * S);
        c.strokeStyle = col(0.45); c.lineWidth = 9; c.stroke();
        c.strokeStyle = col(1.0); c.lineWidth = 4; c.stroke();      // engraved core
      }
    }
  }
  function draw(t) {
    const cutoff = t - COOL_AGE;
    if (cutoff < staticUpTo) { sctx.clearRect(0, 0, S, S); staticUpTo = -1; }   // time went backwards: rebuild
    if (cutoff > staticUpTo) {
      // cooled segments are fully drawn (all their points are revealed long before cutoff)
      strokeChunks(sctx, cutoff + 0.05, staticUpTo, cutoff, () => 0);
      staticUpTo = cutoff;
    }
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(st, 0, 0);
    strokeChunks(ctx, t, staticUpTo, Infinity, (age) => Math.exp(-Math.max(0, age) / TAU));
    tex.needsUpdate = true;
  }
  return { texture: tex, canvas: cv, paths, tip, aim, draw };
}
