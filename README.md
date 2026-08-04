<center>

  <img src="docs/logo.png" alt="Git Commandos" width="480" />

  <p>
    <strong>Every commit is an extraction mission.</strong>
    <br>
    A chaotic 2D action-game CLI where real git commands only run if you survive.
  </p>

</center>

## What is this?

Your staged files become your lives. Take a hit, lose a life. Run out of lives, and those files are unstaged instead of committed.

In **extreme mode**, the stakes are worse: lost files are deleted from disk.

## Install

```bash
npm install -g git-commandos
```

Needs Node 18.17+ and a real git on your PATH. The game ships pre-built — there is
nothing to compile after install.

```bash
# or run from a clone
pnpm install && pnpm build
node cli/index.mjs --help
```

## Commands

| Command | Description |
|---|---|
| `gcmds commit -m "message"` | Commit staged files — survive to ship them |
| `gcmds push [remote] [branch]` | Push commits to remote |
| `gcmds merge <branch>` | Merge a branch |
| `gcmds quick-run` | Stage fake files and play a test round |
| `gcmds fake-files [--count=N]` | Create and stage N fake `.ts` files |
| `gcmds play` | Launch sandbox mode (no real git state) |

All commands accept `--extreme`: on loss, files are **deleted from disk** instead of just unstaged.

## Drop in `gcmds` wherever you type `git`

`gcmds` is a superset of git. Anything it does not gate, it hands to git exactly as
typed — same output, same exit code:

```bash
gcmds status
gcmds log --oneline -10
gcmds rebase -i HEAD~3
gcmds commit -m "earn it"   # ← this one opens the game
```

So you can alias it and forget about it:

```bash
alias git=gcmds   # in ~/.zshrc or ~/.bashrc
```

**`git` itself is never touched.** Nothing is installed, symlinked or shadowed on your
PATH — the alias is yours to add and remove, and every script, hook and tool on your
machine keeps calling the real `git` exactly as before.

What is gated and what is not:

- **Gated:** `commit`, `push`, `merge` — in the plain forms, the ones that mean "ship
  what I have".
- **Passed through:** everything else, and any form of those three the game has no
  business interpreting — `--amend`, `--fixup`, `-p`, a pathspec, `merge --abort`,
  `merge --continue`, `push --delete`, refspecs like `origin :old-branch`. Those go to
  git exactly as typed.
- Flags you pass along (`--no-verify`, `--signoff`, `-u`) are forwarded to the real
  command once you have survived.
- `gcmds commit` with no `-m` still opens your editor, with your template, first.
- Hooks still run. `-C`, `--git-dir` and the rest of git's global options are never
  parsed by us — an invocation carrying them is git's.

Aliased and want to skip the game once? Type `\git` (or `command git`).

## How it works

Running any command opens the game in your browser. Your staged files (or commits, for push/merge) become your HP — the more files, the more lives. Lines added scale the level length. Survive to the end zone and the git operation completes. Die and nothing happens (or in extreme mode, everything is lost).

### Controls

| Key | Action |
|---|---|
| Arrow keys / WASD | Move |
| Z / Space | Shoot |
| Q | Shoot diagonal left |
| E | Shoot diagonal right |
| C | Git revert — clears screen, recovers a lost file |
| ↑ (near door) | Enter building |

### Pickups

| Pickup | Effect |
|---|---|
| SMG / Machine Gun / Shotgun | Weapon upgrade |
| Ammo | Restock current weapon |
| HP+ | Heal and recover a lost file |
| Git Revert | +1 revert charge |
| Git Stash | 3 seconds invincibility |

## Development

```bash
pnpm install   # also copies chiptune3 worklet files to public/audio/
pnpm dev       # Vite dev server (game only, no CLI integration)
pnpm build     # build to dist/ (required for CLI commands to work)
gcmds quick-run   # fast test loop
```

Music: drop a `.xm` or `.mod` tracker file at `public/music/chiptune.xm`. Free tracks at [modarchive.org](https://modarchive.org).

---

## FAQ

**Is this a good idea?**
No.

**Is it safe to use on a real project?**
No.

**I lost a bunch of work. What do I do?**
Please fill out [this form](https://github.com/itsjobojo/git-commandos/issues/1).
