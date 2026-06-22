#!/usr/bin/env python3
"""
chainring_clearance_gauge.py
============================

Generate an STL that represents the clearance swept by a crankset's
chainring(s) and crank arm, for checking against the DRIVE-SIDE CHAINSTAY
of a bicycle frame.

Because the chainstay sits in one place, the gauge only needs to show
clearance in ONE direction: a single radial fin per element (each ring +
the crank arm), all pointing the same way. You seat it on the BB axis,
point the fins at the chainstay, and rotate to the worst-case position.
Each fin sits at the exact radius and axial depth of the part it stands in
for, so it traces the real swept circle.

Coordinate system
-----------------
  +Z   = BB spindle axis, pointing toward the DRIVE side.
  Z=0  = drive-side face of the BB shell (what --offset is measured from).
  Fins all point along +X. Rotate about Z to sweep.

Shell registration (when --shell-width is given)
-----------------------------------------------
  * a face flange seats on the shell end face  -> puts Z=0 on the drive face
  * a centering spigot drops into the shell to the frame centerline
  * the through-bore runs the whole length for an alignment rod
  Set --spigot-dia to your shell's inner bore and --face-dia >= shell OD
  for a snug fit (defaults suit a ~BSA/threaded shell).

Chainring diameter:  ANSI sprocket OD  D = p*(0.6 + cot(180/N)), p = 12.7 mm,
which runs a few mm oversize -> safe for a clearance gauge.

Example
-------
  python3 chainring_clearance_gauge.py --rings 2 --teeth 34 50 \
      --offset 8 --spacing 8 --crank 170 --shell-width 73 -o gauge.stl
"""

import argparse
import math
import sys

import numpy as np
import trimesh
from trimesh.transformations import rotation_matrix

CHAIN_PITCH = 12.7  # mm, 1/2" bicycle chain


# -------------------------------------------------------------------- helpers
def ring_outer_radius(teeth, margin=0.0):
    d = CHAIN_PITCH * (0.6 + 1.0 / math.tan(math.pi / teeth))
    return d / 2.0 + margin


def cylinder(radius, z0, z1, sections=128):
    h = z1 - z0
    c = trimesh.creation.cylinder(radius=radius, height=h, sections=sections)
    c.apply_translation([0, 0, z0 + h / 2.0])
    return c


def radial_fin(inner_r, outer_r, width, thickness, z_center, angle=0.0):
    length = outer_r - inner_r
    box = trimesh.creation.box(extents=[length, width, thickness])
    box.apply_translation([inner_r + length / 2.0, 0, z_center])
    box.apply_transform(rotation_matrix(angle, [0, 0, 1]))
    return box


def boolean(meshes, op):
    try:
        eng = "manifold"
        return (trimesh.boolean.union(meshes, engine=eng) if op == "union"
                else trimesh.boolean.difference(meshes, engine=eng))
    except Exception as exc:  # pragma: no cover
        print(f"  [warn] boolean '{op}' fell back to concatenate ({exc})",
              file=sys.stderr)
        return trimesh.util.concatenate(meshes)


# -------------------------------------------------------------------- builder
def build_gauge(rings, teeth, offset, spacing, crank_len, style,
                ring_thickness, fin_width, crank_thickness, crank_width,
                crank_offset, hub_radius, bore_dia, margin,
                shell_width, spigot_dia, face_dia):

    ring_z = [offset + i * spacing for i in range(rings)]
    ring_r = [ring_outer_radius(t, margin) for t in teeth]
    crank_r = crank_len + margin
    crank_z = ring_z[-1] + crank_offset
    z_top = crank_z + crank_thickness / 2.0
    inner = hub_radius * 0.6

    # hub starts at the drive face, or at the frame centerline if a shell is set
    z_low = -shell_width / 2.0 if shell_width else 0.0

    parts = [cylinder(hub_radius, 0.0, z_top)]

    # shell registration features
    if shell_width:
        parts.append(cylinder(spigot_dia / 2.0, z_low, 0.0))       # into the shell
        parts.append(cylinder(face_dia / 2.0, 0.0, 2.0))           # seats on shell face

    # elements -> single fin each (one direction) or full disk
    for r, z in zip(ring_r, ring_z):
        if style == "disk":
            parts.append(cylinder(r, z - ring_thickness / 2.0, z + ring_thickness / 2.0))
        else:
            parts.append(radial_fin(inner, r, fin_width, ring_thickness, z))

    if style == "disk":
        parts.append(cylinder(crank_r, crank_z - crank_thickness / 2.0,
                              crank_z + crank_thickness / 2.0))
    else:
        parts.append(radial_fin(inner, crank_r, crank_width, crank_thickness, crank_z))

    solid = boolean(parts, "union")

    if bore_dia > 0:
        solid = boolean([solid, cylinder(bore_dia / 2.0, z_low - 10, z_top + 10)],
                        "difference")

    info = dict(ring_z=ring_z, ring_r=ring_r, crank_r=crank_r, crank_z=crank_z,
                z_top=z_top, z_low=z_low,
                span=max(ring_r + [crank_r]))
    return solid, info


# -------------------------------------------------------------------- cli
def main():
    p = argparse.ArgumentParser(
        description="STL clearance gauge for crank + chainrings (drive-side chainstay).",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    p.add_argument("--rings", type=int, default=1, choices=[1, 2, 3],
                   help="number of chainrings (1-3)")
    p.add_argument("--teeth", type=int, nargs="+", required=True,
                   help="tooth count per ring, INNER->OUTER (inner=closest to frame)")
    p.add_argument("--offset", type=float, required=True,
                   help="mm from BB-shell drive face to the first (inner) ring")
    p.add_argument("--spacing", type=float, default=0.0,
                   help="mm between adjacent chainrings")
    p.add_argument("--crank", type=float, required=True,
                   help="crank arm length in mm (BB axis to pedal axle)")
    p.add_argument("--shell-width", type=float, default=None,
                   help="BB shell width (e.g. 68 or 73); adds shell registration")
    p.add_argument("--style", choices=["arms", "disk"], default="arms",
                   help="arms = single rotatable fin per element; disk = solid envelope")
    p.add_argument("-o", "--out", default="clearance_gauge.stl", help="output STL path")
    # registration fit
    p.add_argument("--spigot-dia", type=float, default=30.0,
                   help="centering spigot dia -> set to your shell inner bore")
    p.add_argument("--face-dia", type=float, default=42.0,
                   help="face-flange dia -> set >= your shell OD to seat on the face")
    # element sizing
    p.add_argument("--ring-thickness", type=float, default=3.0,
                   help="axial thickness modeled per ring (mm)")
    p.add_argument("--fin-width", type=float, default=15.0,
                   help="tangential width of ring fins (mm)")
    p.add_argument("--crank-thickness", type=float, default=15.0,
                   help="axial thickness modeled for the crank arm (mm)")
    p.add_argument("--crank-width", type=float, default=18.0,
                   help="tangential width of the crank fin (mm)")
    p.add_argument("--crank-offset", type=float, default=10.0,
                   help="mm the crank arm sits outboard of the outer ring")
    p.add_argument("--hub-radius", type=float, default=12.0, help="hub radius (mm)")
    p.add_argument("--bore", type=float, default=8.0,
                   help="axial bore dia for the alignment rod (mm, 0=none)")
    p.add_argument("--margin", type=float, default=0.0,
                   help="extra mm added to every radius (safety inflation)")
    args = p.parse_args()

    teeth = args.teeth
    if len(teeth) == 1 and args.rings > 1:
        print(f"[warn] one tooth count for {args.rings} rings -> using it for all.",
              file=sys.stderr)
        teeth = teeth * args.rings
    if len(teeth) != args.rings:
        p.error(f"--teeth has {len(teeth)} values but --rings is {args.rings}")

    solid, info = build_gauge(
        rings=args.rings, teeth=teeth, offset=args.offset, spacing=args.spacing,
        crank_len=args.crank, style=args.style, ring_thickness=args.ring_thickness,
        fin_width=args.fin_width, crank_thickness=args.crank_thickness,
        crank_width=args.crank_width, crank_offset=args.crank_offset,
        hub_radius=args.hub_radius, bore_dia=args.bore, margin=args.margin,
        shell_width=args.shell_width, spigot_dia=args.spigot_dia,
        face_dia=args.face_dia)

    solid.export(args.out)

    print(f"\nGauge written to: {args.out}   (style={args.style})")
    print(f"  watertight: {solid.is_watertight}")
    print(f"  {'elem':>6} {'teeth':>6} {'radius':>8} {'dia':>8} {'z(mm)':>8}")
    for i, (t, r, z) in enumerate(zip(teeth, info['ring_r'], info['ring_z'])):
        print(f"  ring{i+1:>2} {t:>6} {r:>8.1f} {2*r:>8.1f} {z:>8.1f}")
    print(f"  {'crank':>6} {'':>6} {info['crank_r']:>8.1f} "
          f"{2*info['crank_r']:>8.1f} {info['crank_z']:>8.1f}")
    print(f"  reach (one side): {info['span']:.1f} mm   "
          f"axial: {info['z_low']:.1f} .. {info['z_top']:.1f} mm")
    if args.shell_width:
        rod = (info['z_top'] - info['z_low']) + 20
        print(f"  frame centerline at Z = {info['z_low']:.1f} mm; "
              f"alignment rod >= {rod:.0f} mm")
    print("  Z=0 = BB drive face; fins point +X; rotate about Z to sweep.\n")


if __name__ == "__main__":
    main()
