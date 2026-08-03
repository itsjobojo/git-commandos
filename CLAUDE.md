# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Git Commandos is a 3D top-down **extraction shooter** that gates real git operations behind gameplay. Running `gcmds commit -m "message"` opens a browser game; your staged files are cargo you must carry to the extraction pad. Files you fail to extract are unstaged (or deleted in `--extreme` mode).

The game layer is mid-rebuild — see **REBUILD.md** for the full design and milestone plan. `cli/` predates the rebuild and is deliberately untouched.

## Commands

```bash
pnpm dev          # Vite dev server — game only, no CLI integration (sandbox mission)
pnpm build        # Build to dist/ (required before CLI works)
npx tsc --noEmit  # Typecheck (strict, noUnusedLocals — run before committing)
node cli/index.mjs --help   # Run CLI without installing globally
gcmds fake-files --count=8  # Create and stage N fake .ts files (1–15)
gcmds play        # Launch game in sandbox mode (no real git state)
gcmds commit -m "msg"       # The real thing — play to commit
gcmds commit -m "msg" --extreme  # Extreme mode: lost files are deleted from disk
```

`GCMDS_NO_OPEN=1` stops the server launching a browser, so the protocol can be driven headlessly in tests.

There is no linting configured. There are no tests **yet** — the first ones belong to `systems/carry.ts` when it lands (M4), because that is the only code that can destroy a user's work.

## Architecture

### Two separate runtimes

**CLI** (`cli/`) — Node.js ESM (`.mjs`). Never imports from `src/`.
- `index.mjs` — argument parsing, command dispatch
- `commands/*.mjs` — one file per subcommand; each exports `run(args, flags)` and `description`
- `server.mjs` — HTTP + WebSocket server serving `dist/`; returns a Promise that resolves with the game result
- `git-ops.mjs` — thin wrappers around `git` shell commands

**Game** (`src/`) — TypeScript + Three.js, compiled by Vite, runs in the browser.

```
core/      loop (fixed 60Hz + interpolated render), input→intent, seeded rng, time scaling
render/    camera rig, lighting, floor, palette, beacon, reticle — no gameplay state
world/     grid collision (the physics), map assembly
entities/  Entity base + Player; enemies land in M3
systems/   the rules: extraction now; combat, carry, vfx to come
ui/        DOM overlays — briefing, HUD, debrief, debug
net/       protocol.ts — the only file that knows the wire format
game/      game.ts (orchestration), mission.ts (GitContext → Mission)
```

**Two rules that keep `game.ts` from becoming the old 1400-line monolith:**

1. `Game` orchestrates, systems decide. `Game` may call `extraction.update(...)`. It may not contain a collision check or a damage rule.
2. Only `systems/carry.ts` mutates crate state. Every "which files survived" question has exactly one answer, in one file.

Everything downstream reads `Mission`, never `GitContext` — sandbox mode is not a special case threaded through the game, it's a Mission built from fake data.

### CLI ↔ game communication

The CLI server sends one `init` message when the browser connects:

```jsonc
{ "type": "init", "command": "commit", "difficulty": "basic", "music": true,
  "payload": { "files": [{ "name": "src/a.ts", "added": 12, "removed": 3 }],
               "commitMessage": "...", "linesAdded": 15,
               "branch": "main", "repo": "myproject" } }
```

The game replies with exactly one `{ type: 'result', outcome: 'win'|'loss', payload: { survivingFiles[], lostFiles[] } }`. If the browser closes without a result, the CLI treats it as `abort` and does nothing — the correct failure mode for a tool that can unstage your work.

`payload.files` also accepts the legacy `string[]` shape, so an older CLI works against a newer build.

### Git integration inside the game

- Staged files → cargo crates. Lines added → extraction hold time and map size.
- Getting hit drops a crate; a dropped crate decays into an unstage unless recovered. *(M4 — not yet implemented; currently all files survive a win.)*
- Reaching the extraction pad and holding it completes the commit.
- The mission seed is `branch:commitMessage`, so the same commit always generates the same map. Never use `Math.random()` in gameplay code — take an `Rng`.
- `Game.finish()` is the only place a result reaches the CLI, and `sendResult` is idempotent on both sides.

### Adding a new CLI command

Create `cli/commands/<name>.mjs` exporting:
```js
export const description = 'one-line description';
export const usage = 'gcmds <name> [options]';
export async function run(args, flags) { ... }
```
It will appear automatically in `gcmds --help`.

### Adding a new enemy

Add a file under `src/entities/enemies/` extending `Entity` and implementing `tick(dt)`. Register spawning in the director (M3). Keep behaviour in the entity and rules in `systems/` — enemies must never touch git state.

## Assets

Every third-party asset is recorded in **ASSETS.md** with source and licence. CC0 only. Nothing from the pre-rebuild sprite packs carries over; asset paths belong in `src/assets/manifest.ts`, not scattered through the code.
