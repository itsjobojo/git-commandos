import { describe, expect, it } from 'vitest';
import { Director, type DirectorContext } from './director';
import { buildRoute } from '../world/arena';
import { CELL, Grid } from '../world/grid';
import { Rng } from '../core/rng';

/**
 * Spawn placement is the one part of the director that depends on the shape of
 * the map, so it is the part worth testing against real generated maps rather
 * than a fixture.
 *
 * What it is guarding: enemies used to be dropped on a ring around the player
 * and accepted if the cell was not solid. On a map that is mostly rock that is
 * a much weaker check than it looks — a spot twenty-five metres away can be a
 * room behind a wall, or a stub the route never visits — so a share of every
 * run's spawn budget went to enemies the player would never meet.
 */
const TILE = 2;

/** Reachable cells, so a spawn can be checked against the space the player has. */
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
 * `spawnPoint` is private and has no business being public — nothing outside
 * the director places enemies. The scene and combat system are never touched on
 * this path, so they are left unset rather than stubbed.
 */
interface SpawnProbe {
  spawnPoint(ctx: DirectorContext): { x: number; z: number };
}

function directorFor(seed: number, cells: number) {
  const map = buildRoute(new Rng(seed), { cols: cells, rows: cells, tile: TILE, files: 8 });
  const director = new Director(
    undefined as never,
    undefined as never,
    undefined as never,
    map.grid,
    new Rng(seed),
    map.waypoints,
    0.5,
  );
  return { map, probe: director as unknown as SpawnProbe };
}

/** Walk the player down the route, asking for spawns the whole way. */
function everySpawn(
  visit: (
    spot: { x: number; z: number },
    at: { x: number; z: number },
    map: ReturnType<typeof directorFor>['map'],
    label: string,
  ) => void,
): void {
  for (const cells of [76, 96, 125]) {
    for (let seed = 0; seed < 20; seed++) {
      const { map, probe } = directorFor(seed, cells);
      for (let w = 0; w < map.waypoints.length - 1; w++) {
        const at = map.waypoints[w];
        for (let n = 0; n < 4; n++) {
          const spot = probe.spawnPoint({
            playerX: at.x,
            playerZ: at.z,
            extractionProgress: 0,
            extracting: false,
            carrying: 3,
          });
          visit(spot, at, map, `${cells}c seed ${seed} waypoint ${w}`);
        }
      }
    }
  }
}

describe('Director spawn placement', () => {
  it('never puts an enemy inside rock', () => {
    everySpawn((spot, _at, map, label) => {
      expect(map.grid.isSolidWorld(spot.x, spot.z), label).toBe(false);
    });
  });

  it('never puts an enemy in the player’s lap', () => {
    everySpawn((spot, at, _map, label) => {
      expect(Math.hypot(spot.x - at.x, spot.z - at.z), label).toBeGreaterThanOrEqual(22);
    });
  });

  /**
   * The point of routing spawns: an enemy is only pressure if the player walks
   * into it. A handful landing off the line is fine — that is the ring fallback
   * near the pad, where there is no route left ahead — but it has to be rare.
   */
  it('puts enemies on the route the player is walking', () => {
    let total = 0;
    let strayed = 0;
    everySpawn((spot, _at, map) => {
      total++;
      let nearest = Infinity;
      for (const point of map.waypoints) {
        nearest = Math.min(nearest, Math.hypot(point.x - spot.x, point.z - spot.z));
      }
      if (nearest > 30) strayed++;
    });
    expect(strayed / total).toBeLessThan(0.02);
  });

  it('never strands an enemy somewhere the player cannot reach', () => {
    let total = 0;
    let stranded = 0;
    everySpawn((spot, _at, map) => {
      total++;
      const reachable = reachableFrom(map.grid, map.spawn.x, map.spawn.z);
      const cell = map.grid.cellZ(spot.z) * map.grid.cols + map.grid.cellX(spot.x);
      if (!reachable.has(cell)) stranded++;
    });
    expect(stranded / total).toBeLessThan(0.01);
  });
});
