# Asset ledger

Every third-party asset in this repo, with its source and licence. This is a
published npm package — if it ships in `dist/`, it is listed here.

**Rule:** CC0 only, or a licence with no attribution requirement that permits
commercial redistribution. Anything else does not go in.

Nothing from the pre-rebuild sprite packs (`kenney_desert-shooter-pack_1.0`,
`kenney_tiny-dungeon`, `kenney_top-down-shooter`) or `src/art/sprites.ts`
carries over — all of it was removed in the 3D rebuild (M0), and the 537
leftover PNGs under `public/sprites/` went with the audio pass.

**Everything in `public/` is shipped**, because Vite copies it into `dist/` and
`dist/` is what npm publishes. Nothing belongs there unless the running game
fetches it.

## Current

| Asset | Path | Source | Licence | Added |
|---|---|---|---|---|
| SFX — 40 files (coin, hurt, explosion, jump, fall, error, move, select, shoot) | `public/sounds/*.ogg` | Kenney — Digital Audio / Impact Sounds | CC0 | pre-rebuild |
| Music — the track that plays | `public/music/juhani-junkala-retro-game-music-pack-level-1.mp3` | [Juhani Junkala — Retro Game Music Pack](https://opengameart.org/content/5-chiptunes-action) ("Level 1"), re-encoded from the source WAV to mp3 (libmp3lame, VBR ~166kbps, 1.76MB vs. the source WAV's 12.5MB) | CC0 — stated by the author on the OGA page: *"These music tracks have been released under CC0 creative commons license. You can do anything you want with these tunes."* | 2026-08-04 |
| chiptune3 worklet | `public/audio/chiptune3.worklet.js` | [chiptune3](https://www.npmjs.com/package/chiptune3) npm package (copied by `scripts/copy-audio-worklets.mjs`, a build step, not `postinstall`) | MIT | pre-rebuild |
| Logo — title lockup on the briefing screen | `public/gcms-logo.webp` | Original (re-exported from `docs/logo.png` as lossless WebP; PNG's DEFLATE compressed it poorly — 358K vs WebP's 299K, pixel-identical) | project-owned | pre-rebuild |

Not shipped, and deliberately outside `public/`:

| Asset | Path | Source | Licence |
|---|---|---|---|
| Logo | `docs/logo.png` | Original | project-owned |

All shipped assets are referenced from `src/assets/manifest.ts` and nowhere
else, and `src/assets/manifest.test.ts` fails if a path in it stops resolving.
Every sound is in use as of the audio pass (2026-08-03); nothing in
`public/sounds/` is dead weight.

The libopenmpt worklet (1.5MB) is no longer shipped: it was only needed when
`MUSIC_TRACK` is a tracker module, which it currently is not, and it was
dead weight in every published tarball. `scripts/copy-audio-worklets.mjs`
copies only `chiptune3.worklet.js` now. If a tracker module becomes the
active track again, add `libopenmpt.worklet.js` back to the `WORKLETS` list
in that script — `systems/music.ts` picks its engine off the file extension,
so nothing else needs to change.

`three` and `chiptune3` are `devDependencies`, not `dependencies`: both are
compiled into the pre-built `dist/` at build time and neither is imported by
`cli/*.mjs`, so a published install has no need to download either.

Everything currently rendered in-game — floor, walls, cover, the player
placeholder, the reticle — is **procedural geometry generated in code**. There
are no 3D model files in the repo yet.

## Planned (M6 art pass)

Not yet downloaded. Listed so the licence check happens before the download,
not after.

| Pack | Source | Licence | Intended use |
|---|---|---|---|
| Blaster Kit | kenney.nl | CC0 | Weapons |
| Mini Arena / City Kit | kenney.nl | CC0 | Cover props, environment set dressing |
| Ultimate Modular Characters | quaternius.com | CC0 | Enemy meshes |
| Animated Characters | quaternius.com | CC0 | Player + enemy baked animations |
| Office props (filtered to CC0) | poly.pizza | CC0 | Desks, monitors, plants |
| Interface Sounds | kenney.nl | CC0 | UI, pickups, invite decline |

Three "hero" meshes — the file crate, the extraction beacon, and the player —
are authored specifically for this game rather than pulled from a pack, so the
game has an identity of its own. See REBUILD.md §5.

## Resolved: the music track's licence

The track that plays on every run (unless `--no-music`) was, until
2026-08-04, `SnD_-_Apollo_products_kgs.mp3` — keygen music with no traceable
rights holder (ID3 title *"SnD - Apollo products kgs"*, comment
`KeygenJukebox.com`; a scene track ripped out of a crack tool and rehosted).
The track it replaced before that was no better — *"those were the days"* by
**Viraxor** (Dec 2021) from modarchive.org, licensed per-track with no
licence stated in the module metadata.

Both are gone from the working tree; `git log --all --diff-filter=D --
'public/music/*'` finds them in history if either is ever wanted back for
reference (their licence problems still apply — don't reuse either).

The current track, [Juhani Junkala's Retro Game Music
Pack](https://opengameart.org/content/5-chiptunes-action) ("Level 1"), is
CC0 with the licence stated directly by the author on the source page — see
the ledger above. `MUSIC_TRACK` in `src/assets/manifest.ts` is one line, and
`systems/music.ts` picks its engine off the file extension, so swapping tracks
in the future (tracker module or browser-decoded) is still a one-line change.

## Exception: the Outlook mark — NOT CC0

`src/render/invite.ts` reproduces the Microsoft Outlook icon, drawn from the
official artwork, at the project owner's explicit direction. It is used for the
Outlook Invite Storm mini-boss and the invites it throws.

This is the **only** thing in the repository that is not CC0, and it is a
registered trademark of Microsoft Corporation. Nothing here is affiliated with
or endorsed by Microsoft.

- It is confined to that one file on purpose, so it can be swapped in one place.
- `git log -- src/render/invite.ts` has an unbranded envelope-and-calendar
  version that is a drop-in replacement and needs no other change.
- **Resolve this before publishing to npm.** A trademark on a character the
  player shoots is the use a mark holder is most likely to object to, and
  distribution is what turns that from theoretical into real.

## Adding an asset

1. Check the licence **before** downloading. CC0 or equivalent only.
2. Drop it under `public/models/` or `public/sounds/`.
3. Add a row above with the source URL and the date.
4. Register the path in `src/assets/manifest.ts` — that is the only file that
   should ever contain an asset path string.
