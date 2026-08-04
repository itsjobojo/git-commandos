import { PALETTE } from './palette';
import { strideCadence, type HumanoidSpec } from './humanoid';

/**
 * Every number that decides how a character *looks*, in one file.
 *
 * The bodies themselves come out of `humanoid.ts`; this is the casting sheet.
 * Identity hues come from `PALETTE` so the game still reads as one palette;
 * the neutral darks stay local, exactly as the entities used to hardcode them.
 *
 * Three rules when tuning these:
 *
 * 1. A rig's half-width must stay inside the entity's collision radius, or the
 *    body clips through walls its circle clears. Whichever of these is largest:
 *      - upper arm:      `0.2575 · height · bulk`
 *      - glove:          `0.205 · height · bulk + 0.0625 · height`
 *      - pauldron:       `0.205 · height · bulk + 0.0975 · height`
 *      - shoulder yoke:  `0.2 · height · bulk`
 *    The glove wins on lean builds and the pauldron on armoured ones. Each spec
 *    below records the widest part and the radius it was checked against.
 * 2. `cadencePerSpeed` comes from `strideCadence(topSpeed, stepsAtTopSpeed)`,
 *    and `topSpeed` is the entity's own fastest state — a lunging intern, a
 *    rallied bro — not its cruise. Read that function before picking a number;
 *    the intuitive derivation is the wrong one.
 * 3. Trousers have to read against the floor (`PALETTE.floor`, 0x18222c). The
 *    first pass used near-black legs on every archetype and every one of them
 *    rendered as a torso hovering over its own shadow.
 */

export type CastId = 'player' | 'intern' | 'recruiter' | 'ai-bro' | 'organizer' | 'invite-swarm';

const IDLE_CADENCE = 1.4;
/**
 * Pure backstop. Every archetype's cadence at its own top speed is well under
 * this — when it binds, legs stop tracking speed. It used to be 16 against
 * derived cadences of 30–68, so it bound permanently, and the entire cast ran
 * its legs at one fixed rate no matter how fast it was actually moving.
 */
const MAX_CADENCE = 22;

const PLAYER_H = 1.64;
const INTERN_H = 1.2;
const RECRUITER_H = 1.52;
const BRO_H = 1.66;
const ORGANIZER_H = 1.56;
const SWARM_H = 2.6;

export const CAST: Readonly<Record<CastId, HumanoidSpec>> = {
  /**
   * The commando. Plate armour, a domed helmet, chest rig, and the backpack the
   * cargo stack rides behind.
   *
   * Bulk 1.10, pauldron half-width 0.530 against a 0.55 radius, which is as
   * wide as it can legally go. The capsule this replaced was 0.84 across, and a
   * body of average build simply lost too much mass on screen next to it.
   *
   * The helmet is green rather than black: from a camera pitched 57° down you
   * are mostly looking at the top of someone's head, so the helmet is the one
   * surface that has to carry "this is you". The brow overhangs a near-black
   * visor, which is what tells you which way the head is pointing.
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
    armour: 'plate',
    legs: 'walk',
    arms: { left: 'swing', right: 'swing' },
    armPose: { left: [0, 0.25, 0], right: [0, 0.25, 0] },
    backpack: true,
    extras: {
      // Absolute units, hip-local — not fractions of height like the rig itself.
      torso: [
        // Visor. Set back from the brow above it, so it sits in shadow.
        { size: [0.05, 0.11, 0.3], at: [0.195, 0.68, 0], colour: 0x0d1a14 },
        // Chest rig, sitting proud of the torso so it catches the sun.
        { size: [0.055, 0.2, 0.5], at: [0.2, 0.36, 0], colour: 0x0d1a14 },
        // Belt. Breaks the drop from chest plate to boot, which otherwise runs
        // as one unbroken green column.
        { size: [0.055, 0.07, 0.33], at: [0.165, 0.12, 0], colour: 0x0d1a14 },
      ],
    },
    emissive: PALETTE.playerDim,
    emissiveIntensity: 0.3,
    roughness: 0.55,
    gait: {
      // Opens across most of the real speed range rather than pinning at the
      // first nudge — a walk out of cover has to look different from a sprint.
      fullStrideSpeed: 5.5,
      idleCadence: IDLE_CADENCE,
      // 4.2 steps/s at the 11.6 sprint, 3.0 at the 8.2 walk.
      cadencePerSpeed: strideCadence(11.6, 4.2),
      maxCadence: MAX_CADENCE,
      legSwing: 0.4,
      armSwing: 0.26,
      armRest: 0.06,
      bob: 0.035,
      lean: 0.1,
      sway: 0.015,
    },
  },

  /**
   * Small, so a pack reads as a pack. Everything about the gait is too eager:
   * the shortest legs in the cast, the fastest arms, and the deepest lean.
   *
   * Glove half-width 0.292 against a 0.46 radius.
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
    armour: 'none',
    legs: 'walk',
    arms: { left: 'swing', right: 'swing' },
    armPose: { left: [0, 0.3, 0], right: [0, 0.3, 0] },
    backpack: true,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.75,
    gait: {
      fullStrideSpeed: 5,
      idleCadence: IDLE_CADENCE,
      // Top speed is the 12.5 lunge, not the 7.4 cruise: the whole point of an
      // intern is that the last few metres come in faster than you expected,
      // and the legs are what has to sell it.
      cadencePerSpeed: strideCadence(12.5, 5.2),
      maxCadence: MAX_CADENCE,
      legSwing: 0.38,
      armSwing: 0.46,
      armRest: 0.1,
      bob: 0.05,
      lean: 0.15,
      sway: 0.025,
    },
  },

  /**
   * A suit, permanently on the phone. The right arm is frozen in that pose
   * rather than swinging — it costs two fewer draw calls and says more about
   * the character than any amount of animation would.
   *
   * Glove half-width 0.382 against a 0.50 radius.
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
    armour: 'none',
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
      fullStrideSpeed: 4,
      idleCadence: IDLE_CADENCE,
      // 2.8 steps/s when repositioning, under one a second on the idle drift —
      // a suit that saunters until it decides you are worth walking towards.
      cadencePerSpeed: strideCadence(6.6, 2.8),
      maxCadence: MAX_CADENCE,
      legSwing: 0.34,
      armSwing: 0.26,
      armRest: 0.08,
      bob: 0.028,
      lean: 0.06,
      sway: 0.012,
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
   * Glove half-width 0.505 against a 0.62 radius.
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
    armour: 'none',
    legs: 'walk',
    arms: { left: 'fixed', right: 'swing' },
    armPose: { left: [0.3, 1.3, 0.45], right: [0, 0.3, 0] },
    backpack: false,
    extras: {
      torso: [{ size: [0.5, 0.06, 0.4], at: [0.4, 0.3, 0], tilt: [-0.35, 0], colour: 0x2b2f38 }],
    },
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.72,
    gait: {
      fullStrideSpeed: 4.6,
      idleCadence: IDLE_CADENCE,
      // Top speed is the 6.6 cruise times the 1.75 rally cap. A herd that has
      // lost members has to visibly pick up the pace, not just cover ground.
      cadencePerSpeed: strideCadence(11.55, 5.4),
      maxCadence: MAX_CADENCE,
      legSwing: 0.46,
      armSwing: 0.36,
      armRest: 0.08,
      bob: 0.055,
      lean: 0.12,
      sway: 0.035,
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
   * Skirt radius 0.484 — the widest part — against a 0.55 radius.
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
    armour: 'none',
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
   * Upper-arm half-width 0.904 against a 1.5 radius — the roomiest in the cast,
   * because the collision circle was sized for the old floating icon.
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
    armour: 'none',
    legs: 'walk',
    // Both arms frozen overhead. It never lowers them and it never stops.
    arms: { left: 'fixed', right: 'fixed' },
    armPose: { left: [2.5, 0.25, 0.1], right: [2.5, 0.25, 0.1] },
    backpack: false,
    emissive: PALETTE.invite,
    emissiveIntensity: 0.18,
    roughness: 0.5,
    gait: {
      fullStrideSpeed: 1.8,
      idleCadence: IDLE_CADENCE,
      // Barely over one step a second. The only thing in the cast slow enough
      // that its feet very nearly do stay planted.
      cadencePerSpeed: strideCadence(2.1, 1.2),
      maxCadence: MAX_CADENCE,
      legSwing: 0.34,
      armSwing: 0,
      armRest: 0,
      bob: 0.045,
      lean: 0.04,
      sway: 0.025,
    },
  },
};
