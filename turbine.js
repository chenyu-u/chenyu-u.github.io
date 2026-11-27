/* ═══════════════════════════════════════════════════════════════════
   turbine.js · the 3D build behind the home page (index.html)

   One horizontal-axis wind turbine, drawn like a CAD model: clean materials with thin outlines,
   on a plain studio floor with a faint grid. The story is how it goes up:
     0  every part laid out on site, with the finished turbine drawn as a faint outline
     1  foundation  poured in place
     2  tower       three steel sections, lifted one onto the next
     3  drivetrain  the bedplate with bearing, shaft, gearbox, brake and generator
     4  nacelle     the cover over the machinery
     5  hub         cast hub, pitch bearings and nose cone
     6  blades      three blades, one at a time
     7  running     the rotor turns
   A crawler crane does every lift (up, across, down) as the visitor scrolls between
   text blocks. window.__home.u (0…7) comes from index.html. Labels name the parts still to
   go up, and a detail view shows the nacelle close up while it is being built.
   It only draws when something changes, or while the rotor turns.
═══════════════════════════════════════════════════════════════════ */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const H = window.__home, S = window.__story || {};
const canvas = document.getElementById('turbine');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = Math.min(innerWidth, innerHeight), phone = small < 480 || (small < 640 && matchMedia('(pointer: coarse)').matches);
const tier = (() => {
  try { const o = localStorage.getItem('cl-gfx'); if (o === 'low' || o === 'high') return o; } catch (e) {}
  let name = '';
  try { const gl = document.createElement('canvas').getContext('webgl'); const ext = gl && gl.getExtension('WEBGL_debug_renderer_info'); name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''; } catch (e) {}
  return /Intel(?!.*Arc)|Radeon\(TM\) (Graphics|R\d|\d{3}M)|Radeon (Graphics|Vega|R\d )|Vega \d|Mali|Adreno|PowerVR|SwiftShader|llvmpipe|Basic Render|VMware|Software/i.test(name) ? 'low' : 'high';
})();
const lite = phone || tier === 'low';

let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (e) { document.body.classList.add('no3d'); S.has3d = true; throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, lite ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = !phone;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), .04).texture;
scene.environmentIntensity = .55;
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, .5, 900);
const dcam = new THREE.PerspectiveCamera(28, 1.4, .2, 300);   // the detail view

/* ── materials ── */
const std = (color, roughness, metalness) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const M = {
  comp: std(0xF3F5F7, .4, .03),     // glass-fibre composite: blades, nose cone
  paint: std(0xE9ECEF, .5, .08),    // painted steel: tower
  steel: std(0xAAB1B9, .34, .8),    // machined steel
  cast: std(0x8E969F, .55, .5),     // castings: hub, main bearing housing
  dark: std(0x4E5660, .55, .4),     // bedplate, door, fittings
  slate: std(0x5A6571, .5, .3),     // generator housing
  red: std(0xC0392B, .5, .1),       // aviation lights, brake calliper
  concrete: std(0xCDD1D5, .95, 0),
  cradle: std(0x737980, .85, 0)
};
const coverMat = M.comp.clone(); coverMat.transparent = true;   // the nacelle cover turns see-through once fitted
const cyl = (rt, rb, h, n = 48) => new THREE.CylinderGeometry(rt, rb, h, n);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const alongX = (m) => { m.rotation.z = Math.PI / 2; return m; };

/* Every part is built twice by the same function: once solid (with an outline), once as a faint
   outline only, standing where it will end up. ctx.ghost says which. */
const edgeCache = new WeakMap();
const edgesOf = (geo) => { let e = edgeCache.get(geo); if (!e) { e = new THREE.EdgesGeometry(geo, 28); edgeCache.set(geo, e); } return e; };
function add(ctx, geo, mat, parent, x = 0, y = 0, z = 0, opt = {}) {
  if (opt.detail && (ctx.ghost || lite)) return new THREE.Object3D();
  let o;
  if (ctx.ghost) { o = new THREE.Mesh(geo, ctx.fill); if (opt.edges !== false) o.add(new THREE.LineSegments(edgesOf(geo), ctx.line)); }
  else {
    o = new THREE.Mesh(geo, mat); o.castShadow = !phone && opt.shadow !== false; o.receiveShadow = !phone;
    if (opt.edges !== false) o.add(new THREE.LineSegments(edgesOf(geo), ctx.line));
  }
  o.position.set(x, y, z); parent.add(o); return o;
}
function boltRing(ctx, parent, r, y, n, size, mat) {
  const geo = cyl(size, size, size * 1.4, 6), group = new THREE.Group();
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; add(ctx, geo, mat, group, Math.cos(a) * r, 0, Math.sin(a) * r, { detail: true, edges: false, shadow: false }); }
  group.position.y = y; parent.add(group); return group;
}

/* ── geometry ── */
function bladeGeometry(L, rootD, maxChord, tipChord) {
  const N = lite ? 40 : 56, P = lite ? 28 : 40, pos = [], idx = [];
  const naca = (x, t) => 5 * t * (.2969 * Math.sqrt(x) - .126 * x - .3516 * x * x + .2843 * x ** 3 - .1036 * x ** 4);
  for (let i = 0; i <= N; i++) {
    const s = i / N, y = s * L;
    const chord = s < .2 ? rootD + (maxChord - rootD) * Math.sin(s / .2 * Math.PI / 2) : maxChord + (tipChord - maxChord) * ((s - .2) / .8) ** .75;
    const t = s < .2 ? .9 - .6 * (s / .2) : .3 - .15 * ((s - .2) / .8);
    const round = Math.max(0, Math.min(1, 1 - (s - .025) / .12));
    const twist = THREE.MathUtils.degToRad(14 * (1 - s) ** 1.8);
    const camber = .03 * (1 - round);
    for (let j = 0; j < P; j++) {
      const th = j / P * Math.PI * 2, xc = (1 - Math.cos(th)) / 2, up = th < Math.PI ? 1 : -1;
      let ax = (xc - .3) * chord, az = (up * naca(Math.max(1e-4, xc), t) + camber * 4 * xc * (1 - xc)) * chord;
      const cx = Math.cos(th + Math.PI) * rootD / 2, cz = Math.sin(th) * rootD / 2;
      ax = ax * (1 - round) + cx * round; az = az * (1 - round) + cz * round;
      pos.push(ax * Math.cos(twist) - az * Math.sin(twist), y, ax * Math.sin(twist) + az * Math.cos(twist));
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < P; j++) { const a = i * P + j, b = i * P + (j + 1) % P; idx.push(a, a + P, b, b, a + P, b + P); }
  const tip = pos.length / 3; pos.push(0, L + .02, 0);
  for (let j = 0; j < P; j++) idx.push(N * P + j, tip, N * P + (j + 1) % P);
  const root = pos.length / 3; pos.push(0, 0, 0);
  for (let j = 0; j < P; j++) idx.push(j, root, (j + 1) % P);       // the root is closed: a flat end with its bolt circle
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/* the nacelle cover: rounded corners, taller at the rotor end, tapering toward the back */
function nacelleGeometry(len, h, w) {
  const g = new THREE.BoxGeometry(len, h, w, 20, 10, 10), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = v.x / len + .5, sc = .82 + .18 * Math.min(1, t * 1.6);
    const ny = v.y / (h / 2), nz = v.z / (w / 2);
    const m = Math.max(Math.abs(ny), Math.abs(nz)), k = Math.pow(Math.pow(Math.abs(ny), 4) + Math.pow(Math.abs(nz), 4), .25) || 1;
    p.setXYZ(i, v.x, v.y * (m / k) * sc - (1 - sc) * h * .3, v.z * (m / k) * sc);
  }
  g.computeVertexNormals(); return g;
}
function noseGeometry(r, len) {
  const pts = []; for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push(new THREE.Vector2(r * Math.pow(1 - Math.pow(t, 1.7), .6) + .001, t * len)); }
  const g = new THREE.LatheGeometry(pts, 48); g.rotateZ(-Math.PI / 2); return g;
}
const BLADE = bladeGeometry(19, 1.15, 2.4, .42);

/* ── the turbine's fixed frames: where each part ends up ── */
const TOWER = [{ h: 14, r0: 1.7, r1: 1.45 }, { h: 12, r0: 1.45, r1: 1.2 }, { h: 10, r0: 1.2, r1: .98 }];
const BASE = 1.6, TOP = BASE + TOWER.reduce((s, t) => s + t.h, 0), HUBX = 4.55, HUBY = 1.45, YAW = -.35;
const yawFrame = new THREE.Object3D(); yawFrame.position.set(0, TOP, 0); yawFrame.rotation.y = YAW; scene.add(yawFrame);
const rotorFrame = new THREE.Object3D(); rotorFrame.position.set(HUBX, HUBY, 0); yawFrame.add(rotorFrame);
const arms = [0, 1, 2].map(k => { const a = new THREE.Object3D(); a.rotation.x = k * Math.PI * 2 / 3; rotorFrame.add(a); return a; });

/* ── part builders (local frames match the frames above) ── */
function buildFoundation(ctx, g) {
  add(ctx, cyl(6.2, 6.6, .9, 72), M.concrete, g, 0, .45, 0);
  add(ctx, cyl(3.0, 3.3, .7, 64), M.concrete, g, 0, 1.25, 0);
  boltRing(ctx, g, 1.55, 1.68, 40, .06, M.steel);
  const st = new THREE.Group(); st.position.set(0, 0, 2.75); g.add(st);           // steps and a landing up to the tower door
  for (let s = 0; s < 5; s++) add(ctx, box(1.4, .08, .4), M.steel, st, 0, .35 + s * .32, 1.3 - s * .36);
  add(ctx, box(1.6, .08, 1.1), M.steel, st, 0, 1.95, -.5);
  for (const sx of [-.78, .78]) {
    add(ctx, cyl(.03, .03, 1.05, 8), M.steel, st, sx, 2.5, -.95, { edges: false });
    add(ctx, box(.04, .04, 2.2), M.steel, st, sx, 1.95, .65, { edges: false }).rotation.x = .72;
  }
}
function buildTower(k) {
  return (ctx, g) => {
    const t = TOWER[k];
    add(ctx, cyl(t.r1, t.r0, t.h, 64), M.paint, g, 0, t.h / 2, 0);
    add(ctx, cyl(t.r0 + .14, t.r0 + .14, .18, 64), M.steel, g, 0, .09, 0);
    add(ctx, cyl(t.r1 + .14, t.r1 + .14, .18, 64), M.steel, g, 0, t.h - .09, 0);
    boltRing(ctx, g, t.r0 + .08, .22, 36, .05, M.dark); boltRing(ctx, g, t.r1 + .08, t.h - .22, 32, .05, M.dark);
    if (k === 0) {
      const door = new THREE.Group(); door.position.set(0, .3, t.r0 - .04); g.add(door);
      add(ctx, box(1.05, 2.15, .12), M.dark, door, 0, 1.08, .03);
      add(ctx, box(1.25, .12, .2), M.steel, door, 0, 2.2, .04, { edges: false });
    }
  };
}
function buildDrivetrain(ctx, g) {
  add(ctx, cyl(1.15, 1.15, .35, 64), M.steel, g, 0, .17, 0);                                    // yaw bearing
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + .4; add(ctx, cyl(.16, .16, .8, 16), M.dark, g, Math.cos(a) * .85, .55, Math.sin(a) * .85, { detail: true }); }
  add(ctx, box(6.4, .35, 2.1), M.dark, g, .3, .52, 0);                                            // bedplate
  alongX(add(ctx, cyl(.62, .62, .7, 40), M.cast, g, 2.6, 1.45, 0));                               // main bearing housing
  alongX(add(ctx, cyl(.32, .32, 2.6, 32), M.steel, g, 2.0, 1.45, 0));                             // main shaft
  add(ctx, box(1.7, 1.6, 1.7), M.steel, g, .3, 1.45, 0);                                           // gearbox
  for (let r = 0; r < 5; r++) add(ctx, box(.06, 1.7, 1.78), M.dark, g, -.3 + r * .3, 1.45, 0, { detail: true, edges: false });
  alongX(add(ctx, cyl(.55, .55, .12, 40), M.steel, g, -.75, 1.45, 0));                           // brake disc
  add(ctx, box(.25, .5, .35), M.red, g, -.75, 2.05, 0);                                             // brake calliper
  alongX(add(ctx, cyl(.18, .18, .9, 20), M.steel, g, -1.25, 1.45, 0));                           // coupling
  alongX(add(ctx, cyl(.95, .95, 2.2, 48), M.slate, g, -2.55, 1.45, 0));                          // generator
  for (let r = 0; r < 9; r++) alongX(add(ctx, cyl(.99, .99, .05, 48), M.dark, g, -3.4 + r * .21, 1.45, 0, { detail: true, edges: false }));
  add(ctx, box(1.1, 1.3, .9), M.paint, g, -2.9, 1.15, -.95);                                       // converter cabinet
}
function buildCover(ctx, g) {
  add(ctx, nacelleGeometry(7.6, 2.9, 2.85), coverMat, g, -.1, 1.75, 0);
  const kit = new THREE.Group(); kit.position.set(-2.9, 3.15, 0); g.add(kit);                     // wind vane, anemometer and lights on the roof
  add(ctx, cyl(.04, .04, 1.3, 8), M.steel, kit, 0, .65, 0, { edges: false }); add(ctx, box(.7, .04, .04), M.steel, kit, 0, 1.3, 0, { edges: false });
  add(ctx, box(.5, .28, .03), M.comp, kit, -.55, 1.45, 0);
  add(ctx, new THREE.SphereGeometry(.09, 12, 8), M.red, kit, .3, 1.38, 0, { edges: false }); add(ctx, new THREE.SphereGeometry(.09, 12, 8), M.red, kit, -.3, 1.38, .12, { edges: false });
}
function buildHub(ctx, g) {
  add(ctx, new THREE.SphereGeometry(1.15, 40, 24), M.cast, g, 0, 0, 0, { edges: false });
  alongX(add(ctx, cyl(.75, .75, .6, 40), M.cast, g, -.75, 0, 0));
  for (let k = 0; k < 3; k++) {
    const arm = new THREE.Group(); arm.rotation.x = k * Math.PI * 2 / 3; g.add(arm);
    add(ctx, cyl(.82, .82, .22, 48), M.steel, arm, 0, 1.15, 0);
    boltRing(ctx, arm, .72, 1.28, 28, .035, M.dark);
  }
  add(ctx, noseGeometry(1.5, 2.9), M.comp, g, -.3, 0, 0);
}
function buildBlade(ctx, g) { add(ctx, BLADE, M.comp, g).rotation.y = Math.PI / 2 + .12; }

/* ── the parts: where each lies on site, where it goes, and when ── */
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const basis = (x, y, z) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
const LYING = basis(V(0, -1, 0), V(1, 0, 0), V(0, 0, 1));         // a tower section on its side, its axis along +x
const FLAT = basis(V(0, 1, 0), V(1, 0, 0), V(0, 0, -1));          // a blade lying flat, span along +x
const NOSE_UP = basis(V(0, 1, 0), V(-1, 0, 0), V(0, 0, 1));       // the hub standing on its back flange
const turned = (a) => new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), a);
const parts = [];
const cradles = new THREE.Group(); scene.add(cradles);
function cradle(o, x, z, w, d, h, rot = 0) { const m = new THREE.Mesh(box(w, h, d), M.cradle); m.position.set(x, h / 2, z); m.rotation.y = rot; m.castShadow = m.receiveShadow = !phone; m.add(new THREE.LineSegments(edgesOf(m.geometry), lineBase)); cradles.add(m); (o.cr = o.cr || []).push(m); }
const lineBase = new THREE.LineBasicMaterial({ color: 0x2D343B, transparent: true, opacity: .45 });
function part(o) {
  o.line = new THREE.LineBasicMaterial({ color: 0x2D343B, transparent: true, opacity: .45 });
  o.ghostLine = new THREE.LineBasicMaterial({ color: 0x2D343B, transparent: true, opacity: .2, depthWrite: false });
  o.ghostFill = new THREE.MeshBasicMaterial({ color: 0x9AA6B2, transparent: true, opacity: .1, depthWrite: false });
  o.g = new THREE.Group(); scene.add(o.g);
  o.build({ ghost: false, line: o.line }, o.g);
  const local = new THREE.Matrix4().compose(o.at || V(0, 0, 0), new THREE.Quaternion(), V(1, 1, 1));
  o.local = local;
  o.ghost = new THREE.Group(); o.ghost.matrixAutoUpdate = false; o.ghost.matrix.copy(local); o.frame.add(o.ghost);
  o.build({ ghost: true, line: o.ghostLine, fill: o.ghostFill }, o.ghost);
  o.lq = o.lq || new THREE.Quaternion();
  o.g.position.copy(o.lp); o.g.quaternion.copy(o.lq);
  o.p = -1; parts.push(o); return o;
}
const F = part({ step: 1, a: .12, b: .85, pour: true, frame: scene, build: buildFoundation, lp: V(0, -2.45, 0) });
let ty = BASE;
const T = TOWER.map((t, k) => {
  const o = part({ step: 2, a: [.06, .38, .7][k], b: [.3, .62, .94][k], frame: scene, at: V(0, ty, 0), build: buildTower(k),
    lp: V(-25 + k * 2, t.r0 + .5, 7.5 + k * 4.6), lq: LYING, clear: 3.5, grip: V(0, t.h, 0), up: .5 });
  cradle(o, o.lp.x + 2.5, o.lp.z, .5, t.r0 * 2.2, .36); cradle(o, o.lp.x + t.h - 2.5, o.lp.z, .5, t.r0 * 2.2, .36);
  ty += t.h; return o;
});
const D = part({ step: 3, a: .12, b: .9, frame: yawFrame, build: buildDrivetrain, lp: V(5, .32, 17), lq: turned(.55), clear: 4, grip: V(.3, 2.3, 0), up: .5 });
cradle(D, 5 - 1.6, 17 + 1.0, .5, 2.4, .32, .55); cradle(D, 5 + 2.4, 17 - 1.6, .5, 2.4, .32, .55);
const N = part({ step: 4, a: .12, b: .9, frame: yawFrame, build: buildCover, lp: V(15.5, .05, 18), lq: turned(.55), clear: 5, grip: V(-.6, 3.3, 0), up: .4 });
cradle(N, 15.5 - 2.2, 18 + 1.3, .5, 2.6, .36, .55); cradle(N, 15.5 + 2.0, 18 - 1.2, .5, 2.4, .42, .55);
const R = part({ step: 5, a: .12, b: .9, frame: rotorFrame, build: buildHub, lp: V(-4, 1.38, 18.5), lq: NOSE_UP, clear: 4, grip: V(0, 0, 0), up: 3.2 });
cradle(R, -4, 18.5, 2.2, 2.2, .3);
const B = [0, 1, 2].map(k => {
  const o = part({ step: 6, a: [.06, .38, .7][k], b: [.3, .62, .94][k], frame: arms[k], at: V(0, 1.3, 0), build: buildBlade,
    lp: V(8.5, .95, 2 + k * 3.6), lq: FLAT, clear: 3, grip: V(0, 6.5, 0), up: 1.1 });
  cradle(o, 10, o.lp.z, .5, 2.2, .4); cradle(o, 21, o.lp.z, .5, 1.6, .55);
  return o;
});

/* ── the crane: a crawler crane with a telescopic boom that does every lift ──
   Each frame the hook goes where the job needs it (on the part being lifted, or travelling to the next
   one); the upper works slew to face it, the boom luffs and telescopes so its tip sits above it. */
const CRANE = V(17, 0, -12), REST = V(-9, 18, 9);
const paintY = std(0xE2A72E, .5, .22);
const cctx = { ghost: false, line: lineBase };
const crane = new THREE.Group(); crane.position.copy(CRANE); scene.add(crane);
for (const sz of [-2.5, 2.5]) {
  add(cctx, box(9.4, 1.25, 1.4), M.dark, crane, 0, .62, sz);
  for (let i = 0; i < 2; i++) alongX(add(cctx, cyl(.62, .62, 1.42, 24), M.dark, crane, i ? 4.1 : -4.1, .62, sz)).rotation.set(Math.PI / 2, 0, 0);
}
add(cctx, box(3.4, .9, 3.6), M.dark, crane, 0, 1.6, 0);
const upper = new THREE.Group(); upper.position.y = 2.05; crane.add(upper);           // slews
add(cctx, cyl(1.7, 1.7, .35, 40), M.steel, upper, 0, .17, 0);
add(cctx, box(6.6, 1.7, 3.3), paintY, upper, -1.3, 1.2, 0);
add(cctx, box(2.2, 2.3, 1.25), paintY, upper, 1.5, 1.5, 2.15);                           // cab
add(cctx, box(.06, 1.1, 1.0), M.dark, upper, 2.62, 1.9, 2.15, { edges: false });
add(cctx, box(1.7, 2.5, 3.5), M.dark, upper, -4.6, 1.7, 0);                               // counterweight
const boom = new THREE.Group(); boom.position.set(1.6, 2.4, 0); upper.add(boom);         // luffs about its foot
const SEC = 22;
add(cctx, box(SEC, 1.5, 1.3), paintY, boom, SEC / 2, 0, 0);
const sec1 = new THREE.Group(); boom.add(sec1); add(cctx, box(SEC, 1.15, 1.0), paintY, sec1, SEC / 2, 0, 0);
const sec2 = new THREE.Group(); boom.add(sec2); add(cctx, box(SEC, .85, .74), paintY, sec2, SEC / 2, 0, 0);
alongX(add(cctx, cyl(.55, .55, .5, 24), M.steel, sec2, SEC, 0, 0)).rotation.set(Math.PI / 2, 0, 0);   // sheave at the tip
const ram = add(cctx, cyl(.26, .26, 1, 16), M.steel, upper, 0, 0, 0);                     // luffing cylinder
const cable = add(cctx, cyl(.045, .045, 1, 6), M.dark, scene, 0, 0, 0, { edges: false });
const hook = new THREE.Group(); scene.add(hook);
add(cctx, box(.7, 1.0, .45), paintY, hook, 0, .5, 0);
add(cctx, new THREE.TorusGeometry(.28, .07, 8, 20, Math.PI * 1.4), M.dark, hook, 0, -.12, 0, { edges: false }).rotation.z = -Math.PI * .7;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function between(m, a, b) {                     // stretch a unit cylinder from a to b
  _b.subVectors(b, a); const len = _b.length() || 1e-3;
  m.position.copy(a).addScaledVector(_b, .5); m.scale.set(1, len, 1); m.quaternion.setFromUnitVectors(_up, _b.divideScalar(len));
}
const grip = (o) => o.g.localToWorld(o.grip.clone()).add(V(0, o.up, 0));
function polar(a, b, e) {                       // travel between two hook positions the way a crane does: slew, reach, hoist
  const c = crane.position, aa = Math.atan2(a.z - c.z, a.x - c.x), ab = Math.atan2(b.z - c.z, b.x - c.x);
  let da = ab - aa; da = Math.atan2(Math.sin(da), Math.cos(da));
  const ang = aa + da * e, r = lerp(Math.hypot(a.x - c.x, a.z - c.z), Math.hypot(b.x - c.x, b.z - c.z), e);
  const y = lerp(a.y, b.y, e) + Math.sin(Math.PI * e) * Math.max(0, 6 - Math.abs(a.y - b.y) * .2);
  return V(c.x + Math.cos(ang) * r, y, c.z + Math.sin(ang) * r);
}
let jobs = null;
function hookTarget(u) {
  if (!jobs) jobs = parts.filter(o => !o.pour).map(o => ({ o, u0: o.step - 1 + o.a, u1: o.step - 1 + o.b })).sort((x, y) => x.u0 - y.u0);
  const rest = crane.position.clone().add(REST), f = jobs[0], l = jobs[jobs.length - 1];
  if (u <= f.u0) return polar(rest, grip(f.o), sm((u - (f.u0 - .45)) / .45));
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i], n = jobs[i + 1];
    if (u >= j.u0 && u <= j.u1) return grip(j.o);
    if (n && u > j.u1 && u < n.u0) return polar(grip(j.o), grip(n.o), sm((u - j.u1) / (n.u0 - j.u1)));
  }
  return polar(grip(l.o), rest, sm((u - l.u1) / .3));
}
function poseCrane(u) {
  const off = sm((u - 6.25) / .7);                                                     // the job's done: it drives off site
  crane.position.copy(CRANE).add(V(off * 55, 0, -off * 40));
  crane.updateMatrixWorld();
  const h = hookTarget(u);
  hook.position.copy(h);
  const foot = upper.localToWorld(boom.position.clone());
  const dx = h.x - crane.position.x, dz = h.z - crane.position.z;
  upper.rotation.y = Math.atan2(-dz, dx);
  const d = Math.max(2, Math.hypot(dx, dz) - 1.6);
  let rise = Math.max(h.y + 7.5, 16) - foot.y;
  let L = Math.hypot(d, rise);
  if (L < SEC + 2) { L = SEC + 2; rise = Math.sqrt(L * L - d * d); }
  L = Math.min(L, SEC * 2.9);
  boom.rotation.z = Math.atan2(rise, d);
  const e = L - SEC; sec1.position.x = e / 2; sec2.position.x = e;
  crane.updateMatrixWorld(true);
  between(ram, _a.set(.6, .5, 0), _b.copy(V(6, -.6, 0)).applyAxisAngle(V(0, 0, 1), boom.rotation.z).add(boom.position));
  const tip = sec2.localToWorld(V(SEC, -.4, 0));
  between(cable, tip, hook.localToWorld(V(0, 1, 0)));
}

/* ── studio floor: a faint grid that fades out, and soft shadows ── */
const floorMat = new THREE.ShaderMaterial({
  transparent: true,
  uniforms: { col: { value: new THREE.Color() }, line: { value: new THREE.Color() } },
  vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: [
    'uniform vec3 col, line; varying vec3 vW;',
    'float grid(vec2 p, float s){ vec2 q = p / s; vec2 g = abs(fract(q - .5) - .5) / fwidth(q); return 1. - min(min(g.x, g.y), 1.); }',
    'void main(){',
    '  float d = length(vW.xz);',
    '  float l = max(grid(vW.xz, 2.5) * .35, grid(vW.xz, 12.5) * .8) * (1. - smoothstep(24., 95., d));',
    '  gl_FragColor = vec4(mix(col, line, l), 1. - smoothstep(140., 520., d));',
    '  #include <colorspace_fragment>',
    '}'].join('\n')
});
const floorGeo = new THREE.PlaneGeometry(1600, 1600); floorGeo.rotateX(-Math.PI / 2);
scene.add(new THREE.Mesh(floorGeo, floorMat));
/* the studio backdrop: a soft vertical gradient behind everything */
const bgMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: { a: { value: new THREE.Color() }, b: { value: new THREE.Color() }, c: { value: new THREE.Color() } },
  vertexShader: 'varying float vy; void main(){ vy = position.y * .5 + .5; gl_Position = vec4(position.xy, .9999, 1.); }',
  fragmentShader: 'uniform vec3 a, b, c; varying float vy; void main(){ float t = 1. - vy; gl_FragColor = vec4(t < .55 ? mix(a, b, t / .55) : mix(b, c, (t - .55) / .45), 1.);\n#include <colorspace_fragment>\n}'
});
const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat); bg.frustumCulled = false; bg.renderOrder = -1; scene.add(bg);
const shadowMat = new THREE.ShadowMaterial({ opacity: .16 });
const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), shadowMat); shadowFloor.position.y = .01; shadowFloor.receiveShadow = true; scene.add(shadowFloor);

/* ── light ── */
const hemi = new THREE.HemisphereLight(0xffffff, 0xC6CCD2, .95);
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.castShadow = !phone;
sun.shadow.mapSize.set(lite ? 1024 : 2048, lite ? 1024 : 2048);
sun.shadow.bias = -.0003; sun.shadow.normalBias = .05; sun.shadow.radius = 3;
Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 48, bottom: -48, near: 1, far: 320 }); sun.shadow.camera.updateProjectionMatrix();
sun.position.set(-55, 95, 70); sun.target.position.set(0, 10, 4);
scene.add(hemi, sun, sun.target);

/* ── theme ── */
let dirty = true, lineCol = new THREE.Color(), hiCol = new THREE.Color(), dark = false;
function applyTheme() {
  dark = document.documentElement.getAttribute('data-theme') === 'dark';
  bgMat.uniforms.a.value.set(dark ? 0x0D1115 : 0xF7F9FA); bgMat.uniforms.b.value.set(dark ? 0x12171D : 0xEDF0F3); bgMat.uniforms.c.value.set(dark ? 0x171C23 : 0xE5E9ED);
  floorMat.uniforms.col.value.set(dark ? 0x161B21 : 0xE6EAEE);
  floorMat.uniforms.line.value.set(dark ? 0x222A33 : 0xC8CFD6);
  lineCol.set(dark ? 0x0B0E12 : 0x2D343B);
  hiCol.set(dark ? 0x8FB0E8 : 0x1E3765);
  lineBase.color.copy(lineCol);
  parts.forEach(o => { o.ghostLine.color.set(dark ? 0x7F8B97 : 0x59626C); o.ghostFill.color.set(dark ? 0x6F7B88 : 0x8C98A5); });
  hemi.intensity = dark ? .5 : .95; hemi.groundColor.set(dark ? 0x1A2027 : 0xC6CCD2);
  sun.intensity = dark ? 1.5 : 2.2; scene.environmentIntensity = dark ? .35 : .55;
  shadowMat.opacity = dark ? .3 : .16;
  renderer.toneMappingExposure = dark ? .85 : 1.02;
  dirty = true;
}

/* ── camera: a few views around the site, every one framing the whole turbine ── */
const SHOTS = [
  { d: V(.42, .40, .82), t: V(-1, 24, 6), hw: 31, hh: 31 },
  { d: V(.22, .34, .92), t: V(-2, 24, 6), hw: 29, hh: 31 },
  { d: V(-.18, .30, .94), t: V(-2, 25, 6), hw: 29, hh: 31 },
  { d: V(.5, .30, .81), t: V(1, 27, 6), hw: 28, hh: 31 },
  { d: V(.66, .25, .71), t: V(2, 28, 5), hw: 28, hh: 31 },
  { d: V(.72, .18, .67), t: V(3, 29, 5), hw: 28, hh: 31.5 },
  { d: V(.45, .2, .87), t: V(4, 29, 6), hw: 29, hh: 32 },
  { d: V(.62, .14, .77), t: V(1, 29, 3), hw: 24, hh: 32 }
];
SHOTS.forEach(s => s.d.normalize());
const sm = x => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;
const shot = { d: V(0, 0, 1), t: V(), hw: 0, hh: 0 };
function shotAt(u) {
  const i = Math.max(0, Math.min(SHOTS.length - 2, Math.floor(u))), e = sm(u - i), A = SHOTS[i], Bs = SHOTS[i + 1];
  shot.d.copy(A.d).lerp(Bs.d, e).normalize(); shot.t.copy(A.t).lerp(Bs.t, e); shot.hw = lerp(A.hw, Bs.hw, e); shot.hh = lerp(A.hh, Bs.hh, e);
}
/* The part of the screen the turbine gets (CSS px): beside the text on wide screens, above it on narrow ones,
   and below the step list either way. */
const stepsEl = document.getElementById('build'), detailEl = document.getElementById('detail');
let view = { x0: 0, y0: 0, x1: 1, y1: 1 }, detailRect = null;
let CW = innerWidth, CH = innerHeight, CT = 0;      // the canvas: full screen on wide screens, a band under the header on narrow ones
function measure() {
  const w = CW, h = CH, wide = innerWidth > 900;
  const top = (stepsEl && getComputedStyle(stepsEl).display !== 'none' ? stepsEl.getBoundingClientRect().bottom + 6 : 70) - CT;
  view = wide ? { x0: Math.min(w * .44, 640), y0: top, x1: w, y1: h - 8 } : { x0: 0, y0: Math.max(0, top), x1: w, y1: h - 4 };
  const r = detailEl && getComputedStyle(detailEl).display !== 'none' ? detailEl.getBoundingClientRect() : null;
  detailRect = r && r.width > 40 ? r : null;
}

/* ── labels: the parts still to go up, named on the drawing ── */
const svg = document.getElementById('tags'), NS = 'http://www.w3.org/2000/svg';
const names = [].slice.call(document.querySelectorAll('#build-steps li > b'));
const el = (n, a, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); (p || svg).appendChild(e); return e; };
const LABELS = [
  { step: 1, at: () => V(-4.6, .9, 4.4), dx: -30, dy: -46 },
  { step: 2, at: () => T[1].g.localToWorld(V(-.8, 6, 1.6)), dx: -24, dy: -40 },
  { step: 3, at: () => D.g.localToWorld(V(.3, 2.3, 0)), dx: -28, dy: -50 },
  { step: 4, at: () => N.g.localToWorld(V(-1.2, 3.1, 0)), dx: 26, dy: -46 },
  { step: 5, at: () => R.g.localToWorld(V(1.6, 0, 0)), dx: -30, dy: -44 },
  { step: 6, at: () => B[2].g.localToWorld(V(0, 13, 0)), dx: 24, dy: 34 }
].map(L => {
  L.gEl = el('g', { class: 'tag' });
  L.line = el('line', {}, L.gEl); L.dot = el('circle', { r: 3.2 }, L.gEl); L.text = el('text', {}, L.gEl);
  return L;
});
const dGroup = el('g', { class: 'tag detail-mark' });
const dCircle = el('circle', { fill: 'none' }, dGroup), dText = el('text', {}, dGroup); dText.textContent = 'A';
const _v = new THREE.Vector3();
function toScreen(p) { _v.copy(p).project(camera); return { x: (_v.x + 1) / 2 * CW, y: (1 - _v.y) / 2 * CH + CT, ok: _v.z < 1 }; }
function drawLabels(u, step, detailOn) {
  const narrow = innerWidth <= 900;
  LABELS.forEach(L => {
    const show = narrow ? (L.step === step && u > .5) : (L.step >= step || u < .5);
    L.gEl.style.display = show ? '' : 'none';
    if (!show) return;
    const s = toScreen(L.at()), tx = s.x + L.dx, ty = s.y + L.dy;
    const r = detailOn && detailRect, inDetail = r && ((s.x > r.left - 8 && s.y > r.top - 8) || (tx > r.left - 90 && ty > r.top - 12));
    L.gEl.style.visibility = inDetail ? 'hidden' : '';
    L.line.setAttribute('x1', s.x); L.line.setAttribute('y1', s.y); L.line.setAttribute('x2', tx); L.line.setAttribute('y2', ty);
    L.dot.setAttribute('cx', s.x); L.dot.setAttribute('cy', s.y);
    L.text.setAttribute('x', tx + (L.dx < 0 ? -6 : 6)); L.text.setAttribute('y', ty + 4);
    L.text.setAttribute('text-anchor', L.dx < 0 ? 'end' : 'start');
    const nm = names[L.step - 1] ? names[L.step - 1].textContent : ''; if (L.text.textContent !== nm) L.text.textContent = nm;
    L.gEl.classList.toggle('now', L.step === step);
  });
  dGroup.style.display = detailOn ? '' : 'none';
  if (detailOn) {
    const c = yawFrame.localToWorld(V(1.2, 1.5, 0)), s = toScreen(c), s2 = toScreen(c.clone().add(V(0, 5.2, 0)));
    const r = Math.max(18, Math.hypot(s2.x - s.x, s2.y - s.y));
    dCircle.setAttribute('cx', s.x); dCircle.setAttribute('cy', s.y); dCircle.setAttribute('r', r);
    dText.setAttribute('x', s.x + r * .74 + 6); dText.setAttribute('y', s.y - r * .74 - 4);
  }
}

/* ── size and loop ── */
function size() {
  const r = canvas.getBoundingClientRect();
  CW = Math.round(r.width) || innerWidth; CH = Math.round(r.height) || innerHeight; CT = r.top;
  renderer.setSize(CW, CH, false);
  svg.setAttribute('viewBox', '0 0 ' + innerWidth + ' ' + innerHeight);
  measure(); dirty = true;
}
let uShown = H.u || 0, last = performance.now(), spin = 0, spinV = 0, first = true;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
function place(o, u) {
  const p = sm((u - (o.step - 1) - o.a) / (o.b - o.a));
  _m.multiplyMatrices(o.frame.matrixWorld, o.local); _m.decompose(_p, _q, _s);       // the installed pose, wherever the rotor is
  if (o.pour) { o.g.position.set(_p.x, lerp(o.lp.y, _p.y, p), _p.z); o.g.quaternion.copy(_q); }
  else if (p <= 0) { o.g.position.copy(o.lp); o.g.quaternion.copy(o.lq); }
  else if (p >= 1) { o.g.position.copy(_p); o.g.quaternion.copy(_q); }
  else {                                                                              // crane: up, across, down
    const top = Math.max(_p.y, o.lp.y) + o.clear;
    const y = p < .6 ? lerp(o.lp.y, top, sm(p / .4)) : lerp(top, _p.y, sm((p - .6) / .4)), m = sm((p - .25) / .5);
    o.g.position.set(lerp(o.lp.x, _p.x, m), y, lerp(o.lp.z, _p.z, m));
    o.g.quaternion.slerpQuaternions(o.lq, _q, sm((p - .1) / .55));
  }
  o.ghostLine.opacity = (dark ? .3 : .22) * (1 - p); o.ghostFill.opacity = (dark ? .12 : .13) * (1 - p);
  o.ghost.visible = p < 1;
  if (o.cr) o.cr.forEach(m => { m.visible = p < 1; });
  o.p = p;
  return p > 0 && p < 1 && !o.pour;
}
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (document.hidden) return;
  const u = H.u || 0, prev = uShown;
  uShown = reduceMotion ? u : uShown + (u - uShown) * (1 - Math.exp(-dt * 6));
  if (Math.abs(u - uShown) < 4e-4) uShown = u;
  const target = reduceMotion ? 0 : .6 * sm((uShown - 6.25) / .6);
  spinV += (target - spinV) * (1 - Math.exp(-dt * 1.6)); if (spinV < 1e-3 && target === 0) spinV = 0;
  if (uShown === prev && spinV === 0 && !dirty) return;                              // nothing has changed: don't draw
  spin += spinV * dt; rotorFrame.rotation.x = spin;
  scene.updateMatrixWorld();

  const step = Math.max(0, Math.min(7, Math.round(uShown)));
  parts.forEach(o => {
    place(o, uShown);
    o.line.color.copy(o.step === step && step > 0 && step < 7 ? hiCol : lineCol);
    o.line.opacity = o.step === step && step > 0 && step < 7 ? .9 : .45;
  });
  coverMat.opacity = 1 - .62 * sm((uShown - 3.85) / .3);
  coverMat.depthWrite = coverMat.opacity > .99;
  scene.updateMatrixWorld();
  poseCrane(uShown);

  shotAt(uShown);
  const w = CW, h = CH, tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const vw = view.x1 - view.x0, vh = view.y1 - view.y0;
  const dist = 1.06 * Math.max(shot.hh / (tanV * vh / h), shot.hw / (tanV * vw / h));
  camera.aspect = w / h;
  camera.position.copy(shot.t).addScaledVector(shot.d, dist); camera.lookAt(shot.t);
  camera.setViewOffset(w, h, w / 2 - (view.x0 + view.x1) / 2, h / 2 - (view.y0 + view.y1) / 2, w, h);
  camera.updateProjectionMatrix();

  renderer.shadowMap.needsUpdate = true;
  renderer.setScissorTest(false); renderer.setViewport(0, 0, w, h);
  renderer.render(scene, camera);

  // the detail view of the nacelle, while it is being built
  const detailOn = !!detailRect && uShown > 2.55 && uShown < 5.6;
  document.body.classList.toggle('detail-on', detailOn);
  if (detailOn) {
    const r = detailRect, y = h - r.bottom;
    dcam.aspect = r.width / r.height; dcam.updateProjectionMatrix();
    dcam.position.copy(yawFrame.localToWorld(V(3.4, 5.8, 18.5))); dcam.lookAt(yawFrame.localToWorld(V(1.4, 1.2, 0)));
    renderer.setScissorTest(true); renderer.setViewport(r.left, y, r.width, r.height); renderer.setScissor(r.left, y, r.width, r.height);
    renderer.clear();
    renderer.render(scene, dcam);
    renderer.setScissorTest(false);
  }
  drawLabels(uShown, step, detailOn);
  dirty = false;
  if (first) { first = false; canvas.classList.add('on'); S.has3d = true; }
}
addEventListener('resize', size);
addEventListener('cl-themechange', applyTheme);
addEventListener('cl-langchange', () => { dirty = true; });
H.redraw = () => { size(); };
size(); applyTheme();
S.buildProgress = .6;
(renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve()).then(() => requestAnimationFrame(tick));
H.debug = { renderer, scene, camera, tier, parts };
