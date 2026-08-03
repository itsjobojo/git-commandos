# Asset ledger

Every third-party asset in this repo, with its source and licence. This is a
published npm package — if it ships in `dist/`, it is listed here.

**Rule:** CC0 only, or a licence with no attribution requirement that permits
commercial redistribution. Anything else does not go in.

Nothing from the pre-rebuild sprite packs (`kenney_desert-shooter-pack_1.0`,
`kenney_tiny-dungeon`, `kenney_top-down-shooter`) or `src/art/sprites.ts`
carries over — all of it was removed in the 3D rebuild (M0).

## Current

| Asset | Path | Source | Licence | Added |
|---|---|---|---|---|
| SFX (coin, hurt, explosion, jump, fall, error) | `public/sounds/*.ogg` | Kenney — Digital Audio / Impact Sounds | CC0 | pre-rebuild |
| Chiptune track | `public/music/chiptune.xm`, `.ogg` | modarchive.org | see track metadata | pre-rebuild |
| chiptune3 worklets | `public/audio/*.worklet.js` | [chiptune3](https://www.npmjs.com/package/chiptune3) npm package (copied by `postinstall`) | MIT | pre-rebuild |
| Logo | `public/images/logo.png` | Original | project-owned | pre-rebuild |

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

## Adding an asset

1. Check the licence **before** downloading. CC0 or equivalent only.
2. Drop it under `public/models/` or `public/sounds/`.
3. Add a row above with the source URL and the date.
4. Register the path in `src/assets/manifest.ts` — that is the only file that
   should ever contain an asset path string.
