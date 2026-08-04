# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Git Commandos is a 3D top-down **extraction shooter** that gates real git operations behind gameplay. Running `gcmds commit -m "message"` opens a browser game; your staged files are cargo you must carry to the extraction pad. Files you fail to extract are unstaged (or deleted in `--extreme` mode).

The game layer is mid-rebuild — see **REBUILD.md** for the full design and milestone plan. `cli/` predates the rebuild and is touched only where a game feature reaches all the way out to git.

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
gcmds status       # Not a gcmds command — forwarded to git verbatim
npm pack           # Build + pack the publishable tarball (prepack runs the build)
```

The published package is `cli/` + a pre-built `dist/`; `three` and `chiptune3` are dev
dependencies because Vite bundles them into `dist/`. Nothing may run on install — a
global install has no `public/`, no devDependencies, and a failing install script is a
failing install. Build-time asset copying lives in `scripts/copy-audio-worklets.mjs`,
which `build` and `prepare` (dev only) call.

`GCMDS_NO_OPEN=1` stops the server launching a browser, so the protocol can be driven headlessly in tests.

`pnpm test` runs vitest. The suites are deliberately few, and cover only what fails silently or fails expensively: `src/systems/cargo-ledger.test.ts` (the ledger decides which of the user's files get committed, unstaged or deleted — the one module that must never regress; add to it whenever you touch cargo rules), `world/arena.test.ts` (an unreachable extraction costs someone their commit; also that alternate routes really are second ways through and dead ends really are dead ends), `world/route.test.ts` (the clearance rules that make those topology guarantees true — cheap to assert on polylines, expensive to assert on a bitmap), `game/director.test.ts` (enemies spawned somewhere the player never walks are spawn budget spent on nothing, and it looks like an empty map rather than a bug), `systems/meetings.test.ts`, `assets/manifest.test.ts` (a mistyped asset path 404s quietly and nothing looks broken), `cli/commit-trailer.test.mjs` (the only code that edits the user's commit message — the failures worth catching are the message not surviving intact and the footer stacking on a re-run), and `cli/dispatch.test.mjs` (everything gcmds does not gate is forwarded to git, so a wrong classification costs someone a command they typed correctly). There is no linting configured.

## Architecture

### Two separate runtimes

**CLI** (`cli/`) — Node.js ESM (`.mjs`). Never imports from `src/`.
- `index.mjs` — argument parsing, command dispatch
- `dispatch.mjs` — pure: is this invocation ours or git's, and which flags do we own
- `passthrough.mjs` — hands an invocation to git and exits with its status
- `commands/*.mjs` — one file per subcommand; each exports `run(args, flags)` and `description`, optionally `supports(args)` and `requiresRepo`
- `commit-message.mjs` — the editor path for `commit` with no `-m`
- `server.mjs` — HTTP + WebSocket server serving `dist/` on loopback; returns a Promise that resolves with the game result
- `git-ops.mjs` — thin wrappers around `git`, argv as an array so paths and refs stay data

### A superset of git, never a replacement for it

`gcmds` gates a few commands and forwards every other invocation to `git` verbatim, so it can be aliased and used wherever `git` is. **The `git` command itself is never touched** — nothing installs, symlinks or shadows a `git` on PATH, and no code here tries to work out whether the `git` it is calling is really git. Aliasing is the user's decision, in their own shell config, reversible by them. Do not add a shim, a bin named `git`, or a postinstall that edits a shell profile.

Two rules keep the forwarding from costing anyone a command:

1. **A command only claims the shapes it fully understands.** `supports(args)` is a denylist-plus-shape check; `commit --amend`, a pathspec, `merge --abort`, a push refspec are all git's. The permissive mistake — claiming an invocation and then half-performing it — is the expensive one, so the default answer is always "not ours".
2. **Only flags we own are consumed.** `parseFlags` takes the gcmds flags and leaves the rest in `args`, so `--no-verify` and friends reach the real command after the run.

`cli/dispatch.test.mjs` covers exactly this: classification, flag ownership, and each gated command's `supports`.

**Game** (`src/`) — TypeScript + Three.js, compiled by Vite, runs in the browser.

```
core/      loop (fixed 60Hz + interpolated render), input→intent, seeded rng, time scaling
render/    camera rig, lighting, floor, palette, beacon, reticle — no gameplay state
world/     grid collision (the physics), route planning, map assembly
entities/  Entity base + Player; enemies land in M3
systems/   the rules: extraction, cargo, combat, carry, audio; vfx to come
assets/    manifest.ts — the only file allowed to contain an asset path string
ui/        DOM overlays — briefing, HUD, debrief, debug
net/       protocol.ts — the only file that knows the wire format
game/      game.ts (orchestration), mission.ts (GitContext → Mission)
```

**Two rules that keep `game.ts` from becoming the old 1400-line monolith:**

1. `Game` orchestrates, systems decide. `Game` may call `extraction.update(...)`. It may not contain a collision check or a damage rule.
2. Only `systems/cargo-ledger.ts` decides what happens to a file. `carry.ts` moves crate *bodies* around the world and delegates every state change to the ledger. Every "which files survived" question has exactly one answer, in one pure, tested file.

Everything downstream reads `Mission`, never `GitContext` — sandbox mode is not a special case threaded through the game, it's a Mission built from fake data.

### CLI ↔ game communication

The CLI server sends one `init` message when the browser connects:

```jsonc
{ "type": "init", "command": "commit", "difficulty": "basic", "music": true,
  "payload": { "files": [{ "name": "src/a.ts", "added": 12, "removed": 3 }],
               "commitMessage": "...", "linesAdded": 15,
               "branch": "main", "repo": "myproject" } }
```

…plus a `rules` block alongside `payload`. The game replies with exactly one `{ type: 'result', outcome: 'win'|'loss', payload: { survivingFiles[], lostFiles[], stashedFiles[], stats } }`. `stashedFiles` is only non-empty under `--stash=persist`: those are neither committed nor unstaged — the CLI drops them from the index, commits, and re-adds them so they stay staged for the next run. `stats` is the run tally (seconds, hits, HP, kills, crates recovered) that `cli/commit-trailer.mjs` stamps into the commit message; it is a report and nothing on either side may make a git decision out of it, and an older build omits it entirely. If the browser closes without a result, the CLI treats it as `abort` and does nothing — the correct failure mode for a tool that can unstage your work.

`payload.files` also accepts the legacy `string[]` shape, so an older CLI works against a newer build.

### Git integration inside the game

- Staged files → cargo crates. Lines added → extraction hold time and map size.
- Getting hit knocks the most recently collected crate loose. It decays on a visible timer and is lost for good if not recovered. A dropped crate has a short pickup lockout — without it the crate lands inside your own pickup radius and a hit costs nothing.
- Mission rules are set by CLI flags (`cli/rules.mjs`) and travel in the init payload: `loss` (unstage/delete, from `--extreme`), `death` (cargo/health/fragile), `stash` (run/persist/off). Each has a safe default; the game must never apply a stricter rule than the one the user asked for.
- Reaching the extraction pad and holding it completes the commit.
- The mission seed is rolled fresh on every deploy (`freshSeed` in `game/mission.ts`) — a commit names its world but does not fix it, so replaying a commit is a new place rather than another go at the same one. Everything downstream still derives from that one string, so a single run is reproducible given its seed. `freshSeed` is the only place `Math.random()` is allowed; gameplay code must take an `Rng`.
- `Game.finish()` is the only place a result reaches the CLI, and `sendResult` is idempotent on both sides.
- A successful commit carries a footer recording that it was made through the game, the run tally, and the rules it was played under. `cli/commit-trailer.mjs` builds it — pure, appends only, idempotent on the mark, and skipped entirely by `--no-trailer`. Because the message can now be multi-line, `commitFiles` feeds git on stdin (`-F -`); putting it through `-m` turns the newlines into a literal `\n`.

### Adding a new CLI command

Create `cli/commands/<name>.mjs` exporting:
```js
export const description = 'one-line description';
export const usage = 'gcmds <name> [options]';
export async function run(args, flags) { ... }

// Optional. Return false for any invocation the game should not claim — it is
// then handed to the real git untouched. Required for anything that shadows a
// real git subcommand.
export function supports(args) { ... }

// Optional, defaults to true.
export const requiresRepo = false;
```
It will appear automatically in `gcmds --help`, and — because unknown commands pass through to git — it also shadows any real git subcommand or user alias of the same name. Pick names git does not use.

### Adding a new enemy

Add a file under `src/entities/enemies/` extending `Entity` and implementing `tick(dt)`. Register spawning in the director (M3). Keep behaviour in the entity and rules in `systems/` — enemies must never touch git state.

## Assets

Every third-party asset is recorded in **ASSETS.md** with source and licence. CC0 only. Nothing from the pre-rebuild sprite packs carries over; asset paths belong in `src/assets/manifest.ts`, not scattered through the code.
