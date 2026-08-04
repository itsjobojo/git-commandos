import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { CELL, Grid } from './grid';
import { PALETTE } from '../render/palette';
import {
  applyConcreteSurface,
  applyFacadeSurface,
  applyFoliageSurface,
  setOccluderFocus,
} from '../render/surfaces';
import { planCity } from './city';
import {
  deadEndTerminals,
  distance,
  type Park,
  pickEndpoints,
  planRoute,
  stashSpot,
  type Branch,
  type RoutePlan,
  type Spot,
} from './route';
import type { Rng } from '../core/rng';

export type { Spot };
export { pickEndpoints };

/** Fallback height, used only if a cell somehow has no building planned for it. */
export const WALL_HEIGHT = 3.4;
export const COVER_HEIGHT = 1.15;
/** The concrete cap ringing each roof. */
export const PARAPET_HEIGHT = 0.34;

export interface BuiltMap {
  grid: Grid;
  group: Group;
  spawn: Spot;
  extraction: Spot;
  /**
   * The trunk, spawn first and extraction last. Enemies stampede along it.
   *
   * Every waypoint the walk placed, not just the corners: `AiBro` steers
   * straight at its next leg with no wall-slide correction, so a herd given
   * only the corners cuts them and runs into rock.
   */
  waypoints: Spot[];
  /** End of a dead-end side branch, or null if there wasn't room for one. */
  stash: Spot | null;
  /** Every carved branch. `routes[0]` is the trunk. */
  routes: Branch[];
  /** The far end of every dead end. */
  deadEnds: Spot[];
  /**
   * Trunk waypoints no alternate route bypasses — the ones every way through
   * the map has to cross. Weapons go here so that taking the scenic route never
   * means missing them.
   */
  chokepoints: Spot[];
  /** What the corridors and rooms were actually cut at, in world units. */
  corridorRadius: number;
  roomRadius: number;
  /** Green spaces on the route. The floor shader lays grass inside these. */
  parks: Park[];
  /** Street lamps, at the kerb. Decorative — they have no cell and no collision. */
  lamps: Spot[];
  /**
   * Move the point that occluding buildings dissolve around. Call once a frame
   * with the player's position — a 6-unit building on the near side of the
   * player sits directly on the camera's sightline, so without this the thing
   * you are steering spends half the run behind a roof.
   */
  setFocus(x: number, y: number, z: number): void;
}

/**
 * Radius of the guaranteed-open pass. Must exceed one tile: a narrower cut can
 * leave cells connected only at their corners, which is a corridor the flood
 * fill — and the player — cannot get through.
 */
const SAFE_CORRIDOR_RADIUS = 3.4;

export interface RouteOptions {
  cols?: number;
  rows?: number;
  tile?: number;
  /**
   * Staged file count. Sets how long the route is — lines added set how big the
   * arena is, and the two are deliberately separate knobs.
   */
  files?: number;
}

/**
 * Carve a level.
 *
 * The map starts as solid rock and gets a route cut through it, rather than
 * being an open arena with scattered cover. That difference is the whole feel
 * of the thing: an extraction is a route you fight your way along under
 * pressure, not a field you wander around looking for objectives. Rooms at the
 * waypoints give you somewhere to actually fight, and the corridors between
 * them are where a stampede becomes a problem.
 *
 * Where the route goes is `route.ts`'s problem. This carves what it decided.
 */
export function buildRoute(rng: Rng, options: RouteOptions = {}): BuiltMap {
  const { cols = 44, rows = 44, tile = 2, files = 4 } = options;
  const grid = new Grid(cols, rows, tile);
  // Solid rock, then cut into it.
  grid.solid.fill(CELL.WALL);

  const plan = planRoute(rng, cols, rows, tile, files);
  const links = carvePlan(grid, plan, rng);

  const waypoints = plan.branches[0].points;
  const stash = stashSpot(plan);

  // Lamps before cover, so cover can be told to keep off them. Every cut is
  // already made at this point — the passes below only add solid cells, and the
  // safety re-cut only removes them — so a spot that is open now stays open.
  const lamps = placeLamps(grid, plan);

  scatterCover(grid, rng, plan.spawn, plan.extraction, stash, plan.parks, lamps);
  plantTrees(grid, rng, plan.parks, lamps);

  // Re-cut every link last, at a radius wide enough to guarantee an
  // orthogonally-connected corridor. Cover is scattered blind, and a corridor
  // it happens to plug would make the run unwinnable — which for this game
  // means silently costing someone their commit.
  //
  // Every branch goes through here, not just the trunk: an alternate route
  // severed by a stray cover cluster is a path the map promised and does not
  // have, and a dead end severed from its anchor is unreachable loot.
  for (const [from, to] of links) {
    carveCorridor(grid, from, to, SAFE_CORRIDOR_RADIUS);
  }

  const city = buildMeshes(grid, plan.parks, lamps);
  return {
    grid,
    group: city.group,
    setFocus: city.setFocus,
    spawn: plan.spawn,
    extraction: plan.extraction,
    waypoints,
    stash,
    routes: plan.branches,
    deadEnds: deadEndTerminals(plan),
    chokepoints: plan.chokepoints.map((i) => waypoints[i]),
    corridorRadius: plan.corridorRadius,
    roomRadius: plan.roomRadius,
    parks: plan.parks,
    lamps,
  };
}

/**
 * Cut every branch of the plan, and report each link so the safety pass can
 * guarantee it stays open.
 *
 * Rooms are the same size everywhere — a junction, a corner and the end of a
 * dead end all get the same chamber. The player is given no signposting about
 * which way leads to the pad, so a room that looked different at a fork would
 * be exactly the tell the design is trying not to give them.
 */
function carvePlan(grid: Grid, plan: RoutePlan, rng: Rng): Array<[Spot, Spot]> {
  const links: Array<[Spot, Spot]> = [];
  for (const branch of plan.branches) {
    for (let i = 0; i < branch.points.length - 1; i++) {
      links.push([branch.points[i], branch.points[i + 1]]);
      carveCorridor(grid, branch.points[i], branch.points[i + 1], plan.corridorRadius);
    }
  }
  // Rooms after every corridor, so a room always opens onto finished ground.
  for (const branch of plan.branches) {
    for (const point of branch.roomAt) {
      carveRoom(grid, point, plan.roomRadius, rng);
    }
  }
  // Parks last and widest. They are where the map is allowed to open out, and
  // the planner has already worked out how far each one can grow without
  // running into anything, so this cannot merge two branches together.
  for (const park of plan.parks) {
    carveRoom(grid, park, park.radius, rng);
  }
  return links;
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

/**
 * Clear a slightly irregular room, so junctions don't all look identical.
 *
 * No lobe may reach past `radius` from the centre — the offset is spent out of
 * the lobe's own size rather than added to it. The planner keeps rooms apart by
 * exactly this radius, so a lobe that bulged beyond it could merge two chambers
 * the plan had separated, and a dead end that shares a room with the corridor
 * running past it is not a dead end any more.
 */
function carveRoom(grid: Grid, centre: Spot, radius: number, rng: Rng): void {
  const lobes = rng.int(2, 4);
  for (let i = 0; i < lobes; i++) {
    const angle = rng.range(0, Math.PI * 2);
    const offset = rng.range(0, radius * 0.35);
    clearDisc(
      grid,
      centre.x + Math.cos(angle) * offset,
      centre.z + Math.sin(angle) * offset,
      (radius - offset) * rng.range(0.7, 1),
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
 * Trees, as cover cells inside the parks.
 *
 * They are ordinary cover as far as the game is concerned — solid, stops a
 * round, does not stop you seeing over it — so nothing in combat has to learn
 * what a tree is. What makes them trees is that `buildMeshes` draws any cover
 * standing on grass as one.
 *
 * Scattered before the safety re-cut, on purpose. A tree that lands in the lane
 * through the park gets cleared along with everything else in the corridor,
 * which leaves a path through the middle and trees to either side — which is
 * what a park with a path through it looks like anyway.
 */
function plantTrees(grid: Grid, rng: Rng, parks: Park[], lamps: Spot[]): void {
  for (const park of parks) {
    const open: Array<{ cx: number; cz: number }> = [];
    const minCX = grid.cellX(park.x - park.radius);
    const maxCX = grid.cellX(park.x + park.radius);
    const minCZ = grid.cellZ(park.z - park.radius);
    const maxCZ = grid.cellZ(park.z + park.radius);

    for (let cz = minCZ; cz <= maxCZ; cz++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        if (!grid.inBounds(cx, cz) || grid.cell(cx, cz) !== CELL.EMPTY) continue;
        const x = (cx + 0.5) * grid.tile;
        const z = (cz + 0.5) * grid.tile;
        // Leave the rim bare so the grass has an edge before the trees start.
        if (distance({ x, z }, park) > park.radius * 0.86) continue;
        // A park has lamps down its path too, and a tree planted on top of one
        // both buries it and puts a solid cell where the lamp is standing.
        if (lamps.some((lamp) => distance({ x, z }, lamp) < 3.5)) continue;
        open.push({ cx, cz });
      }
    }
    if (open.length === 0) continue;

    rng.shuffle(open);
    // Sparse enough to walk and fight between. Packed any tighter and a park
    // stops being somewhere you cross and becomes a wall with a gap in it.
    const count = Math.max(2, Math.round(open.length * 0.09));
    for (let i = 0; i < count && i < open.length; i++) {
      grid.setCell(open[i].cx, open[i].cz, CELL.COVER);
    }
  }
}

/**
 * Lamp posts down the kerb of every route.
 *
 * Placed after the last cut, so a lamp can never end up buried in a wall the
 * safety pass put back. They stand off the centreline by most of the corridor's
 * half-width, which is where a kerb would be, and alternate sides so a street is
 * lit from both without doubling the count.
 *
 * Nothing else in the game lights the ground. The buildings were carrying it
 * with lit windows, which made every wall a light source and the streets
 * themselves oddly flat; a row of actual fittings gives the route somewhere the
 * light is coming *from*, and lets the windows come down.
 */
function placeLamps(grid: Grid, plan: RoutePlan): Spot[] {
  const lamps: Spot[] = [];
  const spacing = 15;
  const offset = plan.corridorRadius * 0.78;
  let side = 1;

  for (const branch of plan.branches) {
    for (let i = 0; i < branch.points.length - 1; i++) {
      const from = branch.points[i];
      const to = branch.points[i + 1];
      const length = distance(from, to);
      if (length < 1) continue;
      const dx = (to.x - from.x) / length;
      const dz = (to.z - from.z) / length;

      for (let along = spacing * 0.5; along < length; along += spacing) {
        side = -side;
        const cx = from.x + dx * along;
        const cz = from.z + dz * along;
        // Perpendicular to the run, so lamps line the street rather than
        // standing in the middle of it.
        const candidates = [
          { x: cx - dz * offset * side, z: cz + dx * offset * side },
          { x: cx + dz * offset * side, z: cz - dx * offset * side },
        ];
        for (const spot of candidates) {
          if (grid.isSolidWorld(spot.x, spot.z)) continue;
          // Not on the pad. The beacon is the brightest thing on the map and
          // has to stay that way.
          if (distance(spot, plan.extraction) < 9) continue;
          if (lamps.some((l) => distance(l, spot) < spacing * 0.6)) continue;
          lamps.push(spot);
          break;
        }
      }
    }
  }
  return lamps;
}

/** Waist-high cover inside the carved space — the things you fight around. */
function scatterCover(
  grid: Grid,
  rng: Rng,
  spawn: Spot,
  extraction: Spot,
  stash: Spot | null,
  parks: Park[],
  lamps: Spot[],
): void {
  const open: Array<{ cx: number; cz: number }> = [];
  for (let cz = 2; cz < grid.rows - 2; cz++) {
    for (let cx = 2; cx < grid.cols - 2; cx++) {
      if (grid.cell(cx, cz) !== CELL.EMPTY) continue;
      const x = (cx + 0.5) * grid.tile;
      const z = (cz + 0.5) * grid.tile;
      // Keep the endpoints clear so you can always land and always extract.
      if (distance({ x, z }, spawn) < 8 || distance({ x, z }, extraction) < 10) continue;
      // And the stash, so a cover cluster can never wall off the cache you
      // walked a detour to reach.
      if (stash && distance({ x, z }, stash) < 6) continue;
      // Parks get trees instead. A concrete block sitting on the grass reads as
      // something dumped there rather than as part of the place.
      if (parks.some((park) => distance({ x, z }, park) < park.radius)) continue;
      // And keep the foot of every lamp clear. A cluster closing around one
      // both looks like the lamp was bricked in and can seal it into a pocket
      // of floor nobody can walk to.
      if (lamps.some((lamp) => distance({ x, z }, lamp) < 3.5)) continue;
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
        // Checked per cell, not per cluster. A block is grown from its seed
        // outward, so filtering only where the seed lands still lets the far
        // corner of a three-by-three come down on top of a lamp.
        if (nearLamp(grid, cx + dx, cz + dz, lamps)) continue;
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
    if (nearLamp(grid, spot.cx, spot.cz, lamps)) continue;
    grid.setCell(spot.cx, spot.cz, CELL.WALL);
    if (rng.next() < 0.5 && !nearLamp(grid, spot.cx + 1, spot.cz, lamps)) {
      grid.setCell(spot.cx + 1, spot.cz, CELL.WALL);
    }
  }
}

/** Keep clutter off the foot of a lamp post, and out of the ring around it. */
function nearLamp(grid: Grid, cx: number, cz: number, lamps: Spot[]): boolean {
  const x = (cx + 0.5) * grid.tile;
  const z = (cz + 0.5) * grid.tile;
  return lamps.some((lamp) => distance({ x, z }, lamp) < 3.5);
}

/**
 * One InstancedMesh per cell kind.
 *
 * Only walls with an open neighbour are built. Now that the map is solid rock
 * with a route cut through it, most cells are buried and would never be seen —
 * rendering the shell instead of the volume cuts the instance count by an
 * order of magnitude and keeps the shadow pass cheap.
 */
export function buildMeshes(grid: Grid, parks: Park[] = [], lamps: Spot[] = []): {
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

  const trees: Array<{ cx: number; cz: number }> = [];
  const benches: Array<{ cx: number; cz: number }> = [];
  const boxes: Array<{ cx: number; cz: number }> = [];
  const bushes: Array<{ cx: number; cz: number }> = [];

  for (let cz = 0; cz < grid.rows; cz++) {
    for (let cx = 0; cx < grid.cols; cx++) {
      const kind = grid.cell(cx, cz);
      if (kind === CELL.COVER) {
        // Cover standing on grass is park furniture. Nothing in the simulation
        // knows the difference — it is the same solid cell whichever it is —
        // which is why the whole distinction can live in the mesh builder and
        // nowhere else.
        const x = (cx + 0.5) * grid.tile;
        const z = (cz + 0.5) * grid.tile;
        if (!parks.some((park) => distance({ x, z }, park) < park.radius)) {
          // Off the grass, a share of the cover is stacked boxes rather than
          // another cast-concrete block. Same cell, same collision — the street
          // just stops looking like it was furnished from one catalogue.
          if (propHash(cx, cz) < 0.42) boxes.push({ cx, cz });
          else covers.push({ cx, cz });
          continue;
        }
        const roll = propHash(cx, cz);
        if (roll < 0.2) benches.push({ cx, cz });
        else if (roll < 0.44) bushes.push({ cx, cz });
        else trees.push({ cx, cz });
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
  if (trees.length > 0) focusable.push(...addTrees(group, grid, trees));
  if (benches.length > 0) focusable.push(...addBenches(group, grid, benches, parks));
  if (boxes.length > 0) focusable.push(...addBoxes(group, grid, boxes));
  if (bushes.length > 0) focusable.push(...addBushes(group, grid, bushes));
  if (parks.length > 0) focusable.push(...addGroundCover(group, grid, parks));
  if (lamps.length > 0) focusable.push(...addLamps(group, lamps));

  return {
    group,
    setFocus: (x, y, z) => setOccluderFocus(focusable, x, y, z),
  };
}

/** Trunk height, and the centre and radius of the canopy sitting on it. */
const TRUNK_HEIGHT = 1.5;
const CANOPY_RADIUS = 1.45;
const CANOPY_CENTRE = TRUNK_HEIGHT + CANOPY_RADIUS * 0.72;
/**
 * Total tree height. Kept under the same ceiling `city.ts` holds buildings to:
 * at a 26-unit standoff and 57° of pitch, anything much taller on the near side
 * of the player sits on the camera's sightline permanently.
 */
const TREE_HEIGHT = CANOPY_CENTRE + CANOPY_RADIUS;

/**
 * Two instanced meshes, trunks and canopies.
 *
 * The canopy is a low-detail icosahedron rather than a sphere on purpose: the
 * facets catch the directional light at different angles, which gives a tree a
 * readable silhouette against a near-black street. A smooth sphere at this size
 * reads as a blob.
 *
 * Each tree is scaled and spun off a hash of its cell rather than off the
 * mission `Rng` — the same argument `city.ts` makes for building heights. Trees
 * are dressing, and drawing from the run's stream here would mean changing how
 * a park looks silently re-rolled every enemy spawn after it.
 */
function addTrees(
  group: Group,
  grid: Grid,
  trees: Array<{ cx: number; cz: number }>,
): MeshStandardMaterial[] {
  const barkMaterial = new MeshStandardMaterial({
    color: PALETTE.bark,
    roughness: 0.96,
    metalness: 0,
  });
  const canopyMaterial = new MeshStandardMaterial({
    color: PALETTE.foliage,
    roughness: 0.88,
    metalness: 0,
    emissive: PALETTE.foliageLight,
    emissiveIntensity: 0.07,
  });
  applyConcreteSurface(barkMaterial, TRUNK_HEIGHT);
  applyFoliageSurface(canopyMaterial, TREE_HEIGHT);

  const trunks = new InstancedMesh(
    new CylinderGeometry(0.16, 0.26, TRUNK_HEIGHT, 6),
    barkMaterial,
    trees.length,
  );
  const canopies = new InstancedMesh(
    new IcosahedronGeometry(CANOPY_RADIUS, 1),
    canopyMaterial,
    trees.length,
  );
  trunks.castShadow = canopies.castShadow = true;
  trunks.receiveShadow = canopies.receiveShadow = true;

  // The foliage shader reads height the same way the concrete one does.
  const canopyData = new Float32Array(trees.length * 2);
  const dummy = new Object3D();

  trees.forEach((cell, i) => {
    const wobble = treeHash(cell.cx, cell.cz);
    const lean = treeHash(cell.cx + 91, cell.cz + 17);
    const scale = 0.78 + wobble * 0.5;
    // Off-centre within the cell, so a row of trees does not line up with the
    // slab joints under it and turn the park back into a grid.
    const x = (cell.cx + 0.5) * grid.tile + (wobble - 0.5) * grid.tile * 0.55;
    const z = (cell.cz + 0.5) * grid.tile + (lean - 0.5) * grid.tile * 0.55;

    dummy.position.set(x, (TRUNK_HEIGHT / 2) * scale, z);
    dummy.rotation.set(0, wobble * Math.PI * 2, 0);
    dummy.scale.set(1, scale, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);

    dummy.position.set(x, CANOPY_CENTRE * scale, z);
    dummy.rotation.set(lean * 0.5, wobble * Math.PI * 2, wobble * 0.4);
    dummy.scale.set(scale, scale * 0.86, scale);
    dummy.updateMatrix();
    canopies.setMatrixAt(i, dummy.matrix);

    canopyData[i * 2] = wobble;
    canopyData[i * 2 + 1] = TREE_HEIGHT * scale;
  });

  canopies.geometry.setAttribute('aBuilding', new InstancedBufferAttribute(canopyData, 2));
  trunks.geometry.setAttribute(
    'aBuilding',
    new InstancedBufferAttribute(new Float32Array(trees.length * 2), 2),
  );
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  group.add(trunks, canopies);

  return [barkMaterial, canopyMaterial];
}

/** Stable per-cell 0..1, so a prop looks the same every time the map is built. */
function treeHash(cx: number, cz: number): number {
  const h = Math.sin(cx * 127.1 + cz * 311.7) * 43758.5453;
  return h - Math.floor(h);
}

/** A second, uncorrelated stream — deciding *what* a prop is, not how it looks. */
function propHash(cx: number, cz: number): number {
  const h = Math.sin(cx * 269.5 + cz * 183.3) * 27182.8459;
  return h - Math.floor(h);
}

const BENCH_SEAT_HEIGHT = 0.44;
const BENCH_LENGTH = 1.7;

/**
 * Benches, as one instanced box drawn twice per bench: a seat and a back.
 *
 * They face the middle of their park. Rolling the angle instead would read as
 * furniture dropped from a height, whereas benches turned inward make the lawn
 * look like somewhere laid out for people — which is the whole reason a park is
 * worth having on the map rather than just a green floor.
 *
 * Solid, like every other bit of cover. Something you can put between yourself
 * and a recruiter is worth more here than something you walk through, and an
 * open lawn needs whatever it can get.
 */
function addBenches(
  group: Group,
  grid: Grid,
  benches: Array<{ cx: number; cz: number }>,
  parks: Park[],
): MeshStandardMaterial[] {
  const material = new MeshStandardMaterial({
    color: PALETTE.bench,
    roughness: 0.9,
    metalness: 0.04,
  });
  applyConcreteSurface(material, BENCH_SEAT_HEIGHT + 0.5);

  // Two boxes per bench, one mesh.
  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, benches.length * 2);
  mesh.castShadow = mesh.receiveShadow = true;
  const dummy = new Object3D();

  benches.forEach((cell, i) => {
    const jitter = treeHash(cell.cx, cell.cz);
    const x = (cell.cx + 0.5) * grid.tile + (jitter - 0.5) * grid.tile * 0.4;
    const z = (cell.cz + 0.5) * grid.tile + (propHash(cell.cx, cell.cz) - 0.5) * grid.tile * 0.4;

    let nearest = parks[0];
    for (const park of parks) {
      if (distance({ x, z }, park) < distance({ x, z }, nearest)) nearest = park;
    }
    // Facing in, with a little slack so a ring of benches is not a perfect ring.
    const yaw = Math.atan2(nearest.z - z, nearest.x - x) + (jitter - 0.5) * 0.5;

    dummy.position.set(x, BENCH_SEAT_HEIGHT, z);
    dummy.rotation.set(0, -yaw, 0);
    dummy.scale.set(0.52, 0.12, BENCH_LENGTH);
    dummy.updateMatrix();
    mesh.setMatrixAt(i * 2, dummy.matrix);

    // The back sits behind the seat, away from the middle of the park.
    dummy.position.set(
      x - Math.cos(yaw) * 0.22,
      BENCH_SEAT_HEIGHT + 0.28,
      z - Math.sin(yaw) * 0.22,
    );
    dummy.rotation.set(0, -yaw, 0);
    dummy.scale.set(0.11, 0.56, BENCH_LENGTH);
    dummy.updateMatrix();
    mesh.setMatrixAt(i * 2 + 1, dummy.matrix);
  });

  mesh.geometry.setAttribute(
    'aBuilding',
    new InstancedBufferAttribute(new Float32Array(benches.length * 4), 2),
  );
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  return [material];
}

const LAMP_HEIGHT = 4.1;

/**
 * Street lamps: a post, a head, and a pool of light on the ground.
 *
 * The pool is a flat disc with a warm centre fading to nothing at the rim, drawn
 * additively and unlit. It is not a light — three would need a real point light
 * per lamp and there are dozens of them, which the forward renderer would not
 * survive. What it has to do is make the ground under a lamp brighter than the
 * ground between two, and a gradient disc does that for one draw call.
 *
 * The head is unlit on purpose. A lamp that dims when it falls into a building's
 * shadow is not a lamp, and being unlit is also what lets it stay the brightest
 * thing in its patch of street and feed the bloom pass properly.
 */
function addLamps(group: Group, lamps: Spot[]): MeshStandardMaterial[] {
  const postMaterial = new MeshStandardMaterial({
    color: PALETTE.lampPost,
    roughness: 0.7,
    metalness: 0.3,
  });
  applyConcreteSurface(postMaterial, LAMP_HEIGHT);

  const posts = new InstancedMesh(
    new CylinderGeometry(0.075, 0.11, LAMP_HEIGHT, 5),
    postMaterial,
    lamps.length,
  );
  posts.castShadow = true;
  posts.receiveShadow = true;

  const heads = new InstancedMesh(
    new BoxGeometry(0.46, 0.16, 0.28),
    new MeshBasicMaterial({ color: PALETTE.lampLight }),
    lamps.length,
  );

  // Vertex colours give the falloff for free: white at the centre vertex, black
  // around the rim, interpolated across the fan.
  const poolGeometry = new CircleGeometry(4.6, 14);
  poolGeometry.rotateX(-Math.PI / 2);
  const rgb = new Float32Array(poolGeometry.attributes.position.count * 3);
  rgb.fill(0);
  rgb[0] = rgb[1] = rgb[2] = 1;
  poolGeometry.setAttribute('color', new Float32BufferAttribute(rgb, 3));

  const pools = new InstancedMesh(
    poolGeometry,
    new MeshBasicMaterial({
      color: PALETTE.lampLight,
      vertexColors: true,
      transparent: true,
      opacity: 0.3,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
    lamps.length,
  );
  // Under everything that stands on the street, and it must not z-fight the
  // road it is painted on.
  pools.renderOrder = -1;

  const dummy = new Object3D();
  lamps.forEach((lamp, i) => {
    dummy.position.set(lamp.x, LAMP_HEIGHT / 2, lamp.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    posts.setMatrixAt(i, dummy.matrix);

    dummy.position.set(lamp.x, LAMP_HEIGHT - 0.1, lamp.z);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);

    dummy.position.set(lamp.x, 0.03, lamp.z);
    dummy.updateMatrix();
    pools.setMatrixAt(i, dummy.matrix);
  });

  posts.geometry.setAttribute(
    'aBuilding',
    new InstancedBufferAttribute(new Float32Array(lamps.length * 2), 2),
  );
  posts.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  pools.instanceMatrix.needsUpdate = true;
  group.add(pools, posts, heads);

  // Only the post dissolves. The head is a few centimetres across and hides
  // nothing; the pool is on the floor.
  return [postMaterial];
}

/**
 * Stacked boxes, in place of some of the street's concrete cover.
 *
 * Two or three to a cell at varied sizes and angles, which is the whole point —
 * a block is a block from any angle, and a stack has a silhouette that tells you
 * which way you are looking at it.
 */
function addBoxes(
  group: Group,
  grid: Grid,
  boxes: Array<{ cx: number; cz: number }>,
): MeshStandardMaterial[] {
  const material = new MeshStandardMaterial({
    color: PALETTE.boxProp,
    roughness: 0.88,
    metalness: 0.03,
  });
  applyConcreteSurface(material, COVER_HEIGHT);

  const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, boxes.length * 3);
  mesh.castShadow = mesh.receiveShadow = true;
  const dummy = new Object3D();

  boxes.forEach((cell, i) => {
    const base = treeHash(cell.cx, cell.cz);
    let stacked = 0;
    for (let n = 0; n < 3; n++) {
      const h = treeHash(cell.cx + n * 53, cell.cz + n * 29);
      // The third box is only there sometimes, so stacks vary in height.
      const size = n === 2 ? 0.52 + h * 0.2 : 0.72 + h * 0.34;
      const skip = n === 2 && h > 0.55;
      dummy.position.set(
        (cell.cx + 0.5) * grid.tile + (h - 0.5) * 0.5,
        skip ? -50 : stacked + size / 2,
        (cell.cz + 0.5) * grid.tile + (base - 0.5) * 0.5,
      );
      dummy.rotation.set(0, (h - 0.5) * 1.1, 0);
      dummy.scale.set(size, size, size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i * 3 + n, dummy.matrix);
      if (!skip) stacked += size * 0.92;
    }
  });

  mesh.geometry.setAttribute(
    'aBuilding',
    new InstancedBufferAttribute(new Float32Array(boxes.length * 6), 2),
  );
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  return [material];
}

/** Shrubs: low, wide and solid, for the parts of a park a tree would over-fill. */
function addBushes(
  group: Group,
  grid: Grid,
  bushes: Array<{ cx: number; cz: number }>,
): MeshStandardMaterial[] {
  const material = new MeshStandardMaterial({
    color: PALETTE.bush,
    roughness: 0.93,
    metalness: 0,
  });
  applyFoliageSurface(material, 1.1);

  // Three lumps per bush, so it reads as a shrub rather than a green pebble.
  const mesh = new InstancedMesh(new IcosahedronGeometry(0.62, 0), material, bushes.length * 3);
  mesh.castShadow = mesh.receiveShadow = true;
  const dummy = new Object3D();

  bushes.forEach((cell, i) => {
    const base = treeHash(cell.cx, cell.cz);
    for (let lump = 0; lump < 3; lump++) {
      const h = treeHash(cell.cx + lump * 31, cell.cz + lump * 17);
      const angle = h * Math.PI * 2;
      const offset = 0.3 + h * 0.4;
      const scale = 0.7 + h * 0.55;
      dummy.position.set(
        (cell.cx + 0.5) * grid.tile + Math.cos(angle) * offset,
        0.34 + h * 0.22,
        (cell.cz + 0.5) * grid.tile + Math.sin(angle) * offset,
      );
      dummy.rotation.set(h * 2, base * 6, h * 1.5);
      dummy.scale.set(scale, scale * 0.72, scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i * 3 + lump, dummy.matrix);
    }
  });

  mesh.geometry.setAttribute(
    'aBuilding',
    new InstancedBufferAttribute(new Float32Array(bushes.length * 6), 2),
  );
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  return [material];
}

/**
 * Ankle-high tufts on the open grass. Purely dressing — no cell, no collision.
 *
 * Kept under knee height on purpose. A prop you walk straight through is only
 * acceptable while it is obviously too small to have stopped you; anything
 * taller and the first time you clip through one the whole park stops reading
 * as solid ground.
 */
function addGroundCover(group: Group, grid: Grid, parks: Park[]): MeshStandardMaterial[] {
  const spots: Array<{ x: number; z: number; h: number }> = [];

  for (const park of parks) {
    const minCX = grid.cellX(park.x - park.radius);
    const maxCX = grid.cellX(park.x + park.radius);
    const minCZ = grid.cellZ(park.z - park.radius);
    const maxCZ = grid.cellZ(park.z + park.radius);

    for (let cz = minCZ; cz <= maxCZ; cz++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        if (!grid.inBounds(cx, cz) || grid.cell(cx, cz) !== CELL.EMPTY) continue;
        const x = (cx + 0.5) * grid.tile;
        const z = (cz + 0.5) * grid.tile;
        if (distance({ x, z }, park) > park.radius * 0.94) continue;
        const h = treeHash(cx * 3 + 7, cz * 5 + 11);
        if (h > 0.42) continue;
        spots.push({ x, z, h });
      }
    }
  }
  if (spots.length === 0) return [];

  const material = new MeshStandardMaterial({
    color: PALETTE.grassLight,
    roughness: 0.97,
    metalness: 0,
  });
  applyFoliageSurface(material, 0.4);

  const mesh = new InstancedMesh(new IcosahedronGeometry(0.3, 0), material, spots.length);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  const dummy = new Object3D();

  spots.forEach((spot, i) => {
    const scale = 0.6 + spot.h * 1.6;
    dummy.position.set(
      spot.x + (spot.h - 0.2) * grid.tile * 0.7,
      0.12 + spot.h * 0.1,
      spot.z + (0.25 - spot.h) * grid.tile * 0.7,
    );
    dummy.rotation.set(spot.h * 3, spot.h * 9, spot.h * 2);
    dummy.scale.set(scale, scale * 0.5, scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });

  mesh.geometry.setAttribute(
    'aBuilding',
    new InstancedBufferAttribute(new Float32Array(spots.length * 2), 2),
  );
  mesh.instanceMatrix.needsUpdate = true;
  group.add(mesh);
  return [material];
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
