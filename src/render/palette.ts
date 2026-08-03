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

  player: 0x4ade80,
  playerDim: 0x166534,

  crate: 0x7dd3fc,
  crateDecay: 0xf87171,
  stash: 0xa78bfa,

  extraction: 0x4ade80,
  meeting: 0xfbbf24,
  meetingOptional: 0x6b7d79,

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
