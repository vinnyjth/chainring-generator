import { $, setupScene, onFontReady, buildHolePlate, triggerDownload } from "./gauge-lib.js";

// --------------------------------------------------------------- presets
// Loose ball bearings are sold in fractional inches, so each preset entry pairs
// the true diameter (mm) with its fraction label. Diameters: 1/8″=3.175,
// 5/32″=3.969, 3/16″=4.762, 7/32″=5.556, 1/4″=6.350, 9/32″=7.144, 5/16″=7.938.
const PRESETS = {
  bike: {
    label: "Bike loose balls",
    note: "The five sizes that cover almost every cup-and-cone bike bearing.",
    entries: [
      { d: 3.175, label: "1/8" }, { d: 3.969, label: "5/32" }, { d: 4.762, label: "3/16" },
      { d: 5.556, label: "7/32" }, { d: 6.350, label: "1/4" },
    ],
  },
  extended: {
    label: "Extended (+9/32, 5/16)",
    note: "Adds the two larger sizes seen on some old BBs and headsets.",
    entries: [
      { d: 3.175, label: "1/8" }, { d: 3.969, label: "5/32" }, { d: 4.762, label: "3/16" },
      { d: 5.556, label: "7/32" }, { d: 6.350, label: "1/4" }, { d: 7.144, label: "9/32" },
      { d: 7.938, label: "5/16" },
    ],
  },
  metric: {
    label: "Metric 3–6 mm",
    note: "Whole/half-mm balls for metric or industrial bearings.",
    entries: [3, 3.5, 4, 4.5, 5, 5.5, 6].map((d) => ({ d, label: d.toString() })),
  },
  custom: { label: "Custom…", note: "Edit the size list below (labelled in mm).", custom: true },
};

let entries = [...PRESETS.bike.entries];

function parseSizes(text) {
  const out = text.split(/[\s,;]+/).map((s) => parseFloat(s)).filter((n) => isFinite(n) && n > 0);
  return Array.from(new Set(out)).sort((a, b) => a - b).map((d) => ({ d, label: d.toFixed(2) }));
}
function fillSizes() { $("sizes").value = entries.map((e) => e.d.toFixed(2)).join(", "); }

// --------------------------------------------------------------- preset UI
const presetSel = $("preset");
for (const [key, p] of Object.entries(PRESETS)) {
  const o = document.createElement("option");
  o.value = key; o.textContent = p.label;
  presetSel.appendChild(o);
}
presetSel.value = "bike";

function applyPreset(key) {
  const p = PRESETS[key];
  $("preset-note").textContent = p.note || "";
  if (p.custom) return;
  entries = p.entries.map((e) => ({ ...e }));
  fillSizes();
  rebuild();
}
function markCustom() {
  if (presetSel.value !== "custom") {
    presetSel.value = "custom";
    $("preset-note").textContent = PRESETS.custom.note;
  }
}

presetSel.addEventListener("change", () => applyPreset(presetSel.value));
$("sizes").addEventListener("input", () => {
  entries = parseSizes($("sizes").value);
  markCustom(); scheduleRebuild();
});
["clearance", "thickness", "pad", "wall", "label_size", "max_bed"].forEach((id) =>
  $(id).addEventListener("input", scheduleRebuild));

let rebuildTimer = null;
function scheduleRebuild() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuild, 140); }

// --------------------------------------------------------------- params
function readParams() {
  const v = (id) => parseFloat($(id).value);
  return {
    entries: entries.map((e) => ({ ...e })),
    clearance: v("clearance"),
    thick: v("thickness"),
    pad: v("pad"),
    wall: v("wall"),
    labelH: v("label_size"),
    maxBed: v("max_bed"),
    caption: "Bearing gauge",
  };
}

// --------------------------------------------------------------- scene + build
const S = setupScene($("scene"));
S.start();
onFontReady(rebuild);

function buildGauge() {
  S.clear();
  const p = readParams();
  if (!p.entries.length) { $("readout").innerHTML = "<p class='warn'>Add at least one size.</p>"; return; }
  const r = buildHolePlate(p);
  r.geoms.forEach(S.add);
  $("readout").innerHTML = r.readoutHTML;
  S.frameCamera(r.span, r.height);
}
function rebuild() { try { buildGauge(); } catch (e) { console.error(e); } }

// --------------------------------------------------------------- download
function setStatus(msg, cls = "") { const s = $("status"); s.textContent = msg; s.className = "status " + cls; }
$("download").addEventListener("click", () => {
  const p = readParams();
  if (!p.entries.length) { setStatus("Add at least one size", "error"); return; }
  try {
    triggerDownload(S.exportSTL(), `bearing_gauge_${p.entries.length}sizes.stl`);
    setStatus("Downloaded", "ok");
  } catch (e) { console.error(e); setStatus("Export failed: " + e.message, "error"); }
});

// --------------------------------------------------------------- init
fillSizes();
applyPreset("bike");
