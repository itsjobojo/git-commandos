import { describe, expect, it } from 'vitest';
import { buildRoute, pickEndpoints } from './arena';
import type { Spot } from './route';
import { CELL, Grid } from './grid';
import { Rng } from '../core/rng';

// buildRoute builds meshes, which needs no DOM — but it does need three's
// geometry classes, which work fine headlessly.

/**
 * A stretch of corridor treated as solid, so a fill can ask counterfactual
 * questions. Capsule-shaped, because that is the shape a corridor is: a disc
 * plug leaves the corridor's shoulders open at its edges and the fill simply
 * walks around it, which looks exactly like a merge that is not there.
 */
interface Block {
  from: Spot;
  to: Spot;
  r: number;
}

/**
 * Flood fill from a world point; returns the set of reachable cell indices.
 *
 * `block` walls off a disc before filling. That is what lets the topology tests
 * ask the questions that actually matter — "is this alternate a second way
 * through, or just a bulge in the first one" is the same question as "does the
 * map still connect once I plug the stretch it bypasses".
 */
function reachableFrom(grid: Grid, x: number, z: number, block?: Block): Set<number> {
  const blocked = (cx: number, cz: number): boolean => {
    if (!block) return false;
    const wx = (cx + 0.5) * grid.tile;
    const wz = (cz + 0.5) * grid.tile;
    const dx = block.to.x - block.from.x;
    const dz = block.to.z - block.from.z;
    const lengthSq = dx * dx + dz * dz;
    const t =
      lengthSq === 0
        ? 0
        : Math.max(0, Math.min(1, ((wx - block.from.x) * dx + (wz - block.from.z) * dz) / lengthSq));
    return Math.hypot(block.from.x + dx * t - wx, block.from.z + dz * t - wz) <= block.r;
  };

  const start = grid.cellZ(z) * grid.cols + grid.cellX(x);
  const seen = new Set<number>([start]);
  const queue = [start];
  while (queue.length) {
    const index = queue.pop()!;
    const cx = index % grid.cols;
    const cz = Math.floor(index / grid.cols);
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!grid.inBounds(nx, nz)) continue;
      // Cover is walkable-adjacent but solid; only EMPTY is traversable.
      if (grid.cell(nx, nz) !== CELL.EMPTY) continue;
      if (blocked(nx, nz)) continue;
      const next = nz * grid.cols + nx;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function cellAt(grid: Grid, p: { x: number; z: number }): number {
  return grid.cellZ(p.z) * grid.cols + grid.cellX(p.x);
}

/**
 * Seal the middle of a leg, leaving the junction at each end open.
 *
 * Both exclusions matter. Reaching into a junction would cut the other branches
 * meeting there, which is not the question being asked; reaching all the way to
 * a dead end's terminal would put the fill's own start inside the plug, so the
 * test would pass without having asked anything at all.
 */
function plugLeg(map: { corridorRadius: number; grid: Grid }, a: Spot, b: Spot): Block {
  const at = (t: number): Spot => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  return { from: at(0.3), to: at(0.7), r: map.corridorRadius + map.grid.tile };
}

/**
 * Endpoint placement is a pure function of the `Rng` it is handed, so these
 * assertions are exact rather than statistical. The seed behind that `Rng`
 * changes every deploy; what is fixed is that a given seed always lays out the
 * same map, which is what makes a run replayable.
 */
const TILE = 2;

describe('pickEndpoints', () => {

  it('keeps spawn and extraction well apart across many seeds', () => {
    const sizes: Array<[number, number]> = [
      [36, 36],
      [44, 44],
      [56, 56],
      [72, 72],
    ];

    for (const [cols, rows] of sizes) {
      const minSeparation = Math.min(cols, rows) * TILE * 0.62;
      let worst = Infinity;

      for (let seed = 0; seed < 200; seed++) {
        const { spawn, extraction } = pickEndpoints(new Rng(seed), cols, rows, TILE);
        worst = Math.min(worst, Math.hypot(spawn.x - extraction.x, spawn.z - extraction.z));
      }

      // Rejection sampling keeps the best candidate, so the floor can sit a
      // little under target — but never close enough to make the haul trivial.
      expect(worst, `${cols}x${rows}`).toBeGreaterThan(minSeparation * 0.9);
    }
  });

  it('keeps both endpoints inside the border wall', () => {
    const cols = 44;
    const rows = 44;
    for (let seed = 0; seed < 100; seed++) {
      const { spawn, extraction } = pickEndpoints(new Rng(seed), cols, rows, TILE);
      for (const p of [spawn, extraction]) {
        expect(p.x).toBeGreaterThan(TILE);
        expect(p.z).toBeGreaterThan(TILE);
        expect(p.x).toBeLessThan((cols - 1) * TILE);
        expect(p.z).toBeLessThan((rows - 1) * TILE);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const a = pickEndpoints(new Rng('fix: auth'), 44, 44, TILE);
    const b = pickEndpoints(new Rng('fix: auth'), 44, 44, TILE);
    expect(a).toEqual(b);
  });

  it('gives different commits different endpoints', () => {
    const a = pickEndpoints(new Rng('fix: auth'), 44, 44, TILE);
    const b = pickEndpoints(new Rng('feat: cargo'), 44, 44, TILE);
    expect(a).not.toEqual(b);
  });
});

describe('buildRoute', () => {
  /**
   * The single most important property of a generated map. An unreachable
   * extraction point is not a bad level — it is a run the player cannot win,
   * and losing a commit to a carve that went wrong is unacceptable.
   */
  it('always connects spawn to extraction', () => {
    for (let seed = 0; seed < 60; seed++) {
      const map = buildRoute(new Rng(seed), { cols: 40, rows: 40, tile: TILE });
      const reachable = reachableFrom(map.grid, map.spawn.x, map.spawn.z);
      const exit =
        map.grid.cellZ(map.extraction.z) * map.grid.cols + map.grid.cellX(map.extraction.x);
      expect(reachable.has(exit), `seed ${seed}`).toBe(true);
    }
  });

  it('leaves both endpoints standing in open floor', () => {
    for (let seed = 0; seed < 40; seed++) {
      const map = buildRoute(new Rng(seed), { cols: 40, rows: 40, tile: TILE });
      expect(map.grid.isSolidWorld(map.spawn.x, map.spawn.z), `spawn ${seed}`).toBe(false);
      expect(map.grid.isSolidWorld(map.extraction.x, map.extraction.z), `exit ${seed}`).toBe(false);
    }
  });

  it('reaches the stash branch whenever it carves one', () => {
    for (let seed = 0; seed < 40; seed++) {
      const map = buildRoute(new Rng(seed), { cols: 40, rows: 40, tile: TILE });
      if (!map.stash) continue;
      const reachable = reachableFrom(map.grid, map.spawn.x, map.spawn.z);
      const stash = map.grid.cellZ(map.stash.z) * map.grid.cols + map.grid.cellX(map.stash.x);
      expect(reachable.has(stash), `seed ${seed}`).toBe(true);
    }
  });

  /**
   * The route should read as open ground that goes somewhere: roomy enough to
   * fight and flank in, bounded enough that the direction of travel is never
   * in question. Too tight and it's a maze you thread; too loose and A-to-B
   * stops meaning anything.
   */
  it('leaves open ground that is still clearly bounded', () => {
    for (const cells of [36, 44, 60]) {
      for (let seed = 0; seed < 8; seed++) {
        const map = buildRoute(new Rng(seed), { cols: cells, rows: cells, tile: TILE });
        let open = 0;
        for (let i = 0; i < map.grid.solid.length; i++) {
          if (map.grid.solid[i] === CELL.EMPTY) open++;
        }
        const fraction = open / map.grid.solid.length;
        expect(fraction, `${cells} seed ${seed}`).toBeGreaterThan(0.18);
        expect(fraction, `${cells} seed ${seed}`).toBeLessThan(0.6);
      }
    }
  });

  it('keeps openness consistent as the map scales up', () => {
    // Widths are a fraction of the map, so a bigger commit gets a grander
    // route rather than the same narrow valley in a larger rock field.
    // Averaged rather than sampled once. A park is a large, discrete lump of
    // open ground, so a single seed swings by more than the property being
    // tested — the claim is about the shape of the distribution, not about any
    // one map.
    const measure = (cells: number): number => {
      let total = 0;
      for (let seed = 0; seed < 8; seed++) {
        const map = buildRoute(new Rng(seed), { cols: cells, rows: cells, tile: TILE });
        let open = 0;
        for (let i = 0; i < map.grid.solid.length; i++) {
          if (map.grid.solid[i] === CELL.EMPTY) open++;
        }
        total += open / map.grid.solid.length;
      }
      return total / 8;
    };
    expect(Math.abs(measure(36) - measure(64))).toBeLessThan(0.15);
  });

  it('keeps the border sealed', () => {
    const map = buildRoute(new Rng(3), { cols: 40, rows: 40, tile: TILE });
    for (let cx = 0; cx < map.grid.cols; cx++) {
      expect(map.grid.isSolid(cx, 0)).toBe(true);
      expect(map.grid.isSolid(cx, map.grid.rows - 1)).toBe(true);
    }
    for (let cz = 0; cz < map.grid.rows; cz++) {
      expect(map.grid.isSolid(0, cz)).toBe(true);
      expect(map.grid.isSolid(map.grid.cols - 1, cz)).toBe(true);
    }
  });

  it('gives the route enough waypoints to bend', () => {
    const map = buildRoute(new Rng(9), { cols: 44, rows: 44, tile: TILE });
    expect(map.waypoints.length).toBeGreaterThanOrEqual(5);
    expect(map.waypoints[0]).toEqual(map.spawn);
    expect(map.waypoints[map.waypoints.length - 1]).toEqual(map.extraction);
  });
});

/**
 * The plan says which branches rejoin and which stop. These check the carve
 * agreed — after corridors were swept, rooms were cut over the top of them and
 * cover was scattered blind across the lot.
 *
 * This matters more here than in most level generators because the player is
 * given no signposting. The extraction beacon is visible from anywhere on the
 * map, but nothing says which corridor reaches it, so the shape of the map is
 * the entire body of information they have to work with. A dead end that turns
 * out to be a through-route, or an alternate that turns out to be a bulge, is
 * the map lying to them.
 */
describe('buildRoute — topology', () => {
  const SIZES = [44, 56, 72];

  /**
   * Alternates are checked by reachability rather than by plugging the trunk
   * leg they skip.
   *
   * Cutting that leg is the question you would rather ask, but it cannot be
   * asked here: corridors are eleven metres wide and trunk legs are seventeen,
   * so any plug wide enough to sever a leg also swallows the junction at its
   * end — which is the alternate's own rejoin. What is verified instead is that
   * the detour is carved, open, and connected. That it is a *separate* path
   * rather than a bulge in the trunk is settled in `route.test.ts`, where every
   * one of its segments is held a full corridor-width clear of the trunk.
   */
  it('carves every alternate as connected, open ground', () => {
    for (const cells of SIZES) {
      for (let seed = 0; seed < 25; seed++) {
        const map = buildRoute(new Rng(seed), { cols: cells, rows: cells, tile: TILE, files: 8 });
        const reachable = reachableFrom(map.grid, map.spawn.x, map.spawn.z);

        for (const branch of map.routes) {
          if (branch.kind !== 'alternate') continue;
          for (const point of branch.points) {
            expect(map.grid.isSolidWorld(point.x, point.z), `${cells}c seed ${seed}`).toBe(false);
            expect(reachable.has(cellAt(map.grid, point)), `${cells}c seed ${seed}`).toBe(true);
          }
          // And it really does start and end on the trunk, so it is a loop off
          // the route rather than a spur that happens to touch it.
          expect(map.waypoints, `${cells}c seed ${seed}`).toContainEqual(branch.points[0]);
          expect(map.waypoints, `${cells}c seed ${seed}`).toContainEqual(
            branch.points[branch.points.length - 1],
          );
        }
      }
    }
  });

  it('carves every dead end as a dead end', () => {
    for (const cells of SIZES) {
      for (let seed = 0; seed < 25; seed++) {
        const map = buildRoute(new Rng(seed), { cols: cells, rows: cells, tile: TILE, files: 8 });
        const exit = cellAt(map.grid, map.extraction);

        for (const branch of map.routes) {
          if (branch.kind !== 'dead-end') continue;
          const terminal = branch.points[branch.points.length - 1];
          // Plug the branch's opening leg. Everything past it must now be cut
          // off — if the pad is still reachable, the stub joined something.
          const blocked = plugLeg(map, branch.points[0], branch.points[1]);
          const reachable = reachableFrom(map.grid, terminal.x, terminal.z, blocked);
          expect(reachable.has(exit), `${cells}c seed ${seed}`).toBe(false);
        }
      }
    }
  });

  it('leaves every dead end reachable from spawn', () => {
    for (const cells of SIZES) {
      for (let seed = 0; seed < 25; seed++) {
        const map = buildRoute(new Rng(seed), { cols: cells, rows: cells, tile: TILE, files: 8 });
        const reachable = reachableFrom(map.grid, map.spawn.x, map.spawn.z);
        for (const terminal of map.deadEnds) {
          expect(reachable.has(cellAt(map.grid, terminal)), `${cells}c seed ${seed}`).toBe(true);
        }
      }
    }
  });

  it('puts the stash on one of the dead ends', () => {
    for (let seed = 0; seed < 40; seed++) {
      const map = buildRoute(new Rng(seed), { cols: 56, rows: 56, tile: TILE, files: 8 });
      if (!map.stash) continue;
      expect(map.deadEnds, `seed ${seed}`).toContainEqual(map.stash);
    }
  });

  it('funnels every route through its chokepoints', () => {
    for (let seed = 0; seed < 25; seed++) {
      const map = buildRoute(new Rng(seed), { cols: 56, rows: 56, tile: TILE, files: 8 });
      const exit = cellAt(map.grid, map.extraction);

      for (const point of map.chokepoints) {
        expect(map.waypoints, `seed ${seed}`).toContainEqual(point);
      }

      // A leg running between two consecutive chokepoints is bypassed by
      // nothing, so plugging it has to cut the map in half. That is what makes
      // a chokepoint the right place to leave a weapon.
      const indices = map.chokepoints.map((p) => map.waypoints.indexOf(p));
      for (let i = 0; i < indices.length - 1; i++) {
        if (indices[i + 1] !== indices[i] + 1) continue;
        const a = map.waypoints[indices[i]];
        const b = map.waypoints[indices[i] + 1];
        // Not inside a park. A park is deliberately wider than the corridor
        // running through it, so there is open grass to either side and
        // plugging the corridor does not cut anything — the leg is still
        // unbypassed in the route graph, which is what `route.test.ts` checks,
        // but a flood fill can no longer see that from the grid alone.
        const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        const reach = map.corridorRadius * 2;
        if (
          map.parks.some(
            (park) =>
              Math.hypot(mid.x - park.x, mid.z - park.z) < park.radius + reach ||
              Math.hypot(a.x - park.x, a.z - park.z) < park.radius + reach ||
              Math.hypot(b.x - park.x, b.z - park.z) < park.radius + reach,
          )
        ) {
          continue;
        }
        const reachable = reachableFrom(map.grid, map.spawn.x, map.spawn.z, plugLeg(map, a, b));
        expect(reachable.has(exit), `seed ${seed} leg ${indices[i]}`).toBe(false);
      }
    }
  });

  /**
   * A lamp is the one prop placed by world position rather than by cell, so it
   * is the one that can end up standing inside a building with nothing to
   * notice. Nothing else in the pipeline would catch it — it has no collision
   * and breaks no invariant; it just looks wrong.
   */
  it('stands every street lamp on open ground', () => {
    for (const cells of SIZES) {
      for (let seed = 0; seed < 20; seed++) {
        const map = buildRoute(new Rng(seed), { cols: cells, rows: cells, tile: TILE, files: 8 });
        const reachable = reachableFrom(map.grid, map.spawn.x, map.spawn.z);
        expect(map.lamps.length, `${cells}c seed ${seed}`).toBeGreaterThan(0);

        for (const lamp of map.lamps) {
          expect(map.grid.isSolidWorld(lamp.x, lamp.z), `${cells}c seed ${seed}`).toBe(false);
          // And on the player's side of the walls, not in a sealed pocket.
          expect(reachable.has(cellAt(map.grid, lamp)), `${cells}c seed ${seed}`).toBe(true);
        }
      }
    }
  });

  it('gives bigger commits more of the map to get lost in', () => {
    const branches = (files: number): number => {
      let total = 0;
      for (let seed = 0; seed < 40; seed++) {
        total += buildRoute(new Rng(seed), { cols: 64, rows: 64, tile: TILE, files }).routes.length;
      }
      return total / 40;
    };
    expect(branches(15)).toBeGreaterThan(branches(1) * 1.3);
  });
});
