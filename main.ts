// cutest-picture-01 entry (Node 22, standard library only). It draws its picture in code, with no image files:
// a chubby peach bunny with one floppy ear and a pink bow, cuddling a sleepy baby chick. Every shape is a signed
// distance field, shaded like a soft round blob and anti-aliased, then written as a PNG to /output/entry.png.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const W = 1024;
const H = 1024;
const img = new Float32Array(W * H * 3);

const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// The colour a paint callback leaves for the pixel it covers.
const C = [0, 0, 0];

// Runs f over a box of pixels; f returns the coverage (0..1) and sets C, which is blended over the image.
function paint(x0, y0, x1, y1, f) {
  x0 = Math.max(0, Math.floor(x0));
  y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(W, Math.ceil(x1));
  y1 = Math.min(H, Math.ceil(y1));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const a = f(x + 0.5, y + 0.5);
      if (a <= 0) continue;
      const i = (y * W + x) * 3;
      img[i] = mix(img[i], C[0], a);
      img[i + 1] = mix(img[i + 1], C[1], a);
      img[i + 2] = mix(img[i + 2], C[2], a);
    }
  }
}

function sdEllipse(u, v, rx, ry) {
  const k0 = Math.hypot(u / rx, v / ry);
  if (k0 < 1e-6) return -Math.min(rx, ry);
  const k1 = Math.hypot(u / (rx * rx), v / (ry * ry));
  return (k0 * (k0 - 1)) / k1;
}

// Fluffy tufts around a silhouette: two layers of soft-tipped tufts, each a different height.
function tufts(ang, n, seed) {
  const t = (ang / (2 * Math.PI)) * n + seed;
  const k = Math.floor(t);
  const b = 1 - Math.abs(2 * (t - k) - 1);
  return Math.pow(b, 1.6) * (0.3 + 0.7 * hash(k + seed * 13));
}
function fur(ang, f) {
  return 0.65 * tufts(ang, f.n, f.seed) + 0.35 * tufts(ang, f.n * 2.3, f.seed + 0.5);
}

// Smooth value noise, used for fur strands.
function noise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const h = (i, j) => hash(i * 57.0 + j * 113.0);
  return mix(mix(h(xi, yi), h(xi + 1, yi), ux), mix(h(xi, yi + 1), h(xi + 1, yi + 1), ux), uy);
}

const LIGHT = (() => {
  const l = [-0.45, -0.62, 0.64];
  const n = Math.hypot(...l);
  return l.map((c) => c / n);
})();

// A shaded ellipse: s = {cx, cy, rx, ry, rot, col, dark, fur, soft, alpha, gloss}.
function blob(s) {
  const col = hex(s.col);
  const dark = hex(s.dark ?? s.col);
  const rot = s.rot ?? 0;
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  const soft = s.soft ?? (s.fur ? 1.6 : 0.8);
  const amp = s.fur ? s.fur.amp : 0;
  const R = Math.max(s.rx, s.ry) + amp + soft + 2;
  paint(s.cx - R, s.cy - R, s.cx + R, s.cy + R, (x, y) => {
    const dx = x - s.cx;
    const dy = y - s.cy;
    const u = dx * c + dy * sn;
    const v = -dx * sn + dy * c;
    let d = sdEllipse(u, v, s.rx, s.ry);
    if (s.fur && d > -amp * 2) d -= amp * fur(Math.atan2(v / s.ry, u / s.rx), s.fur);
    const a = 1 - smooth(-soft, soft, d);
    if (a <= 0) return 0;
    const nu = u / s.rx;
    const nv = v / s.ry;
    const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, nu * nu + nv * nv)));
    const nx = nu * c - nv * sn;
    const ny = nu * sn + nv * c;
    const nl = Math.hypot(nx, ny, nz) || 1;
    const lam = clamp((nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / nl);
    const t = clamp(0.18 + 0.95 * lam);
    const spec = s.gloss ? s.gloss * Math.pow(lam, 24) : 0;
    // strands: noise stretched along the radius, a soft light fringe near the edge
    let tex = 0;
    if (s.fur) {
      const ang = Math.atan2(v / s.ry, u / s.rx);
      const rr = Math.hypot(u / s.rx, v / s.ry);
      const band = 0.25 + 0.75 * smooth(-0.45 * Math.min(s.rx, s.ry), 0, d);
      tex = 0.06 * band * (noise(ang * s.fur.n * 1.7, rr * 9) - 0.5) + 0.05 * smooth(-14, 0, d);
      // a warm rim light from behind, upper right
      tex += 0.1 * Math.pow(1 - nz / nl, 3) * clamp(0.5 + 0.5 * (nx * 0.6 - ny * 0.8) / nl);
    }
    for (let k = 0; k < 3; k++) C[k] = clamp(mix(dark[k], col[k], t) + spec + tex);
    return a * (s.alpha ?? 1);
  });
}

// A flat, soft-edged ellipse (blush, shadows, glows).
function glow(s) {
  const col = hex(s.col);
  const rot = s.rot ?? 0;
  const c = Math.cos(rot);
  const sn = Math.sin(rot);
  const R = Math.max(s.rx, s.ry) + s.soft + 2;
  paint(s.cx - R, s.cy - R, s.cx + R, s.cy + R, (x, y) => {
    const dx = x - s.cx;
    const dy = y - s.cy;
    const d = sdEllipse(dx * c + dy * sn, -dx * sn + dy * c, s.rx, s.ry);
    C[0] = col[0];
    C[1] = col[1];
    C[2] = col[2];
    return (1 - smooth(-s.soft, s.soft, d)) * s.alpha;
  });
}

// A round-capped circular arc, angles in radians with y pointing down.
function arc(cx, cy, r, a0, a1, w, hexCol) {
  const col = hex(hexCol);
  const ends = [a0, a1].map((a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  const span = a1 - a0;
  const R = r + w + 2;
  paint(cx - R, cy - R, cx + R, cy + R, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    let da = Math.atan2(dy, dx) - a0;
    da -= Math.floor(da / (2 * Math.PI)) * 2 * Math.PI;
    let d;
    if (da <= span) d = Math.abs(Math.hypot(dx, dy) - r);
    else d = Math.min(...ends.map(([ex, ey]) => Math.hypot(x - ex, y - ey)));
    C[0] = col[0];
    C[1] = col[1];
    C[2] = col[2];
    return 1 - smooth(w / 2 - 0.8, w / 2 + 0.8, d);
  });
}

// A heart of height ~size with its point at (cx, cy + size / 2).
function heart(cx, cy, size, hexCol, alpha) {
  const col = hex(hexCol);
  const s = size;
  paint(cx - s, cy - s, cx + s, cy + s, (x, y) => {
    let px = Math.abs(x - cx) / s;
    const py = (cy - y) / s + 0.5;
    let d;
    if (py + px > 1) d = Math.hypot(px - 0.25, py - 0.75) - Math.SQRT2 / 4;
    else {
      const m = 0.5 * Math.max(px + py, 0);
      d = Math.sqrt(Math.min(px * px + (py - 1) ** 2, (px - m) ** 2 + (py - m) ** 2)) * Math.sign(px - py);
    }
    d *= s;
    const t = clamp((cy - y) / s + 0.5);
    C[0] = col[0];
    C[1] = clamp(col[1] + 0.12 * t);
    C[2] = clamp(col[2] + 0.08 * t);
    return (1 - smooth(-0.8, 0.8, d)) * alpha;
  });
}

// A four-pointed twinkle of radius r.
function sparkle(cx, cy, r, hexCol, alpha) {
  const col = hex(hexCol);
  const k = Math.sqrt(r);
  paint(cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2, (x, y) => {
    const q = Math.sqrt(Math.abs(x - cx)) + Math.sqrt(Math.abs(y - cy));
    C[0] = col[0];
    C[1] = col[1];
    C[2] = col[2];
    return (1 - smooth(-0.07, 0.07, q / k - 1)) * alpha;
  });
}

// ---- background: a soft mint radial wash with a few pale bokeh dots
{
  const inner = hex('#eefaf5');
  const outer = hex('#bfe6dc');
  paint(0, 0, W, H, (x, y) => {
    const r = Math.hypot(x - 512, y - 440) / 720;
    const t = smooth(0, 1, r);
    for (let k = 0; k < 3; k++) C[k] = mix(inner[k], outer[k], t);
    return 1;
  });
  const dots = [
    [130, 170, 46], [905, 130, 34], [80, 560, 30], [950, 600, 52], [190, 870, 38], [860, 900, 28],
  ];
  for (const [x, y, r] of dots) glow({ cx: x, cy: y, rx: r, ry: r, soft: 10, col: '#ffffff', alpha: 0.35 });
}

// ---- ground shadow and tail
glow({ cx: 512, cy: 958, rx: 340, ry: 42, soft: 30, col: '#5c8f84', alpha: 0.28 });
blob({ cx: 772, cy: 860, rx: 62, ry: 58, col: '#fffaf3', dark: '#e3cdbb', fur: { amp: 12, n: 30, seed: 3 } });

// ---- body, belly and feet
const FUR = '#f4c9a1';
const FUR_DARK = '#c98b63';
const CREAM = '#fff5ea';
const CREAM_DARK = '#e9cdb4';
const PINK = '#f7a8b8';
blob({ cx: 512, cy: 752, rx: 272, ry: 232, col: FUR, dark: FUR_DARK, fur: { amp: 11, n: 92, seed: 1 } });
blob({ cx: 512, cy: 790, rx: 180, ry: 165, col: CREAM, dark: CREAM_DARK, soft: 3 });
for (const side of [-1, 1]) {
  const fx = 512 + side * 168;
  blob({ cx: fx, cy: 905, rx: 98, ry: 74, rot: side * 0.18, col: CREAM, dark: CREAM_DARK, fur: { amp: 6, n: 44, seed: 5 } });
  blob({ cx: fx, cy: 918, rx: 40, ry: 32, col: PINK, dark: '#e98a9d', gloss: 0.15 });
  for (const [ox, oy] of [[-40, -38], [0, -52], [40, -38]]) {
    blob({ cx: fx + ox + side * 4, cy: 918 + oy, rx: 16, ry: 15, col: PINK, dark: '#e98a9d', gloss: 0.15 });
  }
}

// ---- the sleepy chick, held against the bunny's chest
{
  const cx = 512;
  const cy = 752;
  const YEL = '#ffdc5e';
  const YEL_DARK = '#e9a53a';
  for (const [ox, oy, rot] of [[-14, -112, -0.5], [4, -120, 0.1], [20, -110, 0.6]]) {
    blob({ cx: cx + ox, cy: cy + oy, rx: 10, ry: 24, rot, col: YEL, dark: YEL_DARK });
  }
  blob({ cx, cy, rx: 126, ry: 116, col: YEL, dark: YEL_DARK, fur: { amp: 6, n: 70, seed: 7 }, gloss: 0.08 });
  glow({ cx: cx - 62, cy: cy + 22, rx: 22, ry: 13, soft: 9, col: '#ff9a8a', alpha: 0.6 });
  glow({ cx: cx + 62, cy: cy + 22, rx: 22, ry: 13, soft: 9, col: '#ff9a8a', alpha: 0.6 });
  arc(cx - 40, cy - 4, 17, 0.15 * Math.PI, 0.85 * Math.PI, 5.5, '#5b3a26');
  arc(cx + 40, cy - 4, 17, 0.15 * Math.PI, 0.85 * Math.PI, 5.5, '#5b3a26');
  blob({ cx, cy: cy + 18, rx: 19, ry: 12, col: '#ffa63d', dark: '#e0782a', gloss: 0.25 });
}

// ---- arms hugging the chick, with little paws
for (const side of [-1, 1]) {
  blob({ cx: 512 + side * 122, cy: 818, rx: 56, ry: 90, rot: side * 0.85, col: FUR, dark: FUR_DARK, fur: { amp: 6, n: 40, seed: 9 } });
  blob({ cx: 512 + side * 70, cy: 850, rx: 34, ry: 28, col: CREAM, dark: CREAM_DARK });
  for (const o of [-9, 9]) arc(512 + side * 70 + o, 833, 8, 0.2 * Math.PI, 0.8 * Math.PI, 3, '#d7b39a');
}

// ---- the head, tilted a little
const TILT = -0.08;
const PIV = [512, 600];
const tp = (x, y) => {
  const c = Math.cos(TILT);
  const s = Math.sin(TILT);
  const dx = x - PIV[0];
  const dy = y - PIV[1];
  return [PIV[0] + dx * c - dy * s, PIV[1] + dx * s + dy * c];
};
const hb = (s) => {
  const [cx, cy] = tp(s.cx, s.cy);
  blob({ ...s, cx, cy, rot: (s.rot ?? 0) + TILT });
};
const hg = (s) => {
  const [cx, cy] = tp(s.cx, s.cy);
  glow({ ...s, cx, cy, rot: (s.rot ?? 0) + TILT });
};
const ha = (cx, cy, r, a0, a1, w, col) => {
  const [x, y] = tp(cx, cy);
  arc(x, y, r, a0 + TILT, a1 + TILT, w, col);
};

glow({ cx: 512, cy: 612, rx: 230, ry: 50, soft: 30, col: '#8a5a3c', alpha: 0.22 });

// ears: the left one stands up, the right one flops
hb({ cx: 392, cy: 175, rx: 64, ry: 158, rot: -0.2, col: FUR, dark: FUR_DARK, fur: { amp: 6, n: 58, seed: 11 } });
hb({ cx: 396, cy: 185, rx: 34, ry: 118, rot: -0.2, col: PINK, dark: '#e88b9e', soft: 2 });
hb({ cx: 700, cy: 250, rx: 62, ry: 150, rot: 1.05, col: FUR, dark: FUR_DARK, fur: { amp: 6, n: 58, seed: 13 } });
hb({ cx: 704, cy: 258, rx: 32, ry: 112, rot: 1.05, col: PINK, dark: '#e88b9e', soft: 2 });

hb({ cx: 512, cy: 400, rx: 268, ry: 218, col: FUR, dark: FUR_DARK, fur: { amp: 12, n: 110, seed: 2 } });
hb({ cx: 512, cy: 505, rx: 112, ry: 72, col: CREAM, dark: CREAM_DARK, soft: 4 });

// eyes: big, dark and glossy
for (const side of [-1, 1]) {
  const ex = 512 + side * 108;
  const ey = 428;
  hb({ cx: ex, cy: ey, rx: 62, ry: 68, col: '#2a1710' });
  {
    const [cx, cy] = tp(ex, ey + 4);
    const top = hex('#140a07');
    const bot = hex('#8a5128');
    paint(cx - 66, cy - 70, cx + 66, cy + 70, (x, y) => {
      const d = sdEllipse(x - cx, y - cy, 56, 62);
      const t = smooth(-20, 52, y - cy);
      for (let k = 0; k < 3; k++) C[k] = mix(top[k], bot[k], t);
      return 1 - smooth(-0.8, 0.8, d);
    });
  }
  hb({ cx: ex, cy: ey + 2, rx: 36, ry: 40, col: '#0b0504' });
  hg({ cx: ex - 20, cy: ey - 27, rx: 20, ry: 22, soft: 1, col: '#ffffff', alpha: 1 });
  hg({ cx: ex + 22, cy: ey + 25, rx: 9, ry: 9, soft: 1, col: '#ffffff', alpha: 0.95 });
  {
    const [sx, sy] = tp(ex + 28, ey - 6);
    sparkle(sx, sy, 13, '#ffffff', 0.95);
  }
  const a0 = side < 0 ? 1.05 * Math.PI : 1.55 * Math.PI;
  ha(ex, ey, 69, a0, a0 + 0.4 * Math.PI, 5, '#2a1710');
}

// blush, nose and a little "w" mouth
for (const side of [-1, 1]) {
  hg({ cx: 512 + side * 165, cy: 515, rx: 56, ry: 32, soft: 22, col: '#ff8fa3', alpha: 0.6 });
}
hb({ cx: 512, cy: 488, rx: 22, ry: 15, col: '#f58fa2', dark: '#d9667d', gloss: 0.4 });
// a happy open smile: a D-shaped mouth with a pink tongue, hung from the nose
{
  const [mx, my] = tp(512, 506);
  const c = Math.cos(TILT);
  const sn = Math.sin(TILT);
  const lip = hex('#7a3340');
  const inner = hex('#b8475a');
  const tongue = hex('#ff8fa0');
  paint(mx - 34, my - 10, mx + 34, my + 36, (x, y) => {
    const dx = x - mx;
    const dy = y - my;
    const u = dx * c + dy * sn;
    const v = -dx * sn + dy * c;
    // lower half of an ellipse, its top edge gently smiling upward at the corners
    const top = -0.004 * u * u;
    const d = Math.max(sdEllipse(u, v, 27, 25), top - v);
    const dt = sdEllipse(u, v - 17, 15, 9);
    const t = 1 - smooth(-0.8, 0.8, dt);
    const edge = smooth(-3.5, -1.5, d);
    for (let k = 0; k < 3; k++) C[k] = mix(mix(inner[k], tongue[k], t), lip[k], edge);
    return 1 - smooth(-0.8, 0.8, d);
  });
}

// a pink bow at the base of the standing ear
{
  const BOW = '#ff7fa6';
  const BOW_DARK = '#d94f7c';
  hb({ cx: 432, cy: 262, rx: 46, ry: 28, rot: 0.45, col: BOW, dark: BOW_DARK, gloss: 0.3 });
  hb({ cx: 352, cy: 222, rx: 46, ry: 28, rot: 0.45, col: BOW, dark: BOW_DARK, gloss: 0.3 });
  hb({ cx: 392, cy: 242, rx: 20, ry: 18, col: '#ff97b6', dark: BOW_DARK, gloss: 0.3 });
}

// ---- two floating hearts
heart(842, 330, 54, '#ff7fa6', 0.9);
heart(905, 238, 32, '#ff9dbb', 0.8);
sparkle(150, 300, 22, '#ffffff', 0.9);
sparkle(880, 470, 16, '#ffffff', 0.85);
sparkle(210, 420, 11, '#ffffff', 0.8);

// ---- PNG encoding (RGB, 8 bits, best of three filters per row)
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png() {
  const stride = W * 3;
  const px = Buffer.alloc(stride * H);
  for (let i = 0; i < px.length; i++) px[i] = Math.round(clamp(img[i]) * 255);
  const raw = Buffer.alloc((stride + 1) * H);
  const cand = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  for (let y = 0; y < H; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride);
    const up = y ? px.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 3; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? row[i - 3] : 0;
        const b = up[i];
        const c = i >= 3 ? up[i - 3] : 0;
        let pred;
        if (f === 0) pred = a;
        else if (f === 1) pred = b;
        else {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        }
        const v = (row[i] - pred) & 255;
        cand[f][i] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    raw[y * (stride + 1)] = [1, 2, 4][best];
    cand[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(join(process.env.MAKEFUN_OUTPUT_DIR ?? '/output', 'entry.png'), png());
