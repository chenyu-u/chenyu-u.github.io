/* ═══════════════════════════════════════════════════════════════════
   world-terrain.js · the landscape as plain numbers (no three.js)
   ─────────────────────────────────────────────────────────────────
   Everything here is arithmetic: the noise, the map of places and
   roads, the height of the land, its colours, and where each tree
   stands. world-worker.js runs generate() on a second thread while
   the cover page animates, so building the world never stalls the
   page; world.js turns the arrays it returns into meshes.

   The layout, west → east along x:
     x ≈ −1400 … −150   the Rockies (Banff), with a ski hill
     x ≈  −150 …  470   foothills and prairie, Calgary
     x ≈   470 …  660   Canadian Shield forest and lakes
     x ≈   660 …  990   Toronto: campus, turbine, skyline, Lake Ontario
     x ≈   990 … 1390   the Atlantic
     x ≈  1390 … 1900   the Netherlands: polders, canals, tulips, Delft
     x ≈  1900 …        open sea at sunrise
   ═══════════════════════════════════════════════════════════════════ */

/* ── noise ────────────────────────────────────────────────────── */
export function rng(seed) { return () => (seed = (seed * 16807) % 2147483647, (seed - 1) / 2147483646); }
const perm = new Uint8Array(512);
{ const r = rng(2026), p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
const G2X = [1, -1, 1, -1, 1, -1, 0, 0], G2Y = [1, 1, -1, -1, 0, 0, 1, -1];
const F2 = .5 * (Math.sqrt(3) - 1), K2 = (3 - Math.sqrt(3)) / 6;
export function noise(x, y) {
  const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * K2;
  const x0 = x - (i - t), y0 = y - (j - t), i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
  const x1 = x0 - i1 + K2, y1 = y0 - j1 + K2, x2 = x0 - 1 + 2 * K2, y2 = y0 - 1 + 2 * K2, ii = i & 255, jj = j & 255;
  let n = 0, q, g;
  q = .5 - x0 * x0 - y0 * y0; if (q > 0) { g = perm[ii + perm[jj]] & 7; q *= q; n += q * q * (G2X[g] * x0 + G2Y[g] * y0); }
  q = .5 - x1 * x1 - y1 * y1; if (q > 0) { g = perm[ii + i1 + perm[jj + j1]] & 7; q *= q; n += q * q * (G2X[g] * x1 + G2Y[g] * y1); }
  q = .5 - x2 * x2 - y2 * y2; if (q > 0) { g = perm[ii + 1 + perm[jj + 1]] & 7; q *= q; n += q * q * (G2X[g] * x2 + G2Y[g] * y2); }
  return 70 * n;
}
export const fbm = (x, y, o = 4) => { let a = .5, f = 1, s = 0; for (let k = 0; k < o; k++) { s += a * noise(x * f, y * f); f *= 2.03; a *= .5; } return s; };
export const ridged = (x, y, o = 5) => { let a = .5, f = 1, s = 0, w = 1; for (let k = 0; k < o; k++) { let n = 1 - Math.abs(noise(x * f, y * f)); n *= n * w; w = Math.min(1, n * 1.7); s += a * n; f *= 2.05; a *= .5; } return s; };
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const mix = (a, b, t) => a + (b - a) * t;
export const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

/* ── places ───────────────────────────────────────────────────── */
export const PLACES = {            // [x, z]
  peak: [-430, -60], skiBase: [-285, -10],
  calgary: [170, -50], calTower: [186, -36], suburb: [250, 38], lawn: [236, 60], rink: [272, 18],
  downtown: [792, 18], cnTower: [760, 38], campus: [820, -58], vawt: [822, -52],
  hab: [856, -36],                 // Galbraith Building, home of the research group
  windmill: [1470, -24], library: [1560, 22], vawt2: [1592, 48],
};
const P = PLACES;
export const C0 = { x: 820, z: -58 };   // King's College Circle
const ellipse = (cx, cz, rx, rz, n) => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(i / n * Math.PI * 2) * rx, cz + Math.sin(i / n * Math.PI * 2) * rz]);
// roads: polyline of [x, z], width, kind
export const ROADS = [
  { pts: [[150, -60], [100, -64], [40, -50], [-30, -30], [-110, -14], [-190, 2], [-242, 4], [-276, -6]], w: 6, kind: 'highway' },   // Trans-Canada to the mountains
  { pts: [[60, -95], [290, -95]], w: 4.5 }, { pts: [[60, 12], [300, 12]], w: 4.5 }, { pts: [[110, -140], [110, 140]], w: 4.5 }, { pts: [[232, -140], [232, 140]], w: 4.5 },
  { pts: [[170, -82], [170, 135]], w: 4.5 }, { pts: [[60, 92], [300, 92]], w: 4 },
  { pts: ellipse(C0.x, C0.z, 33, 23, 56), w: 3.2 },                         // King's College Circle
  { pts: [[C0.x + 14, C0.z + 22], [C0.x + 14, C0.z + 50]], w: 3.2 },          // King's College Road
  { pts: [[740, C0.z + 50], [910, C0.z + 50]], w: 4.5 },                       // College Street
  { pts: [[C0.x + 48, C0.z + 50], [C0.x + 48, C0.z - 96]], w: 4 },             // St. George Street
  { pts: [[740, C0.z - 96], [910, C0.z - 96]], w: 4.5 },                       // Bloor Street
];
ROADS.forEach(r => { const xs = r.pts.map(p => p[0]), zs = r.pts.map(p => p[1]); r.box = [Math.min(...xs) - 12, Math.max(...xs) + 12, Math.min(...zs) - 12, Math.max(...zs) + 12]; });
export function distToPolyline(x, z, pl) {
  let best = 1e9;
  for (let i = 0; i < pl.length - 1; i++) {
    const ax = pl[i][0], az = pl[i][1], dx = pl[i + 1][0] - ax, dz = pl[i + 1][1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
export function nearRoad(x, z, pad = 2) {
  for (const r of ROADS) {
    if (x < r.box[0] || x > r.box[1] || z < r.box[2] || z > r.box[3]) continue;
    if (distToPolyline(x, z, r.pts) < r.w / 2 + pad) return true;
  }
  return false;
}
export const riverZ = x => -14 + Math.sin(x / 38) * 13;                              // the Bow through Calgary
export const shoreZ = x => 58 + Math.sin(x / 45) * 5 + Math.max(0, x - 905) * 1.1;   // Toronto waterfront
export const SKI_RUNS = [
  [[-405, -48], [-370, -30], [-340, -40], [-310, -22], [-288, -12]],
  [[-400, -82], [-365, -92], [-335, -76], [-300, -60], [-282, -40]],
  [[-398, -20], [-372, 4], [-342, -4], [-312, 10], [-292, 4]],
];
export const onSkiRun = (x, z) => x > -420 && x < -270 && SKI_RUNS.some(r => distToPolyline(x, z, r) < 9);
// [x, z, radius] spots kept free of trees for buildings and landmarks
export const KEEP_CLEAR = [
  [C0.x + 76, C0.z - 72, 30], [C0.x + 76, C0.z - 92, 22], [C0.x + 118, C0.z - 70, 20], [C0.x + 40, C0.z - 74, 16], [C0.x - 40, C0.z - 52, 20], [C0.x + 32, C0.z - 34, 18],
  [C0.x + 40, C0.z + 40, 30], [C0.x + 56, C0.z + 22, 12], [P.skiBase[0], P.skiBase[1], 16], [215, -60, 18], [1528, -50, 24], [P.calgary[0], P.calgary[1], 40],
  [P.suburb[0], P.suburb[1], 46], [P.downtown[0], P.downtown[1], 72], [P.campus[0], P.campus[1], 46], [P.windmill[0], P.windmill[1], 14], [P.library[0], P.library[1], 30], [P.vawt2[0], P.vawt2[1], 14],
];
export const clear = (x, z) => KEEP_CLEAR.every(([cx, cz, r]) => (x - cx) ** 2 + (z - cz) ** 2 > r * r);

/* ── the height of the land ───────────────────────────────────── */
const RB = [-200, 70, 470, 660, 985, 1395, 1905], RW = 80, W8 = new Float64Array(8);
// how much each region counts at x: rockies, foothills, prairie, shield, toronto, atlantic, netherlands, sea
export function regionWeights(x, w = W8) {
  for (let i = 0; i <= 7; i++) {
    const a = i === 0 ? 1 : smooth(RB[i - 1] - RW, RB[i - 1] + RW, x);
    const b = i === 7 ? 1 : 1 - smooth(RB[i] - RW, RB[i] + RW, x);
    w[i] = a * b;
  }
  return w;
}
export function landH(x, z) {
  const w = regionWeights(x);
  let h = 0;
  if (w[0] > 0) {                                        // Rockies
    let m = 26 + ridged(x / 230 + 7, z / 230 - 3, 4) * 150 + fbm(x / 70, z / 70, 3) * 10;
    m += 200 * Math.exp(-((x - P.peak[0]) ** 2 + (z - P.peak[1]) ** 2) / (2 * 120 * 120));
    m -= 40 * Math.exp(-((x + 300) ** 2) / (2 * 60 * 60)) * Math.exp(-(z ** 2) / (2 * 140 * 140));   // the valley in front of the ski hill
    m = mix(m, -4, 1 - smooth(28, 58, Math.hypot(x + 250, z - 92)));                                // glacial lake
    h += w[0] * m;
  }
  if (w[1] > 0) h += w[1] * (16 + fbm(x / 110, z / 110, 3) * 16);
  if (w[2] > 0) {                                        // prairie, Bow River through Calgary
    let p = 6 + fbm(x / 240, z / 240, 2) * 3;
    if (x > 90 && x < 340) p = mix(-3, p, smooth(3, 9, Math.abs(z - riverZ(x))));
    h += w[2] * p;
  }
  if (w[3] > 0) {                                        // shield: rock knobs and small lakes
    let s = 7 + ridged(x / 55, z / 55, 3) * 15;
    if (fbm(x / 70 + 11, z / 70, 2) < -.28) s = -3;
    h += w[3] * s;
  }
  if (w[4] > 0) h += w[4] * mix(3 + fbm(x / 90, z / 90, 2) * 1.2, -9, smooth(-3, 3, z - shoreZ(x)));
  if (w[5] > 0) h += w[5] * -24;
  if (w[6] > 0) {                                        // polder with a canal grid
    let n = 1.6 + fbm(x / 200, z / 200, 2) * .4;
    const cx = ((x - 1400) % 44 + 44) % 44, cz = ((z + 400) % 58 + 58) % 58;
    if ((cx < 2.4 || cz < 2.4) && x > 1420) n = -1.6;
    h += w[6] * n;
  }
  if (w[7] > 0) h += w[7] * -24;
  return h;
}

/* ── colours (linear RGB, the space three.js shades in) ───────── */
const lin = c => c < .04045 ? c * .0773993808 : Math.pow(c * .9478672986 + .0521327014, 2.4);
export const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [lin((n >> 16 & 255) / 255), lin((n >> 8 & 255) / 255), lin((n & 255) / 255)]; };
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const PAL = {
  snow: rgb('#EDF1F4'), snowB: rgb('#C5CFD8'), rock: rgb('#77716A'), rockD: rgb('#534F4B'), forest: rgb('#334530'),
  meadow: rgb('#76824F'), fields: ['#B5A06A', '#A69458', '#939D63', '#C1AD7B', '#899659', '#AE9E6B'].map(rgb),
  urban: rgb('#96948F'), lawn: rgb('#6A8A4B'), shield: rgb('#46603C'), shieldRock: rgb('#857C73'), park: rgb('#67854D'),
  polder: rgb('#6A984A'), sand: rgb('#D3C7A2'), bed: rgb('#4A5F55'),
};
const FOOTHILL = lerp3(PAL.meadow, PAL.fields[2], .3);
const APT = lerp3(PAL.urban, PAL.lawn, .35), SUBURB = lerp3(PAL.lawn, PAL.urban, .12);
const hue = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * 6 * (2 / 3 - t) : p; };
// lighten or darken a colour, keeping its hue and saturation
function shade(c, dl) {
  const r = c[0], g = c[1], b = c[2], max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (min + max) / 2;
  if (min !== max) {
    const d = max - min; s = l <= .5 ? d / (max + min) : d / (2 - max - min);
    h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
  }
  l = Math.min(1, Math.max(0, l + dl));
  if (s === 0) { c[0] = c[1] = c[2] = l; return c; }
  const p = l <= .5 ? l * (1 + s) : l + s - l * s, q = 2 * l - p;
  c[0] = hue(q, p, h + 1 / 3); c[1] = hue(q, p, h); c[2] = hue(q, p, h - 1 / 3); return c;
}
// the base colour of the ground at a point (the shader in world.js adds rock, snow and grain per pixel)
function groundColor(x, y, z, ny, out) {
  if (y < .3) { out[0] = PAL.bed[0]; out[1] = PAL.bed[1]; out[2] = PAL.bed[2]; return out; }
  const w = regionWeights(x);
  let r = 0, g = 0, b = 0, tot = 0;
  const add = (c, k) => { r += c[0] * k; g += c[1] * k; b += c[2] * k; tot += k; };
  if (w[0] > .01) {                                      // Rockies
    const snowLine = 150 + fbm(x / 70, z / 70, 2) * 30;
    let c;
    if (onSkiRun(x, z) && y > 30) c = PAL.snow;
    else if (y > snowLine || (y > 95 && ny > .86)) c = lerp3(PAL.snow, PAL.snowB, smooth(.95, .7, ny) * .7);
    else if (ny < .72) c = ny < .55 ? PAL.rockD : PAL.rock;
    else c = lerp3(PAL.forest, PAL.meadow, smooth(20, 60, y) * .3);
    add(c, w[0]);
  }
  if (w[1] > .01) add(FOOTHILL, w[1]);
  if (w[2] > .01) {                                      // prairie fields, Calgary
    let c = PAL.fields[Math.floor(hash(Math.floor(x / 24), Math.floor(z / 24)) * PAL.fields.length)];
    const dc = Math.hypot(x - P.calgary[0], z - P.calgary[1]);
    if (dc < 34) c = PAL.urban; else if (dc < 58) c = APT; else if (dc < 140) c = SUBURB;
    add(c, w[2]);
  }
  if (w[3] > .01) add(ny < .8 ? PAL.shieldRock : PAL.shield, w[3]);
  if (w[4] > .01) {                                      // Toronto
    let c = PAL.park;
    if (Math.hypot(x - P.downtown[0], z - P.downtown[1]) < 66 || (z > shoreZ(x) - 40 && x > 700 && x < 900)) c = PAL.urban;
    if (Math.hypot((x - P.campus[0]) / 1.4, z - P.campus[1]) < 22) c = PAL.lawn;
    add(c, w[4]);
  }
  if (w[6] > .01) {                                      // the Netherlands
    add(x < 1432 ? PAL.sand : PAL.polder, w[6]);                // the tulip rows are drawn by the shader in world.js
  }
  if (!tot) { out[0] = PAL.bed[0]; out[1] = PAL.bed[1]; out[2] = PAL.bed[2]; return out; }
  out[0] = r / tot; out[1] = g / tot; out[2] = b / tot;
  return shade(out, fbm(x / 40, z / 40, 3) * .05 + (hash(Math.round(x), Math.round(z)) - .5) * .015);   // natural mottling
}

/* ── generate ─────────────────────────────────────────────────── */
export const BOUNDS = { X0: -1400, X1: 2100, Z0: -420, Z1: 420 };
export const TREE_GREENS = ['#22352A', '#28402F', '#1E3127', '#2E4632'], TREE_LEAFY = ['#4D6834', '#58723A', '#64763D', '#465F30', '#7C7440'];

// bilinear height lookup on a generated grid
export function sampler(HG, NX, NZ, CELL) {
  const { X0, Z0 } = BOUNDS, S = NX + 1;
  return (x, z) => {
    const gx = (x - X0) / CELL, gz = (z - Z0) / CELL;
    const i = Math.max(0, Math.min(NX - 1, Math.floor(gx))), j = Math.max(0, Math.min(NZ - 1, Math.floor(gz))), fx = gx - i, fz = gz - j;
    const a = HG[j * S + i], b = HG[j * S + i + 1], c = HG[(j + 1) * S + i], d = HG[(j + 1) * S + i + 1];
    return mix(mix(a, b, fx), mix(c, d, fx), fz);
  };
}

/* A tiling texture of rock detail. RG: the surface normal of a creased, ridged height field;
   B: its height; A: a second, smoother noise. The terrain shader projects it onto the ground from
   three sides, so cliffs get crags and ledges that the mesh is too coarse to hold. */
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
function pnoise(x, y, period, seed) {                    // gradient noise that repeats every `period` cells
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = fade(xf), v = fade(yf);
  const g = (ix, iy, dx, dy) => { const h = perm[(perm[(((ix % period) + period) % period + seed) & 255] + ((iy % period) + period) % period) & 255] & 7; return G2X[h] * dx + G2Y[h] * dy; };
  const a = g(xi, yi, xf, yf), b = g(xi + 1, yi, xf - 1, yf), c = g(xi, yi + 1, xf, yf - 1), d = g(xi + 1, yi + 1, xf - 1, yf - 1);
  return mix(mix(a, b, u), mix(c, d, u), v);
}
export function detailTexture(size = 512) {
  const h = new Float32Array(size * size), sm = new Float32Array(size * size), out = new Uint8Array(size * size * 4);
  let lo = 1e9, hi = -1e9, slo = 1e9, shi = -1e9;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    let s = 0, a = .5, f = 4, wgt = 1;
    for (let o = 0; o < 6; o++) {                        // ridged: sharp creases, finer ones riding on the big ones
      let n = 1 - Math.abs(pnoise(u * f, v * f, f, o * 17) * 1.6); n *= n * wgt; wgt = Math.min(1, n * 1.5); s += a * n; f *= 2; a *= .5;
    }
    h[i] = s; if (s < lo) lo = s; if (s > hi) hi = s;
    const t = pnoise(u * 3, v * 3, 3, 91) * .5 + pnoise(u * 7, v * 7, 7, 53) * .3 + pnoise(u * 16, v * 16, 16, 7) * .2;
    sm[i] = t; if (t < slo) slo = t; if (t > shi) shi = t;
  }
  const k = 7 * size / 512 / (hi - lo);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, xm = y * size + (x - 1 + size) % size, xp = y * size + (x + 1) % size, ym = ((y - 1 + size) % size) * size + x, yp = ((y + 1) % size) * size + x;
    const dx = (h[xp] - h[xm]) * k, dy = (h[yp] - h[ym]) * k, l = Math.hypot(dx, dy, 1);
    out[i * 4] = Math.round((-dx / l * .5 + .5) * 255); out[i * 4 + 1] = Math.round((-dy / l * .5 + .5) * 255);
    out[i * 4 + 2] = Math.round((h[i] - lo) / (hi - lo) * 255); out[i * 4 + 3] = Math.round((sm[i] - slo) / (shi - slo) * 255);
  }
  return out;
}

// a tiling normal map of soft ripples for the water
export function waterTexture(size = 256) {
  const h = new Float32Array(size * size), out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size; let s = 0, a = .5, f = 8;
    for (let o = 0; o < 4; o++) { s += a * pnoise(u * f, v * f, f, o * 29 + 5); f *= 2; a *= .5; }
    h[y * size + x] = s;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, dx = (h[y * size + (x + 1) % size] - h[y * size + (x - 1 + size) % size]) * 1.6, dy = (h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x]) * 1.6, l = Math.hypot(dx, dy, 1);
    out[i * 4] = (-dx / l * .5 + .5) * 255; out[i * 4 + 1] = (-dy / l * .5 + .5) * 255; out[i * 4 + 2] = (1 / l * .5 + .5) * 255; out[i * 4 + 3] = 255;
  }
  return out;
}

/* Builds the landscape. `emit(message, transferables)` receives, in order:
     { type: 'heights', HG, NX, NZ, CELL }        the height grid (everything else stands on it)
     { type: 'detail', size, data, water, waterSize }   the rock detail texture and the water's ripple normal map
     { type: 'terrain', tiles: [{ position, normal, color, index, sphere }] }
     { type: 'trees', conifers, broadleaf }       six floats per tree: x, y, z, scale, turn, colour index
   and { type: 'progress', value } along the way. `pause` lets a caller on the main thread yield. */
export async function generate({ phone = false } = {}, emit, pause = async () => {}) {
  const { X0, X1, Z0, Z1 } = BOUNDS, CELL = phone ? 6 : 4;
  const NX = Math.round((X1 - X0) / CELL), NZ = Math.round((Z1 - Z0) / CELL), S = NX + 1;
  const progress = v => emit({ type: 'progress', value: v });

  // 1. heights
  const HG = new Float32Array(S * (NZ + 1));
  for (let j = 0; j <= NZ; j++) {
    const z = Z0 + j * CELL;
    for (let i = 0; i <= NX; i++) HG[j * S + i] = landH(X0 + i * CELL, z);
    if ((j & 7) === 0) { progress(.4 * j / NZ); await pause(); }
  }
  { const copy = HG.slice(); emit({ type: 'heights', HG: copy, NX, NZ, CELL }, [copy.buffer]); }
  const groundY = sampler(HG, NX, NZ, CELL);

  // 2. the rock detail texture
  { const size = phone ? 256 : 512, data = detailTexture(size), water = waterTexture(256); emit({ type: 'detail', size, data, water, waterSize: 256 }, [data.buffer, water.buffer]); }
  await pause();

  // 3. the ground mesh, cut into tiles so the camera only draws the part of the world it can see
  const nrm = new Float32Array(S * (NZ + 1) * 3), col = new Float32Array(S * (NZ + 1) * 3), c = [0, 0, 0];
  for (let j = 0; j <= NZ; j++) {
    const z = Z0 + j * CELL;
    for (let i = 0; i <= NX; i++) {
      const k = j * S + i, x = X0 + i * CELL;
      const hx = HG[j * S + Math.min(NX, i + 1)] - HG[j * S + Math.max(0, i - 1)], hz = HG[Math.min(NZ, j + 1) * S + i] - HG[Math.max(0, j - 1) * S + i];
      const sx = (Math.min(NX, i + 1) - Math.max(0, i - 1)) * CELL, sz = (Math.min(NZ, j + 1) - Math.max(0, j - 1)) * CELL;
      const nx = -hx / sx, nz = -hz / sz, l = Math.hypot(nx, 1, nz);
      nrm[k * 3] = nx / l; nrm[k * 3 + 1] = 1 / l; nrm[k * 3 + 2] = nz / l;
      groundColor(x, HG[k], z, 1 / l, c);
      col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
    }
    if ((j & 7) === 0) { progress(.4 + .4 * j / NZ); await pause(); }
  }
  const TX = Math.ceil(NX / (phone ? 42 : 63)), TZ = phone ? 2 : 3, perX = Math.ceil(NX / TX), perZ = Math.ceil(NZ / TZ), tiles = [], moved = [];
  for (let tz = 0; tz < TZ; tz++) for (let tx = 0; tx < TX; tx++) {
    const i0 = tx * perX, i1 = Math.min(NX, i0 + perX), j0 = tz * perZ, j1 = Math.min(NZ, j0 + perZ), cols = i1 - i0 + 1, rows = j1 - j0 + 1, nv = cols * rows;
    const position = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), color = new Float32Array(nv * 3), index = new (nv > 65535 ? Uint32Array : Uint16Array)((cols - 1) * (rows - 1) * 6);
    let yLo = 1e9, yHi = -1e9;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const src = j * S + i, dst = (j - j0) * cols + (i - i0), y = HG[src];
      position[dst * 3] = X0 + i * CELL; position[dst * 3 + 1] = y; position[dst * 3 + 2] = Z0 + j * CELL;
      normal[dst * 3] = nrm[src * 3]; normal[dst * 3 + 1] = nrm[src * 3 + 1]; normal[dst * 3 + 2] = nrm[src * 3 + 2];
      color[dst * 3] = col[src * 3]; color[dst * 3 + 1] = col[src * 3 + 1]; color[dst * 3 + 2] = col[src * 3 + 2];
      if (y < yLo) yLo = y; if (y > yHi) yHi = y;
    }
    let q = 0;
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) { const a = j * cols + i, b = a + 1, cc = a + cols, d = cc + 1; index[q++] = a; index[q++] = cc; index[q++] = b; index[q++] = b; index[q++] = cc; index[q++] = d; }
    if (yHi < -.5) continue;                             // entirely under water: nothing to draw
    const cx = X0 + (i0 + i1) / 2 * CELL, cz = Z0 + (j0 + j1) / 2 * CELL, cy = (yLo + yHi) / 2;
    tiles.push({ position, normal, color, index, sphere: [cx, cy, cz, Math.hypot((i1 - i0) * CELL / 2, (j1 - j0) * CELL / 2, (yHi - yLo) / 2)] });
    moved.push(position.buffer, normal.buffer, color.buffer, index.buffer);
  }
  emit({ type: 'terrain', tiles }, moved);
  await pause();

  // 4. trees
  const r = rng(77), N = phone ? 3200 : 7000, conifers = [], broadleaf = [];
  const slopeAt = (x, z) => Math.hypot(groundY(x + 3, z) - groundY(x - 3, z), groundY(x, z + 3) - groundY(x, z - 3)) / 6;
  const G = () => Math.floor(r() * 4), L = () => 4 + Math.floor(r() * 5);   // colour index: 0–3 greens, 4–8 leafy
  for (let k = 0; k < N * 6 && (conifers.length + broadleaf.length) / 6 < N; k++) {
    if ((k & 1023) === 0) { progress(.8 + .2 * (conifers.length + broadleaf.length) / 6 / N); await pause(); }
    const x = X0 + 200 + r() * (1900 - X0 - 200), z = Z0 + 20 + r() * (Z1 - Z0 - 40), y = groundY(x, z);
    if (y < 1.2) continue;
    if (!clear(x, z) || onSkiRun(x, z) || nearRoad(x, z, 3)) continue;
    if (Math.hypot(x - P.calgary[0], z - P.calgary[1]) < 138 && Math.abs(z - riverZ(x)) > 14 && r() > .12) continue;   // suburbs: only a few street trees
    const w = regionWeights(x), w0 = w[0], w1 = w[1], w2 = w[2], w3 = w[3], w4 = w[4], w6 = w[6];
    const sl = slopeAt(x, z), patch = fbm(x / 90 + 3, z / 90 - 8, 3);
    if (w0 > .5) {                                       // mountain forest below the treeline
      if (y > 120 + patch * 25 || sl > .9 || patch < -.15) continue;
      conifers.push(x, y, z, .8 + r() * .7, r() * 6, G());
    } else if (w1 > .5) {
      if (patch < .15 || r() > .45) continue;
      conifers.push(x, y, z, .7 + r() * .5, r() * 6, G());
    } else if (w2 > .5) {                                // shelterbelts and river trees only
      const nearRiver = x > 90 && x < 340 && Math.abs(z - riverZ(x)) < 16;
      if (!nearRiver && !(Math.floor(z / 24) !== Math.floor((z + 3) / 24) && r() < .5)) continue;
      broadleaf.push(x, y, z, .6 + r() * .4, r() * 6, L());
    } else if (w3 > .5) {                                // shield: mixed forest
      if (patch < -.35) continue;
      const list = r() < .65 ? conifers : broadleaf, s = .7 + r() * .6, turn = r() * 6, green = r() < .65;
      list.push(x, y, z, s, turn, green ? G() : 4 + Math.floor(r() * 4));
    } else if (w4 > .5) {
      if (patch < .1 || r() > .5) continue;
      broadleaf.push(x, y, z, .55 + r() * .4, r() * 6, L());
    } else if (w6 > .5) {                                // tree rows along the canals
      const cx = ((x - 1400) % 44 + 44) % 44;
      if (cx < 3.2 || cx > 5.2 || x < 1440 || r() > .55 || (z > 64 && z < 180)) continue;   // not through the tulip fields
      broadleaf.push(x, y, z, .5 + r() * .3, r() * 6, L());
    }
  }
  const cf = new Float32Array(conifers), bl = new Float32Array(broadleaf);
  emit({ type: 'trees', conifers: cf, broadleaf: bl }, [cf.buffer, bl.buffer]);
  progress(1);
}
