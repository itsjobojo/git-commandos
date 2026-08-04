# Git Commandos — where the 3D rebuild stands, and what's next

Written 2026-08-03 as a context handoff. Branch: `rebuild-3d`.
Design rationale lives in **REBUILD.md**; architecture rules live in **CLAUDE.md**.
This file is only "what is done, what is not, and what to do next".

---

## State of play

The 3D rebuild is **playable end to end and wired to real git**. `gcmds commit`
opens the game, and holding the extraction beacon commits for real.

Milestones **M0–M4 are done** (see REBUILD.md §7), plus most of M3 (combat) and
a good chunk of M5 (maps) ahead of schedule.

| | Status |
|---|---|
| Core loop, camera, movement | done |
| Git spine (briefing → run → debrief → CLI) | done, verified against scratch repos |
| Cargo, drop-on-hit, decay, stash | done, 50 tests |
| Route maps, seeded and connectivity-tested | done |
| Combat, bestiary, weapons, drops | done |
| Audio | done — SFX bus, positional mix, tracker music |
| Art pass (M6) | not started — everything is procedural |
| README | **stale — still describes the 2D game** |

Performance: locked 120fps with 25 bros, the boss and ~29 live enemies, ~30–45
draw calls, 174KB gzipped.

### Verification commands

```bash
npx tsc --noEmit          # strict, noUnusedLocals
pnpm test                 # 50 tests, all headless
pnpm build                # must pass before any CLI test
pnpm dev --port 5199      # sandbox
GCMDS_NO_OPEN=1 node cli/index.mjs commit -m "x"   # drive the protocol headlessly
```

---

## Next steps, in the order I'd take them

### 1. README

Still describes the 2D game: "chaotic 2D action-game", Z to shoot, a git-revert
key, a pickups table that no longer exists. It is the first thing anyone reads
and all of it is wrong. Controls are now WASD / mouse aim / LMB fire / Space
dodge / Q drop / E stash / Esc pause, and the CLI has `--death=` and `--stash=`
flags that are undocumented outside `gcmds --help`.

### 2. M6 art pass

Everything on screen is procedural geometry. REBUILD.md §5 has the plan and
ASSETS.md has the licence rules (**CC0 only** — this publishes to npm). The
three hero meshes named there are the player, the file crate and the beacon.
Bloom would flatter the existing emissive palette a lot.

### 3. M5 finish — chunk-authored rooms

`buildRoute` carves a good route procedurally, but REBUILD.md's design was
hand-authored room chunks assembled along it. Current maps are structurally
sound but samey. `src/world/rooms/*.json` was the intended home.

---

## Known gaps and deliberate parking

- **Rushers are parked.** `Intern` (the melee counterpart to the skirmishing
  Recruiter) is complete but disabled behind `SPAWN_INTERNS = false` in
  `director.ts`. Turn it back on once pacing settles; the pincer of "skirmisher
  holds range, pack closes" is a good fight.
- **`--death=health` and `--stash=persist` have never been played.** Both are
  tested at the ledger level and verified over the CLI protocol, but nobody has
  run a real game in either mode.
- **`--extreme` deletes files and has only been tested via the protocol**, not
  by playing. Treat with care; that flag destroys real work.
- **Frame rate on lower-end GPUs is unmeasured.** All numbers above are one
  machine. The budget in REBUILD.md §2 is 60fps on integrated graphics.
- **No pause during the invite modal** is intentional (the joke is that the
  game does not stop for your calendar), but it has not been playtested for
  fairness during a boss fight.
- **The music track's licence is unverified** and it now actually plays. The
  current pick is keygen music off KeygenJukebox; the chiptune it replaced is
  modarchive with no stated licence. See ASSETS.md — this is a publish
  blocker, and swapping the track is one line in the manifest.
- **The mix has been measured, not listened to on other hardware.** Levels were
  set against one pair of speakers; the stampede rumble in particular lives
  low enough that small laptop speakers may not reproduce much of it.
- **Meetings can spawn overlapping walls.** Containment maths is correct; it
  just looks odd.

---

## Things worth not breaking

These were each a real bug, found by playing or by a test. Re-introducing any
of them is easy.

1. **Enemies must call `savePrevious()`** every step. Without it the renderer
   interpolates from their spawn point, so they appear in two places and your
   shots miss the ghost you're aiming at.
2. **Never `vertexColors: true` on the projectile material.** The geometry has
   no per-vertex colour attribute, so every bullet shades to black.
3. **The map connectivity test is load-bearing.** An unreachable extraction is
   not a bad level, it is a run that silently costs someone their commit.
4. **`cargo-ledger.ts` is the only thing allowed to decide a file's fate.** It
   is pure and tested for exactly that reason. `carry.ts` moves bodies.
5. **Countdown/bubble textures are cached or redrawn in place.** Allocating a
   `CanvasTexture` per frame was a real frame-time cost.
6. **No product names or logos.** The Invite Storm is unbranded on purpose —
   this ships to npm, and ASSETS.md is CC0-only.
7. **`sendResult` fires once.** A double send would let the CLI act twice on
   the user's index.
