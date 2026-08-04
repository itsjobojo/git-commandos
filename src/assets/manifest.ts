/**
 * Every asset path in the game, in one place.
 *
 * ASSETS.md is the licence ledger; this is the code's view of the same list.
 * Nothing else in `src/` should contain an asset path string, so swapping a
 * pack out is a diff to this file and nothing else.
 *
 * Paths are relative to the document, matching Vite's `base: './'` — the same
 * build has to work served from the CLI's dev server and from `dist/`.
 */

/**
 * Sound banks: one entry per set of interchangeable takes.
 *
 * A bank, not a file, is what a cue names — repetition is what makes a game
 * sound cheap, and the cheapest fix is three recordings of the same event.
 * These are Kenney's Digital Audio / Impact packs, grouped by what they sound
 * like rather than by the pack's own naming.
 */
export const SOUND_BANKS = {
  /** Dry crack — the sidearm. */
  shootLight: ['sounds/shoot-a.ogg', 'sounds/shoot-b.ogg'],
  /** Thin and short, because it plays thirteen times a second. */
  shootFast: ['sounds/shoot-e.ogg', 'sounds/shoot-f.ogg'],
  /** Heavy — the shotgun. */
  shootHeavy: ['sounds/shoot-c.ogg', 'sounds/shoot-d.ogg'],
  /** Deliberately not one of the player's guns, so incoming reads as incoming. */
  shootEnemy: ['sounds/shoot-g.ogg', 'sounds/shoot-h.ogg'],
  explosion: ['sounds/explosion-a.ogg', 'sounds/explosion-b.ogg', 'sounds/explosion-c.ogg'],
  /** Bullet-on-body ticks. Short enough to survive being played constantly. */
  impact: ['sounds/move-a.ogg', 'sounds/move-b.ogg', 'sounds/move-c.ogg', 'sounds/move-d.ogg'],
  /** You, taking one. */
  hurt: ['sounds/hurt-a.ogg', 'sounds/hurt-b.ogg'],
  /** Something else going down. */
  thud: ['sounds/hurt-c.ogg', 'sounds/hurt-d.ogg', 'sounds/hurt-e.ogg'],
  jump: [
    'sounds/jump-a.ogg',
    'sounds/jump-b.ogg',
    'sounds/jump-c.ogg',
    'sounds/jump-d.ogg',
    'sounds/jump-e.ogg',
    'sounds/jump-f.ogg',
  ],
  fall: ['sounds/fall-a.ogg', 'sounds/fall-b.ogg'],
  coin: ['sounds/coin-a.ogg', 'sounds/coin-b.ogg', 'sounds/coin-c.ogg', 'sounds/coin-d.ogg'],
  error: ['sounds/error-a.ogg', 'sounds/error-b.ogg', 'sounds/error-c.ogg'],
  /** Short bad news — a file bleeding out, a meeting missed. */
  alarm: ['sounds/lose-c.ogg', 'sounds/lose-d.ogg'],
  /** Long bad news. Rationed: it means the run just changed shape. */
  stinger: ['sounds/lose-a.ogg', 'sounds/lose-b.ogg'],
  select: ['sounds/select-a.ogg'],
} as const;

export type SoundBank = keyof typeof SOUND_BANKS;

/**
 * The soundtrack. Switching tracks is this one line.
 *
 * A tracker module (`.xm`, `.it`, `.mod`, `.s3m`) is rendered by libopenmpt in
 * a worklet; anything the browser can decode on its own is played straight.
 * `systems/music.ts` picks the engine off the extension, so both stay working
 * — but only this file ships a track, so dropping a module back in means
 * adding the file as well as changing this line.
 */
export const MUSIC_TRACK = 'music/juhani-junkala-retro-game-music-pack-level-1.mp3';
/**
 * Played only if `MUSIC_TRACK` is a tracker module and libopenmpt won't start
 * — it is a rendered copy of the chiptune, so it is only a sane fallback while
 * the chiptune is the track. Null when there is nothing to fall back to.
 */
export const MUSIC_FALLBACK: string | null = null;
/**
 * chiptune3's AudioWorklet, copied into `public/audio/` by the postinstall
 * step. The library resolves this itself against `import.meta.url`, which is
 * wrong once bundled — `systems/music.ts` redirects it here.
 */
export const CHIPTUNE_WORKLET = 'audio/chiptune3.worklet.js';

/** The title lockup, shown on the briefing screen. Lossless WebP, transparent. */
export const LOGO = 'gcms-logo.webp';
