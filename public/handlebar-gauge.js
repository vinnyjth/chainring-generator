import { $, setupScene, onFontReady, buildNotchBar, triggerDownload } from "./gauge-lib.js";

// --------------------------------------------------------------- presets
// Round-tube clamp diameters (mm). The headline use is a handlebar's centre
// bulge, but stem steerer clamps, front-derailleur bands and seat collars share
// the same standards — verify against the real part with calipers.
const PRESETS = {
  handlebar: {
    label: "Handlebar clamp",
    note: "The four bar centre-bulge standards: 25.4 / 26.0 (older) and 31.8 / 35.0 (oversize).",
    sizes: [25.4, 26.0, 31.8, 35.0],
  },
  clamps: {
    label: "Stem & seat clamps",
    note: "Clamp-band sizes: 28.6 (1⅛″ steerer / small FD), 31.8, 34.9 (seat collar / FD).",
    sizes: [28.6, 31.8, 34.9],
  },
  all: {
    label: "Common round tubes",
    note: "Everything above plus 22.2 (grip / shifter clamp) in one bar.",
    sizes: [22.2, 25.4, 26.0, 28.6, 31.8, 34.9, 35.0],
  },
  custom: { label: "Custom…", note: "Edit the size list below.", custom: true },
};

let sizes = [...PRESETS.handlebar.sizes];

function parseSizes(text) {
  const out = text.split(/[\s,;]+/).map((s) => parseFloat(s)).filter((n) => isFinite(n) && n > 0);
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

// --------------------------------------------------------------- preset UI
const presetSel = $("preset");
for (const [key, p] of Object.entries(PRESETS)) {
  const o = document.createElement("option");
  o.value = key; o.textContent = p.label;
  presetSel.appendChild(o);
}
presetSel.value = "handlebar";

function applyPreset(key) {
  const p = PRESETS[key];
  $("preset-note").textContent = p.note || "";
  if (p.custom) return;
  sizes = [...p.sizes];
  $("sizes").value = sizes.map((s) => s.toFixed(1)).join(", ");
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
  sizes = parseSizes($("sizes").value);
  markCustom(); scheduleRebuild();
});
["clearance", "thickness", "wall", "label_size", "max_bed"].forEach((id) =>
  $(id).addEventListener("input", scheduleRebuild));

// CSG is heavy, so coalesce rapid edits.
let rebuildTimer = null;
function scheduleRebuild() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuild, 140); }

// --------------------------------------------------------------- params
function readParams() {
  const v = (id) => parseFloat($(id).value);
  return {
    entries: sizes.map((d) => ({ d, label: d.toFixed(1) })),
    clearance: v("clearance"),
    thick: v("thickness"),
    wall: v("wall"),
    labelH: v("label_size"),
    maxBed: v("max_bed"),
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
  const r = buildNotchBar(p);
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
    triggerDownload(S.exportSTL(), `handlebar_gauge_${p.entries.length}sizes.stl`);
    setStatus("Downloaded", "ok");
  } catch (e) { console.error(e); setStatus("Export failed: " + e.message, "error"); }
});

// --------------------------------------------------------------- init
$("sizes").value = sizes.map((s) => s.toFixed(1)).join(", ");
applyPreset("handlebar");
