import { describe, expect, it } from 'vitest';
import { CELL, Grid } from './grid';

/**
 * The raycasts are load-bearing twice over: an enemy that can see through walls
 * is a cheat, and an aim line that stops in the wrong place teaches the player
 * the wrong range. Both run through one DDA, so these tests pin the walk.
 */

/** An open 10x10 grid of 2-unit tiles — world extent 0..20 on both axes. */
function openGrid(): Grid {
  return new Grid(10, 10, 2);
}

describe('rayDistance', () => {
  it('returns the full range when nothing is in the way', () => {
    const grid = openGrid();
    expect(grid.rayDistance(1, 1, 1, 0, 8, true)).toBe(8);
  });

  it('stops at the near face of a wall', () => {
    const grid = openGrid();
    // Cell (3, 0) spans x 6..8. A ray from x=1 along +X enters it at 5 units.
    grid.setCell(3, 0, CELL.WALL);
    expect(grid.rayDistance(1, 1, 1, 0, 20, true)).toBeCloseTo(5, 6);
  });

  it('clamps to max even when a wall sits further out', () => {
    const grid = openGrid();
    grid.setCell(6, 0, CELL.WALL);
    expect(grid.rayDistance(1, 1, 1, 0, 4, true)).toBe(4);
  });

  it('treats cover as blocking for shots and transparent for eyes', () => {
    const grid = openGrid();
    grid.setCell(3, 0, CELL.COVER);
    expect(grid.rayDistance(1, 1, 1, 0, 20, true)).toBeCloseTo(5, 6);
    // Eyes see straight over waist-high cover, so the ray runs to the map edge.
    expect(grid.rayDistance(1, 1, 1, 0, 12, false)).toBe(12);
  });

  it('stops immediately when the ray starts inside something solid', () => {
    const grid = openGrid();
    grid.setCell(0, 0, CELL.WALL);
    expect(grid.rayDistance(1, 1, 1, 0, 20, true)).toBe(0);
  });

  it('stops at the map edge, because out of bounds reads as solid', () => {
    const grid = openGrid();
    // From x=19 heading +X, the boundary at x=20 is one unit away.
    expect(grid.rayDistance(19, 1, 1, 0, 20, true)).toBeCloseTo(1, 6);
  });

  it('handles axis-aligned rays without dividing by zero', () => {
    const grid = openGrid();
    grid.setCell(0, 3, CELL.WALL);
    // dirX is exactly 0 — the branch that would produce NaN if mishandled.
    // Cell (0,3) spans z 6..8, so +Z from z=1 enters at 5 and -Z from z=19
    // enters the far face at 11.
    expect(grid.rayDistance(1, 1, 0, 1, 20, true)).toBeCloseTo(5, 6);
    expect(grid.rayDistance(1, 19, 0, -1, 20, true)).toBeCloseTo(11, 6);
  });

  it('stops at the map edge along an axis with nothing in the way', () => {
    const grid = openGrid();
    expect(grid.rayDistance(1, 19, 0, 1, 20, true)).toBeCloseTo(1, 6);
    expect(grid.rayDistance(1, 1, 0, -1, 20, true)).toBeCloseTo(1, 6);
  });

  it('terminates on a zero-length ray rather than spinning', () => {
    const grid = openGrid();
    expect(grid.rayDistance(5, 5, 1, 0, 0, true)).toBe(0);
  });

  it('measures a diagonal in world units, not cells', () => {
    const grid = openGrid();
    grid.setCell(3, 3, CELL.WALL);
    const d = Math.SQRT1_2;
    // Cell (3,3) starts at (6,6); from (1,1) the diagonal entry is at x=6,
    // i.e. 5 units along each axis => hypot(5,5).
    expect(grid.rayDistance(1, 1, d, d, 30, true)).toBeCloseTo(Math.hypot(5, 5), 6);
  });
});

describe('rayDistance agrees with the boolean sight checks', () => {
  const cases: Array<[number, number, number, number]> = [
    [1, 1, 19, 1],
    [1, 1, 19, 19],
    [19, 19, 1, 1],
    [1, 19, 19, 1],
    [5, 5, 5, 15],
  ];

  it('reports a full-length ray exactly when line of sight is clear', () => {
    const grid = openGrid();
    grid.setCell(4, 4, CELL.WALL);
    grid.setCell(7, 2, CELL.WALL);
    grid.setCell(2, 7, CELL.COVER);

    for (const [x0, z0, x1, z1] of cases) {
      const distance = Math.hypot(x1 - x0, z1 - z0);
      const reach = grid.rayDistance(
        x0,
        z0,
        (x1 - x0) / distance,
        (z1 - z0) / distance,
        distance,
        false,
      );
      expect(reach >= distance).toBe(grid.hasLineOfSight(x0, z0, x1, z1));
    }
  });

  it('reports a full-length ray exactly when the shot is clear', () => {
    const grid = openGrid();
    grid.setCell(4, 4, CELL.WALL);
    grid.setCell(2, 7, CELL.COVER);

    for (const [x0, z0, x1, z1] of cases) {
      const distance = Math.hypot(x1 - x0, z1 - z0);
      const reach = grid.rayDistance(
        x0,
        z0,
        (x1 - x0) / distance,
        (z1 - z0) / distance,
        distance,
        true,
      );
      expect(reach >= distance).toBe(grid.hasClearShot(x0, z0, x1, z1));
    }
  });
});

describe('hasLineOfSight / hasClearShot', () => {
  it('sees over cover but cannot shoot through it', () => {
    const grid = openGrid();
    grid.setCell(3, 0, CELL.COVER);
    expect(grid.hasLineOfSight(1, 1, 15, 1)).toBe(true);
    expect(grid.hasClearShot(1, 1, 15, 1)).toBe(false);
  });

  it('is blocked by a full-height wall either way', () => {
    const grid = openGrid();
    grid.setCell(3, 0, CELL.WALL);
    expect(grid.hasLineOfSight(1, 1, 15, 1)).toBe(false);
    expect(grid.hasClearShot(1, 1, 15, 1)).toBe(false);
  });

  it('checks the cell the target stands in', () => {
    const grid = openGrid();
    grid.setCell(7, 0, CELL.WALL);
    // The endpoint is inside the wall cell (x 14..16).
    expect(grid.hasLineOfSight(1, 1, 15, 1)).toBe(false);
  });

  it('handles coincident points', () => {
    const grid = openGrid();
    expect(grid.hasLineOfSight(5, 5, 5, 5)).toBe(true);
    grid.setCell(2, 2, CELL.WALL);
    expect(grid.hasLineOfSight(5, 5, 5, 5)).toBe(false);
  });
});
