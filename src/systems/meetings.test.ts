import { describe, expect, it } from 'vitest';
import { MeetingState, type MeetingEvent } from './meetings';
import { BlobProfile } from './blob';

/**
 * The `avoid` countdown used to start at Infinity, so `Infinity - dt` was still
 * Infinity, the expiry check could never fire, and blobs piled up on the map
 * forever — 24 of them in one run. These pin every timer transition.
 */

/** A perfectly round profile, so containment in these tests is predictable. */
const round = (radius = 3.6): BlobProfile =>
  new BlobProfile(radius, new Array(40).fill(radius));

const meeting = (kind: 'mandatory' | 'avoid', duration = 12): MeetingState =>
  new MeetingState(kind, 'Test Meeting', 0, 0, duration, round());

const step = (m: MeetingState, seconds: number, px = 999, pz = 999): MeetingEvent[] => {
  const out: MeetingEvent[] = [];
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) out.push(m.update(dt, px, pz));
  return out;
};

describe('avoid blobs', () => {
  it('expires on its own after its duration', () => {
    const m = meeting('avoid', 10);
    step(m, 9);
    expect(m.done).toBe(false);
    step(m, 2);
    expect(m.expired).toBe(true);
  });

  it('always terminates rather than running forever', () => {
    const m = meeting('avoid', 18);
    step(m, 60);
    expect(m.done).toBe(true);
  });

  it('never reports a miss — walking past one is free', () => {
    expect(step(meeting('avoid', 5), 8).filter(Boolean)).toEqual([]);
  });

  it('cannot be attended, however long you stand in it', () => {
    const m = meeting('avoid', 30);
    const events = step(m, 10, 0, 0);
    expect(events.filter(Boolean)).toEqual([]);
    expect(m.attended).toBe(false);
  });
});

describe('mandatory meetings', () => {
  it('reports a miss exactly once when the window closes', () => {
    const m = meeting('mandatory');
    const events = step(m, 40);
    expect(events.filter((e) => e === 'missed')).toHaveLength(1);
    expect(m.expired).toBe(true);
  });

  it('is attended by standing in it long enough', () => {
    const m = meeting('mandatory');
    const events = step(m, 4, 0, 0);
    expect(events.filter((e) => e === 'attended')).toHaveLength(1);
    expect(m.attended).toBe(true);
  });

  it('is never both attended and missed', () => {
    const m = meeting('mandatory');
    const events = step(m, 60, 0, 0);
    expect(events.filter((e) => e === 'attended')).toHaveLength(1);
    expect(events.filter((e) => e === 'missed')).toHaveLength(0);
  });

  it('stops emitting events once resolved', () => {
    const m = meeting('mandatory');
    step(m, 40);
    expect(step(m, 20).filter(Boolean)).toEqual([]);
  });

  it('lives long enough to be reachable from across the map', () => {
    // A player crossing at ~8 u/s needs real time to break off and get there.
    expect(meeting('mandatory').timeLeft).toBeGreaterThan(20);
  });

  it('does not count time spent outside it', () => {
    const m = meeting('mandatory');
    step(m, 5, 50, 50);
    expect(m.attended).toBe(false);
    expect(m.attendanceProgress).toBe(0);
  });

  it('reports urgency climbing toward the deadline', () => {
    const m = meeting('mandatory');
    expect(m.urgency).toBeCloseTo(0, 2);
    step(m, 13);
    expect(m.urgency).toBeGreaterThan(0.4);
    expect(m.urgency).toBeLessThan(0.6);
  });
});

describe('blob containment', () => {
  it('uses the blob outline, not a bounding circle', () => {
    const profile = new BlobProfile(4, [
      // Long to +X, short to +Z.
      ...new Array(10).fill(6),
      ...new Array(10).fill(2),
      ...new Array(10).fill(6),
      ...new Array(10).fill(2),
    ]);
    const m = new MeetingState('avoid', 'Blob', 0, 0, 10, profile);
    expect(m.contains(5, 0)).toBe(true);
    expect(m.contains(0, 5)).toBe(false);
  });

  it('is deterministic for a given seed', () => {
    const rngA = { range: seededRange(1) };
    const rngB = { range: seededRange(1) };
    expect(BlobProfile.generate(3.6, rngA).radii).toEqual(BlobProfile.generate(3.6, rngB).radii);
  });

  it('generates an outline that is irregular but never inside-out', () => {
    const profile = BlobProfile.generate(3.6, { range: seededRange(7) });
    const min = Math.min(...profile.radii);
    const max = Math.max(...profile.radii);
    expect(min).toBeGreaterThan(0.5);
    // Genuinely lopsided — a circle would have max/min of exactly 1.
    expect(max / min).toBeGreaterThan(1.2);
  });
});

/** Tiny deterministic stand-in for Rng.range. */
function seededRange(seed: number): (a: number, b: number) => number {
  let state = seed >>> 0;
  return (a: number, b: number) => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return a + (state / 4294967296) * (b - a);
  };
}
