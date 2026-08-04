import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Flat ground shapes for anything that fans out from a point: the player's aim
 * spread and the enemies' vision cones.
 *
 * Both change length *and* angle every frame — the cone reaches further once an
 * enemy is alerted, the wedge shortens against a wall. Rebuilding geometry for
 * that would mean per-frame vertex writes on up to a dozen objects. Instead
 * both shapes are authored once as unit primitives and driven entirely by
 * `scale`, which costs a matrix update and nothing else.
 *
 * The trick for the wedge: scale the unit triangle by `(L, 1, L * tan(θ))` and
 * the apex half-angle comes out as `atan(L·tanθ / L) = θ` — independent of L.
 * So one geometry serves every length and every angle.
 *
 * Facing convention: both shapes point down local +X, matching `Entity.yaw`
 * (0 = +X). The codebase renders yaw as `rotation.y = -yaw`, so a child at
 * `rotation.y = -θ` points at world yaw `+θ`.
 */

let wedge: BufferGeometry | null = null;
let ray: BufferGeometry | null = null;

/**
 * Triangle from the origin to `(1, ±1)`. Scale by `(L, 1, L * Math.tan(half))`.
 *
 * The far edge is a chord rather than an arc, so the corners sit `1/cos(half)`
 * further out than the centre — 1% at the shotgun's 0.14 rad, 12% at a 0.5 rad
 * vision cone. Invisible on the aim wedge and merely slightly pointed on a
 * cone. If that ever matters, swap this for a segmented fan with the same
 * scaling contract and every call site is unchanged.
 */
export function unitWedgeGeometry(): BufferGeometry {
  if (!wedge) {
    wedge = new BufferGeometry();
    // Materials using these geometries should set `side: DoubleSide` — they are
    // flat ground decals with no meaningful back face, and relying on winding
    // order here is a good way to ship an invisible mesh.
    //
    // Split across a mid ring rather than a bare triangle. The extra ring is
    // not about silhouette — it is the only way to get a non-linear brightness
    // falloff out of vertex colours, and a linear one leaves far too much
    // brightness at mid-cone. An organizer's cone is 20 units long and 70
    // degrees wide; at flat opacity that is a slab across the entire screen.
    const mid = 0.35;
    wedge.setAttribute(
      'position',
      new BufferAttribute(
        // prettier-ignore
        new Float32Array([
          0, 0, 0,
          mid, 0, mid,
          mid, 0, -mid,
          1, 0, 1,
          1, 0, -1,
        ]),
        3,
      ),
    );
    // Bright at the eyes, mostly gone by the mid ring, nothing at the rim — so
    // the cone reads as light coming *from* the enemy rather than as a coloured
    // region of floor.
    wedge.setAttribute(
      'color',
      new BufferAttribute(
        // prettier-ignore
        new Float32Array([
          1, 1, 1,
          0.22, 0.22, 0.22,
          0.22, 0.22, 0.22,
          0, 0, 0,
          0, 0, 0,
        ]),
        3,
      ),
    );
    wedge.setIndex([0, 1, 2, 1, 3, 4, 1, 4, 2]);
    wedge.computeVertexNormals();
  }
  return wedge;
}

/**
 * Quad spanning `x` 0..1 and `z` ±0.5. Scale by `(L, 1, width)` — length and
 * width are independent, so a beam keeps a constant world-space thickness at
 * any range rather than tapering.
 *
 * This exists because there is no usable line primitive: `LineBasicMaterial`
 * ignores `linewidth` on every platform that matters, so a "thin line" would be
 * one pixel wide at every camera distance and would vanish under the bloom pass.
 */
export function unitRayGeometry(): BufferGeometry {
  if (!ray) {
    ray = new BufferGeometry();
    ray.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([0, 0, 0.5, 1, 0, 0.5, 1, 0, -0.5, 0, 0, 0.5, 1, 0, -0.5, 0, 0, -0.5]),
        3,
      ),
    );
    ray.computeVertexNormals();
  }
  return ray;
}
