/**
 * Route planning: the shape of a level, decided before anything is carved.
 *
 * This file is pure geometry — no Grid, no three.js, no cell indices. It
 * answers "where does the route go" and hands `arena.ts` a plan to cut. The
 * split exists because the interesting questions about a level are topological
 * ("does this branch actually rejoin", "does this dead end actually end") and
 * those are cheap to assert on polylines and expensive to assert on a bitmap.
 *
 * The load-bearing idea is CLEARANCE. Corridors are carved as swept discs, so
 * two centrelines passing within twice the corridor radius merge into one open
 * blob — which silently turns a dead end into a through-route. The player gets
 * no visual tell about where a branch leads, so the topology is the only
 * information they have, and it has to be true. Every point this planner places
 * is checked against everything already placed, and a candidate that would
 * merge is rejected rather than carved and hoped about.
 */
import type { Rng } from '../core/rng';

export interface Spot {
  x: number;
  z: number;
}

export type BranchKind = 'trunk' | 'alternate' | 'dead-end';

export interface Branch {
  kind: BranchKind;
  /** Polyline in world units, in travel order. */
  points: Spot[];
  /**
   * Where this branch leaves the trunk and where it returns, as indices into
   * the trunk polyline.
   *
   * - `alternate`: both set, and `rejoinIndex - splitIndex >= MIN_BYPASS_SPAN`.
   * - `dead-end`: `splitIndex` set, `rejoinIndex` null. That null is not a
   *   note — it is the guarantee the branch terminates, and it is what the
   *   tests assert against.
   * - `trunk`: both null.
   */
  splitIndex: number | null;
  rejoinIndex: number | null;
  /** Points that get a room carved: junctions, turns, terminals. */
  roomAt: Spot[];
}

/**
 * A green space on the route: grass underfoot instead of tarmac, and trees to
 * fight around.
 *
 * Parks sit on rooms the route already opens up rather than anywhere new, so
 * they cost no extra carving and cannot affect whether the map connects. What
 * they change is what a room *is*: every junction otherwise looks like every
 * other junction, which on a map with no signposting makes one stretch of the
 * haul hard to tell from the last.
 */
export interface Park {
  x: number;
  z: number;
  radius: number;
}

export interface RoutePlan {
  spawn: Spot;
  extraction: Spot;
  /** `branches[0]` is always the trunk. */
  branches: Branch[];
  /** Rooms turned over to grass and trees. */
  parks: Park[];
  /**
   * Trunk indices no alternate bypasses — every path through the map crosses
   * these. Weapons go here, so a player taking the scenic way still finds them.
   */
  chokepoints: number[];
  corridorRadius: number;
  roomRadius: number;
  /** True if the trunk came from the interpolated route of last resort. */
  usedFallback: boolean;
}

/** Keep endpoints this many cells clear of the border wall. */
export const ENDPOINT_MARGIN = 4;
/**
 * Minimum spawn↔extraction distance as a fraction of the arena's shorter side.
 * High enough that the haul is always a real traverse.
 */
export const MIN_SEPARATION_FRACTION = 0.62;

/**
 * Rock left standing between two corridors that pass each other. Two full
 * cells at the standard tile size, so the flood fill cannot leak between them
 * even diagonally — which is what makes a planned dead end a carved dead end.
 */
export const MIN_WALL = 4;

/**
 * Sides, clockwise: 0 top, 1 right, 2 bottom, 3 left. Each is parameterised by
 * `t` in [0, 1] running clockwise, so side `s` at t=1 is the same corner as
 * side `s+1` at t=0. That shared-corner property is what lets the endpoint
 * picker keep adjacent-side pairs apart — see `alongRange`.
 */
type Side = 0 | 1 | 2 | 3;

/** A point on `side`, `t` along it, `depth` cells in from the edge. */
function sidePoint(
  side: Side,
  t: number,
  depth: number,
  cols: number,
  rows: number,
  tile: number,
): Spot {
  const spanX = cols - 1 - ENDPOINT_MARGIN * 2;
  const spanZ = rows - 1 - ENDPOINT_MARGIN * 2;
  const alongX = ENDPOINT_MARGIN + t * spanX;
  const alongZ = ENDPOINT_MARGIN + t * spanZ;
  // Sides 2 and 3 run backwards, so the clockwise winding holds.
  const backX = ENDPOINT_MARGIN + (1 - t) * spanX;
  const backZ = ENDPOINT_MARGIN + (1 - t) * spanZ;

  switch (side) {
    case 0:
      return cellCentre(alongX, depth, tile);
    case 1:
      return cellCentre(cols - 1 - depth, alongZ, tile);
    case 2:
      return cellCentre(backX, rows - 1 - depth, tile);
    default:
      return cellCentre(depth, backZ, tile);
  }
}

function cellCentre(cx: number, cz: number, tile: number): Spot {
  return { x: (cx + 0.5) * tile, z: (cz + 0.5) * tile };
}

/**
 * The stretch of a side an endpoint may sit on, given where the other endpoint
 * is.
 *
 * Opposite sides are already far apart wherever you stand on them. Adjacent
 * sides are not: the top-right corner belongs to both the top and right edges,
 * and two endpoints that both drift toward it end up metres apart. So for an
 * adjacent pair each endpoint is pushed into the half of its edge furthest from
 * the corner they share.
 */
function alongRange(side: Side, other: Side): [number, number] {
  const step = (other - side + 4) % 4;
  if (step === 2) return [0, 1];
  // `other` is clockwise-next: they share this side's t=1 corner.
  if (step === 1) return [0, 0.45];
  // `other` is clockwise-previous: they share this side's t=0 corner.
  return [0.55, 1];
}

/**
 * Seeded spawn and extraction, on different sides of the map.
 *
 * Both endpoints hug the perimeter — you insert from outside and you leave from
 * outside. Rolling the two sides independently is what varies the macro shape
 * of a run: an opposite-side pair is a traverse straight across the map, an
 * adjacent-side pair hooks around a corner. Opposite is weighted 2:1, so it is
 * roughly an even split between the two.
 */
export function pickEndpoints(
  rng: Rng,
  cols: number,
  rows: number,
  tile: number,
): { spawn: Spot; extraction: Spot } {
  const minSeparation = Math.min(cols, rows) * tile * MIN_SEPARATION_FRACTION;

  const spawnSide = rng.int(0, 3) as Side;
  const exitSide = ((spawnSide + rng.pick([1, 2, 2, 3])) % 4) as Side;

  const [spawnLow, spawnHigh] = alongRange(spawnSide, exitSide);
  const spawn = sidePoint(
    spawnSide,
    rng.range(spawnLow, spawnHigh),
    ENDPOINT_MARGIN + rng.int(0, 2),
    cols,
    rows,
    tile,
  );

  // A fixed number of draws, so map tuning never shifts the RNG stream by a
  // seed-dependent amount. The first candidate that clears the bar wins rather
  // than the furthest one — always taking the maximum would pin extraction to
  // the far corner and throw away most of the variety.
  const [exitLow, exitHigh] = alongRange(exitSide, spawnSide);
  let best = spawn;
  let bestDistance = -1;
  let chosen: Spot | null = null;

  for (let i = 0; i < 24; i++) {
    const candidate = sidePoint(
      exitSide,
      rng.range(exitLow, exitHigh),
      ENDPOINT_MARGIN + rng.int(0, 4),
      cols,
      rows,
      tile,
    );
    const d = distance(spawn, candidate);
    if (d > bestDistance) {
      best = candidate;
      bestDistance = d;
    }
    if (chosen === null && d >= minSeparation) chosen = candidate;
  }

  return { spawn, extraction: chosen ?? best };
}

// ---------------------------------------------------------------------------
// Clearance
// ---------------------------------------------------------------------------

/** Squared distance from a point to a segment. */
function pointSegmentDistanceSq(p: Spot, a: Spot, b: Spot): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return (p.x - a.x) ** 2 + (p.z - a.z) ** 2;
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + dx * t;
  const cz = a.z + dz * t;
  return (p.x - cx) ** 2 + (p.z - cz) ** 2;
}

export function pointSegmentDistance(p: Spot, a: Spot, b: Spot): number {
  return Math.sqrt(pointSegmentDistanceSq(p, a, b));
}

/**
 * Distance between two segments. Zero if they cross — which matters, because a
 * crossing is exactly the case that merges two corridors into a junction the
 * plan never intended.
 */
export function segmentDistance(a: Spot, b: Spot, c: Spot, d: Spot): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.sqrt(
    Math.min(
      pointSegmentDistanceSq(a, c, d),
      pointSegmentDistanceSq(b, c, d),
      pointSegmentDistanceSq(c, a, b),
      pointSegmentDistanceSq(d, a, b),
    ),
  );
}

function cross(ox: number, oz: number, ax: number, az: number, bx: number, bz: number): number {
  return (ax - ox) * (bz - oz) - (az - oz) * (bx - ox);
}

function segmentsIntersect(a: Spot, b: Spot, c: Spot, d: Spot): boolean {
  const d1 = cross(c.x, c.z, d.x, d.z, a.x, a.z);
  const d2 = cross(c.x, c.z, d.x, d.z, b.x, b.z);
  const d3 = cross(a.x, a.z, b.x, b.z, c.x, c.z);
  const d4 = cross(a.x, a.z, b.x, b.z, d.x, d.z);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

export interface Radii {
  corridor: number;
  room: number;
}

/**
 * Everything already committed to the plan, in the form the clearance test
 * needs. Segments are corridor centrelines; nodes are points that will get a
 * room, which are fatter and so need more room around them.
 */
export interface Placed {
  segments: Array<[Spot, Spot]>;
  nodes: Spot[];
}

export function emptyPlacement(): Placed {
  return { segments: [], nodes: [] };
}

/** Add a polyline to a placement. `roomAt` points become room nodes. */
export function place(into: Placed, points: Spot[], roomAt: Spot[]): void {
  for (let i = 0; i < points.length - 1; i++) {
    into.segments.push([points[i], points[i + 1]]);
  }
  into.nodes.push(...roomAt);
}

const EPSILON = 1e-6;

function same(a: Spot, b: Spot): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.z - b.z) < EPSILON;
}

/**
 * Would carving `from → to` merge with anything already placed?
 *
 * `attached` lists points this segment is legitimately joined to — its own
 * endpoints where they meet an existing branch. Those are the one case where
 * touching is intended, so segments and nodes at those points are skipped.
 */
export function clears(
  from: Spot,
  to: Spot,
  placed: Placed,
  radii: Radii,
  attached: Spot[],
  /**
   * Whether corridors meeting at a shared junction must visibly separate.
   *
   * A branch leaving a junction has to pull away from whatever else leaves that
   * junction, or the two are carved on top of each other and the fork the
   * player thought they were taking never existed. A route bending at its own
   * waypoint is the opposite case — that is one corridor turning, and holding
   * it to the same rule would ban every gentle bend. So the trunk walking
   * itself passes `false`, and everything hanging off it passes `true`.
   */
  divergeAtJunction = false,
): boolean {
  const isAttached = (p: Spot): boolean => attached.some((a) => same(a, p));
  const segmentGap = radii.corridor * 2 + MIN_WALL;
  const nodeGap = radii.room + radii.corridor + MIN_WALL;

  for (const [a, b] of placed.segments) {
    // A segment sharing an endpoint with this one is the junction we are making.
    const shared = same(a, from) || same(b, from) || same(a, to) || same(b, to);
    if ((isAttached(a) || isAttached(b)) && shared) {
      if (!divergeAtJunction) continue;
      // Two straight lines out of a common point spread apart steadily, so it
      // is enough that each one's far end has cleared the other.
      const mine = same(a, from) || same(b, from) ? to : from;
      const theirs = same(a, from) || same(a, to) ? b : a;
      if (pointSegmentDistance(mine, a, b) < segmentGap) return false;
      if (pointSegmentDistance(theirs, from, to) < segmentGap) return false;
      continue;
    }
    if (segmentDistance(from, to, a, b) < segmentGap) return false;
  }

  for (const node of placed.nodes) {
    if (isAttached(node)) continue;
    if (pointSegmentDistance(node, from, to) < nodeGap) return false;
  }

  return true;
}

/** Would a room at `centre` merge with anything already placed? */
export function clearsRoom(
  centre: Spot,
  placed: Placed,
  radii: Radii,
  attached: Spot[],
): boolean {
  const isAttached = (p: Spot): boolean => attached.some((a) => same(a, p));
  const segmentGap = radii.room + radii.corridor + MIN_WALL;
  const nodeGap = radii.room * 2 + MIN_WALL;

  for (const [a, b] of placed.segments) {
    if (isAttached(a) || isAttached(b)) continue;
    if (pointSegmentDistance(centre, a, b) < segmentGap) return false;
  }
  for (const node of placed.nodes) {
    if (isAttached(node) || same(node, centre)) continue;
    if (distance(node, centre) < nodeGap) return false;
  }
  return true;
}

export function distance(a: Spot, b: Spot): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Clamp a point into the carvable interior. */
export function clampToBounds(point: Spot, cols: number, rows: number, tile: number): Spot {
  const min = (ENDPOINT_MARGIN - 1) * tile;
  return {
    x: Math.max(min, Math.min((cols - ENDPOINT_MARGIN) * tile, point.x)),
    z: Math.max(min, Math.min((rows - ENDPOINT_MARGIN) * tile, point.z)),
  };
}

export function inBounds(point: Spot, cols: number, rows: number, tile: number): boolean {
  const min = (ENDPOINT_MARGIN - 1) * tile;
  return (
    point.x >= min &&
    point.z >= min &&
    point.x <= (cols - ENDPOINT_MARGIN) * tile &&
    point.z <= (rows - ENDPOINT_MARGIN) * tile
  );
}

// ---------------------------------------------------------------------------
// Widths
// ---------------------------------------------------------------------------

/**
 * How much of the arena ends up as open floor, before overlap. The carved
 * fraction the tests police is 0.18–0.6; rooms and corridors overlap at every
 * junction, so the net always lands under this.
 */
const OPEN_TARGET = 0.66;
/** Of the open budget, the share spent on corridors rather than rooms. */
const CORRIDOR_SHARE = 0.62;
/** Never cut narrower than this: the safety re-cut is 3.4, and one tile is 2. */
const MIN_CORRIDOR_RADIUS = 3.6;
/**
 * Widest a corridor may be, as a fraction of the arena's shorter side.
 *
 * This is the knob that trades openness against branching, and it binds on
 * small maps where the area budget alone would ask for something enormous. Every
 * unit of corridor width costs two units of the gap the next corridor needs to
 * keep clear of it, so pushing this up makes the map read more open and leaves
 * less room for the alternates and dead ends that make it worth exploring.
 */
const CORRIDOR_CAP = 0.058;

/**
 * Solve corridor and room widths from an area budget, before a single point is
 * placed.
 *
 * Widths are decided up front rather than tuned as fixed fractions because the
 * route now varies enormously in length: a fifteen-file haul carves three times
 * the line a one-file hop does. Fixed widths would make the big map three times
 * as open. Dividing a fixed area budget by the predicted length instead means
 * more branches automatically get thinner streets, and openness stays put.
 *
 * Solving it here — before planning, not after — also keeps clearance honest.
 * The planner checks candidate points against exactly the radii that will be
 * carved, with no feedback loop between the two.
 */
export function solveRadii(cols: number, rows: number, tile: number, files: number): Radii {
  const span = Math.min(cols, rows) * tile;
  const budget = OPEN_TARGET * (cols * tile) * (rows * tile);
  // Endpoints are not picked yet, so stand in the typical separation — a little
  // above the 0.62 floor the picker aims for.
  const predictedLength = trunkTarget(span, span * 0.75, files) * 1.5;
  const predictedRooms = 8 + clampFiles(files);

  const corridor = clamp(
    (budget * CORRIDOR_SHARE) / (2 * predictedLength),
    MIN_CORRIDOR_RADIUS,
    span * CORRIDOR_CAP,
  );
  const room = clamp(
    Math.sqrt((budget * (1 - CORRIDOR_SHARE)) / (Math.PI * predictedRooms)),
    corridor * 1.2,
    span * 0.11,
  );
  return { corridor, room };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * `fake-files` caps at 15, but a real commit does not. Without this a
 * two-hundred-file refactor asks for a route no arena could hold.
 */
function clampFiles(files: number): number {
  return clamp(files, 1, 15);
}

/**
 * How far the trunk should travel, in world units.
 *
 * Expressed as a multiple of the distance it *has* to cover, not as a fraction
 * of the map. Tying it to the map meant that when spawn and extraction happened
 * to land far apart the route had no slack left and marched straight at the pad
 * — which is the shape this whole design exists to stop producing. A winding
 * factor guarantees the route always has somewhere to wander, however the
 * endpoints fell.
 */
function trunkTarget(span: number, direct: number, files: number): number {
  const winding = 1.6 + 0.17 * (clampFiles(files) - 1);
  return Math.min(span * 3, Math.max(span * 0.9, direct * winding));
}

// ---------------------------------------------------------------------------
// The trunk
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;
/** A normal turn at a waypoint — enough to read as a corner, not a hairpin. */
const TURN_RANGE: [number, number] = [20, 75];
/** Rolled occasionally. This is what lets a route hook back on itself. */
const HARD_TURN_RANGE: [number, number] = [75, 125];
const HARD_TURN_CHANCE = 0.2;
/** Chance the next turn goes the other way, so the route snakes not spirals. */
const FLIP_CHANCE = 0.7;
/** Leg length as a fraction of the arena's shorter side. */
const LEG_FRACTION: [number, number] = [0.16, 0.28];
/** Below this the route has no shape, and `waypoints.length >= 5` is asserted. */
const MIN_TRUNK_NODES = 5;
/** Fraction of the target travelled before the walk starts aiming at the pad. */
const GOAL_PULL_AT = 0.65;
const GOAL_PULL = 0.45;
const MAX_TRUNK_NODES = 40;

export interface Trunk {
  points: Spot[];
  roomAt: Spot[];
  /**
   * True if the walk gave up and the interpolated swing route was used. The
   * swing route cannot self-intersect, but it also does not honour clearance —
   * so this is the one trunk shape the clearance assertions must excuse.
   */
  usedFallback: boolean;
}

/**
 * Walk from spawn to extraction by heading and turn angle.
 *
 * The old route interpolated the spawn→extraction vector and pushed waypoints
 * off it with an alternating perpendicular swing, which meant it could never
 * turn back on itself — every map was a monotone march along one line, and
 * different seeds gave different noise rather than different shapes. Walking by
 * heading instead means the first two thirds of the route have no idea where
 * the pad is, and that unbiased stretch is what makes one run's map genuinely a
 * different place from the next one's.
 */
function walkTrunk(
  rng: Rng,
  spawn: Spot,
  extraction: Spot,
  cols: number,
  rows: number,
  tile: number,
  radii: Radii,
  targetLength: number,
): Trunk | null {
  const span = Math.min(cols, rows) * tile;
  const maxLeg = span * LEG_FRACTION[1];
  const centre = { x: (cols * tile) / 2, z: (rows * tile) / 2 };

  const points: Spot[] = [spawn];
  const placed = emptyPlacement();
  placed.nodes.push(spawn);
  // Reserve the pad before the first step. The walk has no idea where it is
  // going for the first two thirds, so without this it wanders through the
  // extraction's own footprint and then cannot place the room it needs there —
  // the walk poisons its own destination and the whole attempt is thrown away.
  placed.nodes.push(extraction);

  // Head inward, roughly. Anything else spends the first leg in the border.
  let heading =
    Math.atan2(centre.z - spawn.z, centre.x - spawn.x) + rng.range(-70, 70) * DEG;
  let lastSign = rng.next() < 0.5 ? 1 : -1;
  let travelled = 0;
  let backtracks = 0;

  for (let iteration = 0; iteration < MAX_TRUNK_NODES * 3; iteration++) {
    if (points.length >= MAX_TRUNK_NODES) break;
    const current = points[points.length - 1];
    const toGoal = distance(current, extraction);
    const goalPhase = travelled >= targetLength * GOAL_PULL_AT;

    const finish = (): Trunk | null => {
      if (!clears(current, extraction, placed, radii, [current, extraction])) return null;
      if (!clearsRoom(extraction, placed, radii, [current, extraction])) return null;
      points.push(extraction);
      return { points, roomAt: [...points], usedFallback: false };
    };

    // Once it is aiming for the pad, take any clean line to it. Insisting on a
    // short final leg made the walk circle the pad taking full-length steps,
    // filling the ground it needed to land on.
    if (goalPhase && toGoal <= maxLeg * 2.5) {
      const done = finish();
      if (done) return done;
    }

    // Past twice the target the walk is wandering; pull hard for the pad.
    const pull = travelled > targetLength * 2 ? 0.9 : goalPhase ? GOAL_PULL : 0;
    let stepped = false;

    for (let attempt = 0; attempt < 14 && !stepped; attempt++) {
      const hard = rng.next() < HARD_TURN_CHANCE;
      const [low, high] = hard ? HARD_TURN_RANGE : TURN_RANGE;
      const sign = rng.next() < FLIP_CHANCE ? -lastSign : lastSign;
      let angle = heading + sign * rng.range(low, high) * DEG;
      if (pull > 0) {
        angle = blendAngle(angle, Math.atan2(extraction.z - current.z, extraction.x - current.x), pull);
      }
      // A sharp turn needs a long leg to clear its own previous waypoint: the
      // gap between the node before the turn and the node after it is
      // `2 * leg * sin(turn / 2)`, so pairing a hairpin with a short leg
      // produces exactly the two rooms that would merge into one. Give hard
      // turns the long end of the range and they become possible on small maps
      // instead of being silently rejected every time.
      const legLow = hard ? (LEG_FRACTION[0] + LEG_FRACTION[1]) / 2 : LEG_FRACTION[0];
      const leg = span * rng.range(legLow, LEG_FRACTION[1]);
      const candidate = {
        x: current.x + Math.cos(angle) * leg,
        z: current.z + Math.sin(angle) * leg,
      };

      if (!inBounds(candidate, cols, rows, tile)) continue;
      if (!clears(current, candidate, placed, radii, [current])) continue;
      if (!clearsRoom(candidate, placed, radii, [current])) continue;

      placed.segments.push([current, candidate]);
      placed.nodes.push(candidate);
      points.push(candidate);
      travelled += leg;
      heading = angle;
      lastSign = sign;
      stepped = true;
    }

    if (stepped) continue;

    // Boxed in. Undo the last leg and try a different way out of the one before
    // it — the corner the walk painted itself into is usually one turn old.
    // Simply stopping here instead produced exactly the short, thin, one-branch
    // maps this design is meant to replace.
    if (backtracks < 12 && points.length > 2) {
      backtracks++;
      const removed = points.pop()!;
      placed.segments.pop();
      placed.nodes.pop();
      travelled -= distance(points[points.length - 1], removed);
      const current = points[points.length - 1];
      const previous = points[points.length - 2];
      heading = Math.atan2(current.z - previous.z, current.x - previous.x);
      continue;
    }

    // Out of retries. A route that can still reach the pad beats throwing the
    // whole walk away and landing on the interpolated fallback.
    return finish();
  }

  // Out of nodes. Same reasoning: take the route we have if it can close.
  const last = points[points.length - 1];
  if (!clears(last, extraction, placed, radii, [last, extraction])) return null;
  if (!clearsRoom(extraction, placed, radii, [last, extraction])) return null;
  points.push(extraction);
  return { points, roomAt: [...points], usedFallback: false };
}

/** Rotate `from` toward `to` by `amount`, the short way round. */
function blendAngle(from: number, to: number, amount: number): number {
  let delta = ((to - from + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return from + delta * amount;
}

/**
 * The old interpolated swing route, kept as the trunk of last resort.
 *
 * It marches monotonically along the spawn→extraction vector, so it can never
 * self-intersect and can never fail. That makes it the right thing to fall back
 * to: a boring map is recoverable, a map that failed to generate is not.
 */
function swingTrunk(
  rng: Rng,
  spawn: Spot,
  extraction: Spot,
  cols: number,
  rows: number,
  tile: number,
): Trunk {
  const segments = rng.int(4, 6);
  const dx = extraction.x - spawn.x;
  const dz = extraction.z - spawn.z;
  const length = Math.hypot(dx, dz) || 1;
  const px = -dz / length;
  const pz = dx / length;
  const maxSwing = Math.min(cols, rows) * tile * 0.2;

  const points: Spot[] = [spawn];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const swing = rng.range(0.35, 1) * maxSwing * (i % 2 === 0 ? 1 : -1);
    points.push(
      clampToBounds(
        { x: spawn.x + dx * t + px * swing, z: spawn.z + dz * t + pz * swing },
        cols,
        rows,
        tile,
      ),
    );
  }
  points.push(extraction);
  return { points, roomAt: [...points], usedFallback: true };
}

/**
 * Split the longest legs until the trunk has enough nodes to bend.
 *
 * Deterministic and draw-free on purpose — it runs after the RNG-driven walk,
 * so it can top up a short route without shifting anything downstream.
 */
function subdivide(trunk: Trunk, minNodes: number): Trunk {
  const points = [...trunk.points];
  while (points.length < minNodes) {
    let longest = 0;
    let at = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const d = distance(points[i], points[i + 1]);
      if (d > longest) {
        longest = d;
        at = i;
      }
    }
    points.splice(at + 1, 0, {
      x: (points[at].x + points[at + 1].x) / 2,
      z: (points[at].z + points[at + 1].z) / 2,
    });
  }
  // The extra points are waypoints, not places. A room belongs at a turn or a
  // junction; putting one halfway along a straight run would widen the corridor
  // for no reason and add a clearance constraint nothing asked for.
  return { points, roomAt: trunk.roomAt, usedFallback: trunk.usedFallback };
}

/**
 * Drop waypoints that only sit in the middle of a straight run.
 *
 * `subdivide` tops a short trunk up by splitting its longest legs at their
 * midpoints. That changes nothing about the carved shape, but it does turn one
 * leg into two, so the halves on either side of a turn stop being adjacent by
 * index and start looking like two separate corridors that pass close to each
 * other. Anything measuring clearance has to look at the shape, not the index.
 */
export function straighten(points: Spot[], keep: Spot[] = []): Spot[] {
  if (points.length < 3) return [...points];
  // A waypoint another branch hangs off has to survive even if the route runs
  // dead straight through it. Drop it and that branch's junction stops being a
  // shared endpoint and starts looking like a corridor crossing the trunk.
  const pinned = new Set(keep.map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`));

  const kept = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (pinned.has(`${points[i].x.toFixed(3)},${points[i].z.toFixed(3)}`)) {
      kept.push(points[i]);
      continue;
    }
    const a = Math.atan2(points[i].z - points[i - 1].z, points[i].x - points[i - 1].x);
    const b = Math.atan2(points[i + 1].z - points[i].z, points[i + 1].x - points[i].x);
    if (Math.abs(((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) > 0.02) kept.push(points[i]);
  }
  kept.push(points[points.length - 1]);
  return kept;
}

/**
 * Points that must survive `straighten`: anywhere a branch joins another, and
 * anywhere a room is cut.
 *
 * Both are places rather than waypoints. Drop a junction and the branch hanging
 * off it stops sharing an endpoint and starts looking like a corridor crossing
 * the trunk; drop a point carrying a room and the room floats off the polyline
 * and reads as a chamber sitting on top of a corridor.
 */
export function pinnedPoints(branches: Branch[]): Spot[] {
  const points: Spot[] = [];
  for (const branch of branches) {
    points.push(...branch.roomAt);
    if (branch.kind === 'trunk') continue;
    points.push(branch.points[0], branch.points[branch.points.length - 1]);
  }
  return points;
}

export function planTrunk(
  rng: Rng,
  spawn: Spot,
  extraction: Spot,
  cols: number,
  rows: number,
  tile: number,
  radii: Radii,
  files: number,
): Trunk {
  const span = Math.min(cols, rows) * tile;
  const target = trunkTarget(span, distance(spawn, extraction), files);

  // Each retry asks for a shorter route than the last — a walk that painted
  // itself into a corner usually just wanted less distance to cover.
  for (let attempt = 0; attempt < 6; attempt++) {
    const walked = walkTrunk(
      rng,
      spawn,
      extraction,
      cols,
      rows,
      tile,
      radii,
      target * Math.pow(0.85, attempt),
    );
    if (walked) return subdivide(walked, MIN_TRUNK_NODES);
  }
  return subdivide(swingTrunk(rng, spawn, extraction, cols, rows, tile), MIN_TRUNK_NODES);
}

// ---------------------------------------------------------------------------
// Alternates
// ---------------------------------------------------------------------------

/**
 * How many trunk legs an alternate has to skip to be worth carving. Two is the
 * floor: a branch that leaves and rejoins across a single leg is a bulge in the
 * corridor, not a route you could choose.
 */
const MIN_BYPASS_SPAN = 2;

/**
 * Side routes that leave the trunk and come back to it further along.
 *
 * These are what turn navigation into a decision. They are deliberately not
 * better or worse than the trunk — no shortcut, no loot bonus, no extra danger.
 * The map simply has more than one way through, and which way you took is
 * something you find out by taking it.
 */
function planAlternates(
  rng: Rng,
  trunk: Spot[],
  count: number,
  radii: Radii,
  cols: number,
  rows: number,
  tile: number,
  placed: Placed,
): Branch[] {
  const found: Branch[] = [];
  const span = Math.min(cols, rows) * tile;

  for (let n = 0; n < count; n++) {
    let made: Branch | null = null;

    for (let attempt = 0; attempt < 14 && !made; attempt++) {
      const split = Math.floor(rng.range(0.1, 0.45) * (trunk.length - 1));
      const rejoin = Math.floor(rng.range(0.55, 0.9) * (trunk.length - 1));
      if (rejoin - split < MIN_BYPASS_SPAN) continue;
      made = tryBypass(trunk, split, rejoin, rng.next() < 0.5 ? 1 : -1,
        span * rng.range(0.16, 0.3), radii, cols, rows, tile, placed);
    }

    // The corner cut. Any turn in the trunk describes a rectangle whose fourth
    // corner is a two-leg way round it, and the trunk always has turns — so
    // there is always a candidate to try, which is what lets the tests assert
    // that a map always offers more than one way through.
    if (!made) made = cornerBypass(trunk, radii, cols, rows, tile, placed);

    if (!made) break;
    place(placed, made.points, made.roomAt);
    found.push(made);
  }

  return found;
}

/** A polyline leaving the trunk at `split`, bulging sideways, rejoining at `rejoin`. */
function tryBypass(
  trunk: Spot[],
  split: number,
  rejoin: number,
  side: number,
  bulge: number,
  radii: Radii,
  cols: number,
  rows: number,
  tile: number,
  placed: Placed,
): Branch | null {
  const from = trunk[split];
  const to = trunk[rejoin];
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz) || 1;
  const px = (-dz / length) * side;
  const pz = (dx / length) * side;

  // Two waypoints rather than one, so the detour reads as a route with its own
  // corners rather than a single bowed-out arc.
  const vias: Spot[] = [];
  for (const t of [0.33, 0.67]) {
    vias.push({
      x: from.x + dx * t + px * bulge,
      z: from.z + dz * t + pz * bulge,
    });
  }
  if (vias.some((v) => !inBounds(v, cols, rows, tile))) return null;

  const points = [from, ...vias, to];
  const attached = [from, to];
  // A branch has to clear itself as well as everything else. Its own earlier
  // legs are not in `placed` yet — nothing is committed until the whole branch
  // is accepted — so they are tracked separately as it is built.
  const own = emptyPlacement();

  for (let i = 0; i < points.length - 1; i++) {
    if (!clears(points[i], points[i + 1], placed, radii, attached, true)) return null;
    if (!clears(points[i], points[i + 1], own, radii, [points[i]])) return null;
    own.segments.push([points[i], points[i + 1]]);
  }
  for (let i = 1; i < points.length - 1; i++) {
    if (!clearsRoom(points[i], placed, radii, attached)) return null;
    // Neighbours on the same polyline are joined by a corridor, so their rooms
    // running together is the junction working, not a merge.
    if (!clearsRoom(points[i], own, radii, [points[i - 1], points[i], points[i + 1]])) return null;
    own.nodes.push(points[i]);
  }

  return { kind: 'alternate', points, splitIndex: split, rejoinIndex: rejoin, roomAt: vias };
}

/**
 * Go round the outside of a corner: where the trunk runs A → C → B, a single
 * waypoint on the far side of the chord A–B gives a two-leg way round.
 *
 * This is the guarantee that a map always offers more than one way through, so
 * it does not get one shot. The waypoint starts just clear of the corner and
 * steps outward until it fits, and every corner in the trunk is a candidate —
 * a trunk always has corners, so there is always somewhere to try.
 */
function cornerBypass(
  trunk: Spot[],
  radii: Radii,
  cols: number,
  rows: number,
  tile: number,
  placed: Placed,
): Branch | null {
  const reach = radii.room + radii.corridor + MIN_WALL;

  for (let i = 1; i < trunk.length - 1; i++) {
    const a = trunk[i - 1];
    const c = trunk[i];
    const b = trunk[i + 1];
    const midX = (a.x + b.x) / 2;
    const midZ = (a.z + b.z) / 2;
    // Away from the corner, so the detour is a genuine second route around it
    // rather than a second corridor laid on top of the first.
    let outX = midX - c.x;
    let outZ = midZ - c.z;
    const length = Math.hypot(outX, outZ);
    if (length < 1e-6) continue;
    outX /= length;
    outZ /= length;

    for (let step = 1; step <= 5; step++) {
      const offset = reach * (0.6 + step * 0.5);
      const d = { x: midX + outX * offset, z: midZ + outZ * offset };
      if (!inBounds(d, cols, rows, tile)) continue;

      const attached = [a, b];
      if (!clears(a, d, placed, radii, attached, true)) continue;
      if (!clears(d, b, placed, radii, attached, true)) continue;
      if (!clearsRoom(d, placed, radii, attached)) continue;

      return {
        kind: 'alternate',
        points: [a, d, b],
        splitIndex: i - 1,
        rejoinIndex: i + 1,
        roomAt: [d],
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dead ends
// ---------------------------------------------------------------------------

/**
 * Branches that go nowhere.
 *
 * A dead end is only a dead end because nothing it touches leads onward, and
 * that is a clearance property, not a decoration one — carve a stub too close
 * to the route it came from and it quietly becomes a second way through. Every
 * segment here is checked against everything already placed, which is what
 * makes the map's shape honest when the player has nothing but a beacon to
 * navigate by.
 *
 * They hang off alternates as readily as off the trunk. If only the main line
 * sprouted side openings, the density of them would itself tell you which line
 * was the main one.
 */
function planDeadEnds(
  rng: Rng,
  trunk: Spot[],
  alternates: Branch[],
  count: number,
  radii: Radii,
  cols: number,
  rows: number,
  tile: number,
  placed: Placed,
): Branch[] {
  const span = Math.min(cols, rows) * tile;
  const anchors: Array<{ point: Spot; heading: number; trunkIndex: number | null }> = [];

  for (let i = 1; i < trunk.length - 1; i++) {
    anchors.push({ point: trunk[i], heading: localHeading(trunk, i), trunkIndex: i });
  }
  for (const alternate of alternates) {
    for (let i = 1; i < alternate.points.length - 1; i++) {
      anchors.push({
        point: alternate.points[i],
        heading: localHeading(alternate.points, i),
        trunkIndex: null,
      });
    }
  }
  if (anchors.length === 0) return [];
  rng.shuffle(anchors);

  const found: Branch[] = [];
  for (let n = 0; n < count; n++) {
    let made: Branch | null = null;

    for (let attempt = 0; attempt < 26 && !made; attempt++) {
      const anchor = anchors[(n + attempt * 2) % anchors.length];
      // Leave at right angles to the line you are on: a stub that continues the
      // direction of travel reads as the route carrying on. Both sides get
      // tried — space is tight by the time dead ends are planned, and giving up
      // on an anchor because one side of it was full wasted most of them.
      const side = attempt % 2 === 0 ? 1 : -1;
      made = tryStub(anchor, anchor.heading + side * (Math.PI / 2), rng, radii, cols, rows, tile, placed, span);
    }

    if (!made) continue;
    place(placed, made.points, made.roomAt);
    found.push(made);
  }

  return found;
}

function localHeading(points: Spot[], i: number): number {
  const from = points[Math.max(0, i - 1)];
  const to = points[Math.min(points.length - 1, i + 1)];
  return Math.atan2(to.z - from.z, to.x - from.x);
}

function tryStub(
  anchor: { point: Spot; heading: number; trunkIndex: number | null },
  away: number,
  rng: Rng,
  radii: Radii,
  cols: number,
  rows: number,
  tile: number,
  placed: Placed,
  span: number,
): Branch | null {
  const legs = rng.int(1, 3);
  const points: Spot[] = [anchor.point];
  let heading = away + rng.range(-25, 25) * DEG;
  // The stub's own earlier legs, which are not in `placed` until it is
  // accepted. Without this a stub can curl back into itself, and the merged
  // blob it carves is not a dead end any more.
  const own = emptyPlacement();

  for (let leg = 0; leg < legs; leg++) {
    const current = points[points.length - 1];
    const previous = points.length > 1 ? points[points.length - 2] : current;
    // The first leg has to clear the line it is leaving in one go. Anything
    // shorter puts the first room inside the trunk's own clearance envelope,
    // which is why nearly every stub used to be rejected on its opening step.
    const [low, high] = leg === 0 ? [0.24, 0.34] : [0.14, 0.24];
    const length = span * rng.range(low, high);
    const next = {
      x: current.x + Math.cos(heading) * length,
      z: current.z + Math.sin(heading) * length,
    };
    const stop = (): Branch | null => (leg > 0 ? finishStub(anchor, points) : null);
    if (!inBounds(next, cols, rows, tile)) return stop();
    if (!clears(current, next, placed, radii, [anchor.point], true)) return stop();
    if (!clears(current, next, own, radii, [current])) return stop();
    if (!clearsRoom(next, placed, radii, [anchor.point])) return stop();
    if (!clearsRoom(next, own, radii, [previous, current, next])) return stop();

    own.segments.push([current, next]);
    own.nodes.push(next);
    points.push(next);
    heading += rng.range(-40, 40) * DEG;
  }

  return finishStub(anchor, points);
}

/**
 * A stub that ran out of room part way is still a dead end — keep what got
 * placed rather than discarding the whole branch. Two thirds of a side street
 * is a side street; nothing is is an empty map.
 */
function finishStub(
  anchor: { trunkIndex: number | null },
  points: Spot[],
): Branch | null {
  if (points.length < 2) return null;
  return {
    kind: 'dead-end',
    points,
    splitIndex: anchor.trunkIndex,
    // Null is the guarantee, not a note: nothing rejoins.
    rejoinIndex: null,
    roomAt: points.slice(1),
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function planRoute(
  rng: Rng,
  cols: number,
  rows: number,
  tile: number,
  files: number,
): RoutePlan {
  const radii = solveRadii(cols, rows, tile, files);
  const { spawn, extraction } = pickEndpoints(rng, cols, rows, tile);
  const trunk = planTrunk(rng, spawn, extraction, cols, rows, tile, radii, files);

  const placed = emptyPlacement();
  place(placed, trunk.points, trunk.roomAt);

  const clamped = clamp(files, 1, 15);
  const alternates = planAlternates(
    rng,
    trunk.points,
    clamp(1 + Math.floor(clamped / 5), 1, 3),
    radii,
    cols,
    rows,
    tile,
    placed,
  );
  // Dead ends go last, so every stub is placed knowing where everything else
  // ended up. They are the flexible part of the plan: when a map runs out of
  // room, fewer dead ends is the right way to lose.
  const deadEnds = planDeadEnds(
    rng,
    trunk.points,
    alternates,
    clamp(1 + Math.floor(clamped / 4), 2, 5),
    radii,
    cols,
    rows,
    tile,
    placed,
  );

  const branches: Branch[] = [
    {
      kind: 'trunk',
      points: trunk.points,
      splitIndex: null,
      rejoinIndex: null,
      roomAt: trunk.roomAt,
    },
    ...alternates,
    ...deadEnds,
  ];

  const fitted = fitRadii(branches, radii, cols, rows, tile);

  return {
    spawn,
    extraction,
    branches,
    parks: pickParks(rng, branches, spawn, extraction, fitted),
    chokepoints: findChokepoints(trunk.points.length, alternates),
    corridorRadius: fitted.corridor,
    roomRadius: fitted.room,
    usedFallback: trunk.usedFallback,
  };
}

/**
 * Turn some of the route's rooms into parks.
 *
 * Never the spawn or the pad. Both are places the player has to read instantly
 * — where they landed, and where the run ends — and dressing either in trees
 * puts scenery between the camera and the only two points on the map that are
 * not allowed to be ambiguous.
 *
 * A park is a little wider than the room under it. The room is already carved,
 * so the overspill lands on the corridor mouths feeding into it, which is what
 * makes the grass look like it belongs to the junction rather than like a green
 * disc someone dropped on the street.
 */
function pickParks(
  rng: Rng,
  branches: Branch[],
  spawn: Spot,
  extraction: Spot,
  radii: Radii,
): Park[] {
  const candidates: Spot[] = [];
  for (const branch of branches) {
    for (const point of branch.roomAt) {
      if (same(point, spawn) || same(point, extraction)) continue;
      if (distance(point, spawn) < radii.room * 3) continue;
      if (distance(point, extraction) < radii.room * 3) continue;
      candidates.push(point);
    }
  }
  if (candidates.length === 0) return [];

  rng.shuffle(candidates);
  const wanted = Math.min(candidates.length, 2 + Math.floor(candidates.length / 2.5));

  const parks: Park[] = [];
  for (const point of candidates) {
    if (parks.length >= wanted) break;
    // Two parks running into each other read as one big field and lose the
    // "somewhere else" of it.
    if (parks.some((p) => distance(p, point) < radii.room * 2.6)) continue;

    // A park is carved wider than the room under it, which makes it the one
    // place the map opens out — so it has to answer the same clearance question
    // every other cut does. Grown to whatever the surrounding geometry can take
    // and no further, it can never swallow the corridor running past it or the
    // dead end behind it.
    const headroom = clearanceAround(point, branches, radii);
    if (headroom < radii.room * 1.15) continue;
    parks.push({
      x: point.x,
      z: point.z,
      radius: Math.min(headroom, radii.room * rng.range(1.7, 2.6)),
    });
  }
  return parks;
}

/** How far a disc at `centre` may be grown before it merges with anything. */
function clearanceAround(centre: Spot, branches: Branch[], radii: Radii): number {
  const pinned = pinnedPoints(branches);
  const shapes = branches.map((b) => straighten(b.points, pinned));

  const linked = new Set<string>();
  for (const points of shapes) {
    for (let i = 0; i < points.length - 1; i++) linked.add(pairKey(points[i], points[i + 1]));
  }

  let limit = Infinity;
  for (const points of shapes) {
    for (let i = 0; i < points.length - 1; i++) {
      const segment: [Spot, Spot] = [points[i], points[i + 1]];
      // The corridors feeding this room are what the park opens onto.
      if (same(centre, segment[0]) || same(centre, segment[1])) continue;
      if (linked.has(pairKey(centre, segment[0])) || linked.has(pairKey(centre, segment[1]))) {
        continue;
      }
      limit = Math.min(limit, pointSegmentDistance(centre, ...segment) - radii.corridor - MIN_WALL);
    }
  }
  for (const branch of branches) {
    for (const node of branch.roomAt) {
      if (same(node, centre) || linked.has(pairKey(node, centre))) continue;
      limit = Math.min(limit, distance(node, centre) - radii.room - MIN_WALL);
    }

    // The far end of a dead end is never exempt, even where the park is sitting
    // on the junction the branch leaves from.
    //
    // Everything else on this list may run into a park, because a corridor
    // opening onto a lawn is a corridor opening onto a lawn. A cul-de-sac is
    // different: swallow its far end and it stops being somewhere you walk down
    // and find nothing, and becomes part of the grass. The stash lives on one of
    // these, and a stash you can see from the middle of the park has not cost
    // anybody the detour it is supposed to cost.
    if (branch.kind !== 'dead-end') continue;
    const terminal = branch.points[branch.points.length - 1];
    limit = Math.min(limit, distance(terminal, centre) - radii.room - MIN_WALL);
  }
  return limit;
}

/**
 * Trunk indices that no alternate skips past — the waypoints every route
 * through the map has to cross.
 *
 * Weapons are placed on these. Putting them at a fixed fraction along the trunk
 * instead would sooner or later drop one inside a stretch an alternate bypasses,
 * and a player who took the other way would never see it — which turns two
 * routes that are supposed to be equivalent into one good one and one bad one.
 */
function findChokepoints(trunkLength: number, alternates: Branch[]): number[] {
  const chokepoints: number[] = [];
  for (let i = 0; i < trunkLength; i++) {
    const bypassed = alternates.some(
      (a) => a.splitIndex !== null && a.rejoinIndex !== null && i > a.splitIndex && i < a.rejoinIndex,
    );
    if (!bypassed) chokepoints.push(i);
  }
  return chokepoints;
}

/**
 * Widen the carve to fill the open-ground budget, up to what the planned
 * geometry can actually take.
 *
 * `solveRadii` has to guess the route's length before there is a route, and a
 * guess that comes in long leaves the map too solid — the difference between a
 * short hop and a rambling one was showing up as maps carved at 12% open and
 * others at 41%. So the radii get refitted once the real length is known.
 *
 * Feeding a measurement back into the widths is only safe because it is
 * bounded by a second measurement: the narrowest gap the plan actually left.
 * The planner guaranteed `2r + MIN_WALL` everywhere, but it usually did much
 * better than that, and the slack it happened to leave is exactly how much
 * wider we may cut without two corridors touching. Topology survives whatever
 * the budget asks for.
 */
function fitRadii(
  branches: Branch[],
  planned: Radii,
  cols: number,
  rows: number,
  tile: number,
): Radii {
  const segments: Array<[Spot, Spot]> = [];
  const nodes: Spot[] = [];
  const pinned = pinnedPoints(branches);
  const shapes = branches.map((b) => straighten(b.points, pinned));
  for (const points of shapes) {
    for (let i = 0; i < points.length - 1; i++) segments.push([points[i], points[i + 1]]);
  }
  for (const branch of branches) nodes.push(...branch.roomAt);

  const touches = (p: Spot, s: [Spot, Spot]): boolean => same(p, s[0]) || same(p, s[1]);

  let segmentGap = Infinity;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      // Segments meeting at a junction are meant to run into each other.
      if (touches(segments[i][0], segments[j]) || touches(segments[i][1], segments[j])) continue;
      segmentGap = Math.min(segmentGap, segmentDistance(...segments[i], ...segments[j]));
    }
  }

  const linked = new Set<string>();
  for (const points of shapes) {
    for (let i = 0; i < points.length - 1; i++) linked.add(pairKey(points[i], points[i + 1]));
  }
  const adjacent = (p: Spot, s: [Spot, Spot]): boolean =>
    linked.has(pairKey(p, s[0])) || linked.has(pairKey(p, s[1]));

  let nodeSegmentGap = Infinity;
  for (const node of nodes) {
    for (const segment of segments) {
      // A room one leg down the same branch is joined to this corridor already.
      if (touches(node, segment) || adjacent(node, segment)) continue;
      nodeSegmentGap = Math.min(nodeSegmentGap, pointSegmentDistance(node, ...segment));
    }
  }

  let nodeGap = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      // Rooms one leg apart are joined by a corridor; merging is the point.
      if (linked.has(pairKey(nodes[i], nodes[j]))) continue;
      nodeGap = Math.min(nodeGap, distance(nodes[i], nodes[j]));
    }
  }

  let length = 0;
  for (const [a, b] of segments) length += distance(a, b);

  const budget = OPEN_TARGET * (cols * tile) * (rows * tile);
  const span = Math.min(cols, rows) * tile;
  const corridor = clamp(
    (budget * CORRIDOR_SHARE) / (2 * Math.max(1, length)),
    planned.corridor,
    Math.min(span * 0.1, (segmentGap - MIN_WALL) / 2),
  );
  const room = clamp(
    Math.sqrt((budget * (1 - CORRIDOR_SHARE)) / (Math.PI * Math.max(1, nodes.length))),
    planned.room,
    Math.min(span * 0.14, (nodeGap - MIN_WALL) / 2),
  );

  // A room and a corridor passing each other need room + corridor + MIN_WALL
  // between them, so widening them independently can break a limit neither one
  // breaks alone. Walk both back toward the radii the planner actually verified
  // until the pair fits — those are known good, so this always has an answer.
  const limit = nodeSegmentGap - MIN_WALL;
  const base = planned.corridor + planned.room;
  const stretch = corridor - planned.corridor + (room - planned.room);
  if (stretch > 0 && base + stretch > limit) {
    const t = Math.max(0, Math.min(1, (limit - base) / stretch));
    return {
      corridor: planned.corridor + (corridor - planned.corridor) * t,
      room: planned.room + (room - planned.room) * t,
    };
  }

  return { corridor, room };
}

function pairKey(a: Spot, b: Spot): string {
  const ka = `${a.x.toFixed(3)},${a.z.toFixed(3)}`;
  const kb = `${b.x.toFixed(3)},${b.z.toFixed(3)}`;
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** The terminal of every dead end, for callers that want somewhere off-route. */
export function deadEndTerminals(plan: RoutePlan): Spot[] {
  return plan.branches
    .filter((b) => b.kind === 'dead-end')
    .map((b) => b.points[b.points.length - 1]);
}

/**
 * The stash goes on whichever dead end leaves the trunk nearest its middle. It
 * has to cost you a detour, and a detour at the very start or the very end is
 * one you can take for free.
 */
export function stashSpot(plan: RoutePlan): Spot | null {
  const trunkLength = plan.branches[0].points.length;
  const deadEnds = plan.branches.filter((b) => b.kind === 'dead-end');
  if (deadEnds.length === 0) return null;

  let best: Branch | null = null;
  let bestDistance = Infinity;

  for (const branch of deadEnds) {
    if (branch.splitIndex === null) continue;
    const offCentre = Math.abs(branch.splitIndex / (trunkLength - 1) - 0.5);
    if (offCentre < bestDistance) {
      bestDistance = offCentre;
      best = branch;
    }
  }

  // A dead end hanging off an alternate has no trunk index to score, but it is
  // still a detour — a longer one, in fact. Better there than nowhere.
  const chosen = (best ?? deadEnds[0]).points;
  return chosen[chosen.length - 1];
}
