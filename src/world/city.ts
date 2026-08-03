import { CELL, type Grid } from './grid';

/**
 * Turns the carved grid into a block of buildings.
 *
 * Rendered as generated, every wall cell is an identical 2×2 cube and the map
 * reads as a maze of boxes. What makes it read as a *place* is that nearby
 * cells belong to the same structure and therefore share a height, a facade
 * seed and a window palette — so a run of cells becomes one building with one
 * roofline, and the building along the street is visibly a different one.
 *
 * Buildings are laid out on a **block grid**, not by flood-filling connected
 * rock. Flood fill was the obvious approach and it is wrong here: the map is
 * generated as solid rock with a route cut through it, so every wall cell on
 * the map is orthogonally connected to every other one. The fill returned a
 * single component covering the entire city, which then got a single height and
 * a single facade seed — one enormous building with corridors bored through it.
 * A block grid also happens to be how real cities are laid out.
 *
 * Heights come from hashing block coordinates rather than from the mission
 * `Rng`. Both are deterministic, but hashing keeps this off the shared random
 * stream — drawing from it here would shift every downstream spawn, so changing
 * the skyline would silently re-roll the whole run.
 */

export interface CityPlan {
  /** Per cell, indexed `cz * cols + cx`. Building height in world units, 0 if open. */
  readonly height: Float32Array;
  /** Per cell. Stable 0..1 identity for the building this cell belongs to. */
  readonly seed: Float32Array;
}

/** Block footprint, in cells. At a 2-unit tile this is a 6×6 world-unit plot. */
const BLOCK = 3;
/** Chance a plot annexes its western or northern neighbour, for larger buildings. */
const MERGE_CHANCE = 0.28;

/**
 * Height bands and how often each comes up.
 *
 * The ceiling is deliberately low. The camera sits 26 units out at a 57° pitch,
 * so a surface 4 units to the near side of the player is already level with the
 * sightline — anything genuinely tower-like would spend the whole run standing
 * between the player and the camera. Buildings read as buildings through facade
 * detail and varied rooflines, not through height. The occlusion fade in
 * `surfaces.ts` covers what is left.
 */
const BANDS: ReadonlyArray<{ weight: number; min: number; max: number }> = [
  { weight: 0.2, min: 2.3, max: 3.1 }, // low sheds and outbuildings
  { weight: 0.45, min: 3.2, max: 4.6 }, // the ordinary street
  { weight: 0.25, min: 4.6, max: 6.0 },
  { weight: 0.1, min: 6.0, max: 7.4 }, // the occasional bigger block
];

/**
 * Deterministic 32-bit integer hash.
 *
 * The salt matters: without it `hash(0)` is 0, and since block (0,0) sits in the
 * corner of every map that made one building's seed exactly zero — which then
 * drove every seeded choice in the facade shader to the same branch.
 */
function hash(n: number): number {
  let x = (n + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return (x >>> 0) / 4294967296;
}

/** Hash a block coordinate pair, with a salt to decorrelate different uses. */
function hash2(bx: number, bz: number, salt: number): number {
  return hash(Math.imul(bx, 73856093) ^ Math.imul(bz, 19349663) ^ Math.imul(salt, 83492791));
}

export function planCity(grid: Grid): CityPlan {
  const { cols, rows } = grid;
  const height = new Float32Array(cols * rows);
  const seed = new Float32Array(cols * rows);

  for (let cz = 0; cz < rows; cz++) {
    for (let cx = 0; cx < cols; cx++) {
      const index = cz * cols + cx;
      if (grid.solid[index] !== CELL.WALL) continue;

      let bx = Math.floor(cx / BLOCK);
      let bz = Math.floor(cz / BLOCK);

      // Annex a neighbour now and then so the street is not a perfect chequer
      // of identical plots. One step only, and always toward lower coordinates,
      // so two plots can never each claim the other.
      if (hash2(bx, bz, 11) < MERGE_CHANCE) bx -= 1;
      else if (hash2(bx, bz, 23) < MERGE_CHANCE) bz -= 1;

      const identity = hash2(bx, bz, 1);

      // Pick a height band by weight, then a height within it.
      const roll = hash2(bx, bz, 2);
      let acc = 0;
      let band = BANDS[BANDS.length - 1];
      for (const candidate of BANDS) {
        acc += candidate.weight;
        if (roll <= acc) {
          band = candidate;
          break;
        }
      }
      const h = band.min + hash2(bx, bz, 3) * (band.max - band.min);

      height[index] = h;
      seed[index] = identity;
    }
  }

  return { height, seed };
}
