/* ═══════════════════════════════════════════════════════════════════
   world.js · the 3D world behind index.html
   ─────────────────────────────────────────────────────────────────
   One continuous landscape laid out west → east, from the Rockies to
   the Dutch coast (the map is in world-terrain.js). A wind current
   threads through all of it. Each section of the page names a camera
   shot (data-shot); scrolling moves the camera along a spline through
   those shots.

   How it stays fast:
   • The land, its colours and the forests are computed on a second
     thread (world-worker.js) while the cover page animates.
   • Repeated objects are instanced; the ground is cut into tiles so
     only what the camera sees is drawn.
   • Before the cover lets anyone in, every shader is compiled and
     every mesh is sent to the graphics card, so nothing is prepared
     on the first click or the first scroll.
   • The picture is drawn at the screen's own resolution with edge
     smoothing; a governor lowers the resolution only while a device
     cannot keep up, and raises it again once it can.
   ═══════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { rng, noise, smooth, mix, PLACES, C0, ROADS, nearRoad, riverZ, shoreZ, SKI_RUNS, clear, sampler, generate, TREE_GREENS, TREE_LEAFY } from './world-terrain.js';

const STORY = window.__story;
// building the scene takes a moment; yield to the browser every ~8 ms so the cover page stays smooth
let sliceT = performance.now();
const yieldCh = new MessageChannel(), yieldQ = [];
yieldCh.port1.onmessage = () => { const r = yieldQ.shift(); if (r) r(); };
const breathe = () => new Promise(r => { yieldQ.push(r); yieldCh.port2.postMessage(0); });
const progress = { land: 0, scene: 0 };
const report = () => { STORY.buildProgress = Math.min(.99, .5 * progress.land + .5 * progress.scene); };
async function slice(sceneProgress) {
  if (sceneProgress != null) { progress.scene = sceneProgress; report(); }
  if (performance.now() - sliceT > 8) { await breathe(); await new Promise(r => setTimeout(r, 0)); sliceT = performance.now(); }
}
STORY.buildProgress = 0;
const canvas = document.getElementById('world');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = !!(window.__terrain && window.__terrain.phone);   // decided once, in the head of index.html
const VW = () => document.documentElement.clientWidth, VH = () => document.documentElement.clientHeight;   // the page, not the pinch-zoomed viewport

/* How much the graphics card can take. Integrated graphics (most thin laptops) spend as long smoothing
   edges as drawing the scene, so they get the 'low' tier: no multisampling, the simpler ground shader,
   lighter shadows. Dedicated and Apple graphics get everything. A device that turns out to struggle
   on the high tier is remembered (localStorage cl-gfx) and starts on the low one next time. */
const tier = (() => {
  let saved = null; try { saved = localStorage.getItem('cl-gfx'); } catch (e) {}
  if (saved === 'low' || saved === 'high') return saved;
  let name = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    const ext = gl.getExtension('WEBGL_debug_renderer_info'); name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
  } catch (e) {}
  return /Intel(?!.*Arc)|Radeon\(TM\) (Graphics|R\d|\d{3}M)|Radeon (Graphics|Vega|R\d )|Vega \d|Mali|Adreno|PowerVR|SwiftShader|llvmpipe|Basic Render|VMware|Software/i.test(name) ? 'low' : 'high';
})();
const lite = phone || tier === 'low';

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite, powerPreference: 'high-performance', stencil: false }); }
catch (e) { document.body.classList.add('no3d'); throw e; }
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = .62;
renderer.shadowMap.enabled = !phone;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;

/* Resolution. The scene is drawn at the screen's own pixel density (up to 2×) within a pixel budget,
   so a large high-density display doesn't ask the graphics card for more than it needs to look sharp. */
const PIXEL_BUDGET = phone ? 3.4e6 : lite ? 3e6 : 5.2e6;
const dprCeil = () => { const d = devicePixelRatio || 1; return Math.max(Math.min(d, 1), Math.min(d, phone ? 2.5 : 2, Math.sqrt(PIXEL_BUDGET / (VW() * VH())))); };
let DPR_MAX = dprCeil(), DPR_MIN = Math.min(DPR_MAX, phone ? 1.5 : Math.max(.85, DPR_MAX * .6)), dpr = DPR_MAX;
renderer.setPixelRatio(dpr);
renderer.setSize(VW(), VH(), false);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(VW() / VH() < .8 ? 52 : 38, VW() / VH(), 1, 5000);

/* ── 1. the land, from the worker ─────────────────────────────── */
// Messages arrive in order: heights, detail, terrain, trees. land('heights') waits for that part.
const land = (() => {
  const T = window.__terrain || { queue: [], failed: true }, got = {}, want = {};
  const take = (m) => {
    if (m.type === 'progress') { progress.land = m.value; report(); return; }
    got[m.type] = m; if (want[m.type]) want[m.type](m);
  };
  const here = () => generate({ phone }, take, slice);              // no worker: build on this thread, in slices
  if (T.failed || !T.worker) here();
  else { T.queue.forEach(take); T.on = (m) => { if (m.type === 'error') { T.on = null; here(); } else take(m); }; }
  return (type) => got[type] ? Promise.resolve(got[type]) : new Promise(r => { want[type] = r; });
})();

const P = Object.fromEntries(Object.entries(PLACES).map(([k, [x, z]]) => [k, new THREE.Vector3(x, 0, z)]));
const C = (h) => new THREE.Color(h);
const heights = await land('heights');
const groundY = sampler(heights.HG, heights.NX, heights.NZ, heights.CELL);
const dataTexture = (data, size) => {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = Math.min(lite ? 2 : 4, renderer.capabilities.getMaxAnisotropy()); t.needsUpdate = true;
  return t;
};

/* ── 2. the ground ────────────────────────────────────────────── */
/* The mesh carries a base colour per vertex. Everything finer is done per pixel: a rock detail
   texture is projected from three sides (so cliffs aren't smeared), it bends the surface normal to
   give crags and ledges their own light and shade, layers the rock into strata, darkens crevices,
   and lets snow settle on whatever faces up. Texture lookups are mip-mapped, so nothing shimmers
   in the distance. Phones and integrated graphics use the coarse scale only. */
const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .93, metalness: 0, envMapIntensity: .6 });
const terrainDetail = { value: null };
const glsl = (hex) => { const c = C(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
const pick = (list, v) => list.slice(0, -1).reduceRight((rest, hex, i) => `${v} < ${((i + 1) / list.length).toFixed(4)} ? ${glsl(hex)} : (${rest})`, glsl(list[list.length - 1]));
terrainMat.onBeforeCompile = (sh) => {
  sh.uniforms.uDetail = terrainDetail;
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTW; varying vec3 vTN;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vTW = (modelMatrix * vec4(transformed, 1.)).xyz; vTN = normalize(mat3(modelMatrix) * objectNormal);');
  sh.fragmentShader = (lite ? '#define TERRAIN_LITE\n' : '') + sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D uDetail; varying vec3 vTW; varying vec3 vTN;`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      vec3 tN = normalize(vTN);
      vec3 tBlend = pow(abs(tN), vec3(4.)); tBlend /= tBlend.x + tBlend.y + tBlend.z;
      float tWide = texture2D(uDetail, vTW.xz * .0023).a;                 // soft noise, 400 m across
      // seen from the side the rock is layered: the detail is stretched along the beds, which dip and wander a little
      float tBed = vTW.y + tWide * 26. + (vTW.x - vTW.z) * .06;
      vec4 dX = texture2D(uDetail, vec2(vTW.z * .014, tBed * .058)), dZ = texture2D(uDetail, vec2(vTW.x * .014, tBed * .058)), dY = texture2D(uDetail, vTW.xz * .031);
      vec2 bX = (dX.rg * 2. - 1.) * vec2(.45, 1.7), bZ = (dZ.rg * 2. - 1.) * vec2(.45, 1.7), bY = dY.rg * 2. - 1.;
      #ifndef TERRAIN_LITE
        vec4 eX = texture2D(uDetail, vTW.zy * .131 + .37), eZ = texture2D(uDetail, vTW.xy * .131 + .37), eY = texture2D(uDetail, vTW.xz * .131 + .37);
        bX += (eX.rg * 2. - 1.) * .55; bZ += (eZ.rg * 2. - 1.) * .55; bY += (eY.rg * 2. - 1.) * .55;
        dX.b = mix(dX.b, eX.b, .35); dZ.b = mix(dZ.b, eZ.b, .35); dY.b = mix(dY.b, eY.b, .35);
      #endif
      vec3 tBump = tBlend.x * vec3(0., bX.y, bX.x) + tBlend.y * vec3(bY.x, 0., bY.y) + tBlend.z * vec3(bZ.x, bZ.y, 0.);
      float tCrag = dot(tBlend, vec3(dX.b, dY.b, dZ.b));                 // height of the detail: 1 on ledges and ridges, 0 in crevices
      float tGrain = dY.a;
      float tSteep = 1. - smoothstep(.5, .72, tN.y);
      float tRockies = 1. - smoothstep(-260., -140., vTW.x);
      float tGroomed = smoothstep(.78, .88, min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b));   // ski runs
      // prairie: a patchwork of fields 24 m square, each ploughed one way or the other, with a track between them
      {
        vec2 fc = vTW.xz / 24., fi = floor(fc), ff = fract(fc);
        float fh = fract(sin(dot(fi, vec2(127.1, 311.7))) * 43758.5453), fh2 = fract(fh * 57.31);
        vec3 crop = ${pick(['#B5A06A', '#A69458', '#939D63', '#C1AD7B', '#899659', '#AE9E6B'], 'fh')};
        vec2 along = fh2 > .5 ? vTW.xz : vTW.zx;
        crop *= .88 + .24 * texture2D(uDetail, vec2(along.y * .21, along.x * .006)).b;
        float edge = min(min(ff.x, 1. - ff.x), min(ff.y, 1. - ff.y)) * 24., aa = fwidth(edge) + .001;
        crop = mix(crop, ${glsl('#6F7448')}, (1. - smoothstep(.7 - aa, .7 + aa, edge)) * min(1., .9 / aa));
        float amt = smoothstep(-10., 150., vTW.x) * (1. - smoothstep(390., 550., vTW.x)) * smoothstep(138., 146., distance(vTW.xz, vec2(170., -50.))) * smoothstep(.3, 1.4, vTW.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, crop, amt);
      }
      // the Netherlands: tulip fields in rows, one colour to a block
      {
        float block = floor((vTW.x - 1400.) / 44.) + floor((vTW.z + 400.) / 58.) * 7., bi = fract(block / 5.);
        vec3 tulip = ${pick(['#C2453D', '#D9B43A', '#D07C9C', '#E6E1D6', '#AE3C7E'], 'bi')};
        float row = abs(fract(vTW.x / 3.2) - .5) * 3.2, aa = fwidth(row) + .001;
        float bloom = (1. - smoothstep(.55 - aa, .55 + aa, row)) * min(1., 1.4 / aa) + .42 * (1. - min(1., 1.4 / aa));
        float amt = step(1446., vTW.x) * step(vTW.x, 1708.5) * step(66., vTW.z) * step(vTW.z, 180.5) * smoothstep(.3, 1., vTW.y);   // six blocks by two, canal to canal
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(${glsl('#4C7A38')}, tulip * (.9 + .2 * tGrain), bloom), amt);
      }
      diffuseColor.rgb *= .86 + .28 * mix(tGrain, tCrag, .45);
      // rock: grey limestone beds, lighter and darker, shaded into the crevices
      float tBands = texture2D(uDetail, vec2(tBed * .0061, tBed * .0019 + .21)).a;
      vec3 tRock = mix(vec3(.15, .15, .16), vec3(.39, .37, .34), smoothstep(.3, .7, tBands)) * mix(.55, 1.12, smoothstep(.1, .8, tCrag));
      // snow: above a wandering snow line it settles on ledges and gentle ground; rock shows through where it is steep
      float tUp = normalize(tN + tBump * 1.1).y;
      float tLine = 78. + tWide * 60.;
      float tSnow = smoothstep(tLine - 7., tLine + 7., vTW.y + (tCrag - .5) * 14.) * smoothstep(.38, .6, tUp);
      tSnow = max(tSnow, smoothstep(.78, .92, tUp) * smoothstep(66., 120., vTW.y) * .9);
      tSnow = max(tSnow, tGroomed) * tRockies;
      float tRockAmt = tSteep * tRockies * (1. - tGroomed);
      diffuseColor.rgb = mix(diffuseColor.rgb, tRock, tRockAmt);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.93, .95, .97) * (.93 + .07 * tGrain), tSnow);
      vec3 tWorldN = normalize(tN + tBump * mix(.45 + .4 * tSteep, 1.15, tRockAmt) * mix(1., .25, tSnow));`)
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n      normal = normalize((viewMatrix * vec4(tWorldN, 0.)).xyz);')
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n      roughnessFactor = mix(roughnessFactor, .78, tSnow);');
};
async function addTerrain() {
  const detail = await land('detail');
  terrainDetail.value = dataTexture(detail.data, detail.size);
  waterMat.normalMap = waterNormal = dataTexture(detail.water, detail.waterSize); waterNormal.repeat.set(200, 80);
  const { tiles } = await land('terrain');
  for (const t of tiles) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(t.position, 3)); g.setAttribute('normal', new THREE.BufferAttribute(t.normal, 3));
    g.setAttribute('color', new THREE.BufferAttribute(t.color, 3)); g.setIndex(new THREE.BufferAttribute(t.index, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(t.sphere[0], t.sphere[1], t.sphere[2]), t.sphere[3]);
    const m = new THREE.Mesh(g, terrainMat); m.castShadow = m.receiveShadow = true; m.matrixAutoUpdate = false; scene.add(m);
  }
}

/* ── 3. water ─────────────────────────────────────────────────── */
let waterNormal = null;                                // the ripple texture arrives with the terrain (addTerrain)
const waterMat = new THREE.MeshStandardMaterial({ color: '#1C3A4E', roughness: .1, metalness: 0, normalScale: new THREE.Vector2(.12, .12), envMapIntensity: 1.25 });
const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 2400), waterMat);
water.rotation.x = -Math.PI / 2; water.position.set(350, 0, 0); scene.add(water);

/* ── 4. trees, instanced ──────────────────────────────────────── */
function colorize(g, col) { const n = g.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); return g; }
const soft = g => g.index ? g.toNonIndexed() : g;   // unshared vertices, normals kept smooth
const flat = g => { const n = soft(g); n.computeVertexNormals(); return n; };
// trunks keep their own colour; crowns are white, so each tree's instance colour tints them
function coniferGeo() {                 // a spruce: three drooping tiers of boughs
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
const TREE_COLORS = [...TREE_GREENS, ...TREE_LEAFY].map(C), CONIFER = coniferGeo(), BROADLEAF = broadleafGeo();
// list: six numbers per tree (x, y, z, scale, turn, colour index). One instanced mesh per 160 m tile, so only the tiles in view are drawn.
function plant(geo, list) {
  const tiles = new Map();
  for (let i = 0; i < list.length; i += 6) { const k = Math.floor(list[i] / 160) + ':' + Math.floor(list[i + 2] / 160); if (!tiles.has(k)) tiles.set(k, []); tiles.get(k).push(i); }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler(), v = new THREE.Vector3();
  tiles.forEach(items => {
    const im = new THREE.InstancedMesh(geo, treeMat, items.length);
    items.forEach((o, i) => { e.set(0, list[o + 4], 0); q.setFromEuler(e); s.setScalar(list[o + 3]); m.compose(v.set(list[o], list[o + 1] - .3, list[o + 2]), q, s); im.setMatrixAt(i, m); im.setColorAt(i, TREE_COLORS[list[o + 5]]); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere(); im.receiveShadow = true; im.matrixAutoUpdate = false; scene.add(im);
  });
}
async function addForests() { const t = await land('trees'); plant(CONIFER, t.conifers); plant(BROADLEAF, t.broadleaf); }

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
function addBox(x, z, w, d, h, color, rot = 0) {
  const y = groundY(x, z) - .5;
  boxes.push({ x, y, z, w, d, h, color: C(color), rot });
  if (h > 26) boxes.push({ x, y: y + h - .1, z, w: w * .42, d: d * .4, h: 1.6 + h * .018, color: C(color).lerp(C('#8E9398'), .45), rot });   // rooftop plant room (plain metal cladding)
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
  const slate = C('#4B4F53');
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
      addBox(x, zRow, w, 9, h, brick[Math.floor(r() * brick.length)]);
      roofs.push({ x, y: groundY(x, zRow) + h - .5, z: zRow, w: w + .1, d: 9.2, h: 4 + r() * 1.5, rot: 0, c: C('#3A3634') });
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

await slice(0.1);
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
  const r = rng(61), list = [];
  for (let k = 0; k < 160; k++) {
    const [x, z, a, b] = [[720, 122, 60, 9], [790, 128, 45, 7], [850, 118, 40, 10]][k % 3], t = r() * Math.PI * 2, d = Math.sqrt(r()) * .8;
    list.push(x + Math.cos(t) * a * d, 1, z + Math.sin(t) * b * d, .45 + r() * .3, r() * 6, 4 + k % 3);
  }
  plant(BROADLEAF, list);
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
await slice(0.2);
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
await slice(0.26);
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
await slice(0.32);
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

await slice(0.38);
/* ── 7. the wind current ──────────────────────────────────────── */
const WIND_PTS = [
  [-470, 330, -70], [-360, 240, 10], [-230, 150, 60], [-60, 90, 40], [80, 70, 0], [186, 70, -32], [236, 30, 50], [330, 50, 20],
  [520, 75, -10], [680, 85, 10], [760, 82, 36], [790, 40, 0], [822, 16, -48], [852, 30, -76], [880, 26, 10], [800, 14, 70], [700, 30, 90],
  [960, 60, 70], [1180, 80, 10], [1380, 55, -20], [1470, 26, -18], [1560, 30, 12], [1592, 16, 46], [1690, 40, 30], [1830, 70, 20], [2100, 120, 0], [2500, 170, -20],
].map(([x, y, z]) => new THREE.Vector3(x, y, z));
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
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'centripetal', .5), 900, .045 + r() * .035, 3, false);
    const phase = new Float32Array(g.attributes.position.count).fill(r());
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1)); geos.push(g);
    await slice();
  }
  scene.add(new THREE.Mesh(mergeGeometries(geos), windMat));
}

scene.traverse(o => { if (o.isMesh && o !== water && !o.isInstancedMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });

await slice(0.46);
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

await slice(0.52);
/* ── 8. sky and light ─────────────────────────────────────────── */
const sky = new Sky(); sky.scale.setScalar(4400); scene.add(sky);
const skyU = sky.material.uniforms;
skyU.mieCoefficient.value = .004; skyU.mieDirectionalG.value = .82;
// the scene is lit and reflected by the same sky: re-baked whenever the time of day moves on
const pmrem = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), envSky = new Sky();
envSky.material = sky.material; envSky.scale.setScalar(4000); envScene.add(envSky);
let envKey = '';
const envCache = {};
function bakeEnv(key) {                                 // use the sky lighting baked for this time of day (once it exists)
  if (key === envKey || !envCache[key]) return; envKey = key;
  scene.environment = envCache[key].texture;
}
const sun = new THREE.DirectionalLight('#ffffff', 3.4); scene.add(sun, sun.target);
sun.castShadow = !phone;
sun.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
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
if (camera.aspect < .8) SHOTS.rockies = { pos: [230, 115, 480], look: [-380, 210, -80], light: 'dawn' };
// portrait screens are narrow: step every other view back along its line of sight so the subject isn't cropped at the sides
if (camera.aspect < .8) for (const k in SHOTS) if (k !== 'rockies') {
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
const tmpC = new THREE.Color(), tmpC2 = new THREE.Color(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
function applyLight(u) {
  const i = Math.floor(u), f = smooth(0, 1, u - i);
  const a = night ? LIGHTS.night : lightOf(i), b = night ? LIGHTS.night : lightOf(i + 1);
  const lc = (k) => tmpC.set(a[k]).lerp(tmpC2.set(b[k]), f);
  sun.color.copy(lc('sun'));
  skyU.turbidity.value = mix(a.turb, b.turb, f); skyU.rayleigh.value = mix(a.ray, b.ray, f);
  scene.fog.color.copy(lc('fog'));
  const dir = tmpV.set(a.dir[0], a.dir[1], a.dir[2]).lerp(tmpV2.set(b.dir[0], b.dir[1], b.dir[2]), f).normalize();
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

await slice(0.56);
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
  if (camera.aspect < .8) {                             // phones: lift the subject into the top half, above the text
    const d = pos.distanceTo(look); look.y -= d * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * .42;
  }
}

/* The resolution governor. It watches for missed frames rather than an absolute frame rate, so it
   behaves the same on 60, 90 and 120 Hz screens. If more than a third of the frames in a second
   arrive late (or the rate falls under 45 a second), the resolution steps down. After four clean
   seconds it steps back up; if that step proves too much, that level is ruled out for a minute (then
   four, then sixteen), so the picture never flips back and forth. */
const gov = { base: 1 / 60, prev: 0, late: 0, n: 0, win: 0, clean: 0, cap: DPR_MAX, capUntil: 0, strikes: 0, raisedAt: -1e9, quietUntil: 0 };
function setDpr(v) { dpr = v; renderer.setPixelRatio(dpr); renderer.setSize(VW(), VH(), false); }
function govern(dt, now) {
  if (document.hidden || dt <= 0 || dt > .25 || now < gov.quietUntil) { gov.late = gov.n = gov.win = gov.prev = 0; return; }
  if (gov.prev) gov.base = Math.min(gov.base, Math.max(1 / 240, (dt + gov.prev) / 2));   // the screen's own frame time: the fastest pair of frames seen
  gov.prev = dt; gov.n++; gov.win += dt; if (dt > gov.base * 1.6) gov.late++;
  if (gov.win < 1) return;
  const lateShare = gov.late / gov.n, rate = gov.n / gov.win; gov.late = gov.n = gov.win = 0;
  if (now > gov.capUntil) gov.cap = DPR_MAX;
  if ((lateShare > .34 || rate < 45) && dpr > DPR_MIN) {
    if (now - gov.raisedAt < 6000) { gov.cap = Math.max(DPR_MIN, dpr - .25); gov.capUntil = now + 60000 * Math.pow(4, gov.strikes++); }   // 1 min, then 4, then 16…
    setDpr(Math.max(DPR_MIN, dpr - .25)); gov.clean = 0; gov.quietUntil = now + 400;
    if (tier === 'high' && !phone && dpr <= DPR_MIN + .01) try { localStorage.setItem('cl-gfx', 'low'); } catch (e) {}   // too much for this device: start lighter next time
  } else if (lateShare < .04 && rate > 50) {
    if (++gov.clean >= 4 && dpr < Math.min(DPR_MAX, gov.cap)) { setDpr(Math.min(DPR_MAX, gov.cap, dpr + .25)); gov.clean = 0; gov.raisedAt = now; gov.quietUntil = now + 400; }
  } else gov.clean = 0;
}

const clock = new THREE.Clock();
let frameN = 0, worldTime = 0, phTO = 0, phWind = 0, phAir = 0, phWater = 0;
const lastShadowAt = new THREE.Vector3(1e9, 0, 0);
STORY.world = { speed: 0, place: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min(.25, clock.getDelta()), dt = Math.min(.05, realDt);   // easing uses real time so slow devices don't lag behind
  if (STORY.coverOpaque) return;                        // the cover is fully in front: draw nothing yet
  if (!STORY.sceneVisible && !first) return;            // nothing on screen to draw (phone reading a sheet)
  worldTime += reduceMotion ? 0 : dt;

  // ease toward the scroll position: critically damped, so fast flicks glide instead of jumping
  const k = reduceMotion ? 1 : 1 - Math.exp(-realDt * (window.__lenis ? 12 : 6));
  const prev = uShown;
  uShown += (STORY.u - uShown) * k;
  if (first) { uShown = STORY.u; first = false; gov.quietUntil = now + 3200; }   // don't judge the device by the way in
  STORY.world.speed = Math.abs(uShown - prev) / Math.max(dt, 1e-3);
  STORY.world.u = uShown;

  shotAt(uShown, wantPos, wantLook);
  pointer.sx += (pointer.x - pointer.sx) * (1 - Math.exp(-dt * 2)); pointer.sy += (pointer.y - pointer.sy) * (1 - Math.exp(-dt * 2));
  camPos.copy(wantPos); camLook.copy(wantLook);
  if (!reduceMotion) {                                  // gentle hand-held drift and pointer parallax
    camPos.x += Math.sin(worldTime * .21) * 1.2 + pointer.sx * 6; camPos.y += Math.sin(worldTime * .17) * .8 - pointer.sy * 3;
  }
  // the way in: the camera starts high above the range and dives down to the first shot as the cover lifts
  const ip = STORY.introStart ? Math.min(1, (performance.now() - STORY.introStart) / (reduceMotion ? 1 : 2600)) : 0;
  if (ip < 1) {
    const e = 1 - Math.pow(1 - ip, 4);
    camPos.lerpVectors(introFrom, camPos, e); camLook.lerpVectors(introLook, camLook, e);
  }
  if (STORY.peek) { camPos.set(...STORY.peek[0]); camLook.set(...STORY.peek[1]); }
  camera.position.copy(camPos); camera.lookAt(camLook);

  // keep the subject in the open half of the screen while a reading column covers the left
  const target = VW() > 860 ? STORY.sheetCover + (1 - STORY.sheetCover) * .55 : 0;   // openers: nudge right of the title
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
  if (tw > .01) updateAir(phAir, LIVE.ux, LIVE.uz);
  if (camPos.x < 150) {                                 // the ski hill, while it can be seen
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
  if ((lastShadowAt.distanceToSquared(camLook) > .25 && frameN % (lite ? 3 : 1) === 0) || frameN % 8 === 0) { renderer.shadowMap.needsUpdate = true; lastShadowAt.copy(camLook); }
  renderer.render(scene, camera);
  govern(realDt, now);
}

addEventListener('resize', () => {
  if (window.visualViewport && visualViewport.scale > 1.01) return;   // pinch-zoom: keep the scene as it is
  const was = DPR_MAX; DPR_MAX = dprCeil(); DPR_MIN = Math.min(DPR_MAX, phone ? 1.5 : Math.max(.85, DPR_MAX * .6));
  dpr = Math.max(DPR_MIN, Math.min(DPR_MAX, dpr === was ? DPR_MAX : dpr)); renderer.setPixelRatio(dpr);
  renderer.setSize(VW(), VH(), false); camera.aspect = VW() / VH(); camera.fov = camera.aspect < .8 ? 52 : 38; camera.updateProjectionMatrix();
});

/* ── 11. getting ready ────────────────────────────────────────────
   Everything below happens behind the cover, in small steps, so that the click on "Enter" and the
   first scroll have nothing left to prepare. */
await addTerrain(); await slice(.62);
await addForests(); await slice(.68);

// the sky lighting for the time of day at the start; the other times of day are baked afterwards
const bakeLight = (k) => {
  const L = LIGHTS[k];
  skyU.turbidity.value = L.turb; skyU.rayleigh.value = L.ray;
  if (k === 'night') skyU.sunPosition.value.set(L.dir[0], -.12, L.dir[2]); else skyU.sunPosition.value.set(...L.dir).normalize();
  envCache[k] = pmrem.fromScene(envScene, 0, 1, 9000);
};
bakeLight(night ? 'night' : lightOf(Math.floor(STORY.u)).key); await slice(.72);
shotAt(STORY.u, camPos, camLook); camera.position.copy(camPos); camera.lookAt(camLook);
applyLight(STORY.u);                                   // sets the environment, so shaders are compiled once, in their final form

// compile every shader now (rain and snow included), without holding up the page where the browser allows
const hidden = [rain.obj, snow.obj]; hidden.forEach(o => { o.visible = true; });
if (renderer.compileAsync) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera);
await slice(.8);

// send every mesh and texture to the graphics card, a few at a time, drawing into a single pixel
{
  const all = []; scene.traverse(o => { if (o.isMesh || o.isPoints) all.push(o); });
  const state = all.map(o => [o.visible, o.frustumCulled]);
  all.forEach(o => { o.visible = false; o.frustumCulled = false; });
  renderer.setScissorTest(true); renderer.setScissor(0, 0, 1, 1);
  const STEP = 24;
  for (let i = 0; i < all.length; i += STEP) {
    for (let k = i; k < Math.min(all.length, i + STEP); k++) all[k].visible = true;
    renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera);
    for (let k = i; k < Math.min(all.length, i + STEP); k++) all[k].visible = false;
    await slice(.8 + .18 * i / all.length);
  }
  renderer.setScissorTest(false);
  all.forEach((o, i) => { o.visible = state[i][0]; o.frustumCulled = state[i][1]; });
  hidden.forEach(o => { o.visible = false; });
}
/* Real frames from where the way in begins, timed on the graphics card itself (without making the page
   wait for it). The first frame after the click is then already warm, and the scene starts at a
   resolution this device can hold at full speed instead of finding out by stuttering. */
camera.position.copy(introFrom); camera.lookAt(introLook);
sun.position.copy(introLook).addScaledVector(applyLight(STORY.u), 700); sun.target.position.copy(introLook); sky.position.copy(camera.position);
{
  const gl = renderer.getContext(); let worst = 0;
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now();
    renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera);
    if (!gl.fenceSync) break;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); gl.flush();
    while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED && performance.now() - t0 < 500) await breathe();
    gl.deleteSync(sync);
    if (i > 1) worst = Math.max(worst, performance.now() - t0);        // the first two frames still carry set-up work
  }
  STORY.gpuFrameMs = worst;
  if (worst > 11.5 && dpr > DPR_MIN) setDpr(Math.max(DPR_MIN, Math.round(dpr * Math.sqrt(11.5 / worst) * 8) / 8));
}
await slice(1);

STORY.buildProgress = 1;
STORY.has3d = true;
STORY.debug = { renderer, scene, camera, tier, get dpr() { return dpr; }, gov };
document.body.classList.remove('no3d');
requestAnimationFrame(frame);

// the remaining times of day, one at a time, while the visitor is still looking at the cover
for (const k of Object.keys(LIGHTS)) {
  if (envCache[k]) continue;
  await new Promise(r => setTimeout(r, 140));
  bakeLight(k); envKey = '';
}
