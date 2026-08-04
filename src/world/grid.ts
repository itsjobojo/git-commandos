/**
 * The collision world: a flat grid of solid/empty cells on the XZ plane.
 *
 * No physics engine. Movement is planar, so circle-vs-AABB against static
 * cells plus circle-vs-circle between entities covers everything the game
 * does — and it stays deterministic, which the seeded-mission promise needs.
 */
export interface Circle {
  x: number;
  z: number;
}

/**
 * Cell kinds. Both WALL and COVER block movement; they differ only in height,
 * which is what makes cover readable from a top-down camera — you can see over
 * it, so you can see what's about to shoot you.
 */
export const CELL = {
  EMPTY: 0,
  WALL: 1,
  COVER: 2,
} as const;

export class Grid {
  readonly solid: Uint8Array;

  constructor(
    readonly cols: number,
    readonly rows: number,
    readonly tile = 2,
  ) {
    this.solid = new Uint8Array(cols * rows);
  }

  get width(): number {
    return this.cols * this.tile;
  }

  get depth(): number {
    return this.rows * this.tile;
  }

  cellX(worldX: number): number {
    return Math.floor(worldX / this.tile);
  }

  cellZ(worldZ: number): number {
    return Math.floor(worldZ / this.tile);
  }

  inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.cols && cz < this.rows;
  }

  isSolid(cx: number, cz: number): boolean {
    // Out of bounds counts as solid so nothing can leak off the map.
    if (!this.inBounds(cx, cz)) return true;
    return this.solid[cz * this.cols + cx] !== CELL.EMPTY;
  }

  /** Cell kind — see CELL. Out of bounds reads as WALL. */
  cell(cx: number, cz: number): number {
    if (!this.inBounds(cx, cz)) return CELL.WALL;
    return this.solid[cz * this.cols + cx];
  }

  setCell(cx: number, cz: number, value: number): void {
    if (!this.inBounds(cx, cz)) return;
    this.solid[cz * this.cols + cx] = value;
  }

  setSolid(cx: number, cz: number, value: boolean): void {
    this.setCell(cx, cz, value ? CELL.WALL : CELL.EMPTY);
  }

  isSolidWorld(x: number, z: number): boolean {
    return this.isSolid(this.cellX(x), this.cellZ(z));
  }

  /** Centre of a cell in world space. */
  cellCenter(cx: number, cz: number, out: { x: number; z: number }): void {
    out.x = (cx + 0.5) * this.tile;
    out.z = (cz + 0.5) * this.tile;
  }

  /**
   * Push a circle out of any solid cells it overlaps. Mutates `p`.
   * Resolves one axis at a time by smallest penetration, which slides the
   * circle along walls instead of sticking it to them.
   *
   * @returns true if the circle was moved.
   */
  resolveCircle(p: Circle, radius: number): boolean {
    const t = this.tile;
    const minCX = this.cellX(p.x - radius);
    const maxCX = this.cellX(p.x + radius);
    const minCZ = this.cellZ(p.z - radius);
    const maxCZ = this.cellZ(p.z + radius);
    let moved = false;

    for (let cz = minCZ; cz <= maxCZ; cz++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        if (!this.isSolid(cx, cz)) continue;

        const left = cx * t;
        const top = cz * t;
        const closestX = clamp(p.x, left, left + t);
        const closestZ = clamp(p.z, top, top + t);
        let dx = p.x - closestX;
        let dz = p.z - closestZ;
        const distSq = dx * dx + dz * dz;

        if (distSq > radius * radius) continue;

        if (distSq > 1e-8) {
          const dist = Math.sqrt(distSq);
          const push = radius - dist;
          p.x += (dx / dist) * push;
          p.z += (dz / dist) * push;
        } else {
          // Centre is inside the cell — eject along the shallowest face.
          const cxCentre = left + t * 0.5;
          const czCentre = top + t * 0.5;
          dx = p.x - cxCentre;
          dz = p.z - czCentre;
          const overlapX = t * 0.5 + radius - Math.abs(dx);
          const overlapZ = t * 0.5 + radius - Math.abs(dz);
          if (overlapX < overlapZ) {
            p.x += dx >= 0 ? overlapX : -overlapX;
          } else {
            p.z += dz >= 0 ? overlapZ : -overlapZ;
          }
        }
        moved = true;
      }
    }
    return moved;
  }

  /**
   * Can an enemy *see* this point? Only full-height walls block vision —
   * crouching behind waist-high cover hides you from bullets, not from eyes.
   */
  hasLineOfSight(x0: number, z0: number, x1: number, z1: number): boolean {
    return this.reaches(x0, z0, x1, z1, false);
  }

  /**
   * Can a shot travel between these points? Cover stops bullets, which is what
   * makes it worth standing behind.
   */
  hasClearShot(x0: number, z0: number, x1: number, z1: number): boolean {
    return this.reaches(x0, z0, x1, z1, true);
  }

  /**
   * How far a ray gets before something stops it, clamped to `max`.
   *
   * The aim indicator needs a distance rather than a yes/no: a laser has to end
   * *at* the wall, not merely know one is there. `dirX`/`dirZ` must be a unit
   * vector — the returned value is then a world distance.
   *
   * @param blocksCover true for shots (WALL and COVER), false for eyes (WALL
   *   only). Drawing a shot line through waist-high cover would lie in exactly
   *   the situation where the indicator matters most.
   */
  rayDistance(
    x0: number,
    z0: number,
    dirX: number,
    dirZ: number,
    max: number,
    blocksCover: boolean,
  ): number {
    return this.walk(x0, z0, dirX, dirZ, max, blocksCover);
  }

  private reaches(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    blocksCover: boolean,
  ): boolean {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const distance = Math.hypot(dx, dz);
    // Degenerate ray: the only thing that can stop it is the cell it starts in.
    if (distance < 1e-9) return !this.blocks(this.cellX(x0), this.cellZ(z0), blocksCover);
    return this.walk(x0, z0, dx / distance, dz / distance, distance, blocksCover) >= distance;
  }

  private blocks(cx: number, cz: number, blocksCover: boolean): boolean {
    return blocksCover ? this.isSolid(cx, cz) : this.cell(cx, cz) === CELL.WALL;
  }

  /**
   * Amanatides-Woo grid traversal. Walks the cells a ray passes through and
   * returns the distance at which it entered the first blocking one, or `max`
   * if it never hit anything.
   *
   * Because `dirX`/`dirZ` are unit length, the traversal parameter *is* the
   * distance — which is what lets the boolean sight checks and the aim
   * indicator share one walk instead of drifting apart.
   */
  private walk(
    x0: number,
    z0: number,
    dirX: number,
    dirZ: number,
    max: number,
    blocksCover: boolean,
  ): number {
    const tile = this.tile;
    let cx = this.cellX(x0);
    let cz = this.cellZ(z0);

    const stepX = Math.sign(dirX);
    const stepZ = Math.sign(dirZ);

    const tDeltaX = dirX === 0 ? Infinity : Math.abs(tile / dirX);
    const tDeltaZ = dirZ === 0 ? Infinity : Math.abs(tile / dirZ);

    let tMaxX = dirX === 0 ? Infinity : ((stepX > 0 ? cx + 1 : cx) * tile - x0) / dirX;
    let tMaxZ = dirZ === 0 ? Infinity : ((stepZ > 0 ? cz + 1 : cz) * tile - z0) / dirZ;

    let t = 0;
    // Bounded so a degenerate ray can't spin forever.
    const maxSteps = this.cols + this.rows + 2;
    for (let i = 0; i < maxSteps; i++) {
      if (this.blocks(cx, cz, blocksCover)) return t;
      const next = tMaxX < tMaxZ ? tMaxX : tMaxZ;
      if (!(next < max)) return max;
      t = next;
      if (tMaxX < tMaxZ) {
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        tMaxZ += tDeltaZ;
        cz += stepZ;
      }
    }
    return max;
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
