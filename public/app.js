import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";

const CHAIN_PITCH = 12.7;

// ----------------------------------------------------------- presets
// Industry-typical starting points. `chainline` is the spec chainline (frame
// centerline -> center of the ring group); verify against your real crankset.
const PRESETS = {
  "road-compact": {
    label: "Road 2× Compact (50/34)", note: "Most common modern road double. Chainline ≈ 43.5 mm.",
    rings: 2, teeth: [34, 50], chainline: 43.5, spacing: 8, crank: 172.5, shell: "68",
  },
  "road-standard": {
    label: "Road 2× Standard (53/39)", note: "Classic racing gearing. Chainline ≈ 43.5 mm.",
    rings: 2, teeth: [39, 53], chainline: 43.5, spacing: 8, crank: 170, shell: "68",
  },
  "road-subcompact": {
    label: "Road 2× Sub-compact (48/32)", note: "Endurance / climbing gearing. Chainline ≈ 43.5 mm.",
    rings: 2, teeth: [32, 48], chainline: 43.5, spacing: 8, crank: 172.5, shell: "68",
  },
  "gravel-1x": {
    label: "Gravel 1× (40T)", note: "Typical 1× gravel ring. Chainline ≈ 46 mm.",
    rings: 1, teeth: [40], chainline: 46, spacing: 0, crank: 172.5, shell: "68",
  },
  "mtb-1x-32": {
    label: "MTB 1× (32T)", note: "Trail 1×, Boost. Chainline ≈ 52 mm on a 73 mm shell.",
    rings: 1, teeth: [32], chainline: 52, spacing: 0, crank: 175, shell: "73",
  },
  "mtb-1x-34": {
    label: "MTB 1× (34T)", note: "XC 1×, Boost. Chainline ≈ 52 mm on a 73 mm shell.",
    rings: 1, teeth: [34], chainline: 52, spacing: 0, crank: 175, shell: "73",
  },
  "touring-3x": {
    label: "Touring 3× (48/36/26)", note: "Classic mountain/touring triple. Chainline ≈ 45 mm.",
    rings: 3, teeth: [26, 36, 48], chainline: 45, spacing: 8, crank: 175, shell: "68",
  },
  "custom": { label: "Custom…", note: "Enter your own measured values.", custom: true },
};

// ----------------------------------------------------------- DOM
const $ = (id) => document.getElementById(id);
const ids = ["rings", "chainline", "spacing", "crank", "crank_offset", "shell_width",
  "spigot_dia", "face_dia", "spigot_depth", "style", "ring_thickness", "fin_width",
  "crank_thickness", "crank_width", "hub_radius", "bore", "margin"];

let teethValues = [34, 50];

function ringOuterRadius(teeth, margin) {
  const d = CHAIN_PITCH * (0.6 + 1.0 / Math.tan(Math.PI / teeth));
  return d / 2.0 + margin;
}

// Split rings into a continuous, gap-free stack of axial bands joined at the
// midpoints between adjacent rings -> one connected stepped solid (printable).
// If zConnect (the crank's inboard face) is given, the outer ring's band
// extends outboard to meet it, closing the ring->crank gap (never shrinking).
function ringBands(ringZ, ringR, ringThickness, zConnect) {
  const n = ringZ.length;
  let lastTop = ringZ[n - 1] + ringThickness / 2;
  if (zConnect != null) lastTop = Math.max(zConnect, lastTop);
  if (n === 1) return [[ringZ[0] - ringThickness / 2, lastTop, ringR[0]]];
  const bands = [];
  let bPrev = ringZ[0] - ringThickness / 2;
  for (let i = 0; i < n; i++) {
    const bNext = i < n - 1 ? (ringZ[i] + ringZ[i + 1]) / 2 : lastTop;
    if (bNext - bPrev > 1e-6) bands.push([bPrev, bNext, ringR[i]]);
    bPrev = bNext;
  }
  return bands;
}

// ----------------------------------------------------------- preset UI
const presetSel = $("preset");
for (const [key, p] of Object.entries(PRESETS)) {
  const o = document.createElement("option");
  o.value = key; o.textContent = p.label;
  presetSel.appendChild(o);
}
presetSel.value = "road-compact";

function applyPreset(key) {
  const p = PRESETS[key];
  $("preset-note").textContent = p.note || "";
  if (p.custom) return;
  $("rings").value = String(p.rings);
  teethValues = [...p.teeth];
  renderTeethInputs();
  $("chainline").value = p.chainline;
  $("spacing").value = p.spacing;
  $("crank").value = p.crank;
  $("shell_width").value = p.shell;
  syncRegState();
  rebuild();
}

function renderTeethInputs() {
  const rings = parseInt($("rings").value, 10);
  const labels = rings === 1 ? ["ring"] :
    rings === 2 ? ["inner", "outer"] : ["inner", "middle", "outer"];
  while (teethValues.length < rings) teethValues.push(teethValues[teethValues.length - 1] || 32);
  teethValues = teethValues.slice(0, rings);
  const wrap = $("teeth-inputs");
  wrap.innerHTML = "";
  for (let i = 0; i < rings; i++) {
    const d = document.createElement("div");
    d.className = "tooth";
    const inp = document.createElement("input");
    inp.type = "number"; inp.min = "3"; inp.step = "1"; inp.value = teethValues[i];
    inp.addEventListener("input", () => {
      teethValues[i] = parseInt(inp.value, 10) || 0;
      markCustom(); rebuild();
    });
    const lab = document.createElement("span");
    lab.textContent = labels[i];
    d.appendChild(inp); d.appendChild(lab);
    wrap.appendChild(d);
  }
}

function markCustom() {
  if (presetSel.value !== "custom") {
    presetSel.value = "custom";
    $("preset-note").textContent = PRESETS.custom.note;
  }
}

function syncRegState() {
  const on = $("shell_width").value !== "";
  document.querySelectorAll(".reg-only").forEach((el) => el.classList.toggle("disabled", !on));
}

presetSel.addEventListener("change", () => applyPreset(presetSel.value));
$("rings").addEventListener("change", () => { markCustom(); renderTeethInputs(); rebuild(); });
$("shell_width").addEventListener("change", () => { markCustom(); syncRegState(); rebuild(); });
ids.filter((i) => !["rings", "shell_width"].includes(i)).forEach((i) =>
  $(i).addEventListener("input", () => { markCustom(); rebuild(); }));
$("lighten").addEventListener("change", () => { markCustom(); rebuild(); });

// ----------------------------------------------------------- params
function readParams() {
  const v = (id) => parseFloat($(id).value);
  const shell = $("shell_width").value;
  return {
    rings: parseInt($("rings").value, 10),
    teeth: [...teethValues],
    chainline: v("chainline"), spacing: v("spacing"),
    crank: v("crank"), crank_offset: v("crank_offset"),
    shell_width: shell === "" ? null : parseFloat(shell),
    spigot_dia: v("spigot_dia"), face_dia: v("face_dia"), spigot_depth: v("spigot_depth"),
    style: $("style").value,
    ring_thickness: v("ring_thickness"), fin_width: v("fin_width"),
    crank_thickness: v("crank_thickness"), crank_width: v("crank_width"),
    hub_radius: v("hub_radius"), bore: v("bore"), margin: v("margin"),
    lighten: $("lighten").checked,
  };
}

// ----------------------------------------------------------- three.js scene
const canvas = $("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1115);

const camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
camera.up.set(0, 0, 1); // Z is the spindle axis -> make it "up"
camera.position.set(260, -320, 220);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(200, -150, 400);
scene.add(key);
const fill = new THREE.DirectionalLight(0x88aaff, 0.4);
fill.position.set(-200, 200, -100);
scene.add(fill);

// ground grid on the XY plane (Z=0)
const grid = new THREE.GridHelper(600, 24, 0x2b313c, 0x1f232c);
grid.rotation.x = Math.PI / 2;
scene.add(grid);

// axes: X (red) toward chainstay, Z (blue) along BB
const axes = new THREE.AxesHelper(60);
scene.add(axes);

const material = new THREE.MeshStandardMaterial({
  color: 0x4f9dff, metalness: 0.35, roughness: 0.5,
  side: THREE.DoubleSide,
});
const ghostMat = new THREE.MeshStandardMaterial({
  color: 0xffb74f, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
});

const gaugeGroup = new THREE.Group();   // rotates with the sweep slider
const ghostGroup = new THREE.Group();   // BB shell ghost, does not rotate
scene.add(gaugeGroup);
scene.add(ghostGroup);

let exportGeometries = [];  // canonical (sweep=0) geometries for STL export

// geometry helpers — transforms baked into geometry so export matches preview
function cylZ(radius, z0, z1) {
  const h = z1 - z0;
  const g = new THREE.CylinderGeometry(radius, radius, h, 64);
  g.rotateX(Math.PI / 2);          // Y-axis cylinder -> Z-axis
  g.translate(0, 0, z0 + h / 2);
  return g;
}
// annular cylinder (cylinder with an axial bore) via a revolved rectangle
function tubeZ(innerR, outerR, z0, z1) {
  const profile = [
    new THREE.Vector2(innerR, z0), new THREE.Vector2(outerR, z0),
    new THREE.Vector2(outerR, z1), new THREE.Vector2(innerR, z1),
    new THREE.Vector2(innerR, z0),                  // close the loop -> watertight tube
  ];
  const g = new THREE.LatheGeometry(profile, 64);
  g.rotateX(Math.PI / 2);          // revolve axis Y -> Z
  return g;
}
// solid cylinder, or a tube when a bore is requested (matches the Python port)
function boredZ(outerR, z0, z1, boreR) {
  return boreR > 0 ? tubeZ(boreR, outerR, z0, z1) : cylZ(outerR, z0, z1);
}
function finBox(inner, outer, width, thickness, zc) {
  const length = outer - inner;
  const g = new THREE.BoxGeometry(length, width, thickness);
  g.translate(inner + length / 2, 0, zc);
  return g;
}

// A radial fin as a solid box, or — when `lighten` is set — a trussed frame
// (perimeter rails + evenly spaced rungs) leaving rectangular windows through
// the thickness to cut filament. No CSG required. Returns an array of geoms.
const BORDER = 3.5;   // rail / cap thickness (mm)
const RUNG = 3.5;     // cross-rung width (mm)
const WINDOW = 14;    // target window length (mm)
function finElement(inner, outer, width, thickness, zc, lighten) {
  const length = outer - inner;
  // too small to usefully lighten -> keep it solid
  if (!lighten || length < 2 * BORDER + WINDOW || width < 2 * BORDER + 6) {
    return [finBox(inner, outer, width, thickness, zc)];
  }
  const halfW = width / 2;
  const boxXY = (x0, x1, y0, y1) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, thickness);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, zc);
    return g;
  };
  const geos = [
    boxXY(inner, outer, halfW - BORDER, halfW),          // +Y rail
    boxXY(inner, outer, -halfW, -halfW + BORDER),        // -Y rail
    boxXY(inner, inner + BORDER, -halfW, halfW),         // inner cap (root)
    boxXY(outer - BORDER, outer, -halfW, halfW),         // outer cap
  ];
  const x0 = inner + BORDER, x1 = outer - BORDER, span = x1 - x0;
  const m = Math.max(1, Math.round(span / WINDOW));      // number of windows
  const cw = span / m;
  for (let i = 1; i < m; i++) {                          // m-1 rungs between them
    const cx = x0 + i * cw;
    geos.push(boxXY(cx - RUNG / 2, cx + RUNG / 2, -halfW, halfW));
  }
  return geos;
}

function clearGroup(group) {
  while (group.children.length) {
    const c = group.children.pop();
    c.geometry?.dispose();
    group.remove(c);
  }
}

function buildGauge() {
  clearGroup(gaugeGroup);
  clearGroup(ghostGroup);
  exportGeometries = [];

  const p = readParams();
  // Chainline is measured from the frame centerline (center of the seat tube /
  // BB shell, at Z = -shell_width/2) to the CENTER of the ring group. Place the
  // rings symmetrically about that center so the midpoint (2x) / middle ring
  // (3x) / single ring (1x) lands on the chainline. Without a shell width, the
  // chainline is taken from the drive face (Z=0).
  const halfShell = p.shell_width ? p.shell_width / 2 : 0;
  const ringCenterZ = p.chainline - halfShell;
  const ringZ = Array.from({ length: p.rings },
    (_, i) => ringCenterZ + (i - (p.rings - 1) / 2) * p.spacing);
  const ringR = p.teeth.map((t) => ringOuterRadius(t, p.margin));
  const crankR = p.crank + p.margin;
  const crankZ = ringZ[ringZ.length - 1] + p.crank_offset;
  const zTop = crankZ + p.crank_thickness / 2;
  const zLow = p.shell_width ? -p.spigot_depth : 0;

  // Central column: when a shell flange is used, widen the hub to the flange
  // diameter so the part has one flat circular base (no thin protruding flange
  // to print). The bore hollows it out; keep a min wall on every bored part.
  const hubR = p.shell_width ? Math.max(p.hub_radius, p.face_dia / 2) : p.hub_radius;
  let boreR = p.bore / 2;
  boreR = Math.min(boreR, hubR - 2);
  if (p.shell_width) boreR = Math.min(boreR, p.spigot_dia / 2 - 2);
  boreR = Math.max(0, boreR);
  const inner = Math.max(hubR * 0.6, boreR + 1);  // fins start outside the bore
  const lighten = p.lighten && p.style === "arms";

  const geoms = [];
  geoms.push(boredZ(hubR, 0, zTop, boreR));                          // wide central column
  if (p.shell_width) {
    geoms.push(boredZ(p.spigot_dia / 2, -p.spigot_depth, 0, boreR)); // short centering spigot
  }
  // chainrings: one continuous, gap-free stepped solid that also closes the
  // gap up to the crank's inboard face (single connected body)
  const crankInboard = crankZ - p.crank_thickness / 2;
  for (const [z0, z1, r] of ringBands(ringZ, ringR, p.ring_thickness, crankInboard)) {
    if (p.style === "disk") geoms.push(boredZ(r, z0, z1, boreR));
    else geoms.push(...finElement(inner, r, p.fin_width, z1 - z0, (z0 + z1) / 2, lighten));
  }
  if (p.style === "disk") geoms.push(cylZ(crankR, crankZ - p.crank_thickness / 2, crankZ + p.crank_thickness / 2));
  else geoms.push(...finElement(inner, crankR, p.crank_width, p.crank_thickness, crankZ, lighten));

  for (const g of geoms) {
    gaugeGroup.add(new THREE.Mesh(g, material));
    exportGeometries.push(g);
  }

  // BB shell ghost: translucent cylinder the spigot drops into (drive face..non-drive face)
  if (p.shell_width) {
    const sg = cylZ(p.spigot_dia / 2 + 1.5, -p.shell_width, 0);
    ghostGroup.add(new THREE.Mesh(sg, ghostMat));
  }

  updateReadout(p, ringR, ringZ, crankR, crankZ, zTop, zLow);
  frameCamera(Math.max(...ringR, crankR), zLow, zTop);
}

let framed = false;
function frameCamera(span, zLow, zTop) {
  if (framed) return;  // only auto-frame on first build
  framed = true;
  const r = Math.max(span, (zTop - zLow) / 2) * 1.6;
  controls.target.set(0, 0, (zLow + zTop) / 2);
  camera.position.set(r * 1.0, -r * 1.25, r * 0.85 + zTop);
  controls.update();
}

function updateReadout(p, ringR, ringZ, crankR, crankZ, zTop, zLow) {
  const rows = ringR.map((r, i) =>
    `<tr><th>ring ${i + 1} (${p.teeth[i]}T)</th><td>⌀${(2 * r).toFixed(1)}</td><td>z ${ringZ[i].toFixed(1)}</td></tr>`).join("");
  $("readout").innerHTML = `
    <table>
      <caption>Swept geometry</caption>
      ${rows}
      <tr><th>crank arm</th><td>⌀${(2 * crankR).toFixed(1)}</td><td>z ${crankZ.toFixed(1)}</td></tr>
      <tr class="total"><th>reach (one side)</th><td colspan="2">${Math.max(...ringR, crankR).toFixed(1)} mm</td></tr>
      <tr><th>axial extent</th><td colspan="2">${zLow.toFixed(1)} … ${zTop.toFixed(1)} mm</td></tr>
    </table>`;
}

function rebuild() {
  try { buildGauge(); } catch (e) { console.error(e); }
}

// ----------------------------------------------------------- sweep slider
$("sweep").addEventListener("input", (e) => {
  const deg = parseFloat(e.target.value);
  $("sweep-val").textContent = `${deg}°`;
  gaugeGroup.rotation.z = THREE.MathUtils.degToRad(deg);
});

// ----------------------------------------------------------- download
function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Export the canonical (sweep=0) geometries as a binary STL. STLExporter
// traverses the group and computes face normals from vertices, so mixed
// geometry types (boxes, cylinders, lathe tubes) export without merging.
function buildSTL() {
  const tmp = new THREE.Group();
  for (const g of exportGeometries) tmp.add(new THREE.Mesh(g, material));
  const data = new STLExporter().parse(tmp, { binary: true });
  return new Blob([data], { type: "model/stl" });
}

function setStatus(msg, cls = "") { const s = $("status"); s.textContent = msg; s.className = "status " + cls; }

$("download").addEventListener("click", () => {
  const p = readParams();
  if (p.teeth.some((t) => !t || t < 3)) { setStatus("Tooth counts must be ≥ 3", "error"); return; }
  const fname = `chainring_gauge_${p.teeth.join("-")}_${p.style}.stl`;
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
renderTeethInputs();
applyPreset("road-compact");
syncRegState();
animate();
