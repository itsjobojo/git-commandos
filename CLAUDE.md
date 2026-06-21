# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Git Commandos is a 2D vertical-scrolling shooter that gates real git operations behind gameplay. Running `gcmds commit -m "message"` opens a browser game; you must survive to ship the commit. Files lost during gameplay are unstaged (or deleted in `--extreme` mode).

## Commands

```bash
pnpm dev          # Vite dev server — game only, no CLI integration (gitContext = null)
pnpm build        # Build to dist/ (required before CLI works)
node cli/index.mjs --help   # Run CLI without installing globally
gcmds fake-files  # Create and stage fake .ts files for testing
gcmds fake-files --count=8  # Stage N fake files (1–15)
gcmds fake-files --clean    # Remove .fake-files/ dir and unstage
gcmds play        # Launch game in sandbox mode (no real git state)
gcmds commit -m "msg"       # The real thing — play to commit
gcmds commit -m "msg" --extreme  # Extreme mode: lost files are deleted from disk
```

There are no tests or linting configured.

## Architecture

### Two separate runtimes

**CLI** (`cli/`) — Node.js ESM (`.mjs`). Never imports from `src/`.
- `index.mjs` — argument parsing, command dispatch
- `commands/*.mjs` — one file per subcommand; each exports `run(args, flags)` and `description`
- `server.mjs` — HTTP + WebSocket server serving `dist/`; returns a Promise that resolves with the game result
- `git-ops.mjs` — thin wrappers around `git` shell commands

**Game** (`src/`) — TypeScript compiled by Vite, runs in the browser.
- `main.ts` — boots: loads assets, connects WebSocket, instantiates `Game`
- `git-context.ts` — WebSocket handshake with the CLI server; returns `GitContext | null` (null in `pnpm dev` mode)
- `game.ts` — monolithic `Game` class with all state, update loop, and rendering

### CLI ↔ game communication

The CLI server sends `{ type: 'init', command, difficulty, payload: { files[], commitMessage, linesAdded } }` over WebSocket when the browser connects. The game replies with `{ type: 'result', outcome: 'win'|'loss', payload: { survivingFiles[], lostFiles[] } }` when done. If the browser closes without a result message, the CLI treats it as `abort` (no-op).

### Git integration inside the game

- `gitContext` is `null` in standalone/dev mode; the game shows a title screen and classic mode
- When `gitContext` is set, the game skips the title and goes to `level-intro`
- Staged file count → player max HP (capped at 8); lines added → level length (`gameRows`)
- Player HP maps to `GitFile.alive` — taking damage kills the last alive file; health pickups revive the last dead one
- On win/loss, `sendGitResult()` fires once, then the CLI unstages or deletes lost files and optionally commits

### Adding a new CLI command

Create `cli/commands/<name>.mjs` exporting:
```js
export const description = 'one-line description';
export const usage = 'gcmds <name> [options]';
export async function run(args, flags) { ... }
```
It will appear automatically in `gcmds --help`.

### Adding a new enemy

Extend `Enemy` (`src/entities/enemies/enemy.ts`) and implement `ai(dt, px, py)`. Register spawning logic in `Game.spawnWave()` in `src/game.ts`.
