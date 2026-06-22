# Chainring Clearance Gauge — Web App Handoff

## Goal
A web app that lets a user enter crankset parameters, **live-previews** the
resulting clearance gauge in 3D, and **downloads an STL**. The STL represents
the clearance swept by a crankset's chainring(s) and crank arm, used to check
against the drive-side chainstay of a bike frame.

`chainring_clearance_gauge.py` (included) is the working reference
implementation. Match its geometry exactly; the JS port should produce the
same shape.

## Recommended architecture (no backend needed)
- **Static, client-side app.** Everything runs in the browser → deploy to a
  static host (Vercel works well). No server, no Python runtime to host.
- **Stack:** React + three.js (or react-three-fiber). Use `OrbitControls` for
  the preview and three's `STLExporter` for download.
- **Geometry:** build the same primitives the Python tool uses — cylinders +
  boxes. For STL you do NOT need boolean union: a merged multi-body mesh
  (`BufferGeometryUtils.mergeGeometries`) exports to a valid STL that slicers
  handle fine. (Optional phase 2: clean watertight union via the
  `manifold-3d` WASM package, which is the same engine the Python tool uses.)
- **Preview niceties:** a rotation slider that spins the gauge about the BB
  (Z) axis to sweep clearance; a translucent ghost cylinder for the BB shell;
  axis labels (Z = BB axis, X = toward chainstay).

## Geometry spec (authoritative — port this exactly)

**Coordinate system**
- `+Z` = BB spindle axis, pointing to the drive side.
- `Z = 0` = drive-side face of the BB shell; `offset` is measured from here.
- All fins point along `+X`. Rotating about `Z` sweeps the clearance circle.

**Chainring outer radius** (ANSI sprocket OD, runs a few mm oversize = safe):
```
p = 12.7                      # chain pitch, mm
D = p * (0.6 + 1/tan(pi/N))   # N = tooth count
radius = D/2 + margin
```

**Elements** (all concentric about Z):
- Ring i at `z_i = offset + i*spacing`, radius from its tooth count.
  Teeth listed INNER→OUTER (inner = closest to frame).
- Crank arm: radius = `crank_length + margin`, at
  `z = z_lastRing + crank_offset` (default crank_offset 10mm, outboard).

**Two styles**
- `arms` (default): one rectangular fin per element, all pointing +X.
  Fin = box [length = radius − innerRoot, width, thickness], placed so its
  inner end overlaps the hub, centered at the element's z.
- `disk`: each element is a full solid cylinder of its radius and thickness
  (the literal swept envelope; static check, no rotation).

**Hub + shell registration**
- Hub: cylinder, radius `hub_radius` (12mm), from Z=0 to top of crank fin.
- Through-bore: axial cylinder of `bore` dia (8mm) for an alignment rod.
- If `shell_width` given: add a centering spigot (cyl, `spigot_dia`) from
  Z=0 inboard to the frame centerline at `Z = -shell_width/2`, plus a face
  flange (cyl, `face_dia`) at Z=0..+2 that seats on the shell end face.
  NOTE: shell *width* is the axial shell length (68 or 73 = drive face to
  non-drive face). It only positions inboard features along Z; it is NOT a
  diameter. `spigot_dia` ≈ shell inner bore, `face_dia` ≥ shell OD.

## Parameters / UI fields (with current defaults)
| field | default | notes |
|---|---|---|
| rings | 1 | 1–3 |
| teeth[] | — | one per ring, inner→outer |
| offset (mm) | — | drive face → first ring |
| spacing (mm) | 0 | between rings |
| crank (mm) | — | BB axis → pedal axle |
| shell_width (mm) | none | 68 / 73; adds registration |
| style | arms | arms / disk |
| spigot_dia (mm) | 30 | = shell inner bore |
| face_dia (mm) | 42 | ≥ shell OD |
| ring_thickness | 3 | axial mm per ring |
| fin_width | 15 | ring fin width |
| crank_thickness | 15 | axial mm of crank fin |
| crank_width | 18 | |
| crank_offset | 10 | crank outboard of outer ring |
| hub_radius | 12 | |
| bore | 8 | rod hole; 0 = none |
| margin | 0 | inflate all radii (safety) |

## Suggested build phases
1. Param form + three.js scene that renders the `arms` primitives live.
2. STL export (merged mesh) + download.
3. Shell ghost + rotation-sweep slider + `disk` style toggle.
4. (Optional) manifold-3d WASM for watertight union output.

## Kickoff prompt to paste into Claude Code
> I'm building a client-side web app (React + three.js, static deploy) that
> previews and exports an STL for a bike crank/chainring clearance gauge.
> `chainring_clearance_gauge.py` in this folder is the working reference —
> match its geometry exactly. Read `HANDOFF.md` for the full spec, then
> scaffold the app and implement phase 1 (param form + live three.js preview
> of the `arms` style). No backend.
