import { Color } from 'three';

/**
 * One palette for the whole game. Imported meshes get their pack materials
 * overridden with these, which is what keeps mixed-source CC0 assets from
 * looking like a rummage sale.
 *
 * Terminal-brutalist: near-black environment, git green for you and yours,
 * amber for meetings, hot pink for hostiles.
 */
export const PALETTE = {
  void: 0x05070a,
  fog: 0x070b10,

  floor: 0x18222c,
  floorLine: 0x2c4150,
  floorLineMajor: 0x53788c,

  wall: 0x27333f,
  wallTop: 0x33424f,
  wallEdge: 0x4a6374,
  cover: 0x2e3d4a,

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
