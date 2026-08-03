import { BoxGeometry, Group, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D } from 'three';
import { CELL, Grid } from './grid';
import { PALETTE } from '../render/palette';
import type { Rng } from '../core/rng';

export const WALL_HEIGHT = 3.4;
export const COVER_HEIGHT = 1.15;

export interface BuiltMap {
  grid: Grid;
  group: Group;
  spawn: { x: number; z: number };
  extraction: { x: number; z: number };
}

/**
 * Temporary test arena for M1 — a bordered room with seeded cover clusters and
 * a few interior walls, enough to prove out movement, collision and camera
 * readability. M5 replaces this with chunk assembly driven by the diff size;
 * the `BuiltMap` shape is the seam, so nothing downstream changes.
 */
export function buildTestArena(rng: Rng, cols = 44, rows = 44, tile = 2): BuiltMap {
  const grid = new Grid(cols, rows, tile);

  // Border.
  for (let cx = 0; cx < cols; cx++) {
    grid.setCell(cx, 0, CELL.WALL);
    grid.setCell(cx, rows - 1, CELL.WALL);
  }
  for (let cz = 0; cz < rows; cz++) {
    grid.setCell(0, cz, CELL.WALL);
    grid.setCell(cols - 1, cz, CELL.WALL);
  }

  const { spawn, extraction } = pickEndpoints(rng, cols, rows, tile);

  // Interior structures. Keep spawn and extraction clear.
  const keepClear = (cx: number, cz: number): boolean => {
    const wx = (cx + 0.5) * tile;
    const wz = (cz + 0.5) * tile;
    return (
      Math.hypot(wx - spawn.x, wz - spawn.z) < 7 ||
      Math.hypot(wx - extraction.x, wz - extraction.z) < 9
    );
  };

  const place = (cx: number, cz: number, kind: number): void => {
    if (!grid.inBounds(cx, cz) || keepClear(cx, cz)) return;
    grid.setCell(cx, cz, kind);
  };

  // Long walls to break sightlines.
  for (let i = 0; i < 10; i++) {
    const horizontal = rng.next() < 0.5;
    const len = rng.int(4, 10);
    const cx = rng.int(3, cols - 4);
    const cz = rng.int(3, rows - 4);
    for (let k = 0; k < len; k++) {
      place(horizontal ? cx + k : cx, horizontal ? cz : cz + k, CELL.WALL);
    }
  }

  // Cover clusters — the things you actually fight around.
  for (let i = 0; i < 34; i++) {
    const cx = rng.int(2, cols - 3);
    const cz = rng.int(2, rows - 3);
    const w = rng.int(1, 3);
    const h = rng.int(1, 3);
    for (let dz = 0; dz < h; dz++) {
      for (let dx = 0; dx < w; dx++) {
        place(cx + dx, cz + dz, CELL.COVER);
      }
    }
  }

  return { grid, group: buildMeshes(grid), spawn, extraction };
}

/** Keep endpoints this many cells clear of the border wall. */
const ENDPOINT_MARGIN = 4;
/**
 * Minimum spawn↔extraction distance as a fraction of the arena's shorter side.
 * High enough that the haul is always a real traverse, low enough that a
 * randomly-picked pair almost always satisfies it on the first few tries.
 */
const MIN_SEPARATION_FRACTION = 0.62;

/**
 * Seeded random spawn and extraction, separated by at least
 * `MIN_SEPARATION_FRACTION` of the map.
 *
 * Fixed endpoints meant every mission was the same north-south corridor and
 * you learned the route once. Randomising them means the same commit still
 * generates the same map (the RNG is seeded), but two different commits are
 * two different problems.
 */
export function pickEndpoints(
  rng: Rng,
  cols: number,
  rows: number,
  tile: number,
): { spawn: Spot; extraction: Spot } {
  const minSeparation = Math.min(cols, rows) * tile * MIN_SEPARATION_FRACTION;

  const randomPoint = (): Spot => ({
    x: (rng.int(ENDPOINT_MARGIN, cols - 1 - ENDPOINT_MARGIN) + 0.5) * tile,
    z: (rng.int(ENDPOINT_MARGIN, rows - 1 - ENDPOINT_MARGIN) + 0.5) * tile,
  });

  // Spawn hugs the perimeter — you insert from outside. It also guarantees the
  // separation target is reachable at all: a spawn near the middle of the map
  // has no point far enough away from it, and rejection sampling would spend
  // its whole budget failing.
  const spawn = perimeterPoint(rng, cols, rows, tile);
  let best = randomPoint();
  let bestDistance = distance(spawn, best);

  // Rejection sampling, keeping the farthest candidate seen. Bounded so a
  // pathological arena can't hang the loop — the fallback is simply the best
  // pair we found, which is still a long way apart.
  for (let i = 0; i < 60 && bestDistance < minSeparation; i++) {
    const candidate = randomPoint();
    const d = distance(spawn, candidate);
    if (d > bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }

  return { spawn, extraction: best };
}

/** A point in the outer band of the map, on a randomly chosen side. */
function perimeterPoint(rng: Rng, cols: number, rows: number, tile: number): Spot {
  const depth = rng.int(ENDPOINT_MARGIN, ENDPOINT_MARGIN + 2);
  const side = rng.int(0, 3);
  const alongX = rng.int(ENDPOINT_MARGIN, cols - 1 - ENDPOINT_MARGIN);
  const alongZ = rng.int(ENDPOINT_MARGIN, rows - 1 - ENDPOINT_MARGIN);

  switch (side) {
    case 0:
      return cellCentre(alongX, depth, tile);
    case 1:
      return cellCentre(cols - 1 - depth, alongZ, tile);
    case 2:
      return cellCentre(alongX, rows - 1 - depth, tile);
    default:
      return cellCentre(depth, alongZ, tile);
  }
}

function cellCentre(cx: number, cz: number, tile: number): Spot {
  return { x: (cx + 0.5) * tile, z: (cz + 0.5) * tile };
}

function distance(a: Spot, b: Spot): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export interface Spot {
  x: number;
  z: number;
}

/**
 * Find open floor positions, sorted nearest-to-farthest from `origin`.
 *
 * Used to place cargo: the biggest diff goes to the farthest spot, so a
 * 200-line file is a real trek and a one-line tweak is on your way out.
 */
export function findOpenSpots(
  grid: Grid,
  rng: Rng,
  count: number,
  origin: Spot,
  minDistance = 8,
): Spot[] {
  const candidates: Array<Spot & { d: number }> = [];
  for (let cz = 1; cz < grid.rows - 1; cz++) {
    for (let cx = 1; cx < grid.cols - 1; cx++) {
      if (grid.cell(cx, cz) !== CELL.EMPTY) continue;
      // Skip cells wedged against geometry — a crate there is a pain to reach.
      if (grid.isSolid(cx - 1, cz) && grid.isSolid(cx + 1, cz)) continue;
      if (grid.isSolid(cx, cz - 1) && grid.isSolid(cx, cz + 1)) continue;

      const x = (cx + 0.5) * grid.tile;
      const z = (cz + 0.5) * grid.tile;
      const d = Math.hypot(x - origin.x, z - origin.z);
      if (d < minDistance) continue;
      candidates.push({ x, z, d });
    }
  }

  if (candidates.length === 0) return [];

  rng.shuffle(candidates);
  candidates.sort((a, b) => a.d - b.d);

  // Spread the picks across the sorted range so crates aren't all clustered at
  // one radius.
  const spots: Spot[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.min(
      candidates.length - 1,
      Math.floor(((i + 0.5) / count) * candidates.length),
    );
    spots.push({ x: candidates[idx].x, z: candidates[idx].z });
  }
  return spots;
}

/**
 * One InstancedMesh per cell kind. A 44x44 arena is ~500 solid cells; as two
 * instanced draws that is free, where 500 separate meshes would not be.
 */
export function buildMeshes(grid: Grid): Group {
  const group = new Group();
  group.name = 'map';

  let wallCount = 0;
  let coverCount = 0;
  for (let i = 0; i < grid.solid.length; i++) {
    if (grid.solid[i] === CELL.WALL) wallCount++;
    else if (grid.solid[i] === CELL.COVER) coverCount++;
  }

  const wallMaterial = new MeshStandardMaterial({
    color: PALETTE.wall,
    roughness: 0.92,
    metalness: 0.02,
    flatShading: true,
  });
  const coverMaterial = new MeshStandardMaterial({
    color: PALETTE.cover,
    roughness: 0.85,
    metalness: 0.05,
    emissive: PALETTE.wallEdge,
    emissiveIntensity: 0.12,
    flatShading: true,
  });

  const walls = new InstancedMesh(
    new BoxGeometry(grid.tile, WALL_HEIGHT, grid.tile),
    wallMaterial,
    Math.max(wallCount, 1),
  );
  const covers = new InstancedMesh(
    new BoxGeometry(grid.tile * 0.94, COVER_HEIGHT, grid.tile * 0.94),
    coverMaterial,
    Math.max(coverCount, 1),
  );
  walls.castShadow = covers.castShadow = true;
  walls.receiveShadow = covers.receiveShadow = true;
  walls.count = wallCount;
  covers.count = coverCount;

  const dummy = new Object3D();
  const matrix = new Matrix4();
  let wi = 0;
  let ci = 0;

  for (let cz = 0; cz < grid.rows; cz++) {
    for (let cx = 0; cx < grid.cols; cx++) {
      const kind = grid.cell(cx, cz);
      if (kind === CELL.EMPTY) continue;
      const height = kind === CELL.WALL ? WALL_HEIGHT : COVER_HEIGHT;
      dummy.position.set((cx + 0.5) * grid.tile, height / 2, (cz + 0.5) * grid.tile);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      matrix.copy(dummy.matrix);
      if (kind === CELL.WALL) walls.setMatrixAt(wi++, matrix);
      else covers.setMatrixAt(ci++, matrix);
    }
  }

  walls.instanceMatrix.needsUpdate = true;
  covers.instanceMatrix.needsUpdate = true;
  group.add(walls, covers);
  return group;
}
