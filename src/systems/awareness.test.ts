import { describe, expect, it } from 'vitest';
import {
  SENSE_PROFILES,
  alertFrom,
  createSense,
  senseStep,
  type Noise,
  type Sense,
  type SenseProfile,
  type SenseWorld,
} from './awareness';

/**
 * The stealth layer's whole contract. None of this needs a renderer, an entity
 * or a real grid — which is the point: an enemy that can see through a wall is
 * a bug you cannot spot by playing, because it looks exactly like an enemy that
 * guessed well.
 */

const STEP = 1 / 60;

/** A grid stub. `blocked` decides every raycast; `stuck` fakes a wedged body. */
function stubGrid(blocked = false, stuck = false) {
  return {
    hasLineOfSight: () => !blocked,
    isSolidWorld: () => stuck,
  };
}

function world(over: Partial<SenseWorld> = {}): SenseWorld {
  return {
    x: 0,
    z: 0,
    yaw: 0,
    seed: 0,
    bodyX: 10,
    bodyZ: 0,
    conspicuous: 0,
    noises: [],
    floorState: null,
    floorX: 0,
    floorZ: 0,
    grid: stubGrid(),
    ...over,
  };
}

/** Run `seconds` worth of fixed steps. */
function run(
  sense: Sense,
  profile: SenseProfile,
  seconds: number,
  over: Partial<SenseWorld> = {},
): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) senseStep(sense, profile, STEP, world(over));
}

const recruiter = SENSE_PROFILES.recruiter;

describe('promotion by sight', () => {
  it('starts unaware', () => {
    expect(createSense(recruiter, 0).state).toBe('unaware');
  });

  it('notices someone standing in the cone', () => {
    const s = createSense(recruiter, 0);
    run(s, recruiter, recruiter.noticeSeconds + 0.1);
    expect(s.state).toBe('suspicious');
  });

  it('confirms into alerted after a further look', () => {
    const s = createSense(recruiter, 0);
    run(s, recruiter, recruiter.noticeSeconds + recruiter.confirmSeconds + 0.2);
    expect(s.state).toBe('alerted');
  });

  it('does not promote before the notice threshold', () => {
    const s = createSense(recruiter, 0);
    run(s, recruiter, recruiter.noticeSeconds - 0.1);
    expect(s.state).toBe('unaware');
  });

  it('never promotes through a wall, however long you stand there', () => {
    const s = createSense(recruiter, 0);
    run(s, recruiter, 30, { grid: stubGrid(true) });
    expect(s.state).toBe('unaware');
    expect(s.canSee).toBe(false);
  });

  it('never promotes outside the cone, at any distance', () => {
    const s = createSense(recruiter, 0);
    // Directly behind: 180 degrees off the cone, well outside `peripheral`.
    run(s, recruiter, 30, { bodyX: -10, bodyZ: 0 });
    expect(s.state).toBe('unaware');
  });

  it('never promotes beyond its reach', () => {
    const s = createSense(recruiter, 0);
    run(s, recruiter, 30, { bodyX: recruiter.reach + 5, bodyZ: 0 });
    expect(s.state).toBe('unaware');
  });

  it('notices regardless of angle inside the peripheral radius', () => {
    const s = createSense(recruiter, 0);
    // Behind, but close enough to touch — you cannot sneak into someone's elbow.
    run(s, recruiter, recruiter.noticeSeconds + 0.1, { bodyX: -2, bodyZ: 0 });
    expect(s.state).toBe('suspicious');
  });

  it('sees out of a body wedged inside geometry rather than going blind', () => {
    const s = createSense(recruiter, 0);
    run(s, recruiter, 2, { grid: stubGrid(true, true) });
    expect(s.canSee).toBe(true);
  });
});

describe('decay', () => {
  it('drops alerted -> suspicious -> unaware on the right clocks', () => {
    const s = createSense(recruiter, 0);
    run(s, recruiter, 2);
    expect(s.state).toBe('alerted');

    // Break sight. Alerted holds until loseSeconds.
    run(s, recruiter, recruiter.loseSeconds - 0.1, { grid: stubGrid(true) });
    expect(s.state).toBe('alerted');
    run(s, recruiter, 0.2, { grid: stubGrid(true) });
    expect(s.state).toBe('suspicious');

    // Both clocks run from the same last sighting, so `forgetSeconds` is a
    // total rather than a further wait on top of `loseSeconds`.
    run(s, recruiter, recruiter.forgetSeconds - recruiter.loseSeconds - 0.2, {
      grid: stubGrid(true),
    });
    expect(s.state).toBe('suspicious');
    run(s, recruiter, 0.4, { grid: stubGrid(true) });
    expect(s.state).toBe('unaware');
  });

  it('keeps the two decay clocks ordered in every shipped profile', () => {
    for (const [name, profile] of Object.entries(SENSE_PROFILES)) {
      if (profile.locked) continue;
      expect(profile.forgetSeconds, name).toBeGreaterThan(profile.loseSeconds);
    }
  });

  it('re-acquires without paying the notice cost twice', () => {
    const s = createSense(recruiter, 0);
    run(s, recruiter, 2);
    run(s, recruiter, recruiter.loseSeconds + 0.2, { grid: stubGrid(true) });
    expect(s.state).toBe('suspicious');
    // Back in view: only confirmSeconds, not notice + confirm.
    run(s, recruiter, recruiter.confirmSeconds + 0.05);
    expect(s.state).toBe('alerted');
  });
});

describe('hearing', () => {
  const near: Noise[] = [{ x: 3, z: 0, radius: 20 }];
  const far: Noise[] = [{ x: 300, z: 0, radius: 20 }];

  it('promotes unaware -> suspicious', () => {
    const s = createSense(recruiter, 0);
    // Out of sight behind a wall, so only the noise can do anything.
    senseStep(s, recruiter, STEP, world({ noises: near, grid: stubGrid(true) }));
    expect(s.state).toBe('suspicious');
  });

  it('never promotes straight to alerted', () => {
    const s = createSense(recruiter, 0);
    for (let i = 0; i < 600; i++) {
      senseStep(s, recruiter, STEP, world({ noises: near, grid: stubGrid(true) }));
    }
    expect(s.state).toBe('suspicious');
  });

  it('sends it to the sound, not to you', () => {
    const s = createSense(recruiter, 0);
    senseStep(s, recruiter, STEP, world({ noises: near, grid: stubGrid(true) }));
    expect(s.targetX).toBe(3);
    expect(s.stale).toBe(true);
  });

  it('ignores a sound beyond its radius', () => {
    const s = createSense(recruiter, 0);
    run(s, recruiter, 1, { noises: far, grid: stubGrid(true) });
    expect(s.state).toBe('unaware');
  });

  it('is ignored entirely once alerted', () => {
    const s = createSense(recruiter, 0);
    run(s, recruiter, 2);
    expect(s.state).toBe('alerted');
    const before = { x: s.targetX, z: s.targetZ };
    run(s, recruiter, 0.1, { noises: near, grid: stubGrid(true) });
    expect(s.targetX).toBe(before.x);
  });

  it('is deaf when the profile says so', () => {
    const deaf: SenseProfile = { ...recruiter, hearing: 0 };
    const s = createSense(deaf, 0);
    run(s, deaf, 1, { noises: near, grid: stubGrid(true) });
    expect(s.state).toBe('unaware');
  });
});

describe('the anti-wallhack invariant', () => {
  it('never moves the believed target on a step with no sighting and no noise', () => {
    const s = createSense(recruiter, 0);
    run(s, recruiter, 2);
    const seenAt = { x: s.targetX, z: s.targetZ };

    // The player keeps moving, behind a wall. The enemy must not follow.
    for (let i = 0; i < 600; i++) {
      senseStep(
        s,
        recruiter,
        STEP,
        world({ bodyX: 10 + i * 0.1, bodyZ: i * 0.05, grid: stubGrid(true) }),
      );
      expect(s.targetX).toBe(seenAt.x);
      expect(s.targetZ).toBe(seenAt.z);
    }
  });
});

describe('locked profiles', () => {
  it('keeps the boss permanently alerted and always on target', () => {
    const boss = SENSE_PROFILES.boss;
    const s = createSense(boss, 0);
    run(s, boss, 10, { grid: stubGrid(true), bodyX: 42, bodyZ: -7 });
    expect(s.state).toBe('alerted');
    expect(s.canSee).toBe(true);
    expect(s.targetX).toBe(42);
    expect(s.targetZ).toBe(-7);
  });

  it('keeps the stampede permanently unaware and blind', () => {
    const blind = SENSE_PROFILES.blind;
    const s = createSense(blind, 0);
    run(s, blind, 10, { noises: [{ x: 0, z: 0, radius: 999 }] });
    expect(s.state).toBe('unaware');
    expect(s.canSee).toBe(false);
  });

  it('cannot be alerted by damage', () => {
    const boss = SENSE_PROFILES.boss;
    const s = createSense(boss, 0);
    alertFrom(s, boss, 1, 1);
    expect(s.targetX).toBe(0);
  });
});

describe('alertFrom', () => {
  it('jumps straight to alerted and points at the shooter', () => {
    const s = createSense(recruiter, 0);
    alertFrom(s, recruiter, -4, 9);
    expect(s.state).toBe('alerted');
    expect(s.targetX).toBe(-4);
    expect(s.targetZ).toBe(9);
    expect(s.stale).toBe(true);
  });
});

describe('looking', () => {
  it('turns toward the target at the profile turn rate, not instantly', () => {
    const s = createSense(recruiter, 0);
    // Spot something at 90 degrees; the cone must sweep, not snap.
    alertFrom(s, recruiter, 0, 10);
    senseStep(s, recruiter, STEP, world({ bodyX: 0, bodyZ: 10, grid: stubGrid(true) }));
    expect(s.lookYaw).toBeGreaterThan(0);
    expect(s.lookYaw).toBeLessThanOrEqual(recruiter.turnRate * STEP + 1e-9);
  });

  it('sweeps only while unaware', () => {
    const s = createSense(recruiter, 0);
    run(s, recruiter, 0.3, { grid: stubGrid(true) });
    expect(s.sweep).toBeGreaterThan(0);

    alertFrom(s, recruiter, 5, 5);
    const frozen = s.sweep;
    run(s, recruiter, 0.3, { grid: stubGrid(true) });
    expect(s.sweep).toBe(frozen);
  });
});

describe('conspicuousness', () => {
  it('is spotted sooner when hauling everything', () => {
    const light = createSense(recruiter, 0);
    const heavy = createSense(recruiter, 0);
    const seconds = recruiter.noticeSeconds - 0.05;
    run(light, recruiter, seconds, { conspicuous: 0 });
    run(heavy, recruiter, seconds, { conspicuous: 1 });
    expect(light.state).toBe('unaware');
    expect(heavy.state).toBe('suspicious');
  });

  it('is spotted from further away when hauling everything', () => {
    const beyond = recruiter.reach + 3;
    const light = createSense(recruiter, 0);
    const heavy = createSense(recruiter, 0);
    run(light, recruiter, 2, { bodyX: beyond, conspicuous: 0 });
    run(heavy, recruiter, 2, { bodyX: beyond, conspicuous: 1 });
    expect(light.state).toBe('unaware');
    expect(heavy.state).not.toBe('unaware');
  });
});

describe('the extraction floor', () => {
  it('drags an unaware enemy up to the floor and points it at the pad', () => {
    const s = createSense(recruiter, 0);
    run(s, recruiter, 0.5, {
      grid: stubGrid(true),
      floorState: 'suspicious',
      floorX: 60,
      floorZ: 70,
    });
    expect(s.state).toBe('suspicious');
    expect(s.targetX).toBe(60);
    expect(s.targetZ).toBe(70);
  });

  it('does not demote an already alerted enemy', () => {
    const s = createSense(recruiter, 0);
    run(s, recruiter, 2);
    run(s, recruiter, 0.2, { floorState: 'suspicious' });
    expect(s.state).toBe('alerted');
  });
});

describe('determinism', () => {
  it('produces identical state from identical inputs', () => {
    const a = createSense(recruiter, 0);
    const b = createSense(recruiter, 0);
    const noises: Noise[] = [{ x: 4, z: 4, radius: 10 }];
    for (let i = 0; i < 300; i++) {
      const over = { bodyX: 6 + Math.sin(i) * 3, bodyZ: Math.cos(i) * 4, noises, seed: 7 };
      senseStep(a, recruiter, STEP, world(over));
      senseStep(b, recruiter, STEP, world(over));
    }
    expect(a).toEqual(b);
  });
});
