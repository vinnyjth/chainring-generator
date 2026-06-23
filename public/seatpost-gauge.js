import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { FontLoader } from "three/addons/loaders/FontLoader.js";
import { TextGeometry } from "three/addons/geometries/TextGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Evaluator, Brush, SUBTRACTION } from "three-bvh-csg";

// ----------------------------------------------------------- presets
// Common seatpost outer diameters (mm). Sources: industry-standard sizes used
// by Thomson, Ritchey, etc. The "common" set spans the popular modern + legacy
// diameters; verify against your real post/frame with calipers.
const SIZE_PRESETS = {
  common: {
    label: "Common (full set)",
    note: "The popular modern + legacy diameters in one gauge.",
    sizes: [25.4, 26.0, 26.4, 26.8, 27.0, 27.2, 28.6, 30.0, 30.4, 30.8, 30.9, 31.4, 31.6, 31.8, 32.4, 33.9, 34.9],
  },
  modern: {
    label: "Modern (big three +)",
    note: "Today's most common: 27.2, 30.9, 31.6 plus near neighbours.",
    sizes: [27.2, 30.0, 30.9, 31.6, 33.9, 34.9],
  },
  legacy: {
    label: "Legacy 25–27 mm",
    note: "Older road/MTB posts clustered around 26–27 mm.",
    sizes: [25.0, 25.4, 26.0, 26.2, 26.4, 26.6, 26.8, 27.0, 27.2],
  },
  full: {
    label: "Full range 25–35 mm",
    note: "Every 0.4 mm from 25 to 35 — a reference set (tall tower; will split).",
    sizes: [25.0, 25.4, 25.8, 26.2, 26.6, 27.0, 27.4, 27.8, 28.2, 28.6, 29.0, 29.4, 29.8,
      30.2, 30.6, 31.0, 31.4, 31.8, 32.2, 32.6, 33.0, 33.4, 33.8, 34.2, 34.6, 35.0],
  },
  custom: { label: "Custom…", note: "Edit the size list below.", custom: true },
};

// ----------------------------------------------------------- DOM
const $ = (id) => document.getElementById(id);

let sizes = [...SIZE_PRESETS.common.sizes];

function parseSizes(text) {
  const out = text.split(/[\s,;]+/).map((s) => parseFloat(s)).filter((n) => isFinite(n) && n > 0);
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

// ----------------------------------------------------------- preset UI
const presetSel = $("preset");
for (const [key, p] of Object.entries(SIZE_PRESETS)) {
  const o = document.createElement("option");
  o.value = key; o.textContent = p.label;
  presetSel.appendChild(o);
}
presetSel.value = "common";

function applyPreset(key) {
  const p = SIZE_PRESETS[key];
  $("preset-note").textContent = p.note || "";
  if (p.custom) return;
  sizes = [...p.sizes];
  $("sizes").value = sizes.map((s) => s.toFixed(1)).join(", ");
  rebuild();
}

function markCustom() {
  if (presetSel.value !== "custom") {
    presetSel.value = "custom";
    $("preset-note").textContent = SIZE_PRESETS.custom.note;
  }
}

// CSG engraving makes a rebuild non-trivial, so coalesce rapid edits.
let rebuildTimer = null;
function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, 140);
}

presetSel.addEventListener("change", () => applyPreset(presetSel.value));

$("sizes").addEventListener("input", () => {
  sizes = parseSizes($("sizes").value);
  markCustom(); scheduleRebuild();
});

const MODE_NOTES = {
  tower: "Each ring's OUTER ⌀ is its labelled size. Insert the small end into the bike's seat tube; the largest ring that slides in is your seatpost size. Splits into telescoping segments if taller than the printer.",
  plate: "Slide a loose post through the holes; the smallest one it fits is its size. Lays out as a single flat card sized to the bed.",
};
function syncModeUI() {
  const mode = $("mode").value;
  $("tower-fields").classList.toggle("hidden", mode !== "tower");
  $("plate-fields").classList.toggle("hidden", mode !== "plate");
  $("mode-note").textContent = MODE_NOTES[mode];
}
$("mode").addEventListener("change", () => { syncModeUI(); framed = false; rebuild(); });

// every other numeric input rebuilds live (debounced — CSG is heavier)
["clearance", "ring_height", "wall", "label_size", "plate_thickness", "plate_pad",
  "max_z", "max_bed"].forEach((id) =>
  $(id).addEventListener("input", () => scheduleRebuild()));

// ----------------------------------------------------------- params
function readParams() {
  const v = (id) => parseFloat($(id).value);
  return {
    mode: $("mode").value,
    sizes: [...sizes],
    clearance: v("clearance"),
    ring_height: v("ring_height"),
    wall: v("wall"),
    label_size: v("label_size"),
    plate_thickness: v("plate_thickness"),
    plate_pad: v("plate_pad"),
    max_z: v("max_z"),
    max_bed: v("max_bed"),
  };
}

const ENGRAVE = 0.6;      // mm depth labels are cut INTO the surface (debossed)
const JOINT_H = 10;       // mm telescoping engagement between tower segments
const CAP_T = 3;          // mm solid roof above a segment's skirt
const SKIRT_WALL = 2.5;   // mm wall of the connecting skirt
const FIT_CLEAR = 0.35;   // mm slip-fit clearance on the skirt

// ----------------------------------------------------------- three.js scene
const canvas = $("scene");
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
const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
keyLight.position.set(200, -150, 400);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x88aaff, 0.4);
fillLight.position.set(-200, 200, -100);
scene.add(fillLight);

const grid = new THREE.GridHelper(600, 24, 0x2b313c, 0x1f232c);
grid.rotation.x = Math.PI / 2;
scene.add(grid);

const material = new THREE.MeshStandardMaterial({
  color: 0x4f9dff, metalness: 0.3, roughness: 0.55, side: THREE.DoubleSide,
});

const gaugeGroup = new THREE.Group();
scene.add(gaugeGroup);

let exportGeometries = [];  // engraved/solid geometries for STL export

// CSG evaluator used to cut (deboss) the size labels into the surfaces, so the
// printed digits sit BELOW the gauge surface and never interfere with a fit.
const evaluator = new Evaluator();
evaluator.useGroups = false;

// ----------------------------------------------------------- geometry helpers
// annular cylinder (tube) about the Z axis, optionally offset in X.
function tubeZ(innerR, outerR, z0, z1, xc = 0) {
  const profile = [
    new THREE.Vector2(innerR, z0), new THREE.Vector2(outerR, z0),
    new THREE.Vector2(outerR, z1), new THREE.Vector2(innerR, z1),
    new THREE.Vector2(innerR, z0),
  ];
  const g = new THREE.LatheGeometry(profile, 96);
  g.rotateX(Math.PI / 2);
  if (xc) g.translate(xc, 0, 0);
  return g;
}

// ----------------------------------------------------------- font / text
let font = null;
new FontLoader().load(
  "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/fonts/helvetiker_regular.typeface.json",
  (f) => { font = f; rebuild(); },
);

// Text as a solid, centered in X/Y, extruded `depth` along +Z (z = 0..depth).
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

// A cutter that engraves the label into a ring's outer cylindrical face,
// reading tangentially. The flat text plane sits proud of the curved surface by
// the chord sagitta, so the cutter is sunk an extra `sagitta` to guarantee the
// number's outer edges still break the surface (and we leave wall behind it).
function ringTextCutter(str, ringOD, midZ, size, minInnerR) {
  const g = makeText(str, size, 4);          // 4 mm radial reach (plenty)
  if (!g) return null;
  g.rotateX(Math.PI / 2);
  g.rotateZ(Math.PI / 2);                     // normal → +X, read → +Y, up → +Z
  g.computeBoundingBox();
  let b = g.boundingBox;
  const width = b.max.y - b.min.y;
  const R = ringOD / 2;
  const sagitta = R - Math.sqrt(Math.max(0, R * R - (width / 2) * (width / 2)));
  let innerX = R - (ENGRAVE + sagitta);       // deepest cut face
  if (minInnerR != null) innerX = Math.max(innerX, minInnerR); // never breach the bore
  g.translate(innerX - b.min.x, -(b.min.y + b.max.y) / 2, midZ - (b.min.z + b.max.z) / 2);
  return g;
}

// A cutter that engraves a label into a flat top face at z = topZ, at (cx, cy).
function flatTextCutter(str, cx, cy, topZ, size) {
  const g = makeText(str, size, ENGRAVE + 0.5);  // sinks ENGRAVE, pokes 0.5 proud
  if (!g) return null;
  g.translate(cx, cy, topZ - ENGRAVE);
  return g;
}

// ----------------------------------------------------------- builders
function clearGroup(group) {
  while (group.children.length) {
    const c = group.children.pop();
    c.geometry?.dispose();
    group.remove(c);
  }
}

function pushGeom(g) {
  gaugeGroup.add(new THREE.Mesh(g, material));
  exportGeometries.push(g);
}

// Subtract `cutter` from `base`, returning the engraved geometry. Falls back to
// the un-engraved base if the font isn't ready or CSG fails for any reason.
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

// Split the sorted sizes into vertical segments that each fit the printer's Z.
// Each segment after the first carries a skirt+cap coupler (adds JOINT_H+CAP_T).
function chunkSizes(sorted, ringH, maxZ) {
  const chunks = [];
  let cur = [];
  for (const s of sorted) {
    const coupler = chunks.length > 0 ? JOINT_H + CAP_T : 0;
    const h = coupler + (cur.length + 1) * ringH;
    if (cur.length && h > maxZ) { chunks.push(cur); cur = []; }
    cur.push(s);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

function buildTower(p) {
  const sorted = [...p.sizes];
  const ringH = Math.max(2, p.ring_height);
  const wall = Math.max(1, p.wall);
  const maxZ = Math.max(ringH + JOINT_H + CAP_T, p.max_z);
  const chunks = chunkSizes(sorted, ringH, maxZ);

  // The labelled size IS each ring's OUTER diameter — the tower is a plug gauge
  // you insert into the frame's seat tube. `clearance` is slip room removed from
  // the OD so a ring slides into a nominal-size tube. The bore just hollows it.
  const od = (s) => s - p.clearance;                   // outer ⌀ = labelled size
  const id = (s) => Math.max(4, od(s) - 2 * wall);     // bore ⌀ (keep ≥ 4 mm)
  const globalMaxOD = Math.max(...sorted.map(od)) + 2 * SKIRT_WALL;
  const gap = 14;
  const pitch = globalMaxOD + gap;

  const n = chunks.length;
  let prevTopSize = null;   // largest size of the previous (lower) chunk

  chunks.forEach((chunk, k) => {
    const xc = (k - (n - 1) / 2) * pitch;
    const hasCoupler = k > 0 && prevTopSize != null;
    const ringStartZ = hasCoupler ? JOINT_H + CAP_T : 0;

    // connecting coupler: a skirt that slips over the lower chunk's top ring,
    // plus a solid cap that the rings above sit on. Fully revolved (no CSG).
    if (hasCoupler) {
      const lowerTopOD = od(prevTopSize);
      const skirtIR = lowerTopOD / 2 + FIT_CLEAR;
      const skirtOR = skirtIR + SKIRT_WALL;
      pushGeom(tubeZ(skirtIR, skirtOR, 0, JOINT_H, xc));                      // skirt
      pushGeom(tubeZ(id(chunk[0]) / 2, skirtOR, JOINT_H, JOINT_H + CAP_T, xc)); // cap
    }

    chunk.forEach((s, i) => {
      const z0 = ringStartZ + i * ringH;
      const z1 = z0 + ringH;
      // build ring centered, engrave the label into its outer face, then offset
      const ring = tubeZ(id(s) / 2, od(s) / 2, z0, z1);
      const cutter = ringTextCutter(s.toFixed(1), od(s), (z0 + z1) / 2, p.label_size, id(s) / 2 + 0.6);
      const g = engrave(ring, cutter);
      if (xc) g.translate(xc, 0, 0);
      pushGeom(g);
    });

    prevTopSize = chunk[chunk.length - 1];
  });

  // readout
  const heights = chunks.map((c, k) =>
    (k > 0 ? JOINT_H + CAP_T : 0) + c.length * ringH);
  const rows = chunks.map((c, k) =>
    `<tr><th>segment ${k + 1}</th><td>${c.length} rings</td><td>${heights[k].toFixed(0)} mm</td></tr>`).join("");
  const overTall = heights.some((h) => h > p.max_z + 0.5);
  $("readout").innerHTML = `
    <table>
      <caption>Tower — ${sorted.length} sizes</caption>
      ${rows}
      <tr class="total"><th>segments</th><td colspan="2">${n}${n > 1 ? " (telescope together)" : ""}</td></tr>
      <tr><th>ring ⌀</th><td colspan="2">${od(sorted[0]).toFixed(1)}–${od(sorted[sorted.length - 1]).toFixed(1)} mm</td></tr>
      <tr><th>tallest</th><td colspan="2">${Math.max(...heights).toFixed(0)} / ${p.max_z} mm</td></tr>
      ${overTall ? `<tr><td colspan="3" class="warn">⚠ a segment exceeds max height</td></tr>` : ""}
    </table>`;

  return { span: globalMaxOD * n + gap * (n - 1), height: Math.max(...heights) };
}

function buildPlate(p) {
  const sorted = [...p.sizes];
  const wall = Math.max(1, p.wall);          // min wall between holes / to edge
  const pad = Math.max(2, p.plate_pad);
  const labelH = p.label_size;
  const thick = Math.max(2, p.plate_thickness);
  const maxDia = Math.max(...sorted) + p.clearance;

  // cell = hole + padding all round + a label strip below
  const cellW = maxDia + 2 * pad;
  const cellH = maxDia + 2 * pad + labelH + 2;
  const maxCols = Math.max(1, Math.floor((p.max_bed - 2 * wall) / cellW));
  const cols = Math.min(maxCols, sorted.length);
  const rows = Math.ceil(sorted.length / cols);

  const plateW = cols * cellW + 2 * wall;
  const plateH = rows * cellH + 2 * wall;
  const x0 = -plateW / 2, y0 = -plateH / 2;

  // plate as one extruded rectangle with circular holes (THREE.Shape holes)
  const shape = new THREE.Shape();
  const halfW = plateW / 2, halfH = plateH / 2, r = 5;
  shape.moveTo(-halfW + r, -halfH);
  shape.lineTo(halfW - r, -halfH);
  shape.absarc(halfW - r, -halfH + r, r, -Math.PI / 2, 0);
  shape.lineTo(halfW, halfH - r);
  shape.absarc(halfW - r, halfH - r, r, 0, Math.PI / 2);
  shape.lineTo(-halfW + r, halfH);
  shape.absarc(-halfW + r, halfH - r, r, Math.PI / 2, Math.PI);
  shape.lineTo(-halfW, -halfH + r);
  shape.absarc(-halfW + r, -halfH + r, r, Math.PI, 1.5 * Math.PI);

  const labels = [];
  sorted.forEach((s, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const cellLeft = x0 + wall + col * cellW;
    const cellTop = y0 + wall + plateH - 2 * wall - row * cellH;   // top of this cell (y)
    const cx = cellLeft + cellW / 2;
    const holeR = (s + p.clearance) / 2;
    const cy = cellTop - pad - holeR;          // hole near top of cell
    const labelY = cellTop - cellH + pad + labelH / 2 + 1;

    const hole = new THREE.Path();
    hole.absarc(cx, cy, holeR, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    labels.push({ s, cx, cy: labelY });
  });

  const plate = new THREE.ExtrudeGeometry(shape, {
    depth: thick, bevelEnabled: false, curveSegments: 48,
  });
  // engrave every label into the top face in a single CSG subtraction
  const cutters = labels
    .map((l) => flatTextCutter(l.s.toFixed(1), l.cx, l.cy, thick, labelH))
    .filter(Boolean);
  pushGeom(cutters.length ? engrave(plate, mergeGeometries(cutters)) : plate);

  const overBed = plateW > p.max_bed + 0.5 || plateH > p.max_bed + 0.5;
  $("readout").innerHTML = `
    <table>
      <caption>Flat gauge — ${sorted.length} holes</caption>
      <tr><th>layout</th><td colspan="2">${cols} × ${rows}</td></tr>
      <tr><th>plate</th><td colspan="2">${plateW.toFixed(0)} × ${plateH.toFixed(0)} mm</td></tr>
      <tr><th>thickness</th><td colspan="2">${thick} mm</td></tr>
      <tr class="total"><th>bed</th><td colspan="2">${p.max_bed} × ${p.max_bed} mm</td></tr>
      ${overBed ? `<tr><td colspan="3" class="warn">⚠ plate exceeds bed — trim sizes</td></tr>` : ""}
    </table>`;

  return { span: Math.max(plateW, plateH), height: thick };
}

let framed = false;
function frameCamera(span, height) {
  if (framed) return;
  framed = true;
  const r = Math.max(span, height) * 1.5;
  controls.target.set(0, 0, height / 2);
  camera.position.set(r * 0.9, -r * 1.2, r * 0.8 + height);
  controls.update();
}

function buildGauge() {
  clearGroup(gaugeGroup);
  exportGeometries = [];
  const p = readParams();
  if (!p.sizes.length) { $("readout").innerHTML = "<p class='warn'>Add at least one size.</p>"; return; }
  const dims = p.mode === "tower" ? buildTower(p) : buildPlate(p);
  frameCamera(dims.span, dims.height);
}

function rebuild() {
  try { buildGauge(); } catch (e) { console.error(e); }
}

// ----------------------------------------------------------- download
function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildSTL() {
  const tmp = new THREE.Group();
  for (const g of exportGeometries) tmp.add(new THREE.Mesh(g, material));
  const data = new STLExporter().parse(tmp, { binary: true });
  return new Blob([data], { type: "model/stl" });
}

function setStatus(msg, cls = "") { const s = $("status"); s.textContent = msg; s.className = "status " + cls; }

$("download").addEventListener("click", () => {
  const p = readParams();
  if (!p.sizes.length) { setStatus("Add at least one size", "error"); return; }
  const fname = `seatpost_gauge_${p.mode}_${p.sizes.length}sizes.stl`;
  try {
    triggerDownload(buildSTL(), fname);
    setStatus("Downloaded", "ok");
  } catch (e) {
    console.error(e);
    setStatus("Export failed: " + e.message, "error");
  }
});

// ----------------------------------------------------------- render loop
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}
function animate() {
  requestAnimationFrame(animate);
  resize();
  controls.update();
  renderer.render(scene, camera);
}

// ----------------------------------------------------------- init
$("sizes").value = sizes.map((s) => s.toFixed(1)).join(", ");
syncModeUI();
applyPreset("common");
animate();
