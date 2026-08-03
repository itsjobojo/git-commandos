import { PALETTE } from './palette';
import { strideCadence, type HumanoidSpec } from './humanoid';

/**
 * Every number that decides how a character *looks*, in one file.
 *
 * The bodies themselves come out of `humanoid.ts`; this is the casting sheet.
 * Identity hues come from `PALETTE` so the game still reads as one palette;
 * the neutral darks stay local, exactly as the entities used to hardcode them.
 *
 * Two rules when tuning these:
 *
 * 1. A rig's half-width is `0.2925 · height · bulk` (the arms, not the
 *    shoulders, are the widest part). It must stay inside the entity's
 *    collision radius or the body clips through walls its circle clears. Each
 *    spec below records the radius it was checked against.
 * 2. `cadencePerSpeed` is derived from the leg with `strideCadence`, never
 *    typed in. Leg length is `0.44 · height`.
 * 3. Trousers have to read against the floor (`PALETTE.floor`, 0x18222c). The
 *    first pass used near-black legs on every archetype and every one of them
 *    rendered as a torso hovering over its own shadow.
 */

export type CastId = 'player' | 'intern' | 'recruiter' | 'ai-bro' | 'organizer' | 'invite-swarm';

const IDLE_CADENCE = 1.4;
const MAX_CADENCE = 16;

const PLAYER_H = 1.64;
const INTERN_H = 1.2;
const RECRUITER_H = 1.52;
const BRO_H = 1.66;
const ORGANIZER_H = 1.56;
const SWARM_H = 2.6;

/** Leg length, for the cadence derivation. */
const leg = (height: number): number => 0.44 * height;

export const CAST: Readonly<Record<CastId, HumanoidSpec>> = {
  /**
   * The commando. Helmet, chest rig, and the backpack the cargo stack rides
   * behind.
   *
   * Bulked up to 1.10 — half-width 0.528 against a 0.55 radius, which is as
   * wide as it can legally go. The capsule this replaced was 0.84 across, and a
   * body of average build simply lost too much mass on screen next to it.
   *
   * The helmet is green rather than black: from a camera pitched 57° down you
   * are mostly looking at the top of someone's head, so the helmet is the one
   * surface that has to carry "this is you". The visor stays near-black, which
   * is what tells you which way the head is pointing.
   *
   * The emissive is well below the old capsule's 0.6: a rig has roughly twice
   * the lit surface, and a player who out-glows their own cargo is the exact
   * failure `crate.ts` records.
   */
  player: {
    key: 'player',
    height: PLAYER_H,
    bulk: 1.1,
    colours: {
      garment: PALETTE.player,
      legs: 0x1d7a4a,
      boot: 0x0d1a14,
      skin: 0x1e2a24,
      gear: 0x2f8f5c,
    },
    headgear: 'helmet',
    legs: 'walk',
    arms: { left: 'swing', right: 'swing' },
    armPose: { left: [0, 0.25, 0], right: [0, 0.25, 0] },
    backpack: true,
    extras: {
      torso: [
        // Visor: the dark band that used to be a separate box on the capsule.
        { size: [0.05, 0.09, 0.2], at: [0.135, 0.763, 0], colour: 0x0d1a14 },
        // Chest rig, sitting proud of the torso so it catches the sun.
        { size: [0.06, 0.26, 0.46], at: [0.18, 0.418, 0], colour: 0x0d1a14 },
      ],
    },
    emissive: PALETTE.playerDim,
    emissiveIntensity: 0.3,
    roughness: 0.55,
    gait: {
      fullStrideSpeed: 3.5,
      idleCadence: IDLE_CADENCE,
      cadencePerSpeed: strideCadence(leg(PLAYER_H), 0.62),
      maxCadence: MAX_CADENCE,
      legSwing: 0.62,
      armSwing: 0.34,
      armRest: 0.06,
      bob: 0.05,
      lean: 0.13,
      sway: 0.02,
    },
  },

  /**
   * Small, so a pack reads as a pack. Everything about the gait is too eager:
   * the shortest legs in the cast, the fastest arms, and the deepest lean.
   *
   * Half-width 0.309 against a 0.46 radius.
   */
  intern: {
    key: 'intern',
    height: INTERN_H,
    bulk: 0.88,
    colours: {
      garment: 0x9ca9c9,
      legs: 0x59647a,
      boot: 0x232a34,
      skin: 0xc9d4e6,
      gear: 0x4a5468,
    },
    headgear: 'none',
    legs: 'walk',
    arms: { left: 'swing', right: 'swing' },
    armPose: { left: [0, 0.3, 0], right: [0, 0.3, 0] },
    backpack: true,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.75,
    gait: {
      fullStrideSpeed: 3,
      idleCadence: IDLE_CADENCE,
      cadencePerSpeed: strideCadence(leg(INTERN_H), 0.55),
      maxCadence: MAX_CADENCE,
      legSwing: 0.55,
      armSwing: 0.68,
      armRest: 0.1,
      bob: 0.075,
      lean: 0.2,
      sway: 0.03,
    },
  },

  /**
   * A suit, permanently on the phone. The right arm is frozen in that pose
   * rather than swinging — it costs two fewer draw calls and says more about
   * the character than any amount of animation would.
   *
   * Half-width 0.409 against a 0.50 radius.
   */
  recruiter: {
    key: 'recruiter',
    height: RECRUITER_H,
    bulk: 0.92,
    colours: {
      garment: PALETTE.hostile,
      legs: 0x6b3450,
      boot: 0x1a1016,
      skin: 0xf9d2e4,
      gear: 0x0d1117,
    },
    headgear: 'none',
    legs: 'walk',
    arms: { left: 'swing', right: 'fixed' },
    armPose: { left: [0, 0.28, 0], right: [0.35, 1.45, 0.3] },
    backpack: false,
    extras: {
      // Authored as if the arm hung straight down — a phone flat against the
      // thigh. The arm's baked rotation then tips it up in front of the face,
      // which is where a phone belongs, with no compensating tilt needed.
      rightHand: [{ size: [0.05, 0.16, 0.09], at: [0.02, 0, 0], colour: 0x0d1117 }],
    },
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.6,
    gait: {
      fullStrideSpeed: 2.4,
      idleCadence: IDLE_CADENCE,
      cadencePerSpeed: strideCadence(leg(RECRUITER_H), 0.5),
      maxCadence: MAX_CADENCE,
      legSwing: 0.5,
      armSwing: 0.34,
      armRest: 0.08,
      bob: 0.035,
      lean: 0.06,
      sway: 0.015,
    },
  },

  /**
   * The widest body in the cast, backwards cap, laptop carried like a
   * clipboard. Left arm frozen cradling it, right arm still swinging — a
   * stampede of statues is worse than one that jogs.
   *
   * The laptop is merged into the torso rather than the hand: at this size a
   * prop that swings 0.55 radians reads as flailing, not typing.
   *
   * Half-width 0.573 against a 0.62 radius — the tightest in the cast, so
   * check the arithmetic before nudging `bulk`.
   */
  'ai-bro': {
    key: 'ai-bro',
    height: BRO_H,
    bulk: 1.18,
    colours: {
      garment: PALETTE.bro,
      legs: 0x4e5666,
      boot: 0x1a1d23,
      skin: 0xe8b98f,
      gear: 0x2b2f38,
    },
    headgear: 'cap',
    legs: 'walk',
    arms: { left: 'fixed', right: 'swing' },
    armPose: { left: [0.3, 1.3, 0.45], right: [0, 0.3, 0] },
    backpack: false,
    extras: {
      torso: [{ size: [0.52, 0.06, 0.4], at: [0.42, 0.25, 0], tilt: [-0.35, 0], colour: 0x2b2f38 }],
    },
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.72,
    gait: {
      fullStrideSpeed: 3,
      idleCadence: IDLE_CADENCE,
      cadencePerSpeed: strideCadence(leg(BRO_H), 0.72),
      maxCadence: MAX_CADENCE,
      legSwing: 0.72,
      armSwing: 0.55,
      armRest: 0.08,
      bob: 0.09,
      lean: 0.16,
      sway: 0.05,
    },
  },

  /**
   * Robed and cowled — no legs, no stride, it glides. Both arms clasped.
   *
   * The bob is deliberately tiny: the skirt reaches the floor, so bob is
   * literally the robe leaving the ground. 0.014 units is sub-pixel at this
   * camera distance; 0.05 would not be, and a hovering authority figure is a
   * different character.
   *
   * Half-width 0.465, skirt radius 0.460, against a 0.55 radius.
   */
  organizer: {
    key: 'organizer',
    height: ORGANIZER_H,
    bulk: 1.02,
    colours: {
      garment: PALETTE.meeting,
      legs: PALETTE.meeting,
      boot: 0x4a3410,
      skin: 0x6b4c0d,
      // A shade under the robe, so the cowl reads as a separate mass from
      // above rather than melting into the shoulders.
      gear: 0xd08a0a,
    },
    headgear: 'cowl',
    legs: 'robe',
    arms: { left: 'fixed', right: 'fixed' },
    armPose: { left: [0.25, 1.5, 0.55], right: [0.25, 1.5, 0.55] },
    backpack: false,
    emissive: PALETTE.meeting,
    emissiveIntensity: 0.28,
    roughness: 0.55,
    gait: {
      fullStrideSpeed: 1.6,
      idleCadence: IDLE_CADENCE,
      // No legs to derive from — this only has to drive the robe's breath.
      cadencePerSpeed: 0.9,
      maxCadence: 4,
      legSwing: 0,
      armSwing: 0,
      armRest: 0,
      bob: 0.014,
      lean: 0,
      sway: 0.02,
    },
  },

  /**
   * The mini-boss: head and shoulders above anything else on the map, both arms
   * locked overhead, hurling invites out of the thing it is holding up there.
   *
   * It used to be a giant Outlook icon with no body at all, which made it a
   * floating logo rather than an antagonist. Somebody has to be sending these.
   *
   * Half-width 1.027 against a 1.5 radius — the roomiest in the cast, because
   * the collision circle was sized for the old floating icon.
   */
  'invite-swarm': {
    key: 'invite-swarm',
    height: SWARM_H,
    bulk: 1.35,
    colours: {
      garment: PALETTE.invite,
      legs: 0x2f5a8c,
      boot: 0x0f1c2e,
      skin: 0xdbeafe,
      gear: 0x1e3a5f,
    },
    headgear: 'cowl',
    legs: 'walk',
    // Both arms frozen overhead. It never lowers them and it never stops.
    arms: { left: 'fixed', right: 'fixed' },
    armPose: { left: [2.5, 0.25, 0.1], right: [2.5, 0.25, 0.1] },
    backpack: false,
    emissive: PALETTE.invite,
    emissiveIntensity: 0.18,
    roughness: 0.5,
    gait: {
      fullStrideSpeed: 2.5,
      idleCadence: IDLE_CADENCE,
      cadencePerSpeed: strideCadence(leg(SWARM_H), 0.5),
      maxCadence: MAX_CADENCE,
      legSwing: 0.5,
      armSwing: 0,
      armRest: 0,
      bob: 0.06,
      lean: 0.05,
      sway: 0.03,
    },
  },
};
