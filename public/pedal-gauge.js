import { $, setupScene, onFontReady, buildHolePlate, triggerDownload } from "./gauge-lib.js";

// --------------------------------------------------------------- presets
// The two pedal threads in circulation are both 20 TPI, so only the major
// (crest) diameter separates them: 1/2″ = 12.70 mm, 9/16″ = 14.29 mm.
const PRESETS = {
  standard: {
    label: "½″ & 9⁄16″ (standard)",
    note: "Adult cranks are 9⁄16″; one-piece / BMX / kids cranks are 1⁄2″.",
    entries: [{ d: 12.70, label: "1/2" }, { d: 14.29, label: "9/16" }],
  },
  custom: { label: "Custom…", note: "Edit the size list below (labelled in mm).", custom: true },
};

let entries = [...PRESETS.standard.entries];

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
presetSel.value = "standard";

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
    caption: "Pedal gauge",
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
    triggerDownload(S.exportSTL(), `pedal_gauge_${p.entries.length}sizes.stl`);
    setStatus("Downloaded", "ok");
  } catch (e) { console.error(e); setStatus("Export failed: " + e.message, "error"); }
});

// --------------------------------------------------------------- init
fillSizes();
applyPreset("standard");
