import {
  BoxGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { CELL, Grid } from './grid';
import { PALETTE } from '../render/palette';
import { applyConcreteSurface, applyFacadeSurface, setOccluderFocus } from '../render/surfaces';
import { planCity } from './city';
import type { Rng } from '../core/rng';

/** Fallback height, used only if a cell somehow has no building planned for it. */
export const WALL_HEIGHT = 3.4;
export const COVER_HEIGHT = 1.15;
/** The concrete cap ringing each roof. */
export const PARAPET_HEIGHT = 0.34;

export interface Spot {
  x: number;
  z: number;
}

export interface BuiltMap {
  grid: Grid;
  group: Group;
  spawn: Spot;
  extraction: Spot;
  /** The route, spawn first and extraction last. Enemies stampede along it. */
  waypoints: Spot[];
  /** End of a dead-end side branch, or null if there wasn't room for one. */
  stash: Spot | null;
  /**
   * Move the point that occluding buildings dissolve around. Call once a frame
   * with the player's position — a 6-unit building on the near side of the
   * player sits directly on the camera's sightline, so without this the thing
   * you are steering spends half the run behind a roof.
   */
  setFocus(x: number, y: number, z: number): void;
}

/** Keep endpoints this many cells clear of the border wall. */
const ENDPOINT_MARGIN = 4;
/**
 * Minimum spawn↔extraction distance as a fraction of the arena's shorter side.
 * High enough that the haul is always a real traverse.
 */
const MIN_SEPARATION_FRACTION = 0.62;
/**
 * Radius of the guaranteed-open pass. Must exceed one tile: a narrower cut can
 * leave cells connected only at their corners, which is a corridor the flood
 * fill — and the player — cannot get through.
 */
const SAFE_CORRIDOR_RADIUS = 3.4;

/**
 * The route is a wide valley, not a corridor network.
 *
 * The first pass cut passages barely wider than the player, which read as a
 * maze — you were threading gaps rather than travelling. These are deliberately
 * generous: there should be room to circle an enemy, flank, or run a stampede
 * out, while the surrounding rock still makes the direction of travel obvious.
 * Open, but going somewhere.
 */
/**
 * Widths are a fraction of the map's shorter side, not absolute. Fixed sizes
 * meant a big commit produced a big map threaded by the same narrow valley, so
 * larger runs felt progressively more claustrophobic rather than grander.
 */
const CORRIDOR_FRACTION: [number, number] = [0.07, 0.095];
const ROOM_FRACTION: [number, number] = [0.12, 0.17];
const BRANCH_FRACTION = 0.055;

/**
 * Carve a route from A to B.
 *
 * The map starts as solid rock and gets a path cut through it, rather than
 * being an open arena with scattered cover. That difference is the whole feel
 * of the thing: an extraction is a route you fight your way along under
 * pressure, not a field you wander around looking for objectives. Rooms at the
 * waypoints give you somewhere to actually fight, and the corridors between
 * them are where a stampede becomes a problem.
 */
export function buildRoute(rng: Rng, cols = 44, rows = 44, tile = 2): BuiltMap {
  const grid = new Grid(cols, rows, tile);
  // Solid rock, then cut into it.
  grid.solid.fill(CELL.WALL);

  const { spawn, extraction } = pickEndpoints(rng, cols, rows, tile);
  const waypoints = routeWaypoints(rng, spawn, extraction, cols, rows, tile);
  const span = Math.min(cols, rows) * tile;

  // Every carved link, so the safety pass below knows what must stay open.
  const links: Array<[Spot, Spot]> = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    links.push([waypoints[i], waypoints[i + 1]]);
    carveCorridor(
      grid,
      waypoints[i],
      waypoints[i + 1],
      span * rng.range(CORRIDOR_FRACTION[0], CORRIDOR_FRACTION[1]),
    );
  }
  for (const point of waypoints) {
    carveRoom(grid, point, span * rng.range(ROOM_FRACTION[0], ROOM_FRACTION[1]), rng);
  }

  const stash = carveSideBranch(grid, rng, waypoints, cols, rows, tile, links, span);

  scatterCover(grid, rng, spawn, extraction);

  // Re-cut every link last, at a radius wide enough to guarantee an
  // orthogonally-connected corridor. Cover is scattered blind, and a corridor
  // it happens to plug would make the run unwinnable — which for this game
  // means silently costing someone their commit.
  for (const [from, to] of links) {
    carveCorridor(grid, from, to, SAFE_CORRIDOR_RADIUS);
  }

  const city = buildMeshes(grid);
  return { grid, group: city.group, setFocus: city.setFocus, spawn, extraction, waypoints, stash };
}

/**
 * Seeded random spawn and extraction, separated by at least
 * `MIN_SEPARATION_FRACTION` of the map.
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

/** Waypoints marching from spawn to extraction with a lateral wander. */
function routeWaypoints(
  rng: Rng,
  spawn: Spot,
  extraction: Spot,
  cols: number,
  rows: number,
  tile: number,
): Spot[] {
  const segments = rng.int(4, 6);
  const dx = extraction.x - spawn.x;
  const dz = extraction.z - spawn.z;
  const length = Math.hypot(dx, dz) || 1;
  // Perpendicular, for pushing waypoints off the straight line.
  const px = -dz / length;
  const pz = dx / length;
  const maxSwing = Math.min(cols, rows) * tile * 0.2;

  const points: Spot[] = [spawn];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    // Swing alternates sides so the route snakes instead of drifting one way.
    const swing = rng.range(0.35, 1) * maxSwing * (i % 2 === 0 ? 1 : -1);
    points.push(
      clampToBounds(
        {
          x: spawn.x + dx * t + px * swing,
          z: spawn.z + dz * t + pz * swing,
        },
        cols,
        rows,
        tile,
      ),
    );
  }
  points.push(extraction);
  return points;
}

/** Clear a capsule of cells between two points. */
function carveCorridor(grid: Grid, from: Spot, to: Spot, radius: number): void {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(length / (grid.tile * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    clearDisc(grid, from.x + dx * t, from.z + dz * t, radius);
  }
}

/** Clear a slightly irregular room, so junctions don't all look identical. */
function carveRoom(grid: Grid, centre: Spot, radius: number, rng: Rng): void {
  const lobes = rng.int(2, 4);
  for (let i = 0; i < lobes; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const offset = rng.range(0, radius * 0.5);
    clearDisc(
      grid,
      centre.x + Math.cos(angle) * offset,
      centre.z + Math.sin(angle) * offset,
      radius * rng.range(0.7, 1),
    );
  }
}

function clearDisc(grid: Grid, x: number, z: number, radius: number): void {
  const minCX = grid.cellX(x - radius);
  const maxCX = grid.cellX(x + radius);
  const minCZ = grid.cellZ(z - radius);
  const maxCZ = grid.cellZ(z + radius);
  for (let cz = minCZ; cz <= maxCZ; cz++) {
    for (let cx = minCX; cx <= maxCX; cx++) {
      // Never breach the border — the map has to stay sealed.
      if (cx <= 0 || cz <= 0 || cx >= grid.cols - 1 || cz >= grid.rows - 1) continue;
      const wx = (cx + 0.5) * grid.tile;
      const wz = (cz + 0.5) * grid.tile;
      if (Math.hypot(wx - x, wz - z) > radius) continue;
      grid.setCell(cx, cz, CELL.EMPTY);
    }
  }
}

/**
 * A dead end hanging off the middle of the route, for the stash cache. It has
 * to cost you a detour, which means it can't be on the way.
 */
function carveSideBranch(
  grid: Grid,
  rng: Rng,
  waypoints: Spot[],
  cols: number,
  rows: number,
  tile: number,
  links: Array<[Spot, Spot]>,
  span: number,
): Spot | null {
  if (waypoints.length < 3) return null;
  const anchor = waypoints[rng.int(1, waypoints.length - 2)];

  for (let attempt = 0; attempt < 24; attempt++) {
    const angle = rng.range(0, Math.PI * 2);
    const length = span * rng.range(0.14, 0.22);
    const end = clampToBounds(
      { x: anchor.x + Math.cos(angle) * length, z: anchor.z + Math.sin(angle) * length },
      cols,
      rows,
      tile,
    );
    // Only worth carving if it actually leads somewhere off the main line.
    const nearRoute = waypoints.some((w) => w !== anchor && distance(w, end) < 12);
    if (nearRoute) continue;

    carveCorridor(grid, anchor, end, span * BRANCH_FRACTION);
    carveRoom(grid, end, span * 0.085, rng);
    links.push([anchor, end]);
    return end;
  }
  return null;
}

/** Waist-high cover inside the carved space — the things you fight around. */
function scatterCover(grid: Grid, rng: Rng, spawn: Spot, extraction: Spot): void {
  const open: Array<{ cx: number; cz: number }> = [];
  for (let cz = 2; cz < grid.rows - 2; cz++) {
    for (let cx = 2; cx < grid.cols - 2; cx++) {
      if (grid.cell(cx, cz) !== CELL.EMPTY) continue;
      const x = (cx + 0.5) * grid.tile;
      const z = (cz + 0.5) * grid.tile;
      // Keep the endpoints clear so you can always land and always extract.
      if (distance({ x, z }, spawn) < 8 || distance({ x, z }, extraction) < 10) continue;
      open.push({ cx, cz });
    }
  }
  if (open.length === 0) return;

  rng.shuffle(open);

  // Clusters, not confetti. Single scattered cells give nothing to hide behind
  // and just make the floor noisy; a two-by-three block is an actual position
  // to fight from, which is what open space needs to stay interesting.
  const clusters = Math.max(4, Math.floor(open.length / 26));
  for (let i = 0; i < clusters && i < open.length; i++) {
    const { cx, cz } = open[i];
    const w = rng.int(1, 3);
    const h = rng.int(1, 3);
    for (let dz = 0; dz < h; dz++) {
      for (let dx = 0; dx < w; dx++) {
        if (grid.cell(cx + dx, cz + dz) !== CELL.EMPTY) continue;
        grid.setCell(cx + dx, cz + dz, CELL.COVER);
      }
    }
  }

  // A few full-height pillars to break the long sightlines a wide valley
  // creates, without turning any of it back into a maze.
  const pillars = Math.max(2, Math.floor(clusters * 0.35));
  for (let i = 0; i < pillars; i++) {
    const spot = open[(clusters + i) % open.length];
    if (grid.cell(spot.cx, spot.cz) !== CELL.EMPTY) continue;
    grid.setCell(spot.cx, spot.cz, CELL.WALL);
    if (rng.next() < 0.5) grid.setCell(spot.cx + 1, spot.cz, CELL.WALL);
  }
}

function clampToBounds(point: Spot, cols: number, rows: number, tile: number): Spot {
  const min = (ENDPOINT_MARGIN - 1) * tile;
  return {
    x: Math.max(min, Math.min((cols - ENDPOINT_MARGIN) * tile, point.x)),
    z: Math.max(min, Math.min((rows - ENDPOINT_MARGIN) * tile, point.z)),
  };
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

/** Find open floor positions, sorted nearest-to-farthest from `origin`. */
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
 * One InstancedMesh per cell kind.
 *
 * Only walls with an open neighbour are built. Now that the map is solid rock
 * with a route cut through it, most cells are buried and would never be seen —
 * rendering the shell instead of the volume cuts the instance count by an
 * order of magnitude and keeps the shadow pass cheap.
 */
export function buildMeshes(grid: Grid): {
  group: Group;
  setFocus: (x: number, y: number, z: number) => void;
} {
  const group = new Group();
  group.name = 'map';

  const plan = planCity(grid);

  // Every wall cell is built, not just the shell.
  //
  // The old build skipped buried cells because nothing could see them. Now that
  // buildings have varied heights they also have roofs, and a roof is exactly
  // what a 57° camera looks down at — skipping the interior leaves each
  // building an open shell with a pit where its middle should be. It is still
  // one instanced draw call either way.
  const buildings: Array<{ cx: number; cz: number }> = [];
  // The parapet rings only the outer edge, which is the whole point of it.
  const parapets: Array<{ cx: number; cz: number }> = [];
  const covers: Array<{ cx: number; cz: number }> = [];

  for (let cz = 0; cz < grid.rows; cz++) {
    for (let cx = 0; cx < grid.cols; cx++) {
      const kind = grid.cell(cx, cz);
      if (kind === CELL.COVER) {
        covers.push({ cx, cz });
      } else if (kind === CELL.WALL) {
        buildings.push({ cx, cz });
        if (hasOpenNeighbour(grid, cx, cz)) parapets.push({ cx, cz });
      }
    }
  }

  // flatShading is dropped here: it quantises the normal per face, which throws
  // away the gradients the surface shaders paint down each facade.
  const facadeMaterial = new MeshStandardMaterial({
    color: PALETTE.wall,
    roughness: 0.92,
    metalness: 0.02,
  });
  const parapetMaterial = new MeshStandardMaterial({
    color: PALETTE.wallTop,
    roughness: 0.95,
    metalness: 0.0,
  });
  const coverMaterial = new MeshStandardMaterial({
    color: PALETTE.cover,
    roughness: 0.85,
    metalness: 0.05,
    emissive: PALETTE.wallEdge,
    emissiveIntensity: 0.12,
  });
  applyFacadeSurface(facadeMaterial);
  applyConcreteSurface(parapetMaterial, PARAPET_HEIGHT);
  applyConcreteSurface(coverMaterial, COVER_HEIGHT);

  // Unit-height box: the instance matrix scales it to each building's height,
  // so one geometry serves every roofline on the map.
  const facades = new InstancedMesh(
    new BoxGeometry(grid.tile, 1, grid.tile),
    facadeMaterial,
    Math.max(buildings.length, 1),
  );
  const parapetMesh = new InstancedMesh(
    // Slightly proud of the facade so the cap actually overhangs and throws a
    // line of shadow, instead of sitting flush and reading as more wall.
    new BoxGeometry(grid.tile * 1.06, PARAPET_HEIGHT, grid.tile * 1.06),
    parapetMaterial,
    Math.max(parapets.length, 1),
  );
  const coverMesh = new InstancedMesh(
    new BoxGeometry(grid.tile * 0.94, COVER_HEIGHT, grid.tile * 0.94),
    coverMaterial,
    Math.max(covers.length, 1),
  );

  facades.castShadow = parapetMesh.castShadow = coverMesh.castShadow = true;
  facades.receiveShadow = parapetMesh.receiveShadow = coverMesh.receiveShadow = true;
  facades.count = buildings.length;
  parapetMesh.count = parapets.length;
  coverMesh.count = covers.length;

  // Per-instance (building seed, building height). The facade shader needs both
  // to place windows and to know where its own roofline is; neither can be
  // recovered from the instance matrix without decomposing it per fragment.
  const facadeData = new Float32Array(Math.max(buildings.length, 1) * 2);
  const parapetData = new Float32Array(Math.max(parapets.length, 1) * 2);
  const coverData = new Float32Array(Math.max(covers.length, 1) * 2);

  const dummy = new Object3D();

  buildings.forEach((cell, i) => {
    const index = cell.cz * grid.cols + cell.cx;
    const height = plan.height[index] || WALL_HEIGHT;
    dummy.position.set((cell.cx + 0.5) * grid.tile, height / 2, (cell.cz + 0.5) * grid.tile);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, height, 1);
    dummy.updateMatrix();
    facades.setMatrixAt(i, dummy.matrix);
    facadeData[i * 2] = plan.seed[index];
    facadeData[i * 2 + 1] = height;
  });

  parapets.forEach((cell, i) => {
    const index = cell.cz * grid.cols + cell.cx;
    const height = plan.height[index] || WALL_HEIGHT;
    dummy.position.set(
      (cell.cx + 0.5) * grid.tile,
      height + PARAPET_HEIGHT / 2,
      (cell.cz + 0.5) * grid.tile,
    );
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    parapetMesh.setMatrixAt(i, dummy.matrix);
    parapetData[i * 2] = plan.seed[index];
    parapetData[i * 2 + 1] = PARAPET_HEIGHT;
  });

  covers.forEach((cell, i) => {
    dummy.position.set((cell.cx + 0.5) * grid.tile, COVER_HEIGHT / 2, (cell.cz + 0.5) * grid.tile);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    coverMesh.setMatrixAt(i, dummy.matrix);
    coverData[i * 2] = 0;
    coverData[i * 2 + 1] = COVER_HEIGHT;
  });

  facades.geometry.setAttribute('aBuilding', new InstancedBufferAttribute(facadeData, 2));
  parapetMesh.geometry.setAttribute('aBuilding', new InstancedBufferAttribute(parapetData, 2));
  coverMesh.geometry.setAttribute('aBuilding', new InstancedBufferAttribute(coverData, 2));

  facades.instanceMatrix.needsUpdate = true;
  parapetMesh.instanceMatrix.needsUpdate = true;
  coverMesh.instanceMatrix.needsUpdate = true;
  group.add(facades, parapetMesh, coverMesh);

  const focusable = [facadeMaterial, parapetMaterial, coverMaterial];
  return {
    group,
    setFocus: (x, y, z) => setOccluderFocus(focusable, x, y, z),
  };
}

function hasOpenNeighbour(grid: Grid, cx: number, cz: number): boolean {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      if (grid.cell(cx + dx, cz + dz) === CELL.EMPTY) return true;
    }
  }
  return false;
}
