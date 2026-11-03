/* ═══════════════════════════════════════════════════════════════════
   world.js · the 3D world behind index.html
   ─────────────────────────────────────────────────────────────────
   One continuous low-poly landscape laid out west → east (x axis):

     x ≈ −1400 … −150   the Rockies (Banff), with a ski hill
     x ≈  −150 …  470   foothills and prairie, Calgary
     x ≈   470 …  660   Canadian Shield forest and lakes
     x ≈   660 …  990   Toronto: campus, the UTWind turbine, the HAB
                        research building, skyline, Lake Ontario
     x ≈   990 … 1390   the Atlantic
     x ≈  1390 … 1900   the Netherlands: polders, canals, tulips,
                        windmill, TU Delft library, the turbine again
     x ≈  1900 …        open sea at sunrise

   A gold wind current threads through all of it. Each section in the
   page names a camera shot (data-shot); scrolling moves the camera
   smoothly along a spline through those shots.

   Performance budget: no shadow maps, Lambert materials, instancing
   for every repeated object, pixel ratio capped, and rendering pauses
   whenever the scene is fully covered by text (phones).
   ═══════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';

const STORY = window.__story;
// the world takes a few seconds to build; yield to the browser every ~10 ms so the cover page stays smooth
let sliceT = performance.now();
const yieldCh = new MessageChannel(), yieldQ = [];
yieldCh.port1.onmessage = () => { const r = yieldQ.shift(); if (r) r(); };
const breathe = () => new Promise(r => { yieldQ.push(r); yieldCh.port2.postMessage(0); });
async function slice(progress) {
  if (progress != null) STORY.buildProgress = progress;
  if (performance.now() - sliceT > 10) { await breathe(); await new Promise(r => setTimeout(r, 0)); sliceT = performance.now(); }
}
STORY.buildProgress = 0;
const canvas = document.getElementById('world');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = Math.min(innerWidth, innerHeight) < 640;

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: (devicePixelRatio || 1) < 1.5, powerPreference: 'high-performance', stencil: false }); }
catch (e) { document.body.classList.add('no3d'); throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .62;
renderer.shadowMap.enabled = !phone;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(innerWidth / innerHeight < .8 ? 52 : 38, innerWidth / innerHeight, 1, 5000);

/* ── noise ────────────────────────────────────────────────────── */
function rng(seed) { return () => (seed = (seed * 16807) % 2147483647, (seed - 1) / 2147483646); }
const perm = new Uint8Array(512);
{ const r = rng(2026), p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) perm[i] = p[i & 255]; }
const G2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const F2 = .5 * (Math.sqrt(3) - 1), K2 = (3 - Math.sqrt(3)) / 6;
function noise(x, y) {
  const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * K2;
  const x0 = x - (i - t), y0 = y - (j - t), i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
  const x1 = x0 - i1 + K2, y1 = y0 - j1 + K2, x2 = x0 - 1 + 2 * K2, y2 = y0 - 1 + 2 * K2, ii = i & 255, jj = j & 255;
  let n = 0, q, g;
  q = .5 - x0 * x0 - y0 * y0; if (q > 0) { g = G2[perm[ii + perm[jj]] & 7]; q *= q; n += q * q * (g[0] * x0 + g[1] * y0); }
  q = .5 - x1 * x1 - y1 * y1; if (q > 0) { g = G2[perm[ii + i1 + perm[jj + j1]] & 7]; q *= q; n += q * q * (g[0] * x1 + g[1] * y1); }
  q = .5 - x2 * x2 - y2 * y2; if (q > 0) { g = G2[perm[ii + 1 + perm[jj + 1]] & 7]; q *= q; n += q * q * (g[0] * x2 + g[1] * y2); }
  return 70 * n;
}
const fbm = (x, y, o = 4) => { let a = .5, f = 1, s = 0; for (let k = 0; k < o; k++) { s += a * noise(x * f, y * f); f *= 2.03; a *= .5; } return s; };
const ridged = (x, y, o = 5) => { let a = .5, f = 1, s = 0, w = 1; for (let k = 0; k < o; k++) { let n = 1 - Math.abs(noise(x * f, y * f)); n *= n * w; w = Math.min(1, n * 1.7); s += a * n; f *= 2.05; a *= .5; } return s; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

/* ── places ───────────────────────────────────────────────────── */
const P = {
  peak:     new THREE.Vector3(-430, 0, -60),
  skiBase:  new THREE.Vector3(-285, 0, -10),
  calgary:  new THREE.Vector3(170, 0, -50),
  calTower: new THREE.Vector3(186, 0, -36),
  suburb:   new THREE.Vector3(250, 0, 38),
  lawn:     new THREE.Vector3(236, 0, 60),
  rink:     new THREE.Vector3(272, 0, 18),
  downtown: new THREE.Vector3(792, 0, 18),
  cnTower:  new THREE.Vector3(760, 0, 38),
  campus:   new THREE.Vector3(820, 0, -58),
  vawt:     new THREE.Vector3(822, 0, -52),
  hab:      new THREE.Vector3(856, 0, -36),   // Galbraith Building, home of the research group
  windmill: new THREE.Vector3(1470, 0, -24),
  library:  new THREE.Vector3(1560, 0, 22),
  vawt2:    new THREE.Vector3(1592, 0, 48),
};
// roads: [polyline of [x, z], width, kind]
const C0 = { x: 820, z: -58 };   // King's College Circle
const ellipse = (cx, cz, rx, rz, n) => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(i / n * Math.PI * 2) * rx, cz + Math.sin(i / n * Math.PI * 2) * rz]);
const ROADS = [
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
function nearRoad(x, z, pad = 2) {
  for (const r of ROADS) {
    if (x < r.box[0] || x > r.box[1] || z < r.box[2] || z > r.box[3]) continue;
    if (distToPolyline(x, z, r.pts) < r.w / 2 + pad) return true;
  }
  return false;
}
const riverZ = x => -14 + Math.sin(x / 38) * 13;
const shoreZ = x => 58 + Math.sin(x / 45) * 5 + Math.max(0, x - 905) * 1.1;   // Toronto waterfront

/* ── 1. terrain height ────────────────────────────────────────── */
const SKI_RUNS = [
  [[-405, -48], [-370, -30], [-340, -40], [-310, -22], [-288, -12]],
  [[-400, -82], [-365, -92], [-335, -76], [-300, -60], [-282, -40]],
  [[-398, -20], [-372, 4], [-342, -4], [-312, 10], [-292, 4]],
];
function distToPolyline(x, z, pl) {
  let best = 1e9;
  for (let i = 0; i < pl.length - 1; i++) {
    const [ax, az] = pl[i], [bx, bz] = pl[i + 1], dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
const onSkiRun = (x, z) => x > -420 && x < -270 && SKI_RUNS.some(r => distToPolyline(x, z, r) < 9);

function regionWeights(x) {
  const B = [-200, 70, 470, 660, 985, 1395, 1905], W = 80, w = [];
  for (let i = 0; i <= B.length; i++) {
    const a = i === 0 ? 1 : smooth(B[i - 1] - W, B[i - 1] + W, x);
    const b = i === B.length ? 1 : 1 - smooth(B[i] - W, B[i] + W, x);
    w.push(a * b);
  }
  return w;   // rockies, foothills, prairie, shield, toronto, atlantic, netherlands, sea
}
function landH(x, z) {
  const w = regionWeights(x);
  let h = 0;
  if (w[0] > 0) {                                        // Rockies
    let m = 26 + ridged(x / 230 + 7, z / 230 - 3, 4) * 150 + fbm(x / 70, z / 70, 3) * 10;
    m += 200 * Math.exp(-((x - P.peak.x) ** 2 + (z - P.peak.z) ** 2) / (2 * 120 * 120));
    m -= 40 * Math.exp(-((x + 300) ** 2) / (2 * 60 * 60)) * Math.exp(-(z ** 2) / (2 * 140 * 140));   // the valley in front of the ski hill
    m = mix(m, -4, 1 - smooth(28, 58, Math.hypot(x + 250, z - 92)));                                // glacial lake
    h += w[0] * m;
  }
  if (w[1] > 0) h += w[1] * (16 + fbm(x / 110, z / 110, 3) * 16);
  if (w[2] > 0) {                                        // prairie, Bow River through Calgary
    let p = 6 + fbm(x / 240, z / 240, 2) * 3;
    if (x > 90 && x < 340) p = mix(-3, p, smooth(3, 9, Math.abs(z - (-14 + Math.sin(x / 38) * 13))));
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

/* ── 2. terrain mesh (flat-shaded, coloured per face) ─────────── */
const X0 = -1400, X1 = 2100, Z0 = -420, Z1 = 420, CELL = phone ? 6 : 6;
const NX = Math.round((X1 - X0) / CELL), NZ = Math.round((Z1 - Z0) / CELL);
const HG = new Float32Array((NX + 1) * (NZ + 1));
for (let j = 0; j <= NZ; j++) { for (let i = 0; i <= NX; i++) HG[j * (NX + 1) + i] = landH(X0 + i * CELL, Z0 + j * CELL); await slice(.3 * j / NZ); }
function groundY(x, z) {
  const gx = (x - X0) / CELL, gz = (z - Z0) / CELL;
  const i = Math.max(0, Math.min(NX - 1, Math.floor(gx))), j = Math.max(0, Math.min(NZ - 1, Math.floor(gz))), fx = gx - i, fz = gz - j;
  const a = HG[j * (NX + 1) + i], b = HG[j * (NX + 1) + i + 1], c = HG[(j + 1) * (NX + 1) + i], d = HG[(j + 1) * (NX + 1) + i + 1];
  return mix(mix(a, b, fx), mix(c, d, fx), fz);
}
const C = (h) => new THREE.Color(h);
const PAL = {
  snow: C('#EDF1F4'), snowB: C('#C5CFD8'), rock: C('#77716A'), rockD: C('#534F4B'), forest: C('#334530'),
  meadow: C('#76824F'), fields: ['#B5A06A', '#A69458', '#939D63', '#C1AD7B', '#899659', '#AE9E6B'].map(C),
  urban: C('#96948F'), lawn: C('#6A8A4B'), shield: C('#46603C'), shieldRock: C('#857C73'), park: C('#67854D'),
  polder: C('#6A984A'), sand: C('#D3C7A2'), tulips: ['#C2453D', '#D9B43A', '#D07C9C', '#E6E1D6', '#AE3C7E'].map(C), bed: C('#4A5F55'),
};
const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
function faceColor(x, y, z, ny, out) {
  const w = regionWeights(x);
  if (y < .3) return out.copy(PAL.bed);
  const cols = [];
  // rockies
  if (w[0] > .01) {
    const c = new THREE.Color(), snowLine = 150 + fbm(x / 70, z / 70, 2) * 30;
    if (onSkiRun(x, z) && y > 30) c.copy(PAL.snow);
    else if (y > snowLine || (y > 95 && ny > .86)) c.copy(PAL.snow).lerp(PAL.snowB, smooth(.95, .7, ny) * .7);
    else if (ny < .72) c.copy(ny < .55 ? PAL.rockD : PAL.rock);
    else c.copy(PAL.forest).lerp(PAL.meadow, smooth(20, 60, y) * .3);
    cols.push([c, w[0]]);
  }
  if (w[1] > .01) cols.push([PAL.meadow.clone().lerp(PAL.fields[2], .3), w[1]]);
  if (w[2] > .01) {
    let c = PAL.fields[Math.floor(hash(Math.floor(x / 24), Math.floor(z / 24)) * PAL.fields.length)].clone();
    const dc = Math.hypot(x - P.calgary.x, z - P.calgary.z);
    if (dc < 34) c = PAL.urban.clone();
    else if (dc < 58) c = PAL.urban.clone().lerp(PAL.lawn, .35);
    else if (dc < 140) c = PAL.lawn.clone().lerp(PAL.urban, .12);
    cols.push([c, w[2]]);
  }
  if (w[3] > .01) cols.push([ny < .8 ? PAL.shieldRock : PAL.shield, w[3]]);
  if (w[4] > .01) {
    let c = PAL.park.clone();
    if (Math.hypot(x - P.downtown.x, z - P.downtown.z) < 66 || (z > shoreZ(x) - 40 && x > 700 && x < 900)) c = PAL.urban.clone();
    if (Math.hypot((x - P.campus.x) / 1.4, z - P.campus.z) < 22) c = PAL.lawn.clone();
    cols.push([c, w[4]]);
  }
  if (w[6] > .01) {
    let c = PAL.polder.clone();
    if (x < 1432) c = PAL.sand.clone();
    else if (z > 55 && z < 170 && x > 1440 && x < 1720) {
      const field = Math.floor((x - 1400) / 44) + Math.floor((z + 400) / 58) * 7;
      const row = Math.floor(x / CELL) % 2 === 0;
      c = row ? PAL.tulips[field % PAL.tulips.length].clone() : PAL.polder.clone().multiplyScalar(.85);
    }
    cols.push([c, w[6]]);
  }
  if (!cols.length) return out.copy(PAL.bed);
  let tot = 0; out.setRGB(0, 0, 0);
  for (const [c, k] of cols) { out.r += c.r * k; out.g += c.g * k; out.b += c.b * k; tot += k; }
  out.multiplyScalar(1 / tot);
  return out.offsetHSL(0, 0, fbm(x / 40, z / 40, 3) * .05 + (hash(Math.round(x), Math.round(z)) - .5) * .015);   // natural mottling
}
// a tiling normal map of fine noise, so surfaces have grain up close instead of looking like plastic
function detailNormal(size, scale, strength) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), img = g.createImageData(size, size);
  const hgt = (x, y) => fbm(x / scale, y / scale, 4) + noise(x / (scale * .25), y / (scale * .25)) * .25;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (hgt((x + 1) % size, y) - hgt((x - 1 + size) % size, y)) * strength, dy = (hgt(x, (y + 1) % size) - hgt(x, (y - 1 + size) % size)) * strength;
    const l = Math.hypot(dx, dy, 1), k = (y * size + x) * 4;
    img.data[k] = (-dx / l * .5 + .5) * 255; img.data[k + 1] = (-dy / l * .5 + .5) * 255; img.data[k + 2] = (1 / l * .5 + .5) * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
let terrain;
{
  const nv = (NX + 1) * (NZ + 1), pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), c = new THREE.Color();
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    const k = j * (NX + 1) + i, x = X0 + i * CELL, z = Z0 + j * CELL, y = HG[k];
    const hx = HG[j * (NX + 1) + Math.min(NX, i + 1)] - HG[j * (NX + 1) + Math.max(0, i - 1)];
    const hz = HG[Math.min(NZ, j + 1) * (NX + 1) + i] - HG[Math.max(0, j - 1) * (NX + 1) + i];
    const ny = 2 * CELL / Math.hypot(hx, hz, 2 * CELL);
    faceColor(x, y, z, ny, c);
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z; col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    uv[k * 2] = x / 7; uv[k * 2 + 1] = z / 7;
    if (i === NX) await slice(.3 + .3 * j / NZ);
  }
  const idx = new Uint32Array(NX * NZ * 6); let q = 0;
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const a = j * (NX + 1) + i, b = a + 1, cc = a + NX + 1, d = cc + 1;
    idx[q++] = a; idx[q++] = cc; idx[q++] = b; idx[q++] = b; idx[q++] = cc; idx[q++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
  terrain = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .93, metalness: 0, normalMap: detailNormal(256, 22, 1.6), normalScale: new THREE.Vector2(.9, .9), envMapIntensity: .6 }));
  // per-pixel detail, so steep faces don't look like a stretched low-res image:
  // crisp snow lines, horizontal limestone bands in the Rockies, and fine grain everywhere
  terrain.material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW; varying vec3 vTN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vTW = (modelMatrix * vec4(transformed, 1.)).xyz; vTN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vTW; varying vec3 vTN;
      float th(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float tn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(th(i), th(i+vec2(1,0)), f.x), mix(th(i+vec2(0,1)), th(i+vec2(1,1)), f.x), f.y); }
      float tf(vec2 p){ return tn(p)*.5 + tn(p*2.1)*.25 + tn(p*4.3)*.125 + tn(p*8.7)*.0625; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float ny = vTN.y, rockies = 1. - smoothstep(-260., -140., vTW.x);
        float vsnow = smoothstep(.78, .88, min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b));   // groomed runs
        float grain = tf(vTW.xz * .55);
        diffuseColor.rgb *= .9 + .2 * grain;
        if (rockies > 0.) {
          float steep = 1. - smoothstep(.5, .7, ny);
          float bands = tn(vec2((vTW.x + vTW.z) * .02, vTW.y * .22)) * .7 + tn(vec2(vTW.x * .06, vTW.y * .9)) * .3;
          vec3 rock = mix(vec3(.22, .22, .22), vec3(.40, .39, .37), bands) * (.88 + .24 * tf(vTW.xz * .15 + vTW.y * .05));
          float snowLine = 95. + tf(vTW.xz * .012) * 50.;
          float snow = smoothstep(snowLine - 5., snowLine + 5., vTW.y + tf(vTW.xz * .08) * 20.) * smoothstep(.4, .55, ny);
          snow = max(snow, smoothstep(.8, .9, ny) * smoothstep(70., 90., vTW.y));
          snow = max(snow, vsnow);
          vec3 c = mix(diffuseColor.rgb, rock, steep * rockies * (1. - vsnow));
          c = mix(c, vec3(.93, .95, .97) * (.94 + .06 * grain), snow * rockies);
          diffuseColor.rgb = c;
        }
      }`);
  };
  terrain.receiveShadow = true;
  // split into 14 strips so the camera only draws the part of the world it can see
  const STRIPS = 14, per = Math.ceil(NX / STRIPS), P3 = g.attributes.position.array, N3 = g.attributes.normal.array;
  for (let sIdx = 0; sIdx < STRIPS; sIdx++) {
    const i0 = sIdx * per, i1 = Math.min(NX, i0 + per), cols = i1 - i0 + 1, nvS = cols * (NZ + 1);
    const pp = new Float32Array(nvS * 3), nn = new Float32Array(nvS * 3), cc = new Float32Array(nvS * 3), uu = new Float32Array(nvS * 2), ii = new Uint32Array((cols - 1) * NZ * 6);
    for (let j = 0; j <= NZ; j++) for (let i = i0; i <= i1; i++) {
      const src = j * (NX + 1) + i, dst = j * cols + (i - i0);
      for (let c3 = 0; c3 < 3; c3++) { pp[dst * 3 + c3] = P3[src * 3 + c3]; nn[dst * 3 + c3] = N3[src * 3 + c3]; cc[dst * 3 + c3] = col[src * 3 + c3]; }
      uu[dst * 2] = uv[src * 2]; uu[dst * 2 + 1] = uv[src * 2 + 1];
    }
    let qq = 0;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < cols - 1; i++) { const a = j * cols + i, b = a + 1, c2 = a + cols, d = c2 + 1; ii[qq++] = a; ii[qq++] = c2; ii[qq++] = b; ii[qq++] = b; ii[qq++] = c2; ii[qq++] = d; }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pp, 3)); sg.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(cc, 3)); sg.setAttribute('uv', new THREE.BufferAttribute(uu, 2)); sg.setIndex(new THREE.BufferAttribute(ii, 1));
    sg.computeBoundingSphere();
    const strip = new THREE.Mesh(sg, terrain.material); strip.receiveShadow = true; scene.add(strip);
  }
}

/* ── 3. water ─────────────────────────────────────────────────── */
const waterNormal = detailNormal(256, 30, 1.4); waterNormal.repeat.set(200, 80);
const waterMat = new THREE.MeshStandardMaterial({ color: '#1C3A4E', roughness: .1, metalness: 0, normalMap: waterNormal, normalScale: new THREE.Vector2(.12, .12), envMapIntensity: 1.25 });
const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 2400), waterMat);
water.rotation.x = -Math.PI / 2; water.position.set(350, 0, 0); scene.add(water);

/* ── 4. trees, instanced ──────────────────────────────────────── */
function colorize(g, col) { const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }
const flat = g => { const n = g.toNonIndexed(); n.computeVertexNormals(); return n; };
const soft = g => g.toNonIndexed();   // keep smooth normals
function coniferGeo() {                 // a spruce: four drooping tiers of boughs
  const parts = [colorize(soft(new THREE.CylinderGeometry(.22, .34, 2.6, 7).translate(0, 1.3, 0)), C('#4A3A2D'))];
  const r = rng(3);
  [[3.0, 5.2, 3.8], [2.2, 4.6, 7.0], [1.3, 3.8, 9.9]].forEach(([rad, h, y]) => {
    const g = new THREE.ConeGeometry(rad, h, 9, 1, true), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < -h / 2 + .01) { const k = .8 + r() * .4; p.setXYZ(i, p.getX(i) * k, p.getY(i) - r() * .5, p.getZ(i) * k); }
    g.computeVertexNormals(); g.translate(0, y, 0); parts.push(colorize(soft(g), C('#ffffff')));
  });
  return mergeGeometries(parts);
}
function broadleafGeo() {
  const t = colorize(soft(new THREE.CylinderGeometry(.22, .32, 3.2, 7).translate(0, 1.6, 0)), C('#5A4636'));
  const crown = new THREE.IcosahedronGeometry(3, 1), p = crown.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + noise(x * .6 + 3, y * .6 + z * .4) * .22; p.setXYZ(i, x * k, y * k * .85, z * k); }
  crown.computeVertexNormals(); crown.translate(0, 5.2, 0);
  return mergeGeometries([t, colorize(soft(crown), C('#ffffff'))]);
}
const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: 0, envMapIntensity: .5 });
const trunkTint = (geo) => geo;   // trunks keep their colour; crowns are white so instanceColor tints them
function plant(geo, list) {
  // one instanced mesh per 160 m tile, so the camera only draws the tiles it can see
  const tiles = new Map();
  list.forEach(t => { const k = Math.floor(t.x / 160) + ':' + Math.floor(t.z / 160); if (!tiles.has(k)) tiles.set(k, []); tiles.get(k).push(t); });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler(), v = new THREE.Vector3();
  tiles.forEach(items => {
    const im = new THREE.InstancedMesh(geo, treeMat, items.length);
    items.forEach((t, i) => { e.set(0, t.r, 0); q.setFromEuler(e); s.setScalar(t.s); m.compose(v.set(t.x, t.y - .3, t.z), q, s); im.setMatrixAt(i, m); im.setColorAt(i, t.c); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere(); im.receiveShadow = true; scene.add(im);
  });
}
const KEEP_CLEAR = [];   // [x, z, radius] spots for buildings and landmarks
const clear = (x, z) => KEEP_CLEAR.every(([cx, cz, r]) => (x - cx) ** 2 + (z - cz) ** 2 > r * r);
const slopeAt = (x, z) => Math.hypot(groundY(x + 3, z) - groundY(x - 3, z), groundY(x, z + 3) - groundY(x, z - 3)) / 6;

KEEP_CLEAR.push([C0.x + 76, C0.z - 72, 30], [C0.x + 76, C0.z - 92, 22], [C0.x + 118, C0.z - 70, 20], [C0.x + 40, C0.z - 74, 16], [C0.x - 40, C0.z - 52, 20], [C0.x + 32, C0.z - 34, 18], [C0.x + 40, C0.z + 40, 30], [C0.x + 56, C0.z + 22, 12], [P.skiBase.x, P.skiBase.z, 14], [215, -60, 18], [1528, -50, 24], [P.calgary.x, P.calgary.z, 40], [P.suburb.x, P.suburb.z, 46], [P.downtown.x, P.downtown.z, 72], [P.campus.x, P.campus.z, 46],
  [P.skiBase.x, P.skiBase.z, 16], [P.windmill.x, P.windmill.z, 14], [P.library.x, P.library.z, 30], [P.vawt2.x, P.vawt2.z, 14]);

const conifers = [], broadleaf = [];
{
  const r = rng(77), N = phone ? 3200 : 7000;
  const greens = ['#22352A', '#28402F', '#1E3127', '#2E4632'].map(C), leafy = ['#4D6834', '#58723A', '#64763D', '#465F30', '#7C7440'].map(C);
  for (let k = 0; k < N * 6 && conifers.length + broadleaf.length < N; k++) {
    if ((k & 255) === 0) await slice(.6 + .2 * (conifers.length + broadleaf.length) / N);
    const x = X0 + 200 + r() * (1900 - X0 - 200), z = Z0 + 20 + r() * (Z1 - Z0 - 40), y = groundY(x, z);
    if (y < 1.2) continue;
    if (!clear(x, z) || onSkiRun(x, z) || nearRoad(x, z, 3)) continue;
    if (Math.hypot(x - P.calgary.x, z - P.calgary.z) < 138 && Math.abs(z - riverZ(x)) > 14 && r() > .12) continue;   // suburbs: only a few street trees
    const w = regionWeights(x), sl = slopeAt(x, z);
    const patch = fbm(x / 90 + 3, z / 90 - 8, 3);
    if (w[0] > .5) {                                     // mountain forest below the treeline
      if (y > 120 + patch * 25 || sl > .9 || patch < -.15) continue;
      conifers.push({ x, y, z, s: .8 + r() * .7, r: r() * 6, c: greens[Math.floor(r() * greens.length)] });
    } else if (w[1] > .5) {
      if (patch < .15 || r() > .45) continue;
      conifers.push({ x, y, z, s: .7 + r() * .5, r: r() * 6, c: greens[Math.floor(r() * greens.length)] });
    } else if (w[2] > .5) {                              // shelterbelts and river trees only
      const nearRiver = x > 90 && x < 340 && Math.abs(z - (-14 + Math.sin(x / 38) * 13)) < 16;
      if (!nearRiver && !(Math.floor(z / 24) !== Math.floor((z + 3) / 24) && r() < .5)) continue;
      broadleaf.push({ x, y, z, s: .6 + r() * .4, r: r() * 6, c: leafy[Math.floor(r() * leafy.length)] });
    } else if (w[3] > .5) {
      if (patch < -.35) continue;
      (r() < .65 ? conifers : broadleaf).push({ x, y, z, s: .7 + r() * .6, r: r() * 6, c: (r() < .65 ? greens : leafy)[Math.floor(r() * 4)] });
    } else if (w[4] > .5) {
      if (patch < .1 || r() > .5) continue;
      broadleaf.push({ x, y, z, s: .55 + r() * .4, r: r() * 6, c: leafy[Math.floor(r() * leafy.length)] });
    } else if (w[6] > .5) {                              // tree rows along the canals
      const cx = ((x - 1400) % 44 + 44) % 44;
      if (cx < 3.2 || cx > 5.2 || x < 1440 || r() > .55 || (z > 55 && z < 170)) continue;
      broadleaf.push({ x, y, z, s: .5 + r() * .3, r: r() * 6, c: leafy[Math.floor(r() * leafy.length)] });
    }
  }
  plant(coniferGeo(), conifers); plant(broadleafGeo(), broadleaf);
}

/* ── 5. buildings ─────────────────────────────────────────────── */
const boxes = [], windowLights = [];
const buildingMat = new THREE.MeshStandardMaterial({ roughness: .48, metalness: .18, envMapIntensity: 1 });
const winUniform = { value: 0 };
buildingMat.onBeforeCompile = (sh) => {
  sh.uniforms.uNightWin = winUniform;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying float vLY; varying float vH;')
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vec4 wpI = modelMatrix * instanceMatrix * vec4(transformed, 1.); vWP = wpI.xyz;
      vWN = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);
      vH = length(instanceMatrix[1].xyz); vLY = position.y * vH;`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN; varying float vLY; varying float vH; uniform float uNightWin;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      float gWin = 0., gRnd = 0.;
      if (abs(vWN.y) < .5 && vLY > 1.2 && vH > 6.5) {
        float h = abs(vWN.x) > .5 ? vWP.z : vWP.x;
        float glassy = max(step(.03, diffuseColor.b - diffuseColor.r), 1. - step(.035, dot(diffuseColor.rgb, vec3(.3, .59, .11))));
        vec2 cell = vec2(h / (glassy > .5 ? 1.7 : 2.6), vLY / 3.4), f = fract(cell);
        float punched = step(.2, f.x) * step(f.x, .78) * step(.28, f.y) * step(f.y, .82);
        float curtain = step(.07, f.x) * step(.16, f.y);
        gWin = mix(punched, curtain, glassy);
        gRnd = fract(sin(dot(floor(cell), vec2(12.9898, 78.233)) + floor(vWP.x * .1) * 3.1) * 43758.5);
        vec3 glass = mix(vec3(.13, .17, .21), diffuseColor.rgb * .55, glassy * .5);
        diffuseColor.rgb = mix(diffuseColor.rgb, glass, gWin * .85);
      }
      diffuseColor.rgb *= mix(vH > 6.5 ? .62 : 1., 1., smoothstep(0., 3.5, vLY));   // darker where the wall meets the ground`)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n      roughnessFactor = mix(roughnessFactor, .07, gWin);')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n      metalnessFactor = mix(metalnessFactor, .6, gWin);')
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1., .78, .45), gWin * uNightWin * step(.55, gRnd));`);
};
function addBox(x, z, w, d, h, color, rot = 0, lit = true) {
  const y = groundY(x, z) - .5;
  boxes.push({ x, y, z, w, d, h, color: C(color), rot });
  if (h > 26) boxes.push({ x, y: y + h - .1, z, w: w * .42, d: d * .4, h: 1.6 + h * .018, color: C(color).lerp(C('#8E9398'), .45), rot });   // rooftop plant room (plain metal cladding)
  if (false && lit) {
    const r = rng(Math.floor(x * 31 + z * 17 + 7) & 0x7fffffff || 1);
    const floors = Math.max(1, Math.floor(h / 3.4)), per = Math.max(1, Math.floor((w + d) / 4));
    for (let f = 0; f < floors; f++) for (let k = 0; k < per; k++) {
      if (r() > .42) continue;
      const side = Math.floor(r() * 4), a = (r() - .5);
      const lx = side < 2 ? a * w : (side === 2 ? -1 : 1) * (w / 2 + .1), lz = side < 2 ? (side === 0 ? -1 : 1) * (d / 2 + .1) : a * d;
      const cs = Math.cos(rot), sn = Math.sin(rot);
      windowLights.push(x + lx * cs + lz * sn, y + 2 + f * 3.4, z - lx * sn + lz * cs);
    }
  }
}
// a coarse map of roof heights, so the camera always clears the buildings
const ROOF = new Map(), RC = 12, roofKey = (x, z) => Math.floor(x / RC) + ':' + Math.floor(z / RC);
function roofAt(x, z) { let m = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) m = Math.max(m, ROOF.get(roofKey(x + a * RC, z + b * RC)) || 0); return m; }
function buildBoxes() {
  boxes.forEach(b => { const k = roofKey(b.x, b.z); ROOF.set(k, Math.max(ROOF.get(k) || 0, b.y + b.h)); });
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0);
  const im = new THREE.InstancedMesh(geo, buildingMat, boxes.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  boxes.forEach((b, i) => { e.set(0, b.rot, 0); q.setFromEuler(e); m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.w, b.h, b.d)); im.setMatrixAt(i, m); im.setColorAt(i, b.color); });
  im.castShadow = im.receiveShadow = true; scene.add(im);
}
// Calgary downtown: a street grid, tallest in the core (landmark towers are added in section 6)
{
  const r = rng(5), tones = ['#8FA2B3', '#A9B4BD', '#6F8396', '#C2BBAE', '#54677A', '#B7A893'];
  for (let a = -3; a <= 3; a++) for (let b = -3; b <= 2; b++) {
    const x = P.calgary.x + a * 9, z = P.calgary.z + b * 8.5;
    const d = Math.hypot(a * 9, b * 8.5);
    if (d > 30 || Math.hypot(x - P.calTower.x, z - P.calTower.z) < 8 || Math.hypot(x - (P.calgary.x - 6), z - (P.calgary.z - 8)) < 12 || Math.hypot(x - (P.calgary.x + 8), z - (P.calgary.z - 4)) < 7) continue;
    addBox(x + (r() - .5) * 1.5, z + (r() - .5) * 1.5, 5 + r() * 2.5, 5 + r() * 2.5, 8 + Math.pow(1 - d / 30, 1.5) * 38 * (.45 + r() * .7), tones[Math.floor(r() * tones.length)]);
  }
}
// Calgary around the core: a ring of apartment blocks, then houses on streets out to the farmland
const roofs = [];
{
  const r = rng(9), walls = ['#E9E2D3', '#D8D3C9', '#C8B79E', '#B8C3C9', '#E4D6C3', '#C9B9A6'], roofsC = ['#5A4A40', '#6B5E55', '#4E555C', '#7A5A48', '#3F4448'];
  const apt = ['#B9AE9E', '#A79C8C', '#C4BAA9', '#8F99A1', '#B08F77'];
  const blocked = (x, z, pad) => nearRoad(x, z, pad) || Math.abs(z - riverZ(x)) < 11 || Math.hypot(x - 215, z + 60) < 18 || Math.hypot(x - P.rink.x, z - P.rink.z) < 11 || Math.hypot(x - P.lawn.x, z - P.lawn.z) < 9;
  for (let x = P.calgary.x - 60; x <= P.calgary.x + 60; x += 13) for (let z = P.calgary.z - 60; z <= P.calgary.z + 60; z += 13) {
    const d = Math.hypot(x - P.calgary.x, z - P.calgary.z);
    if (d < 33 || d > 58 || blocked(x, z, 4)) continue;
    addBox(x + (r() - .5) * 2, z + (r() - .5) * 2, 9 + r() * 3, 8 + r() * 3, 10 + (58 - d) * .35 + r() * 6, apt[Math.floor(r() * apt.length)]);
  }
  for (let x = P.calgary.x - 140; x <= P.calgary.x + 140; x += 10.5) for (let z = P.calgary.z - 140; z <= P.calgary.z + 140; z += 12) {
    const d = Math.hypot(x - P.calgary.x, z - P.calgary.z);
    if (d < 62 || d > 136 || blocked(x, z, 3.5) || r() < .08) continue;
    const rot = (r() - .5) * .06, w = 6 + r() * 2, dd = 5.5 + r() * 1.5;
    addBox(x, z, w, dd, 3.2 + (r() < .35 ? 2.6 : 0), walls[Math.floor(r() * walls.length)], rot);
    roofs.push({ x, y: groundY(x, z) + (boxes[boxes.length - 1].h) - .5, z, w: w + .6, d: dd + .6, h: 2.4, rot, c: C(roofsC[Math.floor(r() * roofsC.length)]) });
  }
  // the house whose backyard is the striped lawn
  addBox(P.lawn.x, P.lawn.z - 9.5, 8, 6.5, 5.8, '#E4D6C3'); roofs.push({ x: P.lawn.x, y: groundY(P.lawn.x, P.lawn.z - 9.5) + 5.3, z: P.lawn.z - 9.5, w: 8.6, d: 7.1, h: 2.6, rot: 0, c: C('#4E555C') });
}
// Toronto: the Financial District behind the CN Tower, condos along the water, the campus
{
  // named towers (x, z, w, d, h, colour): First Canadian Place, TD Centre, Scotia Plaza, Commerce Court, Bay Adelaide
  for (const t of [[790, 2, 9, 9, 98, '#E4E2DC'], [775, 8, 8, 12, 72, '#1E2327'], [771, -7, 8, 12, 58, '#1E2327'], [783, 20, 7, 10, 44, '#22272B'],
                   [803, 6, 9, 9, 90, '#8A3D33'], [812, -6, 8, 8, 70, '#9AA3A8'], [797, -14, 9, 9, 82, '#7F95A8']]) addBox(...t);
  const r = rng(13), condo = ['#A9C7CC', '#93B4BC', '#BFD3D6', '#7FA1AD', '#C9D6D8'], mid = ['#B7AFA2', '#9C9387', '#8C99A3', '#C7C0B3', '#A7826E'];
  // slim glass condo towers lining the waterfront
  for (let k = 0; k < 60; k++) {
    const x = 712 + r() * 150, z = shoreZ(x) - 6 - r() * 26;
    if (Math.hypot(x - P.cnTower.x, z - P.cnTower.z) < 13 || Math.hypot(x - 734, z - 40) < 22 || groundY(x, z) < 1) continue;
    if (boxes.some(b => Math.abs(b.x - x) < 7 && Math.abs(b.z - z) < 7)) continue;
    addBox(x, z, 5 + r() * 2, 5 + r() * 2, 30 + r() * 52, condo[Math.floor(r() * condo.length)], (r() - .5) * .2);
  }
  // mid-rise blocks filling the rest of downtown
  for (let k = 0; k < 120; k++) {
    const x = 735 + r() * 120, z = -40 + r() * 55;
    if (groundY(x, z) < 1 || (x > 768 && z < -2) || nearRoad(x, z, 2)) continue;
    if (boxes.some(b => Math.abs(b.x - x) < 7.5 && Math.abs(b.z - z) < 7.5)) continue;
    const d = Math.hypot(x - 792, z - 4);
    addBox(x, z, 6 + r() * 4, 6 + r() * 4, 10 + Math.max(0, 40 - d) * .9 * r() + r() * 12, mid[Math.floor(r() * mid.length)]);
  }
  // U of T, laid out like the real campus around King's College Circle (north is -z)
  const slate = C('#4B4F53'), copper = C('#5E8C7E');
  const hall = (dx, dz, w, d, h, col, roof = slate, rh = 4.5, rot = 0) => {
    const x = C0.x + dx, z = C0.z + dz; addBox(x, z, w, d, h, col, rot);
    if (roof) roofs.push({ x, y: groundY(x, z) + h - .5, z, w: w + .4, d: d + .4, h: rh, rot, c: roof });
  };
  hall(0, -33, 38, 10, 12, '#B49A74');                    // University College
  hall(0, -27, 6, 6, 24, '#B49A74', slate, 6);            //   and its tower
  hall(-40, -4, 10, 24, 11, '#A88D6B');                   // Knox College
  hall(34, -36, 26, 15, 11, '#B5A07E');                   // Hart House
  hall(48, -36, 5, 5, 30, '#A99475', slate, 6);           // Soldiers' Tower
  hall(4, 31, 18, 9, 10, '#C2AE8E');                      // Simcoe Hall
  hall(26, 40, 24, 10, 12, '#BCA383');                    // Sandford Fleming Building (engineering)
  hall(36, 22, 12, 14, 22, '#8C5A44', null);              // Galbraith Building (the research group)
  hall(64, 40, 20, 14, 18, '#9A8574', null);              // Bahen Centre
  hall(62, 18, 14, 16, 22, '#93B3C6', null);              // Myhal Centre (glass)
  hall(-46, 36, 18, 12, 14, '#BDB6A9', null);             // Medical Sciences
}
// Delft old town: narrow brick canal houses with their gables to the street
{
  const r = rng(21), brick = ['#7E3F2E', '#8F4A35', '#6E3A2C', '#A35A40', '#874434'];
  for (const [zRow, x0, x1] of [[-58, 1488, 1600], [-47, 1488, 1520], [-47, 1548, 1600], [-24, 1488, 1530]]) {
    for (let x = x0; x < x1; x += 4.8 + r() * .8) {
      if (!clear(x, zRow) || (Math.abs(x - 1528) < 9 && zRow < -40)) continue;
      const h = 8 + r() * 5, w = 4.4;
      addBox(x, zRow, w, 9, h, brick[Math.floor(r() * brick.length)], 0, true);
      roofs.push({ x, y: groundY(x, zRow) + h - .5, z: zRow, w: w + .1, d: 9.2, h: 4 + r() * 1.5, rot: Math.PI / 2, c: C('#3A3634') });
    }
  }
}
buildBoxes();
{ // roofs as one instanced triangular prism
  const shape = new THREE.Shape([new THREE.Vector2(-.5, 0), new THREE.Vector2(.5, 0), new THREE.Vector2(0, 1)]);
  const geo = flat(new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false }).translate(0, 0, -.5));
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: .8 }), roofs.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  roofs.forEach((b, i) => { e.set(0, b.rot, 0); q.setFromEuler(e); m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.w, b.h, b.d)); im.setMatrixAt(i, m); im.setColorAt(i, b.c); });
  scene.add(im);
}

/* ── 6. landmarks ─────────────────────────────────────────────── */
const lambert = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: .62, metalness: 0, ...extra });
const concrete = lambert('#D6D3CC'), white = lambert('#F2F3F2'), dark = lambert('#2E3439'), steel = lambert('#9AA4AC', { metalness: .75, roughness: .35 });
function at(obj, v, yOff = 0) { obj.position.set(v.x, groundY(v.x, v.z) + yOff, v.z); scene.add(obj); return obj; }

// CN Tower: three-legged base, main pod with the observation level, SkyPod, antenna
{
  const g = new THREE.Group();
  for (let k = 0; k < 3; k++) {                     // the Y-shaped concrete shaft
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(.9, 2.6, 78, 6), concrete), a = k / 3 * Math.PI * 2;
    leg.position.set(Math.cos(a) * 1.6, 39, Math.sin(a) * 1.6); g.add(leg);
  }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 90, 12), concrete); core.position.y = 45; g.add(core);
  const podLo = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 3.2, 3.6, 32), concrete); podLo.position.y = 72.4; g.add(podLo);
  const glassRing = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.4, 2.2, 32), lambert('#3D4A55', { metalness: .4, roughness: .2 })); glassRing.position.y = 75.3; g.add(glassRing);
  const podHi = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 6.6, 3, 32), concrete); podHi.position.y = 77.9; g.add(podHi);
  const sky = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 2.2, 20), concrete); sky.position.y = 94; g.add(sky);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.3, 1.1, 30, 10), lambert('#C9CDD0')); mast.position.y = 110; g.add(mast);
  at(g, P.cnTower);
  windowLights.push(P.cnTower.x, groundY(P.cnTower.x, P.cnTower.z) + 125, P.cnTower.z);
}
// Rogers Centre: the white retractable dome beside the tower
{
  const g = new THREE.Group();
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(16, 16.5, 6, 48), lambert('#CFCDC6')); wall.position.y = 3; g.add(wall);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(16.2, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2), lambert('#E8E8E4', { roughness: .45, metalness: .2 }));
  dome.scale.y = .42; dome.position.y = 6; g.add(dome);
  at(g, new THREE.Vector3(734, 0, 40));
}
// Toronto Islands, low and green across the harbour
{
  const isl = lambert('#5F7E48');
  for (const [x, z, a, b, rot] of [[720, 122, 60, 9, .05], [790, 128, 45, 7, -.08], [850, 118, 40, 10, .2], [760, 112, 18, 6, 0]]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.15, 1.2, 40), isl); m.scale.set(a, 1, b); m.rotation.y = rot; m.position.set(x, .3, z); scene.add(m);
  }
  const r = rng(61), list = [], leafy = ['#4D6834', '#58723A', '#64763D'].map(C);
  for (let k = 0; k < 160; k++) {
    const [x, z, a, b] = [[720, 122, 60, 9], [790, 128, 45, 7], [850, 118, 40, 10]][k % 3], t = r() * Math.PI * 2, d = Math.sqrt(r()) * .8;
    list.push({ x: x + Math.cos(t) * a * d, y: 1, z: z + Math.sin(t) * b * d, s: .45 + r() * .3, r: r() * 6, c: leafy[k % 3] });
  }
  plant(broadleafGeo(), list);
}
// Convocation Hall: the domed rotunda on King's College Circle
{
  const g = new THREE.Group(), stone = lambert('#C8B48E');
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 9, 40), stone); drum.position.y = 4.5; g.add(drum);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 7.4, 1, 40), lambert('#B39F7A')); ring.position.y = 9.4; g.add(ring);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(6.6, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2), lambert('#6F9C88', { roughness: .5, metalness: .3 })); dome.position.y = 9.8; dome.scale.y = .7; g.add(dome);
  const portico = new THREE.Mesh(new THREE.BoxGeometry(9, 7, 4), stone); portico.position.set(0, 3.5, 8); g.add(portico);
  at(g, new THREE.Vector3(C0.x - 18, 0, C0.z + 30));
}
// Robarts Library: Brutalist concrete on a triangular plan. Ribbed walls of narrow concrete fins over dark glass,
// the upper floors cantilevered out past the base, a low podium around the foot.
{
  const g = new THREE.Group(), conc = lambert('#B9B2A6', { roughness: .92 }), dark = lambert('#3F454B', { roughness: .4, metalness: .2 });
  const triPts = (s) => [[-15 * s, -9 * s], [15 * s, -9 * s], [0, 17 * s]];
  const prism = (s, h, y, mat) => {
    const sh = new THREE.Shape(triPts(s).map(([x, z]) => new THREE.Vector2(x, z)));
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2), mat);
    m.position.y = y; m.castShadow = m.receiveShadow = true; g.add(m); return m;
  };
  prism(1.32, 4, 0, conc);                 // podium
  prism(.97, 18, 4, dark);                 // glass core behind the fins
  prism(1.12, 9, 22, dark);                // cantilevered upper floors
  prism(1.15, .9, 31, conc);               // roof slab
  prism(1.0, .8, 21.2, conc);              // floor slab where the overhang starts
  // fins along every edge: lower shaft and the wider upper storeys
  const fins = [];
  for (const [s, y0, h] of [[.985, 4, 17.2], [1.135, 22, 9]]) {
    const P = triPts(s);
    for (let e = 0; e < 3; e++) {
      const [ax, az] = P[e], [bx, bz] = P[(e + 1) % 3], L = Math.hypot(bx - ax, bz - az), n = Math.floor(L / 2.1), ang = Math.atan2(bz - az, bx - ax);
      for (let k = 0; k <= n; k++) fins.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n, ang, y0, h]);
    }
  }
  const finMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.45, 1, 1.1), conc, fins.length), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  fins.forEach(([x, z, ang, y0, h], i) => { M.compose(new THREE.Vector3(x, y0 + h / 2, -z), Q.setFromEuler(E.set(0, ang, 0)), new THREE.Vector3(1, h, 1)); finMesh.setMatrixAt(i, M); });
  finMesh.castShadow = true; g.add(finMesh);
  at(g, new THREE.Vector3(C0.x - 42, 0, C0.z - 56), -.3); g.rotation.y = .2;
}
// Varsity Stadium: a rectangular pitch inside a red running track, grandstands raked up along both long sides
{
  const g = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(46, 1.2, 38), lambert('#9EA1A3', { roughness: .95 })); pad.position.set(0, -.4, -1.5); pad.receiveShadow = true; g.add(pad);
  const stad = (hw, hh, r) => { const sh = new THREE.Shape(); sh.moveTo(-hw + r, -hh); sh.lineTo(hw - r, -hh); sh.absarc(hw - r, 0, hh, -Math.PI / 2, Math.PI / 2, false); sh.lineTo(-hw + r, hh); sh.absarc(-hw + r, 0, hh, Math.PI / 2, Math.PI * 1.5, false); return sh; };
  const trackSh = stad(19, 10.5, 10.5); trackSh.holes.push(stad(15.6, 7.1, 7.1));
  const track = new THREE.Mesh(new THREE.ShapeGeometry(trackSh, 24).rotateX(-Math.PI / 2), lambert('#B5473A', { roughness: .9 })); track.position.y = .22; track.receiveShadow = true; g.add(track);
  const pitch = new THREE.Mesh(new THREE.ShapeGeometry(stad(15.6, 7.1, 7.1), 24).rotateX(-Math.PI / 2), lambert('#4F8F3E', { roughness: 1 })); pitch.position.y = .23; pitch.receiveShadow = true; g.add(pitch);
  const lines = lambert('#EEF0EA'); for (const x of [-13, 0, 13]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(.18, 13.4).rotateX(-Math.PI / 2), lines); l.position.set(x, .25, 0); g.add(l); }
  const rake = (len, depth, h) => { const sh = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(depth, 0), new THREE.Vector2(depth, h)]); return new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, steps: 1 }).translate(0, 0, -len / 2).rotateY(Math.PI / 2); };
  const seats = lambert('#7E868D', { roughness: .8 });
  const north = new THREE.Mesh(rake(40, 7, 7), seats); north.position.set(0, .2, -11); g.add(north);              // rises away from the track
  const south = new THREE.Mesh(rake(36, 4.5, 4), seats); south.position.set(0, .2, 11); south.rotation.y = Math.PI; g.add(south);
  for (const m of [north, south]) m.castShadow = m.receiveShadow = true;
  const roofN = new THREE.Mesh(new THREE.BoxGeometry(40, .4, 5), lambert('#E6E7E5')); roofN.position.set(0, 9.2, -16); g.add(roofN);
  for (const x of [-18, -6, 6, 18]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, 9.2, 8), lambert('#E6E7E5')); c.position.set(x, 4.6, -18.2); g.add(c); }
  at(g, new THREE.Vector3(C0.x + 76, 0, C0.z - 72), .2);
}
// Varsity Arena: a long brick hall with a shallow barrel-vaulted roof and a row of tall windows
{
  const a = new THREE.Group(), brick = lambert('#9A5F49', { roughness: .85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(30, 9, 20), brick); body.position.y = 4.5; body.castShadow = body.receiveShadow = true; a.add(body);
  const arch = new THREE.Shape(); arch.moveTo(-10.4, 0); arch.quadraticCurveTo(0, 7, 10.4, 0); arch.lineTo(-10.4, 0);
  const vault = new THREE.Mesh(new THREE.ExtrudeGeometry(arch, { depth: 31, bevelEnabled: false, curveSegments: 20 }).translate(0, 0, -15.5).rotateY(Math.PI / 2), lambert('#7D8790', { roughness: .45, metalness: .35 }));
  vault.position.y = 9; vault.castShadow = true; a.add(vault);
  const cornice = new THREE.Mesh(new THREE.BoxGeometry(31, .7, 21), lambert('#C9C1B2')); cornice.position.y = 9; a.add(cornice);
  const glass = lambert('#2F3A44', { roughness: .2, metalness: .4 });
  for (let k = -6; k <= 6; k++) for (const sz of [-10.05, 10.05]) { const w = new THREE.Mesh(new THREE.BoxGeometry(1.1, 4.2, .12), glass); w.position.set(k * 2.2, 5, sz); a.add(w); }
  const entry = new THREE.Mesh(new THREE.BoxGeometry(.4, 4, 7), glass); entry.position.set(15.1, 2.2, 0); a.add(entry);
  at(a, new THREE.Vector3(C0.x + 118, 0, C0.z - 70), -.3); a.rotation.y = Math.PI / 2;
}
// the Skule cannon on the lawn beside Sandford Fleming
{
  const g = new THREE.Group(), iron = lambert('#202326', { metalness: .6, roughness: .4 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(.28, .42, 3.2, 16), iron); barrel.rotation.z = Math.PI / 2 - .25; barrel.position.y = 1.2; g.add(barrel);
  for (const sz of [-.75, .75]) { const wheel = new THREE.Mesh(new THREE.TorusGeometry(.75, .12, 8, 20), lambert('#3A2E24')); wheel.position.set(.2, .8, sz); g.add(wheel); }
  const carriage = new THREE.Mesh(new THREE.BoxGeometry(2.2, .35, 1.2), lambert('#3A2E24')); carriage.position.set(-.6, .7, 0); g.add(carriage);
  g.scale.setScalar(1.6); at(g, new THREE.Vector3(C0.x + 12, 0, C0.z + 44)); g.rotation.y = -.6;
}
// roads: a ribbon that follows the ground (bridges where it crosses water)
{
  const asphalt = new THREE.MeshStandardMaterial({ color: '#45484B', roughness: .85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const paint = new THREE.MeshStandardMaterial({ color: '#D9B44A', roughness: .7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const ribbon = (pts, w, yOff) => {
    const path = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 3));
      for (let k = 0; k < n; k++) path.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
    }
    path.push(pts[pts.length - 1]);
    const pos = [], idx = [];
    path.forEach(([x, z], i) => {
      const [px, pz] = path[Math.max(0, i - 1)], [nx, nz] = path[Math.min(path.length - 1, i + 1)], dx = nx - px, dz = nz - pz, l = Math.hypot(dx, dz) || 1;
      const sx = -dz / l * w / 2, sz = dx / l * w / 2;
      const y = Math.max(groundY(x + sx, z + sz), groundY(x - sx, z - sz), groundY(x, z), 3.5) + yOff;
      pos.push(x + sx, y, z + sz, x - sx, y, z - sz);
      if (i) { const b = i * 2; idx.push(b - 2, b, b - 1, b - 1, b, b + 1); }
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  };
  ROADS.forEach(r => {
    const m = new THREE.Mesh(ribbon(r.pts, r.w, .35), asphalt); m.receiveShadow = true; scene.add(m);
    if (r.kind === 'highway') scene.add(new THREE.Mesh(ribbon(r.pts, .35, .4), paint));
  });
}
// the ski hill: runs cut through the forest, a chairlift with moving chairs, a lodge, and a few skiers
const skiers = [];
let liftChairs = [], liftPath = null;
{
  const wood = lambert('#6B4A33'), snowRoof = lambert('#ECF0F3'), dk = lambert('#2C3136');
  const lodge = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(16, 6, 10), wood); body.position.y = 3; lodge.add(body);
  const aShape = new THREE.Shape([new THREE.Vector2(-9, 0), new THREE.Vector2(9, 0), new THREE.Vector2(0, 8)]);
  const aRoof = new THREE.Mesh(new THREE.ExtrudeGeometry(aShape, { depth: 11.5, bevelEnabled: false }).translate(0, 0, -5.75), snowRoof); aRoof.position.y = 6; lodge.add(aRoof);
  const glassF = new THREE.Mesh(new THREE.PlaneGeometry(9, 5), lambert('#2D3A44', { metalness: .5, roughness: .15 })); glassF.position.set(0, 3.2, 5.02); lodge.add(glassF);
  at(lodge, P.skiBase); lodge.rotation.y = -.4;
  // chairlift from the base up the main ridge
  const A = new THREE.Vector3(P.skiBase.x - 10, 0, P.skiBase.z - 12), B = new THREE.Vector3(-392, 0, -66), n = 10, top = [];
  const dir = B.clone().sub(A).setY(0).normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x);
  for (let k = 0; k <= n; k++) {
    const p = A.clone().lerp(B, k / n), y = groundY(p.x, p.z), t = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.28, .4, 9, 8), dk); pole.position.y = 4.5; t.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(4.2, .3, .3), dk); arm.position.y = 9; t.add(arm);
    t.position.set(p.x, y, p.z); t.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2; scene.add(t);
    top.push(new THREE.Vector3(p.x, y + 9, p.z));
  }
  liftPath = new THREE.CatmullRomCurve3(top);
  const cableMat = lambert('#1C1F22');
  for (const sg of [-1.9, 1.9]) {
    const pts = top.map(p => p.clone().addScaledVector(side, sg));
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, .06, 4), cableMat));
  }
  const chairGeo = mergeGeometries([new THREE.BoxGeometry(.06, 2.2, .06).translate(0, -1.1, 0), new THREE.BoxGeometry(1.6, .12, .7).translate(0, -2.2, .1), new THREE.BoxGeometry(1.6, .7, .1).translate(0, -1.9, -.25)]);
  const chairMat = lambert('#30363C');
  for (let k = 0; k < 16; k++) { const c = new THREE.Mesh(chairGeo, chairMat); scene.add(c); liftChairs.push({ c, phase: k / 16 }); }
  liftChairs.side = side; liftChairs.dir = dir;
  // skiers carving down the runs
  const suits = ['#C23B2E', '#2F6FCF', '#E8A33D', '#2D8A4E', '#7A3FA0', '#1F2A33'];
  for (let k = 0; k < 9; k++) {
    const g = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.32, .8, 3, 8), lambert(suits[k % suits.length])); torso.position.y = 1.15; torso.rotation.x = .3; g.add(torso);
    const skisM = new THREE.Mesh(new THREE.BoxGeometry(.5, .06, 1.8), dk); skisM.position.y = .05; g.add(skisM);
    g.scale.setScalar(1.4); scene.add(g);
    skiers.push({ g, run: SKI_RUNS[k % SKI_RUNS.length], t: (k * .37) % 1, speed: .025 + (k % 3) * .006, phase: k });
  }
}
// Calgary: the Calgary Tower, the curved Bow, Brookfield Place, the Saddledome and the Peace Bridge
{
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.4, 44, 16), concrete); shaft.position.y = 22; g.add(shaft);
  const pod = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 3.6, 3.4, 32), lambert('#E6E3DD')); pod.position.y = 45.2; g.add(pod);
  const win = new THREE.Mesh(new THREE.CylinderGeometry(4.7, 4.7, 1.2, 32), lambert('#3B4652', { metalness: .4, roughness: .2 })); win.position.y = 45.4; g.add(win);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(3, 4.4, 2.2, 32), lambert('#B8372C')); crown.position.y = 48; g.add(crown);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(.5, .8, 5, 12), lambert('#D9D4CC')); beacon.position.y = 51.5; g.add(beacon);
  at(g, P.calTower);
}
{
  // The Bow: a crescent of glass, bowed toward the south
  const shape = new THREE.Shape(), R0 = 9, R1 = 13, a0 = -.8, a1 = .8;
  shape.absarc(0, 0, R1, a0, a1, false); shape.absarc(0, 0, R0, a1, a0, true);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 62, bevelEnabled: false, curveSegments: 32 }); geo.rotateX(-Math.PI / 2);
  const bow = new THREE.Mesh(geo, lambert('#7E97AC', { metalness: .55, roughness: .18 }));
  at(bow, new THREE.Vector3(P.calgary.x - 6, 0, P.calgary.z - 8 + 11)); bow.rotation.y = Math.PI / 2;
  const brook = new THREE.Mesh(new THREE.BoxGeometry(8, 58, 8), lambert('#9DB2C1', { metalness: .5, roughness: .2 })); brook.position.y = 29;
  const bg = new THREE.Group(); bg.add(brook); at(bg, new THREE.Vector3(P.calgary.x + 8, 0, P.calgary.z - 4));
  // Saddledome: the saddle-shaped roof over a round bowl
  const sg = new THREE.Group(), R = 12, saddle = (x, z) => 7 + 2.6 * (x * x - z * z) / (R * R);
  const wall = new THREE.CylinderGeometry(R, R, 1, 64, 1, true), wp = wall.attributes.position;
  for (let i = 0; i < wp.count; i++) wp.setY(i, wp.getY(i) > 0 ? saddle(wp.getX(i), wp.getZ(i)) : 0);
  wall.computeVertexNormals(); sg.add(new THREE.Mesh(wall, lambert('#A9AEB2', { side: THREE.DoubleSide })));
  const roof = new THREE.CircleGeometry(R, 64, 0, Math.PI * 2); roof.rotateX(-Math.PI / 2);
  const rp = roof.attributes.position; for (let i = 0; i < rp.count; i++) rp.setY(i, saddle(rp.getX(i), rp.getZ(i)) + .05);
  roof.computeVertexNormals(); sg.add(new THREE.Mesh(roof, lambert('#D7D5CF', { side: THREE.DoubleSide })));
  at(sg, new THREE.Vector3(215, 0, -60)); sg.rotation.y = .5;
  // Peace Bridge: a red helix of rings across the Bow
  const pb = new THREE.Group(), red = lambert('#C0322B');
  for (let k = 0; k <= 22; k++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(3, .14, 6, 24), red); ring.position.z = -12 + k * (24 / 22); ring.rotation.z = k * .28; ring.scale.set(1.2, .8, 1); pb.add(ring); }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.6, .25, 24), lambert('#8C8F92')); deck.position.y = -2; pb.add(deck);
  const bx = 150, bz = -14 + Math.sin(bx / 38) * 13; pb.position.set(bx, 6, bz); scene.add(pb);
}
// Nieuwe Kerk, Delft: the tall Gothic tower over the market square
{
  const g = new THREE.Group(), stone = lambert('#9C8F7E'), brick = lambert('#86533F'), slate = lambert('#3E4347');
  const nave = new THREE.Mesh(new THREE.BoxGeometry(12, 14, 32), brick); nave.position.set(0, 7, -20); g.add(nave);
  const shape = new THREE.Shape([new THREE.Vector2(-6.4, 0), new THREE.Vector2(6.4, 0), new THREE.Vector2(0, 8)]);
  const naveRoof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 32, bevelEnabled: false }).translate(0, 0, -16), slate); naveRoof.position.set(0, 14, -20); g.add(naveRoof);
  const base = new THREE.Mesh(new THREE.BoxGeometry(8, 34, 8), stone); base.position.y = 17; g.add(base);
  const oct1 = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.8, 16, 8), stone); oct1.position.y = 42; g.add(oct1);
  const oct2 = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.9, 12, 8), stone); oct2.position.y = 56; g.add(oct2);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(2.3, 26, 8), slate); spire.position.y = 75; g.add(spire);
  at(g, new THREE.Vector3(1528, 0, -36)); g.rotation.y = .05;
}
// hockey rink and the striped lawn with a mower going back and forth
{
  const rink = new THREE.Mesh(new THREE.BoxGeometry(15, .4, 7.5), lambert('#F4F7FA')); at(rink, P.rink, .2);
  const boards = new THREE.Mesh(new THREE.BoxGeometry(15.6, .9, 8.1), lambert('#3D5A80')); at(boards, P.rink, .05);
  rink.position.y += .5;
  const stripes = new THREE.Group();
  for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.4, .08, 10), lambert(i % 2 ? '#6E9A4E' : '#86AD62')); s.position.x = (i - 2.5) * 1.4; stripes.add(s); }
  at(stripes, P.lawn, .12);
  const fence = lambert('#8B7A66');                      // a backyard fence around it
  for (const [fx, fz, fw, fd] of [[0, 5.3, 9, .2], [-4.5, 0, .2, 10.6], [4.5, 0, .2, 10.6]]) { const f = new THREE.Mesh(new THREE.BoxGeometry(fw, 1.2, fd), fence); f.position.set(fx, .6, fz); stripes.add(f); }
}
const mower = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, .6, 1.4), lambert('#D9442E')); body.position.y = .5; mower.add(body);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(.1, 1.2, .1), dark); handle.position.set(0, 1, -.9); handle.rotation.x = -.5; mower.add(handle);
  const person = new THREE.Mesh(new THREE.CapsuleGeometry(.35, 1, 3, 6), lambert('#2F5F8F')); person.position.set(0, 1.4, -1.5); mower.add(person);
  at(mower, P.lawn, .1);
}
// UTWind vertical-axis turbine (H-rotor), reused in Delft
function vawt(scale = 1) {
  const g = new THREE.Group(), rotor = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.35, .5, 10, 8), steel); mast.position.y = 5; g.add(mast);
  const base = new THREE.Mesh(new THREE.BoxGeometry(3, .6, 3), dark); base.position.y = .3; g.add(base);
  const blade = lambert('#F5F6F7'), accent = lambert('#1F4E8C');
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI * 2, b = new THREE.Mesh(new THREE.BoxGeometry(.5, 7, 1.2), blade);
    b.position.set(Math.cos(a) * 3.4, 0, Math.sin(a) * 3.4); b.rotation.y = -a; rotor.add(b);
    for (const yy of [-2.2, 2.2]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(3.4, .18, .3), accent); arm.position.set(Math.cos(a) * 1.7, yy, Math.sin(a) * 1.7); arm.rotation.y = -a; rotor.add(arm); }
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(.45, .45, 5.4, 8), accent); rotor.add(hub);
  rotor.position.y = 10.5; g.add(rotor); g.scale.setScalar(scale);
  return { g, rotor };
}
const vawtTO = vawt(1.1); at(vawtTO.g, P.vawt);
const vawtNL = vawt(1.1); at(vawtNL.g, P.vawt2);
// research building airflow: particles that stream around the glass block (tracer-gas research)
const AIR_N = 360, airPos = new Float32Array(AIR_N * 3), airSeed = new Float32Array(AIR_N * 3);
{ const r = rng(31); for (let i = 0; i < AIR_N; i++) { airSeed[i * 3] = r(); airSeed[i * 3 + 1] = r(); airSeed[i * 3 + 2] = r(); } }
const airGeo = new THREE.BufferGeometry(); airGeo.setAttribute('position', new THREE.BufferAttribute(airPos, 3));
const air = new THREE.Points(airGeo, new THREE.PointsMaterial({ color: '#5EC8E5', size: 1.15, map: null, transparent: true, opacity: .95, depthWrite: false }));
scene.add(air);
const habY = groundY(P.hab.x, P.hab.z);
// t is the flow's phase; (ux, uz) is the way the wind blows across the site (live in Toronto, +x until known)
function updateAir(t, ux = 1, uz = 0) {
  for (let i = 0; i < AIR_N; i++) {
    const u = (airSeed[i * 3] + t * .05) % 1, lane = airSeed[i * 3 + 1], hgt = 2 + airSeed[i * 3 + 2] * 26;
    const x = -34 + u * 68, side = lane < .5 ? -1 : 1;
    const off = (4 + Math.abs(lane - .5) * 22) * side;
    const bump = Math.exp(-(x * x) / 120) * 9 * side, across = off + bump;   // flow bends around the building
    airPos[i * 3] = P.hab.x + ux * x - uz * across; airPos[i * 3 + 1] = habY + hgt + Math.exp(-(x * x) / 200) * (hgt > 22 ? 4 : 0); airPos[i * 3 + 2] = P.hab.z + uz * x + ux * across;
  }
  airGeo.attributes.position.needsUpdate = true;
}
// a runner on the waterfront path
const runner = new THREE.Mesh(new THREE.CapsuleGeometry(.45, 1.3, 3, 6), lambert('#E8A33D')); scene.add(runner);
// Dutch windmill with turning sails
const sails = new THREE.Group();
{
  const g = new THREE.Group();
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 5, 16, 8), lambert('#5B4A3E')); tower.position.y = 8; g.add(tower);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(3.6, 4.5, 8), lambert('#3C3836')); cap.position.y = 18.2; g.add(cap);
  for (let k = 0; k < 4; k++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(1.8, 13, .2), lambert('#EDE6D8')); s.position.y = 6.5;
    const arm = new THREE.Group(); arm.add(s); arm.rotation.z = k * Math.PI / 2; sails.add(arm);
  }
  sails.position.set(0, 16, 3.8); g.add(sails);
  at(g, P.windmill); g.rotation.y = .4;
}
// modern turbines along the dike
const rotors = [];
for (let k = 0; k < 7; k++) {
  const g = new THREE.Group(), x = 1440 + k * 42, z = -128;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.7, 1.3, 46, 8), white); mast.position.y = 23; g.add(mast);
  const nac = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 5), white); nac.position.set(0, 46.5, .5); g.add(nac);
  const rotor = new THREE.Group();
  for (let b = 0; b < 3; b++) { const bl = new THREE.Mesh(new THREE.BoxGeometry(1.1, 20, .3), white); bl.position.y = 10; const arm = new THREE.Group(); arm.add(bl); arm.rotation.z = b * Math.PI * 2 / 3; rotor.add(arm); }
  rotor.position.set(0, 46.5, 3.3); g.add(rotor); rotors.push({ rotor, phase: k * .7 });
  at(g, new THREE.Vector3(x, 0, z)); g.rotation.y = -.25;
  windowLights.push(x, groundY(x, z) + 48.5, z);    // aviation light
}
// TU Delft library: a grass roof sloping up out of the lawn, a glass front under its raised edge, a steel cone through it
{
  const g = new THREE.Group();
  const shape = new THREE.Shape([new THREE.Vector2(-30, 0), new THREE.Vector2(20, 0), new THREE.Vector2(20, 6.5), new THREE.Vector2(19.2, 6.5)]);
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 38, bevelEnabled: false }).translate(0, 0, -19), [lambert('#3E5568', { metalness: .6, roughness: .1 }), lambert('#5E9846', { roughness: 1 })]);   // glass gable ends, grass slope
  roof.receiveShadow = true; g.add(roof);
  const conc = lambert('#CFCBC2', { roughness: .8 });
  const edge = new THREE.Mesh(new THREE.BoxGeometry(1.4, .6, 38.4), conc); edge.position.set(19.9, 6.6, 0); g.add(edge);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(.3, 6.2, 37.6), lambert('#3E5568', { metalness: .6, roughness: .08 })); glass.position.set(20.1, 3.1, 0); g.add(glass);
  for (let k = -9; k <= 9; k++) { const m = new THREE.Mesh(new THREE.BoxGeometry(.4, 6.2, .18), conc); m.position.set(20.3, 3.1, k * 2); g.add(m); }
  const steelC = lambert('#DADDE0', { metalness: .55, roughness: .35 });
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(.45, 3, 24, 32, 1, true), steelC); cone.position.set(4, 12, 0); g.add(cone);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, .5, 32), conc); collar.position.set(4, 34 / 49.2 * 6.5, 0); g.add(collar);
  for (let k = 1; k < 6; k++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(3 - (k / 6) * 2.55, .06, 6, 32), steelC); ring.rotation.x = Math.PI / 2; ring.position.set(4, k * 24 / 6, 0); g.add(ring); }
  const needle = new THREE.Mesh(new THREE.CylinderGeometry(.06, .25, 7, 8), steelC); needle.position.set(4, 27.5, 0); g.add(needle);
  // sized and squared up to sit inside one polder block (canals at x 1532/1576, z 6/64)
  g.scale.setScalar(.74); at(g, new THREE.Vector3(1555, 0, 37), -.2); g.rotation.y = Math.PI / 2;
}
// night: lit windows, aviation lights, stars
const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'); const g = x.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.35, 'rgba(255,255,255,.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
const lights = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(windowLights, 3)),
  new THREE.PointsMaterial({ color: '#FF5A4A', size: 3.2, map: glowTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
scene.add(lights);
const stars = (() => {
  const r = rng(5), pos = [];
  for (let i = 0; i < 1500; i++) { const u = r() * Math.PI * 2, v = Math.acos(1 - r() * .9), R = 4200; pos.push(Math.sin(v) * Math.cos(u) * R, Math.cos(v) * R, Math.sin(v) * Math.sin(u) * R); }
  return new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)),
    new THREE.PointsMaterial({ color: '#fff', size: 1.5, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
})();
scene.add(stars);

/* ── 7. the wind current ──────────────────────────────────────── */
const WIND_PTS = [
  [-470, 330, -70], [-360, 240, 10], [-230, 150, 60], [-60, 90, 40], [80, 70, 0], [186, 70, -32], [236, 30, 50], [330, 50, 20],
  [520, 75, -10], [680, 85, 10], [760, 82, 36], [790, 40, 0], [822, 16, -48], [852, 30, -76], [880, 26, 10], [800, 14, 70], [700, 30, 90],
  [960, 60, 70], [1180, 80, 10], [1380, 55, -20], [1470, 26, -18], [1560, 30, 12], [1592, 16, 46], [1690, 40, 30], [1830, 70, 20], [2100, 120, 0], [2500, 170, -20],
].map(([x, y, z]) => new THREE.Vector3(x, y, z));
const windCurve = new THREE.CatmullRomCurve3(WIND_PTS, false, 'centripetal', .5);
const windMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#FFFFFF') }, uBoost: { value: 1 } },
  vertexShader: 'attribute float aPhase; varying vec2 vUv; varying float vPhase; void main(){ vUv = uv; vPhase = aPhase; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
  fragmentShader: `uniform float uTime, uBoost; uniform vec3 uColor; varying vec2 vUv; varying float vPhase;
    void main(){
      float s = fract(vUv.x * 160. - uTime * .55 + vPhase);
      float dash = smoothstep(0., .5, s) * (1. - smoothstep(.5, .72, s));      // short pulses moving downwind
      float a = dash * .34 * uBoost;
      a *= smoothstep(0., .015, vUv.x) * (1. - smoothstep(.96, 1., vUv.x));
      gl_FragColor = vec4(uColor, a);
    }`,
});
{
  // ten streamlines bundled around the main path, drifting apart and back together
  const r = rng(17), geos = [];
  for (let k = 0; k < 10; k++) {
    const ph = r() * 6.28, amp = 1 + r() * 2.5, f1 = .6 + r() * .8, f2 = .4 + r() * .9;
    const pts = WIND_PTS.map((p, i) => p.clone().add(new THREE.Vector3(Math.sin(i * f2 + ph) * amp * .5, Math.sin(i * f1 + ph) * amp, Math.cos(i * f1 * .8 + ph) * amp)));
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal', .5), 1800, .045 + r() * .035, 3, false);
    const phase = new Float32Array(g.attributes.position.count).fill(r());
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1)); geos.push(g);
  }
  scene.add(new THREE.Mesh(mergeGeometries(geos), windMat));
}

scene.traverse(o => { if (o.isMesh && o !== water && !o.isInstancedMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });

/* ── 7b. live weather over the Toronto chapter ────────────────────
   live-weather.js brings the current conditions at the University of Toronto. Over the Toronto
   chapter they drive the scene: the turbine spins at the speed the real wind would turn it (it
   starts making power at 4 m/s), the tracer airflow around the research building comes from the
   real direction, the lake roughens, cloud and fog dim the sun, and rain or snow falls past the
   camera. Everything eases toward the live values, so nothing jumps when they arrive or change.
   Rain and snow are one draw call each, animated entirely on the GPU (no per-frame CPU work),
   and are taken out of the scene when the sky is dry. */
const LIVE = { spin: 1, flow: 1, ux: 1, uz: 0, wx: 0, wz: 0, oc: 0, fog: 0, rain: 0, snow: 0, storm: 0, chop: 0 };
const LIVE_T = { ...LIVE };
if (window.__wx) window.__wx.on((d, x) => {
  if (!d) return;
  const ms = d.speed / 3.6, to = (d.dir + 180) * Math.PI / 180;
  const ex = Math.sin(to), sz = -Math.cos(to);                          // world +x is east, +z is south
  LIVE_T.spin = ms < 4 ? .2 + .3 * ms / 4 : Math.min(2.2, .5 + (ms - 4) * .19);   // idles below cut-in, then turns with the wind
  LIVE_T.flow = Math.max(.6, Math.min(1.8, .6 + ms * .14));
  if (ms > .5) { LIVE_T.ux = ex; LIVE_T.uz = sz; }
  LIVE_T.wx = ex * ms; LIVE_T.wz = sz * ms;
  LIVE_T.oc = x.overcast; LIVE_T.fog = x.fog; LIVE_T.storm = x.storm;
  LIVE_T.rain = x.kind === 'rain' ? x.rate : 0; LIVE_T.snow = x.kind === 'snow' ? x.rate : 0;
  LIVE_T.chop = Math.min(1, ms / 12);
});
// how much of the view is "Toronto": by where the camera is along the west → east story
const torontoWeight = (x) => smooth(470, 640, x) * (1 - smooth(1060, 1250, x));

function precipLayer(kind) {
  const streaks = kind === 'rain', N = streaks ? (phone ? 1800 : 4000) : (phone ? 1600 : 3200), per = streaks ? 4 : 1;
  const r = rng(streaks ? 71 : 73);
  const pos = new Float32Array(N * per * 3), end = new Float32Array(N * per), side = new Float32Array(N * per), rnd = new Float32Array(N * per);
  for (let i = 0; i < N; i++) {
    const a = r(), b = r(), c = r(), q = r();
    for (let e = 0; e < per; e++) { const k = i * per + e; pos[k * 3] = a; pos[k * 3 + 1] = b; pos[k * 3 + 2] = c; rnd[k] = q; end[k] = e >> 1; side[k] = e & 1 ? 1 : -1; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1)); g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  if (streaks) {                                       // each drop is a thin quad: head pair, tail pair
    const idx = new Uint32Array(N * 6);
    for (let i = 0; i < N; i++) { const v = i * 4; idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], i * 6); }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  const uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: streaks ? new THREE.Vector3(90, 70, 90) : new THREE.Vector3(70, 54, 70) },
    uVel: { value: new THREE.Vector3(0, -10, 0) }, uLen: { value: .5 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color('#fff') }, uScale: { value: 1 },
    uRes: { value: new THREE.Vector2(1, 1) }, uWidth: { value: 1.5 } };
  // world-anchored drops in a box that wraps around the camera: the camera flies through them, never drags them along
  const head = `uniform float uTime, uLen, uScale, uWidth; uniform vec2 uRes; uniform vec3 uCam, uBox, uVel; attribute float aEnd, aSide, aRnd; varying float vFade, vEnd, vSide;
    vec3 vel() { return uVel * (.85 + .3 * aRnd); }
    vec3 place() {
      vec3 p = position * uBox + vel() * uTime;
      ${streaks ? '' : 'p.x += sin(uTime * 1.3 + aRnd * 40.) * .7; p.z += cos(uTime * 1.1 + aRnd * 31.) * .7;'}
      p = uCam + mod(p - uCam + uBox * .5, uBox) - uBox * .5;
      vec3 q = abs(p - uCam) / (uBox * .5);
      vFade = 1. - smoothstep(.65, 1., max(q.x, max(q.y, q.z)));          // no popping at the edges of the box
      return p;
    }`;
  const streakMain = `void main(){
      vec3 h = place(), t = h - normalize(vel()) * uLen;
      vec4 ch = projectionMatrix * viewMatrix * vec4(h, 1.), ct = projectionMatrix * viewMatrix * vec4(t, 1.);
      vec2 sh = ch.xy / ch.w * uRes, st = ct.xy / ct.w * uRes, d = sh - st;
      vec2 n = normalize(vec2(-d.y, d.x) + 1e-5);
      vec4 c = aEnd > .5 ? ct : ch;
      c.xy += n * aSide * uWidth / uRes * c.w;                            // constant width on screen, in device pixels
      vEnd = aEnd; vSide = aSide;
      vFade *= smoothstep(1.5, 6., c.w);                                   // nothing smeared across the lens
      gl_Position = c;
    }`;
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: false,
    vertexShader: head + (streaks ? streakMain
      : 'void main(){ vec3 p = place(); vec4 mv = viewMatrix * vec4(p, 1.); gl_PointSize = clamp(uScale * (.6 + .8 * aRnd) / -mv.z, 1.5, 11.); vFade *= smoothstep(1.5, 5., -mv.z); gl_Position = projectionMatrix * mv; }'),
    fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; varying float vFade, vEnd, vSide; void main(){ float a = uAlpha * vFade; ' +
      (streaks ? 'a *= mix(1., .1, vEnd); ' : 'float d = length(gl_PointCoord - .5); a *= smoothstep(.5, .15, d); ') +
      'if (a < .004) discard; gl_FragColor = vec4(uColor, a); }',
  });
  const obj = streaks ? new THREE.Mesh(g, mat) : new THREE.Points(g, mat);
  obj.frustumCulled = false; obj.visible = false; obj.renderOrder = 5; scene.add(obj);
  return { obj, u: uniforms, N, per: streaks ? 6 : 1 };
}
const rain = precipLayer('rain'), snow = precipLayer('snow');
STORY.weather = { live: LIVE, target: LIVE_T };
let precipT = 0, flash = 0, hemiBase = 1.1, fogNear0 = 500;
const fogGrey = new THREE.Color();
function stepWeather(dt, w) {
  const k = 1 - Math.exp(-dt * .8);
  for (const key in LIVE_T) LIVE[key] += (LIVE_T[key] - LIVE[key]) * k;
  const n = Math.hypot(LIVE.ux, LIVE.uz) || 1; LIVE.ux /= n; LIVE.uz /= n;
  precipT += reduceMotion ? 0 : dt;
  for (const [L, amt] of [[rain, LIVE.rain], [snow, LIVE.snow]]) {
    const a = reduceMotion ? 0 : amt * w;
    L.obj.visible = a > .01;
    if (!L.obj.visible) continue;
    L.obj.geometry.setDrawRange(0, Math.ceil(L.N * Math.min(1, a * 1.25)) * L.per);
    L.u.uTime.value = precipT; L.u.uCam.value.copy(camera.position);
    if (L === rain) {
      L.u.uVel.value.set(LIVE.wx * .8, -11, LIVE.wz * .8); L.u.uLen.value = L.u.uVel.value.length() * .075;
      renderer.getDrawingBufferSize(L.u.uRes.value).multiplyScalar(.5); L.u.uWidth.value = .75 * dpr;   // half-width, in drawing-buffer pixels
      L.u.uColor.value.set(night ? '#A9BCD3' : '#E3E9EF'); L.u.uAlpha.value = (night ? .5 : .55) * Math.min(1, a * 3);
    } else {
      L.u.uVel.value.set(LIVE.wx * .55, -1.15, LIVE.wz * .55);
      L.u.uScale.value = (phone ? 120 : 150) * dpr; L.u.uColor.value.set(night ? '#DCE5F1' : '#FFFFFF'); L.u.uAlpha.value = (night ? .8 : .92) * Math.min(1, a * 3);
    }
  }
}
// applied after the time-of-day lighting each frame, so nothing accumulates
function weatherLight(dt, w) {
  const oc = LIVE.oc * w, fog = LIVE.fog * w;
  if (oc > .001 || fog > .001 || flash > .001) {
    sun.intensity *= 1 - .62 * oc;
    skyU.turbidity.value += (night ? .4 : 9) * oc; skyU.rayleigh.value *= 1 - (night ? .1 : .45) * oc;   // night haze stays dark, never brown
    scene.fog.color.lerp(fogGrey.set(night ? '#1A2330' : '#C3CAD1'), .55 * oc);
  }
  stars.material.opacity = night ? .9 * (1 - oc) : 0;
  scene.fog.near = mix(fogNear0, 40, fog) * (1 - .3 * oc); scene.fog.far = mix(mix(4200, 2600, oc), 700, fog);
  // thunderstorms: the odd flash lights everything for a moment
  if (!reduceMotion && LIVE.storm * w > .3 && Math.random() < dt * .09) flash = 1;
  flash = Math.max(0, flash - dt * 3.2);
  hemi.intensity = hemiBase * (1 - .25 * oc) + flash * 2.4;
  waterMat.normalScale.set(.12 + .2 * LIVE.chop * w, .12 + .2 * LIVE.chop * w);
}

/* ── 8. sky and light ─────────────────────────────────────────── */
const sky = new Sky(); sky.scale.setScalar(4400); scene.add(sky);
const skyU = sky.material.uniforms;
skyU.mieCoefficient.value = .004; skyU.mieDirectionalG.value = .82;
// the scene is lit and reflected by the same sky: re-baked whenever the time of day moves on
const pmrem = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), envSky = new Sky();
envSky.material = sky.material; envSky.scale.setScalar(4000); envScene.add(envSky);
let envKey = '';
const envCache = {};
function bakeEnv(key) {
  if (key === envKey || !envCache[key]) return; envKey = key;
  scene.environment = envCache[key].texture;
}
const sun = new THREE.DirectionalLight('#ffffff', 3.4); scene.add(sun, sun.target);
sun.castShadow = !phone;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -130, right: 130, top: 130, bottom: -130, near: 10, far: 1600 });
sun.shadow.bias = -.0004; sun.shadow.normalBias = 1.2;
const hemi = new THREE.HemisphereLight('#bcd4ea', '#6f7a5e', 1.1); scene.add(hemi);
scene.fog = new THREE.Fog('#dbe6ef', 900, 4200);

/* ── 9. camera shots, one per section ─────────────────────────── */
// pos = where the camera sits, look = what it looks at; light = the time of day there
const SHOTS = {
  'rockies':      { pos: [120, 95, 330],   look: [-380, 150, -80], light: 'dawn' },
  'calgary':      { pos: [345, 105, 190],  look: [200, 18, -6],    light: 'morning' },
  'calgary-lawn': { pos: [290, 42, 118],   look: [244, 6, 40],     light: 'morning' },
  'toronto':      { pos: [900, 120, 235],  look: [790, 42, 14],    light: 'day' },
  'campus':       { pos: [905, 118, 62],   look: [828, 6, -64],    light: 'day' },
  'turbine':      { pos: [846, 18, -26],   look: [822, 11, -52],   light: 'day' },
  'research':     { pos: [900, 42, 14],    look: [854, 14, -36],   light: 'afternoon' },
  'lake':         { pos: [690, 38, 205],   look: [792, 42, 28],    light: 'golden' },
  'delft':        { pos: [1418, 95, 170],  look: [1545, 12, 4],    light: 'soft' },
  'delft-stand':  { pos: [1630, 24, 98],   look: [1588, 10, 40],   light: 'soft' },
  'horizon':      { pos: [1770, 48, 70],   look: [2300, 60, -10],  light: 'sunrise' },
  'horizon-high': { pos: [1880, 110, 50],  look: [2400, 120, -20], light: 'sunrise' },
};
// phones (portrait): step back from the Rockies so the whole summit fits above the hero text.
// shotAt() lowers the aim on portrait screens by ~170 m at this distance, so the look y here ends up ~40.
if (innerWidth / innerHeight < .8) SHOTS.rockies = { pos: [230, 115, 480], look: [-380, 210, -80], light: 'dawn' };
// portrait screens are narrow: step every other view back along its line of sight so the subject isn't cropped at the sides
if (innerWidth / innerHeight < .8) for (const k in SHOTS) if (k !== 'rockies') {
  const sh = SHOTS[k], d = sh.pos.map((v, i) => v - sh.look[i]);
  sh.pos = sh.look.map((v, i) => v + d[i] * 1.45);
}
const LIGHTS = {
  dawn:      { turb: 5, ray: 2.6, top: '#5E7DB8', hor: '#F2C3A2', sun: '#FFC796', dir: [1, .22, .35], fog: '#E3CDBF', hemi: ['#C9D2E8', '#7A6F62'], int: 2.1 },
  morning:   { turb: 3.5, ray: 1.6, top: '#5C93CF', hor: '#DCE8F1', sun: '#FFF0D6', dir: [.6, .6, .45], fog: '#D7E3EC', hemi: ['#C3D7EC', '#7D7A5E'], int: 2.6 },
  day:       { turb: 3, ray: 1.2, top: '#4F8ACB', hor: '#D3E4F0', sun: '#FFF6E6', dir: [-.25, .85, .45], fog: '#D3E2ED', hemi: ['#C5DAEE', '#6E7A5E'], int: 2.7 },
  afternoon: { turb: 4.5, ray: 1.5, top: '#5687C0', hor: '#E2E3DE', sun: '#FFE7C2', dir: [-.6, .55, .4], fog: '#DCE2E4', hemi: ['#C8D8E8', '#7A735E'], int: 2.6 },
  golden:    { turb: 6, ray: 2.4, top: '#5F7FB4', hor: '#F4D2A6', sun: '#FFC27A', dir: [-.85, .2, .45], fog: '#EBD5BC', hemi: ['#D7CFD5', '#7C6C58'], int: 2.4 },
  soft:      { turb: 9, ray: 1.4, top: '#7B9EC2', hor: '#E3EAEE', sun: '#FFF3E2', dir: [-.4, .6, .5], fog: '#DDE6EB', hemi: ['#D2DEE9', '#78806A'], int: 2.2 },
  sunrise:   { turb: 5.5, ray: 3, top: '#3E5590', hor: '#F7A86B', sun: '#FF9C5A', dir: [1, .07, -.05], fog: '#E9B490', hemi: ['#B9B5D4', '#6F5B57'], int: 1.9 },
  night:     { turb: 1, ray: .2, top: '#040913', hor: '#17283F', sun: '#BFD0FF', dir: [.4, .6, -.3], fog: '#0F1B2B', hemi: ['#2A3F60', '#151C24'], int: .55 },
};
Object.keys(LIGHTS).forEach(k => { LIGHTS[k].key = k; });
const sections = STORY.sections, shotList = sections.map(s => SHOTS[s.dataset.shot] || SHOTS.rockies);
const camCurve = new THREE.CatmullRomCurve3(shotList.map(s => new THREE.Vector3(...s.pos)), false, 'centripetal', .5);
const lookCurve = new THREE.CatmullRomCurve3(shotList.map(s => new THREE.Vector3(...s.look)), false, 'centripetal', .5);
const lightOf = (i) => LIGHTS[shotList[Math.max(0, Math.min(shotList.length - 1, i))].light];

let night = false;
const tmpC = new THREE.Color(), tmpC2 = new THREE.Color(), tmpV = new THREE.Vector3();
function applyLight(u) {
  const i = Math.floor(u), f = smooth(0, 1, u - i);
  const a = night ? LIGHTS.night : lightOf(i), b = night ? LIGHTS.night : lightOf(i + 1);
  const lc = (k) => tmpC.set(a[k]).lerp(tmpC2.set(b[k]), f);
  sun.color.copy(lc('sun'));
  skyU.turbidity.value = mix(a.turb, b.turb, f); skyU.rayleigh.value = mix(a.ray, b.ray, f);
  scene.fog.color.copy(lc('fog'));
  const dir = tmpV.set(...a.dir).lerp(new THREE.Vector3(...b.dir), f).normalize();
  if (night) skyU.sunPosition.value.set(dir.x, -.12, dir.z); else skyU.sunPosition.value.copy(dir);
  bakeEnv(night ? 'night' : (f < .5 ? a : b).key);
  hemi.color.set(a.hemi[0]).lerp(tmpC2.set(b.hemi[0]), f); hemi.groundColor.set(a.hemi[1]).lerp(tmpC2.set(b.hemi[1]), f);
  sun.intensity = mix(a.int, b.int, f);
  return dir;
}
function setTheme() {
  night = document.documentElement.getAttribute('data-theme') === 'dark';
  lights.material.opacity = night ? 1 : 0; stars.material.opacity = night ? .9 : 0; winUniform.value = night ? 1 : 0;
  waterMat.color.set(night ? '#0B1824' : '#1C3A4E'); envKey = '';
  hemi.intensity = hemiBase = night ? .55 : .35; renderer.toneMappingExposure = night ? 1.1 : .62;
  windMat.uniforms.uBoost.value = night ? 1.5 : 1;
  scene.fog.near = fogNear0 = night ? 300 : 500;
}
setTheme();
new MutationObserver(setTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

/* ── 10. frame loop ───────────────────────────────────────────── */
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
const introFrom = new THREE.Vector3(...SHOTS.rockies.pos).add(new THREE.Vector3(320, 560, 520)), introLook = new THREE.Vector3(...SHOTS.rockies.look).add(new THREE.Vector3(60, -40, 40));
let uShown = STORY.u, film = 0, first = true;
const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
addEventListener('pointermove', e => { pointer.x = e.clientX / innerWidth - .5; pointer.y = e.clientY / innerHeight - .5; }, { passive: true });

// moves between shots arc up and over, like a drone, so long flights never cut through a skyline
const hopLift = shotList.map((s, i) => i < shotList.length - 1 ? Math.min(160, new THREE.Vector3(...s.pos).distanceTo(new THREE.Vector3(...shotList[i + 1].pos)) * .38) : 0);
function shotAt(u, pos, look) {
  const t = Math.min(1, Math.max(0, u / (shotList.length - 1)));
  camCurve.getPoint(t, pos); lookCurve.getPoint(t, look);
  const i = Math.min(shotList.length - 2, Math.floor(u)), f = u - i;
  pos.y += Math.sin(Math.PI * Math.min(1, Math.max(0, f))) * hopLift[i];
  pos.y = Math.max(pos.y, groundY(pos.x, pos.z) + 10, roofAt(pos.x, pos.z) + 12);
  if (innerWidth / innerHeight < .8) {                  // phones: lift the subject into the top half, above the text
    const d = pos.distanceTo(look); look.y -= d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * .42;
  }
}
const clock = new THREE.Clock();
let frameN = 0;
const lastShadowAt = new THREE.Vector3(1e9, 0, 0);
// resolution follows the device: if frames run slow it steps the pixel ratio down, and back up when there's headroom
// phones have 3x screens: below 1.5 the scene turns visibly pixelated, so that's the floor there
const DPR_MAX = Math.min(devicePixelRatio || 1, phone ? 2.5 : 2), DPR_MIN = Math.min(phone ? 1.5 : 1, DPR_MAX);
let dpr = Math.min(DPR_MAX, phone ? 2 : 1.75), slowT = 0, fastT = 0;
renderer.setPixelRatio(dpr);
function adapt(dt) {
  if (document.hidden || dt <= 0) return;
  if (dt > 1 / 38) { slowT += dt; fastT = 0; } else if (dt < 1 / 75) { fastT += dt; slowT = 0; } else { slowT = Math.max(0, slowT - dt); }
  if (slowT > .6 && dpr > DPR_MIN) { dpr = Math.max(DPR_MIN, dpr - .25); renderer.setPixelRatio(dpr); renderer.setSize(document.documentElement.clientWidth, document.documentElement.clientHeight, false); slowT = 0; }
  if (fastT > 3 && dpr < DPR_MAX) { dpr = Math.min(DPR_MAX, dpr + .25); renderer.setPixelRatio(dpr); renderer.setSize(document.documentElement.clientWidth, document.documentElement.clientHeight, false); fastT = 0; }
}
let worldTime = 0, phTO = 0, phWind = 0, phAir = 0, phWater = 0;
STORY.world = { speed: 0, place: 0 };
function frame() {
  requestAnimationFrame(frame);
  const realDt = Math.min(.25, clock.getDelta()), dt = Math.min(.05, realDt);   // easing uses real time so slow devices don't lag behind
  if (STORY.coverOpaque) { clock.getDelta(); return; }   // the cover is fully in front: draw nothing yet
  if (!STORY.sceneVisible && !first) return;            // nothing on screen to draw (phone reading a sheet)
  worldTime += reduceMotion ? 0 : dt;

  // ease toward the scroll position: critically damped, so fast flicks glide instead of jumping
  const k = reduceMotion ? 1 : 1 - Math.exp(-realDt * (window.__lenis ? 12 : 6));
  const prev = uShown;
  uShown += (STORY.u - uShown) * k;
  if (first) { uShown = STORY.u; first = false; }
  STORY.world.speed = Math.abs(uShown - prev) / Math.max(dt, 1e-3);
  STORY.world.u = uShown;

  shotAt(uShown, wantPos, wantLook);
  pointer.sx += (pointer.x - pointer.sx) * (1 - Math.exp(-dt * 2)); pointer.sy += (pointer.y - pointer.sy) * (1 - Math.exp(-dt * 2));
  camPos.copy(wantPos); camLook.copy(wantLook);
  if (!reduceMotion) {                                  // gentle hand-held drift and pointer parallax
    camPos.x += Math.sin(worldTime * .21) * 1.2 + pointer.sx * 6; camPos.y += Math.sin(worldTime * .17) * .8 - pointer.sy * 3;
  }
  // the way in: the camera starts high above the range and dives down to the first shot as the loader lifts
  const ip = STORY.introStart ? Math.min(1, (performance.now() - STORY.introStart) / (reduceMotion ? 1 : 2600)) : 0;
  if (ip < 1) {
    const e = 1 - Math.pow(1 - ip, 4);
    camPos.lerpVectors(introFrom, camPos, e); camLook.lerpVectors(introLook, camLook, e);
  }
  if (STORY.peek) { camPos.set(...STORY.peek[0]); camLook.set(...STORY.peek[1]); }
  camera.position.copy(camPos); camera.lookAt(camLook);

  // keep the subject in the open half of the screen while a reading column covers the left
  const wide = innerWidth > 860;
  const target = wide ? STORY.sheetCover + (1 - STORY.sheetCover) * .55 : 0;   // openers: nudge right of the title
  film += (target - film) * (1 - Math.exp(-realDt * 4));
  const fw = camera.getFilmWidth(), tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.filmOffset = -film * .25 * fw * 2 * tanH * camera.aspect;   // shift the view a quarter-width right
  camera.updateProjectionMatrix();

  const sunDir = applyLight(uShown);
  const tw = torontoWeight(camPos.x), mdt = reduceMotion ? 0 : dt;
  stepWeather(realDt, tw); weatherLight(realDt, tw);
  phTO += mdt * 1.6 * LIVE.spin; phAir += mdt * LIVE.flow; phWind += mdt * mix(1, LIVE.flow, tw); phWater += mdt * (1 + LIVE.chop * tw * 1.5);
  sun.position.copy(camLook).addScaledVector(sunDir, 700); sun.target.position.copy(camLook);
  sky.position.copy(camera.position); stars.position.copy(camera.position);

  // things that move
  windMat.uniforms.uTime.value = phWind; waterNormal.offset.set(phWater * .004, phWater * .0025);
  vawtTO.rotor.rotation.y = phTO; vawtNL.rotor.rotation.y = worldTime * 1.9;
  sails.rotation.z = -worldTime * .55;
  rotors.forEach(r => { r.rotor.rotation.z = worldTime * .9 + r.phase; });
  const mt = worldTime * .18, lane = Math.floor(mt) % 8, dir = lane % 2 ? -1 : 1, f = mt % 1;
  mower.position.set(P.lawn.x + ((lane % 6) - 2.5) * 1.4, mower.position.y, P.lawn.z + (dir > 0 ? -4 + f * 8 : 4 - f * 8)); mower.rotation.y = dir > 0 ? 0 : Math.PI;
  const rx = 700 + ((worldTime * 6) % 190); runner.position.set(rx, groundY(rx, shoreZ(rx) - 5) + 1.2, shoreZ(rx) - 5);
  updateAir(phAir, LIVE.ux, LIVE.uz);
  if (liftPath) {
    for (const ch of liftChairs) {
      const f = (ch.phase + worldTime * .01) % 1, up = f < .5, u = up ? f * 2 : 2 - f * 2;
      liftPath.getPoint(u, ch.c.position); ch.c.position.addScaledVector(liftChairs.side, up ? -1.9 : 1.9);
      ch.c.rotation.y = Math.atan2(liftChairs.dir.x, liftChairs.dir.z) + (up ? 0 : Math.PI);
    }
    for (const sk of skiers) {
      sk.t = (sk.t + dt * sk.speed) % 1;
      const run = sk.run, segs = run.length - 1, ft = sk.t * segs, i = Math.min(segs - 1, Math.floor(ft)), a = ft - i;
      const [ax, az] = run[i], [bx, bz] = run[i + 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
      const weave = Math.sin(sk.t * 60 + sk.phase) * 4, x = ax + dx * a - dz / l * weave, z = az + dz * a + dx / l * weave;
      sk.g.position.set(x, groundY(x, z) + .05, z); sk.g.rotation.y = Math.atan2(dx, dz) + Math.cos(sk.t * 60 + sk.phase) * .5;
    }
  }

  // shadows: re-render only when the view moved, plus a slow refresh for the spinning turbines
  frameN++;
  if (lastShadowAt.distanceToSquared(camLook) > .25 || frameN % 8 === 0) { renderer.shadowMap.needsUpdate = true; lastShadowAt.copy(camLook); }
  renderer.render(scene, camera);
  adapt(realDt);
}

// size to the page, not the pinch-zoomed visual viewport (iOS shrinks innerWidth while zoomed, which blurred the scene)
const VW = () => document.documentElement.clientWidth, VH = () => document.documentElement.clientHeight;
addEventListener('resize', () => {
  if (window.visualViewport && visualViewport.scale > 1.01) return;
  renderer.setSize(VW(), VH(), false); camera.aspect = VW() / VH(); camera.fov = camera.aspect < .8 ? 52 : 38; camera.updateProjectionMatrix();
});
for (const k of Object.keys(LIGHTS)) {                 // bake the sky lighting for each time of day
  const L = LIGHTS[k];
  skyU.turbidity.value = L.turb; skyU.rayleigh.value = L.ray;
  if (k === 'night') skyU.sunPosition.value.set(L.dir[0], -.12, L.dir[2]); else skyU.sunPosition.value.set(...L.dir).normalize();
  envCache[k] = pmrem.fromScene(envScene, 0, 1, 9000);
  await slice(.85 + .1 * Object.keys(envCache).length / 8);
}
renderer.compile(scene, camera);                     // compile every shader now, not on the first scroll
renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera);   // and draw one frame (shadows included) behind the cover
renderer.shadowMap.needsUpdate = true;
STORY.buildProgress = 1;
STORY.has3d = true;
document.body.classList.remove('no3d');
requestAnimationFrame(frame);
