import { describe, expect, it } from 'vitest';
import {
  clears,
  distance,
  pickEndpoints,
  planRoute,
  pointSegmentDistance,
  segmentDistance,
  MIN_WALL,
  straighten,
  pinnedPoints,
  type RoutePlan,
  type Spot,
} from './route';
import { Rng } from '../core/rng';

const TILE = 2;
const SIZES = [36, 44, 56, 72];
const FILE_COUNTS = [1, 4, 8, 15];

function trunkOf(plan: RoutePlan): Spot[] {
  return plan.branches[0].points;
}

function key(p: Spot): string {
  return `${p.x.toFixed(3)},${p.z.toFixed(3)}`;
}

function polylineLength(points: Spot[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += distance(points[i], points[i + 1]);
  return total;
}

/** Every plan the matrix produces, so assertions can sweep the whole space. */
function eachPlan(
  seeds: number,
  visit: (plan: RoutePlan, label: string, cells: number, files: number) => void,
): void {
  for (const cells of SIZES) {
    for (const files of FILE_COUNTS) {
      for (let seed = 0; seed < seeds; seed++) {
        const plan = planRoute(new Rng(seed), cells, cells, TILE, files);
        visit(plan, `${cells}c f${files} seed ${seed}`, cells, files);
      }
    }
  }
}

describe('clearance primitives', () => {
  it('measures point-to-segment distance including the endpoints', () => {
    const a = { x: 0, z: 0 };
    const b = { x: 10, z: 0 };
    expect(pointSegmentDistance({ x: 5, z: 3 }, a, b)).toBeCloseTo(3);
    // Past the end of the segment, the nearest point is the endpoint itself.
    expect(pointSegmentDistance({ x: 14, z: 0 }, a, b)).toBeCloseTo(4);
    expect(pointSegmentDistance({ x: -3, z: 4 }, a, b)).toBeCloseTo(5);
  });

  it('reports zero distance for crossing segments', () => {
    const d = segmentDistance({ x: 0, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }, { x: 10, z: 0 });
    expect(d).toBe(0);
  });

  it('measures the gap between parallel segments', () => {
    const d = segmentDistance({ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 0, z: 7 }, { x: 10, z: 7 });
    expect(d).toBeCloseTo(7);
  });

  it('lets a branch touch what it attaches to but not what it passes', () => {
    const radii = { corridor: 4, room: 6 };
    const junction = { x: 0, z: 0 };
    const placed = { segments: [[junction, { x: 20, z: 0 }]] as Array<[Spot, Spot]>, nodes: [] };

    // Leaving the junction at right angles is the whole point of a junction.
    expect(clears(junction, { x: 0, z: 30 }, placed, radii, [junction])).toBe(true);
    // Running alongside it two units away would merge into one open blob.
    expect(clears({ x: 0, z: 2 }, { x: 20, z: 2 }, placed, radii, [])).toBe(false);
  });
});

describe('pickEndpoints', () => {
  it('puts spawn and extraction on the perimeter, well apart', () => {
    for (const cells of SIZES) {
      const minSeparation = cells * TILE * 0.62;
      for (let seed = 0; seed < 200; seed++) {
        const { spawn, extraction } = pickEndpoints(new Rng(seed), cells, cells, TILE);
        expect(distance(spawn, extraction), `${cells}c seed ${seed}`).toBeGreaterThan(
          minSeparation * 0.9,
        );
      }
    }
  });
});

describe('planRoute — trunk', () => {
  it('is deterministic for a given seed', () => {
    const a = planRoute(new Rng('fix: auth'), 44, 44, TILE, 6);
    const b = planRoute(new Rng('fix: auth'), 44, 44, TILE, 6);
    expect(a).toEqual(b);
  });

  it('runs from spawn to extraction with enough nodes to bend', () => {
    eachPlan(20, (plan, label) => {
      const trunk = trunkOf(plan);
      expect(trunk[0], label).toEqual(plan.spawn);
      expect(trunk[trunk.length - 1], label).toEqual(plan.extraction);
      expect(trunk.length, label).toBeGreaterThanOrEqual(5);
    });
  });

  it('never revisits a point', () => {
    eachPlan(20, (plan, label) => {
      const seen = new Set(trunkOf(plan).map((p) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`));
      expect(seen.size, label).toBe(trunkOf(plan).length);
    });
  });

  /**
   * The assertion the whole design rests on. Two corridor centrelines that pass
   * closer than twice the corridor radius carve into one open blob — which is
   * how a dead end silently becomes a through-route. The player is given no
   * visual tell about where a branch leads, so the topology is the only
   * information they have, and it has to be true.
   */
  it('keeps non-adjacent stretches of the route far enough apart to stay separate', () => {
    eachPlan(25, (plan, label) => {
      // The interpolated fallback cannot self-intersect but does not honour
      // clearance. It is rare; the next test pins how rare.
      if (plan.usedFallback) return;
      const trunk = straighten(trunkOf(plan), pinnedPoints(plan.branches));
      const segmentGap = plan.corridorRadius * 2 + MIN_WALL;

      for (let i = 0; i < trunk.length - 1; i++) {
        // Skip j === i + 1: consecutive legs share a waypoint by design.
        for (let j = i + 2; j < trunk.length - 1; j++) {
          const gap = segmentDistance(trunk[i], trunk[i + 1], trunk[j], trunk[j + 1]);
          expect(gap, `${label} legs ${i}/${j}`).toBeGreaterThanOrEqual(segmentGap - 0.001);
        }
      }
    });
  });

  /**
   * The same rule as above, applied to the whole plan rather than just the
   * trunk: every branch against every other branch, and against itself.
   *
   * Self-comparison is the case that is easy to miss and expensive to lose. A
   * branch is not committed to the placement until it has been accepted whole,
   * so nothing stops it doubling back into its own earlier legs unless it is
   * checked separately — and a stub that curls into itself carves a blob, not a
   * dead end.
   */
  it('keeps every branch clear of every other branch and of itself', () => {
    eachPlan(15, (plan, label) => {
      if (plan.usedFallback) return;

      const segmentGap = plan.corridorRadius * 2 + MIN_WALL;
      const nodeSegmentGap = plan.roomRadius + plan.corridorRadius + MIN_WALL;
      const nodeGap = plan.roomRadius * 2 + MIN_WALL;

      const segments: Array<[Spot, Spot]> = [];
      const nodes: Spot[] = [];
      const linked = new Set<string>();
      const pinned = pinnedPoints(plan.branches);
      for (const branch of plan.branches) {
        // Measured on the shape, not the index — see `straighten`.
        const points = straighten(branch.points, pinned);
        for (let i = 0; i < points.length - 1; i++) {
          segments.push([points[i], points[i + 1]]);
          linked.add(key(points[i]) + '|' + key(points[i + 1]));
          linked.add(key(points[i + 1]) + '|' + key(points[i]));
        }
        nodes.push(...branch.roomAt);
      }
      const touches = (p: Spot, s: [Spot, Spot]): boolean =>
        key(p) === key(s[0]) || key(p) === key(s[1]);

      for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
          // Segments meeting at a junction are meant to run together.
          if (touches(segments[i][0], segments[j]) || touches(segments[i][1], segments[j])) continue;
          const gap = segmentDistance(...segments[i], ...segments[j]);
          expect(gap, `${label} corridors`).toBeGreaterThanOrEqual(segmentGap - 0.01);
        }
      }

      // A room one leg further down the same branch is already joined to this
      // corridor by the leg between them.
      const adjacent = (p: Spot, s: [Spot, Spot]): boolean =>
        linked.has(key(p) + '|' + key(s[0])) || linked.has(key(p) + '|' + key(s[1]));

      for (const node of nodes) {
        for (const segment of segments) {
          if (touches(node, segment) || adjacent(node, segment)) continue;
          const gap = pointSegmentDistance(node, ...segment);
          expect(gap, `${label} room vs corridor`).toBeGreaterThanOrEqual(nodeSegmentGap - 0.01);
        }
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          // Rooms one leg apart are joined by a corridor; merging is the point.
          if (linked.has(key(nodes[i]) + '|' + key(nodes[j]))) continue;
          expect(distance(nodes[i], nodes[j]), `${label} room vs room`).toBeGreaterThanOrEqual(
            nodeGap - 0.01,
          );
        }
      }
    });
  });

  /**
   * A park is the only thing on the map carved wider than the route asked for,
   * which makes it the only thing that can open a hole between two branches the
   * planner had kept apart. Grow one too far and the dead end behind it joins
   * the corridor in front of it — and the map starts lying about where its
   * routes go, which is the one thing this design cannot afford.
   */
  it('never lets a park grow into anything it is not attached to', () => {
    eachPlan(15, (plan, label) => {
      if (plan.usedFallback) return;

      const pinned = pinnedPoints(plan.branches);
      const shapes = plan.branches.map((b) => straighten(b.points, pinned));
      const linked = new Set<string>();
      for (const points of shapes) {
        for (let i = 0; i < points.length - 1; i++) {
          linked.add(key(points[i]) + '|' + key(points[i + 1]));
          linked.add(key(points[i + 1]) + '|' + key(points[i]));
        }
      }

      for (const park of plan.parks) {
        expect(park.radius, `${label} park radius`).toBeGreaterThanOrEqual(plan.roomRadius);

        for (const points of shapes) {
          for (let i = 0; i < points.length - 1; i++) {
            const segment: [Spot, Spot] = [points[i], points[i + 1]];
            // The corridors feeding the room under it are what it opens onto.
            if (key(park) === key(segment[0]) || key(park) === key(segment[1])) continue;
            if (linked.has(key(park) + '|' + key(segment[0]))) continue;
            if (linked.has(key(park) + '|' + key(segment[1]))) continue;
            expect(
              pointSegmentDistance(park, ...segment),
              `${label} park vs corridor`,
            ).toBeGreaterThanOrEqual(park.radius + plan.corridorRadius + MIN_WALL - 0.01);
          }
        }

        for (const branch of plan.branches) {
          for (const node of branch.roomAt) {
            if (key(node) === key(park) || linked.has(key(node) + '|' + key(park))) continue;
            expect(distance(node, park), `${label} park vs room`).toBeGreaterThanOrEqual(
              park.radius + plan.roomRadius + MIN_WALL - 0.01,
            );
          }
        }
      }
    });
  });

  it('keeps parks off the two places that must stay legible', () => {
    eachPlan(20, (plan, label) => {
      for (const park of plan.parks) {
        // Where you landed and where the run ends are the only two points on
        // the map that are never allowed to be ambiguous.
        expect(distance(park, plan.spawn), label).toBeGreaterThan(plan.roomRadius);
        expect(distance(park, plan.extraction), label).toBeGreaterThan(plan.roomRadius);
      }
    });
  });

  it('almost never needs the interpolated fallback', () => {
    let fellBack = 0;
    let total = 0;
    eachPlan(25, (plan) => {
      total++;
      if (plan.usedFallback) fellBack++;
    });
    expect(fellBack / total).toBeLessThan(0.02);
  });

  /**
   * The point of the redesign. A route length tied to file count is what makes
   * a fifteen-file haul visibly a longer mission than a one-file hop.
   */
  it('gets longer the more files you are carrying', () => {
    const mean = (cells: number, files: number): number => {
      let total = 0;
      for (let seed = 0; seed < 40; seed++) {
        total += polylineLength(trunkOf(planRoute(new Rng(seed), cells, cells, TILE, files)));
      }
      return total / 40;
    };

    for (const cells of SIZES) {
      // Non-decreasing all the way up: a small arena eventually runs out of
      // room to wind, and flattening out there is correct — going backwards is
      // not.
      let previous = 0;
      for (const files of FILE_COUNTS) {
        const length = mean(cells, files);
        expect(length, `${cells}c f${files}`).toBeGreaterThanOrEqual(previous * 0.98);
        previous = length;
      }
      // And across the whole range the difference has to be obvious, not
      // marginal — this is what makes a big commit feel like a bigger mission.
      expect(mean(cells, 15), `${cells}c`).toBeGreaterThan(mean(cells, 1) * 1.25);
    }
  });

  /**
   * The user's actual complaint, encoded. The old route interpolated the
   * spawn→extraction vector, so every map was a monotone march along one line
   * and different seeds gave different noise rather than different shapes.
   * Without this assertion a regression to that behaviour passes everything
   * else in the file.
   */
  it('produces a genuinely different shape from one run to the next', () => {
    for (const cells of SIZES) {
      const shapes = new Set<string>();
      for (let seed = 0; seed < 200; seed++) {
        const trunk = trunkOf(planRoute(new Rng(seed), cells, cells, TILE, 6));
        // Quantised coarsely, so this measures macro shape and not jitter.
        shapes.add(trunk.map((p) => `${Math.round(p.x / 12)},${Math.round(p.z / 12)}`).join('|'));
      }
      expect(shapes.size, `${cells}c`).toBeGreaterThan(120);
    }
  });
});
