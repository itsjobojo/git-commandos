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
| Music — the track that plays | `public/music/SnD_-_Apollo_products_kgs.mp3` | ID3: *"SnD - Apollo products kgs"*, comment `KeygenJukebox.com` | **unverified — see below** | 2026-08-03 |
| chiptune3 worklets | `public/audio/*.worklet.js` | [chiptune3](https://www.npmjs.com/package/chiptune3) npm package (copied by `postinstall`) | MIT | pre-rebuild |

Not shipped, and deliberately outside `public/`:

| Asset | Path | Source | Licence |
|---|---|---|---|
| Logo | `docs/logo.png` | Original | project-owned |

All shipped assets are referenced from `src/assets/manifest.ts` and nowhere
else, and `src/assets/manifest.test.ts` fails if a path in it stops resolving.
Every sound is in use as of the audio pass (2026-08-03); nothing in
`public/sounds/` is dead weight.

The libopenmpt worklets (1.5MB) are the exception: they are regenerated on
every install by the `postinstall` step and are only needed when `MUSIC_TRACK`
is a tracker module, which it currently is not. They are kept because the
engine is one line away from being used again. To shed them, drop the
`postinstall` script and the `chiptune3` dependency — `systems/music.ts` only
imports it dynamically, so nothing else breaks.

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

## Open question: the music track's licence

`SnD_-_Apollo_products_kgs.mp3` plays on every run unless `--no-music` is
passed, and its licence is unverified. **It falls short of the rule at the top
of this file** and needs resolving before publishing.

Its ID3 tags give the title *"SnD - Apollo products kgs"* and the comment
`KeygenJukebox.com`. That is keygen music: a scene track ripped out of a crack
tool and rehosted. No licence travels with it, the original artist is not
reliably identified by the filename, and the site it came from is an archive
rather than a rights holder.

The track it replaced was no better — *"those were the days"* by **Viraxor**
(Dec 2021) from modarchive.org, which licenses per-track and stated no licence
in the module metadata. It was deleted in the audio pass; `git show
HEAD~1:public/music/chiptune.xm` still has it if it is ever wanted back.

- The fix: confirm the licence with the rights holder, or drop in a CC0 track.
  `MUSIC_TRACK` in `src/assets/manifest.ts` is one line, and `systems/music.ts`
  picks its engine off the file extension, so a tracker module and an mp3 are
  equally easy to swap in.
- Nothing else depends on it. `--no-music` is a tested path and the game is
  fully playable without any track at all.

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
