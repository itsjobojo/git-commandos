import { describe, expect, it } from 'vitest';
import { pickEndpoints } from './arena';
import { Rng } from '../core/rng';

/**
 * Endpoint placement is seeded, so these assertions are exact rather than
 * statistical — the same commit message must always produce the same map.
 */
describe('pickEndpoints', () => {
  const TILE = 2;

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
