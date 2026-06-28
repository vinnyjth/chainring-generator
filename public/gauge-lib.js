// =============================================================================
// gauge-lib.js — shared scaffolding for the "identify a bike part size" gauges.
//
// The chainring and seatpost gauges predate this file and stay standalone. The
// newer size-ID gauges (handlebar clamp, bearings, pedal thread) all reduce to
// one of two printable shapes, so they share this module:
//
//   • buildHolePlate — a flat card of labelled through-holes. Drop a ball / push
//     a spindle through; the smallest hole it passes is its size. (A "sieve".)
//   • buildNotchBar  — a flat bar with labelled semicircular saddle notches cut
//     into its edges. Lay a round tube in each notch; the one that cradles it
//     without rocking is its diameter. (A contour / radius gauge.)
//
// Every length is millimetres. Geometry is built in the seatpost gauge's frame:
// the part lies in the XY plane and is extruded +Z, so STL export matches the
// preview. Labels are debossed (cut 0.6 mm into a face) so the printed digits
// never sit proud of a measuring surface and skew a fit.
// =============================================================================
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Evaluator, Brush, SUBTRACTION } from "three-bvh-csg";

export const $ = (id) => document.getElementById(id);
export const ENGRAVE = 0.6;   // mm: depth labels are cut into a surface (debossed)

// --------------------------------------------------------------- font / text
let font = null;
const fontWaiters = [];
new FontLoader().load(
  "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/fonts/helvetiker_regular.typeface.json",
  (f) => { font = f; fontWaiters.forEach((cb) => cb()); },
);
// Register a callback to (re)run once the label font is available. Fires
// immediately if the font already loaded.
export function onFontReady(cb) {
  if (font) cb(); else fontWaiters.push(cb);
}

// Text as a solid, centred in X/Y, extruded `depth` along +Z (z = 0..depth).
function makeText(str, size, depth) {
  if (!font) return null;
  const g = new TextGeometry(str, {
    font, size, height: depth, curveSegments: 4, bevelEnabled: false,
  });
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, 0);
  return g;
}

// A cutter that debosses a label into a flat top face at z = topZ, centred at
// (cx, cy). Sinks ENGRAVE deep and pokes 0.5 mm proud so the subtraction is clean.
function flatTextCutter(str, cx, cy, topZ, size) {
  const g = makeText(str, size, ENGRAVE + 0.5);
  if (!g) return null;
  g.translate(cx, cy, topZ - ENGRAVE);
  return g;
}

// --------------------------------------------------------------- CSG engraving
const evaluator = new Evaluator();
evaluator.useGroups = false;

// Subtract `cutter` from `base`, returning the engraved geometry. Falls back to
// the plain base if the font isn't ready or CSG fails for any reason.
function engrave(base, cutter) {
  if (!cutter) return base;
  try {
    const a = new Brush(base); a.updateMatrixWorld();
    const b = new Brush(cutter); b.updateMatrixWorld();
    return evaluator.evaluate(a, b, SUBTRACTION).geometry;
  } catch (e) {
    console.warn("engrave failed; leaving surface blank", e);
    return base;
  }
}

// --------------------------------------------------------------- geometry util
// Rounded-rectangle Shape centred on the origin (corner radius r).
function roundedRect(w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  const hw = w / 2, hh = h / 2;
  const s = new THREE.Shape();
  s.moveTo(-hw + r, -hh);
  s.lineTo(hw - r, -hh);
  s.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0);
  s.lineTo(hw, hh - r);
  s.absarc(hw - r, hh - r, r, 0, Math.PI / 2);
  s.lineTo(-hw + r, hh);
  s.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI);
  s.lineTo(-hw, -hh + r);
  s.absarc(-hw + r, -hh + r, r, Math.PI, 1.5 * Math.PI);
  return s;
}

// A solid cylinder whose axis runs along Z, centred at (x, y), spanning the
// extruded plate (used as a through-cutter, so it overshoots in Z by `over`).
function cylCutterZ(x, y, radius, thick, over = 4) {
  const g = new THREE.CylinderGeometry(radius, radius, thick + over, 64);
  g.rotateX(Math.PI / 2);            // axis Y -> Z
  g.translate(x, y, thick / 2);
  return g;
}

// =============================================================================
// scene factory
// =============================================================================
// Stands up the dark three.js viewport shared by every gauge page and returns a
// small API. `add(geom)` puts a mesh on screen AND records the canonical
// geometry for STL export, so the download always matches the preview.
export function setupScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f1115);

  const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
  camera.up.set(0, 0, 1);
  camera.position.set(260, -320, 220);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.1);
  key.position.set(200, -150, 400);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
  fill.position.set(-200, 200, -100);
  scene.add(fill);

  const grid = new THREE.GridHelper(600, 24, 0x2b313c, 0x1f232c);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);

  const material = new THREE.MeshStandardMaterial({
    color: 0x4f9dff, metalness: 0.3, roughness: 0.55, side: THREE.DoubleSide,
  });

  const group = new THREE.Group();
  scene.add(group);

  let exportGeoms = [];
  let framed = false;

  function add(geom) {
    group.add(new THREE.Mesh(geom, material));
    exportGeoms.push(geom);
  }

  function clear() {
    while (group.children.length) {
      const c = group.children.pop();
      c.geometry?.dispose();
      group.remove(c);
    }
    exportGeoms = [];
  }

  function frameCamera(span, height) {
    if (framed) return;
    framed = true;
    const r = Math.max(span, height) * 1.5;
    controls.target.set(0, 0, height / 2);
    camera.position.set(r * 0.9, -r * 1.2, r * 0.8 + height);
    controls.update();
  }
  function resetFrame() { framed = false; }

  function exportSTL() {
    const tmp = new THREE.Group();
    for (const g of exportGeoms) tmp.add(new THREE.Mesh(g, material));
    const data = new STLExporter().parse(tmp, { binary: true });
    return new Blob([data], { type: "model/stl" });
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== w || canvas.height !== h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }
  function start() {
    (function animate() {
      requestAnimationFrame(animate);
      resize();
      controls.update();
      renderer.render(scene, camera);
    })();
  }

  return { scene, camera, controls, material, add, clear, frameCamera, resetFrame, exportSTL, start };
}

// =============================================================================
// builder: labelled through-hole "sieve" plate
// =============================================================================
// entries: [{ d, label }]  — d = nominal diameter (mm), label = printed string.
// Each hole's diameter is d + clearance: a part of size d (and anything bigger)
// is blocked, the matching part passes. Read the smallest hole it drops through.
export function buildHolePlate({
  entries, clearance, thick, pad, wall, labelH, maxBed, caption,
}) {
  const sorted = [...entries].sort((a, b) => a.d - b.d);
  const t = Math.max(2, thick);
  const w = Math.max(1, wall);
  const pd = Math.max(2, pad);
  const maxDia = Math.max(...sorted.map((e) => e.d)) + clearance;

  const cellW = maxDia + 2 * pd;
  const cellH = maxDia + 2 * pd + labelH + 2;
  const maxCols = Math.max(1, Math.floor((maxBed - 2 * w) / cellW));
  const cols = Math.min(maxCols, sorted.length);
  const rows = Math.ceil(sorted.length / cols);

  const plateW = cols * cellW + 2 * w;
  const plateH = rows * cellH + 2 * w;
  const x0 = -plateW / 2, y0 = -plateH / 2;

  const shape = roundedRect(plateW, plateH, 5);
  const labels = [];
  sorted.forEach((e, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cellLeft = x0 + w + col * cellW;
    const cellTop = y0 + w + plateH - 2 * w - row * cellH;   // top y of this cell
    const cx = cellLeft + cellW / 2;
    const holeR = (e.d + clearance) / 2;
    const cy = cellTop - pd - holeR;                          // hole near cell top
    const labelY = cellTop - cellH + pd + labelH / 2 + 1;     // label below hole

    const hole = new THREE.Path();
    hole.absarc(cx, cy, holeR, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    labels.push({ label: e.label, cx, cy: labelY });
  });

  let plate = new THREE.ExtrudeGeometry(shape, {
    depth: t, bevelEnabled: false, curveSegments: 48,
  });
  const cutters = labels
    .map((l) => flatTextCutter(l.label, l.cx, l.cy, t, labelH))
    .filter(Boolean);
  if (cutters.length) plate = engrave(plate, mergeGeometries(cutters));

  const overBed = plateW > maxBed + 0.5 || plateH > maxBed + 0.5;
  const readoutHTML = `
    <table>
      <caption>${caption} — ${sorted.length} holes</caption>
      <tr><th>layout</th><td colspan="2">${cols} × ${rows}</td></tr>
      <tr><th>plate</th><td colspan="2">${plateW.toFixed(0)} × ${plateH.toFixed(0)} mm</td></tr>
      <tr><th>thickness</th><td colspan="2">${t} mm</td></tr>
      <tr><th>holes ⌀</th><td colspan="2">${(sorted[0].d + clearance).toFixed(2)}–${(maxDia).toFixed(2)} mm</td></tr>
      <tr class="total"><th>bed</th><td colspan="2">${maxBed} × ${maxBed} mm</td></tr>
      ${overBed ? `<tr><td colspan="3" class="warn">⚠ plate exceeds bed — trim sizes</td></tr>` : ""}
    </table>`;

  return { geoms: [plate], span: Math.max(plateW, plateH), height: t, readoutHTML };
}

// =============================================================================
// builder: edge-notch "saddle" bar
// =============================================================================
// entries: [{ d, label }] — round-tube outer diameters. Semicircular notches of
// radius (d + clearance)/2 are cut into the long edges; notches alternate top /
// bottom edge to keep the bar short. The tube nests in the matching arc.
export function buildNotchBar({
  entries, clearance, thick, wall, labelH, maxBed,
}) {
  const sorted = [...entries].sort((a, b) => a.d - b.d);
  const t = Math.max(3, thick);
  const w = Math.max(2, wall);

  // alternate sizes between the top and bottom edge to halve the bar length
  const top = [], bot = [];
  sorted.forEach((e, i) => (i % 2 === 0 ? top : bot).push(e));

  const maxD = Math.max(...sorted.map((e) => e.d)) + clearance;
  const cellW = maxD + 2 * w;
  const nCols = Math.max(top.length, bot.length);
  const labelBand = labelH + 4;
  const notchDepth = maxD / 2;        // deepest (largest) notch
  const centerWeb = 12;               // solid spine between the two notch rows

  const barW = nCols * cellW + 2 * w;
  const barH = 2 * notchDepth + 2 * labelBand + centerWeb;
  const colW = (barW - 2 * w) / nCols;
  const colX = (i) => -barW / 2 + w + (i + 0.5) * colW;

  let plate = new THREE.ExtrudeGeometry(roundedRect(barW, barH, 4), {
    depth: t, bevelEnabled: false, curveSegments: 48,
  });

  const notches = [];     // CylinderGeometry cutters (homogeneous → mergeable)
  const texts = [];       // TextGeometry cutters (homogeneous → mergeable)
  const place = (list, edgeY, labelDir) => list.forEach((e, i) => {
    const x = colX(i);
    notches.push(cylCutterZ(x, edgeY, (e.d + clearance) / 2, t));
    const ly = edgeY + labelDir * (notchDepth + labelBand / 2);
    const lc = flatTextCutter(e.label, x, ly, t, labelH);
    if (lc) texts.push(lc);
  });
  place(top, barH / 2, -1);     // notches open up; labels sit below, toward centre
  place(bot, -barH / 2, +1);    // notches open down; labels sit above, toward centre

  // Cut the notches first, then the labels — separate passes keep each merge set
  // attribute-homogeneous (cylinders vs. text differ), which mergeGeometries needs.
  if (notches.length) plate = engrave(plate, mergeGeometries(notches));
  if (texts.length) plate = engrave(plate, mergeGeometries(texts));

  const overBed = barW > maxBed + 0.5 || barH > maxBed + 0.5;
  const readoutHTML = `
    <table>
      <caption>Saddle bar — ${sorted.length} notches</caption>
      <tr><th>top edge</th><td colspan="2">${top.map((e) => e.label).join(", ") || "—"}</td></tr>
      <tr><th>bottom edge</th><td colspan="2">${bot.map((e) => e.label).join(", ") || "—"}</td></tr>
      <tr><th>bar</th><td colspan="2">${barW.toFixed(0)} × ${barH.toFixed(0)} mm</td></tr>
      <tr class="total"><th>thickness</th><td colspan="2">${t} mm</td></tr>
      ${overBed ? `<tr><td colspan="3" class="warn">⚠ bar exceeds bed — trim sizes</td></tr>` : ""}
    </table>`;

  return { geoms: [plate], span: Math.max(barW, barH), height: t, readoutHTML };
}

// --------------------------------------------------------------- download
export function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
