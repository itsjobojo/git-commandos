import { describe, expect, it } from 'vitest';
import {
  CHIPTUNE_WORKLET,
  MUSIC_FALLBACK,
  MUSIC_TRACK,
  SOUND_BANKS,
  type SoundBank,
} from './manifest';

/**
 * A wrong path in the manifest is silent: the fetch 404s, the buffer never
 * decodes, and that cue simply never makes a sound. Nothing throws and nothing
 * in the game looks broken — which is exactly why this is worth a test.
 *
 * Everything here is served out of `public/`, which Vite copies to `dist/`.
 */
const SHIPPED = new Set(Object.keys(import.meta.glob('/public/**/*')));

function exists(path: string): boolean {
  return SHIPPED.has(`/public/${path}`);
}

describe('asset manifest', () => {
  const banks = Object.entries(SOUND_BANKS) as [SoundBank, readonly string[]][];

  it.each(banks)('%s points at files that exist', (_bank, paths) => {
    for (const path of paths) {
      expect(exists(path), `missing ${path}`).toBe(true);
    }
  });

  it('has no empty banks — a bank with no takes is a silent cue', () => {
    for (const [bank, paths] of banks) {
      expect(paths.length, `${bank} is empty`).toBeGreaterThan(0);
    }
  });

  it('ships the music and the worklet that plays it', () => {
    expect(exists(MUSIC_TRACK), MUSIC_TRACK).toBe(true);
    if (MUSIC_FALLBACK) expect(exists(MUSIC_FALLBACK), MUSIC_FALLBACK).toBe(true);
    // Copied out of node_modules by the postinstall step, so it is the one
    // asset here that is absent until someone has installed dependencies.
    expect(exists(CHIPTUNE_WORKLET), CHIPTUNE_WORKLET).toBe(true);
  });

  it('uses document-relative paths, so the build works from any base', () => {
    const all = [
      ...banks.flatMap(([, paths]) => paths),
      MUSIC_TRACK,
      ...(MUSIC_FALLBACK ? [MUSIC_FALLBACK] : []),
      CHIPTUNE_WORKLET,
    ];
    for (const path of all) {
      expect(path.startsWith('/'), `${path} is absolute`).toBe(false);
    }
  });
});
