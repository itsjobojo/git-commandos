import { Color } from 'three';

/**
 * One palette for the whole game. Imported meshes get their pack materials
 * overridden with these, which is what keeps mixed-source CC0 assets from
 * looking like a rummage sale.
 *
 * Terminal-brutalist: near-black environment, git green for you and yours,
 * amber for meetings, hot pink for hostiles.
 */
/**
 * The environment sits a stop lower than it used to, along with the lighting
 * rig. Only the ground, the walls and the air move: the gameplay colours below
 * are untouched, so a darker city is also a higher-contrast one — your green,
 * the crate cyan and the hostile pink all read further across a map that is now
 * three times the size.
 */
export const PALETTE = {
  void: 0x030507,
  fog: 0x05080c,

  floor: 0x141c25,
  floorLine: 0x243746,
  floorLineMajor: 0x476a7d,

  wall: 0x222d38,
  wallTop: 0x2d3b47,
  wallEdge: 0x43596a,
  cover: 0x28353f,

  /**
   * Parks. Deliberately dark and desaturated: the player is git green
   * (`player`, several stops brighter), and a park has to read as a change of
   * ground without ever competing with the thing you are steering.
   */
  grass: 0x16281b,
  grassLight: 0x223d27,
  bark: 0x241d19,
  foliage: 0x1e3a24,
  foliageLight: 0x2c5233,
  /** Weathered slats. A shade up from bark so a bench reads as a thing, not a stump. */
  bench: 0x3b3028,
  bush: 0x1b3320,
  /**
   * Street clutter. Deliberately drab and nowhere near `crate` — that cyan
   * means "your files are in this", and a pile of scenery wearing it would have
   * you running across the map for a packing box.
   */
  boxProp: 0x39322a,
  lampPost: 0x1e242b,
  /** Sodium. Warm, so a lit street reads apart from the cold monitor glow. */
  lampLight: 0xffc978,

  player: 0x4ade80,
  playerDim: 0x166534,

  crate: 0x7dd3fc,
  crateDecay: 0xf87171,
  stash: 0xa78bfa,

  extraction: 0x4ade80,
  /** Mandatory meetings — a shelter you're compelled to visit. */
  meeting: 0xfbbf24,
  /** Avoid blobs — step in and you're in molasses. */
  meetingAvoid: 0xef4444,

  hostile: 0xf472b6,
  bro: 0xfb923c,
  invite: 0x60a5fa,

  muzzle: 0xfef08a,
  tracer: 0xfde047,
} as const;

export type PaletteKey = keyof typeof PALETTE;

const cache = new Map<number, Color>();

/** Cached Color instances — never allocate one per frame. */
export function color(hex: number): Color {
  let c = cache.get(hex);
  if (!c) {
    c = new Color(hex);
    cache.set(hex, c);
  }
  return c;
}
