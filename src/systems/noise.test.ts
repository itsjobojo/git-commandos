import { describe, expect, it } from 'vitest';
import { NoiseBus } from './noise';
import { WEAPONS, WEAPON_ORDER } from './weapons';

/**
 * Small enough to look obviously correct, which is exactly why it is worth
 * pinning: the double-buffer is the thing that keeps "who heard that" from
 * depending on array order, and getting it wrong produces a stealth layer that
 * is subtly unfair in a way playtesting will never isolate.
 */
describe('NoiseBus', () => {
  it('starts silent', () => {
    expect(new NoiseBus().current).toHaveLength(0);
  });

  it('does not make a sound audible in the step it was emitted', () => {
    const bus = new NoiseBus();
    bus.emit(1, 2, 10);
    expect(bus.current).toHaveLength(0);
  });

  it('makes it audible in the next step', () => {
    const bus = new NoiseBus();
    bus.emit(1, 2, 10);
    bus.swap();
    expect(bus.current).toEqual([{ x: 1, z: 2, radius: 10 }]);
  });

  it('drops it the step after that', () => {
    const bus = new NoiseBus();
    bus.emit(1, 2, 10);
    bus.swap();
    bus.swap();
    expect(bus.current).toHaveLength(0);
  });

  it('carries several sounds from the same step', () => {
    const bus = new NoiseBus();
    bus.emit(0, 0, 5);
    bus.emit(9, 9, 7);
    bus.swap();
    expect(bus.current).toHaveLength(2);
  });

  it('ignores a silent emission rather than queueing an inaudible entry', () => {
    const bus = new NoiseBus();
    bus.emit(0, 0, 0);
    bus.swap();
    expect(bus.current).toHaveLength(0);
  });

  it('reuses its buffers instead of allocating per step', () => {
    const bus = new NoiseBus();
    bus.emit(1, 1, 1);
    bus.swap();
    const first = bus.current;
    bus.swap();
    bus.emit(2, 2, 2);
    bus.swap();
    // Two buffers, swapped back and forth — the third swap lands on the first.
    expect(bus.current).toBe(first);
  });
});

describe('weapon loudness', () => {
  it('is louder the bigger the gun', () => {
    expect(WEAPONS.pistol.noise).toBeLessThan(WEAPONS.smg.noise);
    expect(WEAPONS.smg.noise).toBeLessThan(WEAPONS.shotgun.noise);
  });

  it('gives every weapon a positive range and noise', () => {
    for (const id of WEAPON_ORDER) {
      expect(WEAPONS[id].range, id).toBeGreaterThan(0);
      expect(WEAPONS[id].noise, id).toBeGreaterThan(0);
    }
  });

  it('draws a sight far shorter than the weapon actually reaches', () => {
    // The camera frames roughly 35 units across. A sight drawn at full lethal
    // range spans most of that and stops reading as an aim indicator, so every
    // weapon's line is deliberately a fraction of what it can hit.
    for (const id of WEAPON_ORDER) {
      const weapon = WEAPONS[id];
      expect(weapon.sightLength, id).toBeGreaterThan(0);
      expect(weapon.sightLength, id).toBeLessThan(weapon.range);
      // Roughly a third of the framed width. Past this it stops reading as an
      // aim indicator and starts reading as scenery.
      expect(weapon.sightLength, id).toBeLessThanOrEqual(14);
    }
  });

  it('keeps the sights distinct, longest on the sidearm', () => {
    expect(WEAPONS.shotgun.sightLength).toBeLessThan(WEAPONS.smg.sightLength);
    expect(WEAPONS.smg.sightLength).toBeLessThan(WEAPONS.pistol.sightLength);
  });

  it('makes the sidearm quieter than it shoots far, and the shotgun the reverse', () => {
    // The whole point of the sidearm: you can use it without telling the map.
    expect(WEAPONS.pistol.noise).toBeLessThan(WEAPONS.pistol.range);
    // And of the shotgun: it is the panic button, and panic is loud.
    expect(WEAPONS.shotgun.noise).toBeGreaterThan(WEAPONS.shotgun.range);
  });
});
