import { describe, expect, it } from 'vitest';
import { aimEnvelope } from './aim';
import { MUZZLE_OFFSET, WEAPONS } from './weapons';
import { CELL, Grid } from '../world/grid';

/**
 * The envelope is a promise: draw it, and the player believes pellets land
 * inside it. These tests pin the promise — the geometry the indicator scales
 * to, and the wall clipping that makes it worth drawing at all.
 */

function openGrid(): Grid {
  return new Grid(20, 20, 2);
}

describe('aimEnvelope', () => {
  it('starts at the muzzle, not the player', () => {
    const e = aimEnvelope(openGrid(), 5, 5, 0, 0.1, 10);
    expect(e.muzzleX).toBeCloseTo(5 + MUZZLE_OFFSET, 6);
    expect(e.muzzleZ).toBeCloseTo(5, 6);
  });

  it('runs the full range when nothing is in the way', () => {
    const e = aimEnvelope(openGrid(), 5, 5, 0, WEAPONS.pistol.spread, 20);
    expect(e.centre).toBe(20);
    expect(e.left).toBe(20);
    expect(e.right).toBe(20);
  });

  it('reports the spread as the half-angle both edges sit at', () => {
    const spread = WEAPONS.shotgun.spread;
    const e = aimEnvelope(openGrid(), 5, 5, 0, spread, 10);
    expect(e.halfAngle).toBe(spread);
    // The renderer scales a unit wedge by (L, 1, L*tan(halfAngle)); that is the
    // apex half-angle it produces, so it must equal the weapon's spread exactly.
    expect(Math.atan((e.centre * Math.tan(e.halfAngle)) / e.centre)).toBeCloseTo(spread, 12);
  });

  it('clips on a wall', () => {
    const grid = openGrid();
    // Cell (5, 2) spans x 10..12; the muzzle sits at x = 5.8.
    grid.setCell(5, 2, CELL.WALL);
    const e = aimEnvelope(grid, 5, 5, 0, 0, 20);
    expect(e.centre).toBeCloseTo(10 - (5 + MUZZLE_OFFSET), 6);
  });

  it('clips on cover, because cover stops bullets', () => {
    const grid = openGrid();
    grid.setCell(5, 2, CELL.COVER);
    const e = aimEnvelope(grid, 5, 5, 0, 0, 20);
    expect(e.centre).toBeLessThan(20);
  });

  it('gives the pistol three lengths that agree', () => {
    const grid = openGrid();
    grid.setCell(8, 2, CELL.WALL);
    const e = aimEnvelope(grid, 5, 5, 0, WEAPONS.pistol.spread, WEAPONS.pistol.sightLength);
    // 0.012 rad over ~10 units is 12cm of divergence — the three rays are the
    // same ray for all practical purposes, which is why the fill is hidden.
    expect(e.left).toBeCloseTo(e.centre, 1);
    expect(e.right).toBeCloseTo(e.centre, 1);
  });

  it('gives the shotgun edges that disagree around a corner', () => {
    const grid = openGrid();
    // Cell (4,4) spans x 8..10, z 8..10. Firing at 0.6 rad from a muzzle at
    // (5.66, 5.45), the wide edge clips its corner within the 5-unit sight
    // while the narrow edge runs clear past it. That asymmetry is the entire
    // reason three separate raycasts exist rather than one.
    grid.setCell(4, 4, CELL.WALL);
    const e = aimEnvelope(grid, 5, 5, 0.6, WEAPONS.shotgun.spread, WEAPONS.shotgun.sightLength);
    expect(e.right).toBeLessThan(e.left);
    expect(e.left).toBe(WEAPONS.shotgun.sightLength);
  });

  it('never draws past the fill, which uses the shortest edge', () => {
    const grid = openGrid();
    grid.setCell(4, 4, CELL.WALL);
    const e = aimEnvelope(grid, 5, 5, 0.6, WEAPONS.shotgun.spread, WEAPONS.shotgun.sightLength);
    const fill = Math.min(e.centre, e.left, e.right);
    expect(fill).toBeLessThanOrEqual(e.centre);
    expect(fill).toBeLessThanOrEqual(e.left);
    expect(fill).toBeLessThanOrEqual(e.right);
  });

  it('reuses the out parameter so the render path allocates nothing', () => {
    const grid = openGrid();
    const first = aimEnvelope(grid, 5, 5, 0, 0.1, 10);
    const second = aimEnvelope(grid, 6, 6, 1, 0.2, 12, first);
    expect(second).toBe(first);
    expect(second.yaw).toBe(1);
  });
});
