import { angleDelta } from '../entities/entity';
import type { Grid } from '../world/grid';

/**
 * What an enemy knows about you, and how it found out.
 *
 * Enemies used to be handed your exact position every step, which reads as
 * unfair for a good reason: it is. This file is the whole correction — a cone,
 * a raycast and four clocks. Everything else in the stealth layer (cones on
 * screen, the noise a gunshot makes, an archetype deciding to charge) is either
 * a renderer for this state or a consumer of it.
 *
 * It is deliberately free of Three.js and of `Enemy`, because a state machine
 * you can only exercise by playing the game is a state machine nobody will
 * check. `SenseWorld` takes a structural grid, so a test passes a stub.
 */
export type Awareness = 'unaware' | 'suspicious' | 'alerted';

const RANK: Record<Awareness, number> = { unaware: 0, suspicious: 1, alerted: 2 };

/**
 * One enemy's private picture of the world.
 *
 * Plain data with no methods: every rule that reads or writes it lives in this
 * file, so there is exactly one place where "does it know where you are" can be
 * answered — and exactly one place to get it wrong.
 */
export interface Sense {
  state: Awareness;
  /** Unbroken line of sight, inside the cone, this step. */
  canSee: boolean;
  /**
   * Where it *believes* you are. Frozen at the last confirmation, so a
   * suspicious enemy walks to where you were, not to where you went.
   */
  targetX: number;
  targetZ: number;
  /** True while the target is a memory rather than a live sighting. */
  stale: boolean;
  /**
   * Seconds since anything last confirmed your position — a sighting *or* a
   * noise. Drives forgetting.
   */
  sinceSeen: number;
  /** Seconds of unbroken current sighting. Reset by a state change. */
  contact: number;
  /** Seconds in the current state. Drives the ?/! pop and the cone tween. */
  inState: number;
  /**
   * Where the cone points. Lags the body: the gap between this and `yaw` is
   * what "turns to look" actually looks like.
   */
  lookYaw: number;
  /** Idle head-sweep phase. Advances only while unaware. */
  sweep: number;
  /** Live cone dimensions after state and conspicuousness scaling. */
  halfAngle: number;
  reach: number;
}

/**
 * Per-archetype senses. Immutable data, so archetypes differ in numbers rather
 * than in five copies of a state machine that have to agree.
 */
export interface SenseProfile {
  /** Half-angle of the vision cone, radians. 0 means no cone is drawn. */
  readonly halfAngle: number;
  readonly reach: number;
  /** Reach multiplier once it is looking for you — eyes widen. */
  readonly alertReachScale: number;
  /** 360° awareness inside this radius. You cannot sneak into someone's elbow. */
  readonly peripheral: number;
  /** Unbroken sighting needed for unaware -> suspicious. */
  readonly noticeSeconds: number;
  /** ...and again for suspicious -> alerted. */
  readonly confirmSeconds: number;
  /** Silence needed to stop chasing: alerted -> suspicious. */
  readonly loseSeconds: number;
  /**
   * Silence needed to give up entirely: suspicious -> unaware.
   *
   * Both clocks run from the *same* last stimulus rather than from entering the
   * state, so this is a total and must exceed `loseSeconds`. Measuring the
   * second one from the demotion instead would mean a noise that only ever got
   * an enemy to suspicious costs it the full `lose + forget` to shake off,
   * which is not what either number reads as.
   */
  readonly forgetSeconds: number;
  /** How fast the cone swings toward what it wants to look at, rad/s. */
  readonly turnRate: number;
  readonly sweepAmplitude: number;
  readonly sweepRate: number;
  /** Multiplier on how far a noise carries. 0 is deaf. */
  readonly hearing: number;
  /**
   * Pinned to this state forever. The boss is always `alerted` (sneaking past
   * the set piece is anticlimactic) and the AI-bro stampede is always
   * `unaware`, because it is a hazard rather than a hunter and never reads the
   * player at all.
   */
  readonly locked: Awareness | null;
}

/** A sound. Not blocked by walls — going round corners is what makes it hearing. */
export interface Noise {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
}

/**
 * Everything the rule is allowed to know.
 *
 * Structural rather than `Grid` so tests need no world, and pointedly missing
 * an `Rng`: the mission RNG also lays out the map and paces the director, and
 * its draw *order* is load-bearing. One draw per enemy per step would reshuffle
 * the level for a given commit message. Per-enemy variation comes from `seed`
 * instead, and the missing field makes that a compile error rather than a
 * convention.
 */
export interface SenseWorld {
  readonly x: number;
  readonly z: number;
  /** Body facing. The cone chases this; it does not equal it. */
  readonly yaw: number;
  /** Stable per-entity offset — pass `enemy.id`. */
  readonly seed: number;
  /** Your actual position. Only this file is allowed to compare against it. */
  readonly bodyX: number;
  readonly bodyZ: number;
  /** 0..1 cargo load. Hauling more makes you seen further off and sooner. */
  readonly conspicuous: number;
  readonly noises: readonly Noise[];
  /**
   * Floor the state at this, for the extraction hold: the beacon is a light
   * column built to be visible from anywhere on the map, so nobody gets to be
   * unaware while it is running. `floorX`/`floorZ` are where it draws them.
   */
  readonly floorState: Awareness | null;
  readonly floorX: number;
  readonly floorZ: number;
  readonly grid: Pick<Grid, 'hasLineOfSight' | 'isSolidWorld'>;
}

export const SENSE_PROFILES = {
  /** Ranged, patient, and the only thing that shoots back from a distance. */
  recruiter: {
    halfAngle: 0.6,
    // Matches its own firing gate, so the cone is exactly the danger zone.
    reach: 17,
    alertReachScale: 1.25,
    peripheral: 5,
    noticeSeconds: 0.45,
    confirmSeconds: 0.35,
    loseSeconds: 2.6,
    forgetSeconds: 7,
    turnRate: 3.4,
    sweepAmplitude: 0.7,
    sweepRate: 0.9,
    hearing: 1,
    locked: null,
  },
  /** Notices late, then commits totally. An omniscient rusher is undodgeable. */
  intern: {
    halfAngle: 0.5,
    reach: 12,
    alertReachScale: 1.4,
    peripheral: 4,
    noticeSeconds: 0.15,
    confirmSeconds: 0.1,
    loseSeconds: 3.2,
    forgetSeconds: 6,
    turnRate: 5,
    sweepAmplitude: 0.5,
    sweepRate: 1.6,
    hearing: 1.1,
    locked: null,
  },
  /** The mini-boss. Arrives with a banner; there is nothing to sneak past. */
  boss: {
    halfAngle: 0,
    reach: 0,
    alertReachScale: 1,
    peripheral: 0,
    noticeSeconds: 0,
    confirmSeconds: 0,
    loseSeconds: 0,
    forgetSeconds: 0,
    turnRate: 0,
    sweepAmplitude: 0,
    sweepRate: 0,
    hearing: 0,
    locked: 'alerted',
  },
  /** No eyes, no cone, no opinion — the stampede. */
  blind: {
    halfAngle: 0,
    reach: 0,
    alertReachScale: 1,
    peripheral: 0,
    noticeSeconds: 0,
    confirmSeconds: 0,
    loseSeconds: 0,
    forgetSeconds: 0,
    turnRate: 0,
    sweepAmplitude: 0,
    sweepRate: 0,
    hearing: 0,
    locked: 'unaware',
  },
} as const satisfies Record<string, SenseProfile>;

export type SenseProfileId = keyof typeof SENSE_PROFILES;

export function createSense(profile: SenseProfile, yaw: number): Sense {
  return {
    state: profile.locked ?? 'unaware',
    canSee: profile.locked === 'alerted',
    targetX: 0,
    targetZ: 0,
    stale: true,
    sinceSeen: Infinity,
    contact: 0,
    inState: 0,
    lookYaw: yaw,
    sweep: 0,
    halfAngle: profile.halfAngle,
    reach: profile.reach,
  };
}

/**
 * Advance one enemy's picture of the world by `dt`. Mutates `sense`.
 *
 * Order matters: look, then see, then hear, then decide. Deciding first would
 * let an enemy act on a promotion in the same step it earned it, which reads as
 * a flinch rather than a reaction.
 */
export function senseStep(
  sense: Sense,
  profile: SenseProfile,
  dt: number,
  world: SenseWorld,
): void {
  sense.inState += dt;

  // Pinned profiles skip the machinery entirely. The boss always knows where
  // you are; the stampede never cares.
  if (profile.locked) {
    sense.state = profile.locked;
    sense.canSee = profile.locked === 'alerted';
    sense.halfAngle = profile.halfAngle;
    sense.reach = profile.reach;
    if (sense.canSee) {
      sense.targetX = world.bodyX;
      sense.targetZ = world.bodyZ;
      sense.stale = false;
      sense.sinceSeen = 0;
    }
    sense.lookYaw = world.yaw;
    return;
  }

  // Carrying more makes you louder to look at: seen from further off, and
  // sooner once you are in frame. REBUILD.md called for this and never got it.
  const alerted = sense.state !== 'unaware';
  const reach =
    profile.reach * (alerted ? profile.alertReachScale : 1) * (1 + 0.5 * world.conspicuous);
  sense.halfAngle = profile.halfAngle;
  sense.reach = reach;

  // --- look ---------------------------------------------------------------
  if (sense.state === 'unaware') sense.sweep += dt * profile.sweepRate;
  const want =
    sense.state === 'unaware'
      ? world.yaw + Math.sin(sense.sweep + world.seed) * profile.sweepAmplitude
      : Math.atan2(sense.targetZ - world.z, sense.targetX - world.x);
  const swing = angleDelta(sense.lookYaw, want);
  const step = profile.turnRate * dt;
  sense.lookYaw += Math.abs(swing) <= step ? swing : Math.sign(swing) * step;

  // --- see ----------------------------------------------------------------
  const dx = world.bodyX - world.x;
  const dz = world.bodyZ - world.z;
  const distance = Math.hypot(dx, dz);
  let canSee = false;
  if (profile.halfAngle > 0 && distance <= reach) {
    const inCone =
      distance <= profile.peripheral ||
      Math.abs(angleDelta(sense.lookYaw, Math.atan2(dz, dx))) <= profile.halfAngle;
    if (inCone) {
      // An enemy shoved into a solid cell by the separation pass would fail
      // every raycast forever and go permanently blind. Treat being stuck
      // inside geometry as an unobstructed view rather than a lobotomy.
      canSee =
        world.grid.isSolidWorld(world.x, world.z) ||
        world.grid.hasLineOfSight(world.x, world.z, world.bodyX, world.bodyZ);
    }
  }

  sense.canSee = canSee;
  if (canSee) {
    sense.contact += dt;
    sense.sinceSeen = 0;
    sense.targetX = world.bodyX;
    sense.targetZ = world.bodyZ;
    sense.stale = false;
  } else {
    sense.contact = 0;
    sense.sinceSeen += dt;
    sense.stale = true;
  }

  // --- hear ---------------------------------------------------------------
  // Sound never promotes past suspicious, and the already-alerted ignore it:
  // gunfire tells you *where someone was*, not who or where they are now. That
  // one restriction is what stops a shout chain alerting the entire map from a
  // single contact.
  let heard = false;
  if (sense.state !== 'alerted' && profile.hearing > 0) {
    for (const noise of world.noises) {
      const audible = noise.radius * profile.hearing;
      if (Math.hypot(noise.x - world.x, noise.z - world.z) > audible) continue;
      heard = true;
      if (!canSee) {
        sense.targetX = noise.x;
        sense.targetZ = noise.z;
        sense.stale = true;
      }
      sense.sinceSeen = 0;
    }
  }

  // --- decide -------------------------------------------------------------
  const notice = profile.noticeSeconds / (1 + world.conspicuous);
  let next = sense.state;
  if (sense.state === 'unaware') {
    if (canSee && sense.contact >= notice) next = 'suspicious';
    else if (heard) next = 'suspicious';
  } else if (sense.state === 'suspicious') {
    if (canSee && sense.contact >= profile.confirmSeconds) next = 'alerted';
    else if (sense.sinceSeen >= profile.forgetSeconds) next = 'unaware';
  } else if (sense.sinceSeen >= profile.loseSeconds) {
    next = 'suspicious';
  }

  // The extraction beacon is a light column visible from anywhere on the map,
  // so stealth cannot trivialise the endgame.
  if (world.floorState && RANK[next] < RANK[world.floorState]) {
    next = world.floorState;
    if (!canSee) {
      sense.targetX = world.floorX;
      sense.targetZ = world.floorZ;
      sense.stale = true;
    }
  }

  if (next !== sense.state) transition(sense, next);
}

/**
 * Being shot at tells you where the shooter is regardless of where you were
 * looking. Without this a player standing behind an enemy is invulnerable.
 */
export function alertFrom(sense: Sense, profile: SenseProfile, x: number, z: number): void {
  if (profile.locked) return;
  sense.targetX = x;
  sense.targetZ = z;
  sense.stale = true;
  sense.sinceSeen = 0;
  if (sense.state !== 'alerted') transition(sense, 'alerted');
}

function transition(sense: Sense, next: Awareness): void {
  sense.state = next;
  sense.inState = 0;
  // Each threshold then means what it says: `confirmSeconds` is fresh sighting
  // after being spotted, not a running total since the enemy woke up.
  sense.contact = 0;
  if (next === 'unaware') {
    sense.stale = true;
    sense.sweep = 0;
  }
}
