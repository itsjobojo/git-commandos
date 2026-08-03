import { describe, expect, it } from 'vitest';
import { buildRoute, pickEndpoints } from './arena';
import { CELL, Grid } from './grid';
import { Rng } from '../core/rng';

// buildRoute builds meshes, which needs no DOM — but it does need three's
// geometry classes, which work fine headlessly.

/** Flood fill from a world point; returns the set of reachable cell indices. */
function reachableFrom(grid: Grid, x: number, z: number): Set<number> {
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
      const next = nz * grid.cols + nx;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/**
 * Endpoint placement is seeded, so these assertions are exact rather than
 * statistical — the same commit message must always produce the same map.
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
      const map = buildRoute(new Rng(seed), 40, 40, TILE);
      const reachable = reachableFrom(map.grid, map.spawn.x, map.spawn.z);
      const exit =
        map.grid.cellZ(map.extraction.z) * map.grid.cols + map.grid.cellX(map.extraction.x);
      expect(reachable.has(exit), `seed ${seed}`).toBe(true);
    }
  });

  it('leaves both endpoints standing in open floor', () => {
    for (let seed = 0; seed < 40; seed++) {
      const map = buildRoute(new Rng(seed), 40, 40, TILE);
      expect(map.grid.isSolidWorld(map.spawn.x, map.spawn.z), `spawn ${seed}`).toBe(false);
      expect(map.grid.isSolidWorld(map.extraction.x, map.extraction.z), `exit ${seed}`).toBe(false);
    }
  });

  it('reaches the stash branch whenever it carves one', () => {
    for (let seed = 0; seed < 40; seed++) {
      const map = buildRoute(new Rng(seed), 40, 40, TILE);
      if (!map.stash) continue;
      const reachable = reachableFrom(map.grid, map.spawn.x, map.spawn.z);
      const stash = map.grid.cellZ(map.stash.z) * map.grid.cols + map.grid.cellX(map.stash.x);
      expect(reachable.has(stash), `seed ${seed}`).toBe(true);
    }
  });

  it('carves a route rather than an open arena', () => {
    const map = buildRoute(new Rng('fix: auth'), 44, 44, TILE);
    let open = 0;
    for (let i = 0; i < map.grid.solid.length; i++) {
      if (map.grid.solid[i] === CELL.EMPTY) open++;
    }
    // A corridor network should leave most of the map as solid rock.
    expect(open / map.grid.solid.length).toBeLessThan(0.45);
    expect(open / map.grid.solid.length).toBeGreaterThan(0.05);
  });

  it('keeps the border sealed', () => {
    const map = buildRoute(new Rng(3), 40, 40, TILE);
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
    const map = buildRoute(new Rng(9), 44, 44, TILE);
    expect(map.waypoints.length).toBeGreaterThanOrEqual(5);
    expect(map.waypoints[0]).toEqual(map.spawn);
    expect(map.waypoints[map.waypoints.length - 1]).toEqual(map.extraction);
  });
});
