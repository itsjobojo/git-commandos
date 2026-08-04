# Git Commandos — 3D Rebuild Plan

Ground-up rebuild of the game layer as a **3D top-down extraction shooter** on
**Three.js**, keeping the existing CLI/git integration intact.

Decisions locked (2026-08-03):

| Question | Decision |
|---|---|
| Perspective | 3D scene, camera locked ~50° above, slight orbit/lag |
| Engine | Three.js + custom fixed-step loop (no framework) |
| Assets | CC0 packs (Kenney / Quaternius) + procedural geometry + a few custom hero meshes |
| Audio | Keep approach: CC0 SFX + tracker music |
| Scope | Replace `src/`, keep `cli/` and the `dist/` contract |
| Old sprites | **Not reused.** `src/art/sprites.ts` and the `kenney_*` sprite folders are deleted. |

---

## 1. The core idea, restated

The current game is a vertical shmup where HP happens to be named after your files.
The rebuild makes the metaphor literal:

> **Your staged files are physical cargo. You carry them across a hostile map to the
> extraction pad. Getting shot makes you drop cargo. What reaches the pad gets committed;
> what you leave behind gets unstaged.**

`git commit` stops being "survive to the end of the level" and becomes an actual
extraction: get in, get loaded, get out.

### The loop

```
  SPAWN (working directory)          EXTRACTION PAD (commit)
        ▼                                      ▼
   ┌────────────────────────────────────────────────┐
   │  ▣ ▣        ◆        ▓▓▓▓        ◆      ░░░░░  │
   │   ▣      ◆       ▓▓▓▓▓▓▓▓            ░ HOLD ░  │
   │  ☗ ──────────────────────────────────►░ 8.0s ░ │
   │         ◆     ▓▓▓▓        ◆   ◆       ░░░░░░░  │
   └────────────────────────────────────────────────┘
     ▣ file crate   ☗ you   ◆ hostile   ▓ cover   ░ pad
```

1. **Load in.** Your staged files spawn as crates — some on your back at spawn, the rest
   scattered across the map. You must physically collect them.
2. **Haul.** Each crate you carry slows you slightly and raises your threat profile
   (more carried = enemies aggro from further away). Carrying everything is a choice, not a default.
3. **Get hit → drop a crate.** A hit costs one carried file. The crate tumbles to the
   ground and starts **decaying** (a visible ~12s timer). Pick it back up and it's saved.
   Let it decay and that file is unstaged — permanently, for this run.
4. **Extract.** Standing on the pad starts a **hold timer** ("writing commit object").
   The timer length scales with `linesAdded`. Enemies escalate hard during the hold.
   Leaving the pad pauses the timer, it doesn't reset.
5. **Result.** Crates on your person when the timer completes → committed.
   Everything else → unstaged. Zero crates on the pad → no commit, mission aborted.
   Death with crates carried → all of them unstaged.

### Why this is better than the current design

- **Failure is granular and legible.** "I dropped `auth.ts` behind that wall and couldn't
  get back to it" is a story; "my HP hit zero" isn't.
- **Real decisions.** Go back for a dropped crate under fire, or extract with 4 of 5?
  Every run has that moment.
- **Partial wins are the norm, not dead code.** The existing partial-commit path in
  `cli/commands/commit.mjs:75–86` finally gets exercised on most runs.
- **The metaphor stays honest.** Files are objects, extraction is a commit, dropping is
  unstaging. Nothing needs explaining.

### Git mechanics mapped to gameplay

| Git concept | In-game |
|---|---|
| Staged file | A carryable crate, labelled with the basename, sized by its diff |
| `linesAdded` | Extraction hold timer + map size |
| Getting shot | Drop one carried crate; it decays into an unstage |
| Branch name | Mission name on the briefing screen |
| `git stash` | **Stash cache** on the map: deposit crates there and they're safe even if you die (re-staged next run) |
| `git revert` | Consumable: rewind the world state 3 seconds (undo a bad drop) |
| `git cherry-pick` | Consumable: teleport one decaying crate to your hands from anywhere |
| `--extreme` | Decayed crates aren't unstaged, they're deleted from disk. The decay timer is halved. |
| `git push` / `merge` | Same map, different mission modifiers (see §7) |

---

## 2. Architecture

### What survives untouched

```
cli/index.mjs            argument parsing, dispatch
cli/commands/*.mjs       commit, push, merge, play, fake-files, quick-run
cli/git-ops.mjs          the actual git shell-outs
cli/server.mjs           HTTP + WS, serves dist/, resolves with the game result
index.html               entry point
vite.config.ts           build to dist/
public/sounds/*.ogg      CC0 SFX (kept)
public/music/*           tracker music (kept)
```

The `{type:'init'} → {type:'result'}` WebSocket contract is preserved, with one
**additive, backwards-compatible** extension (§6).

### What gets deleted

```
src/**                       everything — game.ts, world.ts, entities/, systems/, art/
kenney_desert-shooter-pack_1.0/
kenney_tiny-dungeon/
kenney_top-down-shooter/
editor.html                  the 2D level editor (replaced by JSON room definitions)
```

`src/git-context.ts` is the one file worth reading before deleting — the new
`net/protocol.ts` is a direct descendant of it.

### New `src/` layout

```
src/
  main.ts                  boot: load assets → connect WS → build Game → start loop
  game/
    game.ts                orchestration only. Owns the state machine, not the logic.
    state.ts               'briefing' | 'playing' | 'extracting' | 'debrief'
    mission.ts             builds a Mission from the GitContext (files → crates, lines → timer)
    director.ts            spawn pacing: pressure curve, escalation during the hold
  core/
    loop.ts                fixed 60Hz accumulator + interpolated render
    time.ts                dt, elapsed, timescale (slow-mo on extract, hitstop on damage)
    input.ts               keyboard + mouse + gamepad → an intent struct, no globals
    rng.ts                 seeded PRNG (seed = commit message hash → replayable missions)
    events.ts              tiny typed pub/sub; how systems talk without importing each other
  render/
    renderer.ts            WebGLRenderer, sizing, DPR clamp, colour management
    camera.ts              top-down rig: follow with lag, aim-lean, extraction pull-back, shake
    lighting.ts            one directional (shadow-casting) + hemi fill + per-entity point lights
    post.ts                EffectComposer: bloom → vignette → subtle chromatic aberration
    materials.ts           shared material cache (flat-shaded toon + emissive accents)
    instancing.ts          InstancedMesh pools for bullets, crates, debris
  world/
    grid.ts                the collision world: a 2D plane, cells, static AABBs
    map.ts                 assembles a Map from room chunks
    rooms/*.json           hand-authored room chunks (see §4)
    props.ts               spawning cover, doors, decoration from chunk data
  entities/
    entity.ts              id, transform, radius, flags. No inheritance beyond this.
    player.ts              movement, aim, carry stack, i-frames
    crate.ts               the file object: carried / dropped / decaying / stashed / extracted
    enemies/*.ts           one file per archetype, each exports a spawn() + tick()
    projectile.ts          pooled, instanced
    pickup.ts
  systems/
    movement.ts            integrate + resolve against grid
    combat.ts              hit detection, damage, the drop-a-crate rule (single source of truth)
    carry.ts               pick up / drop / decay / stash — owns all crate lifecycle
    extraction.ts          pad presence, hold timer, escalation trigger, completion
    audio.ts               SFX bus + music, positional where it matters
    vfx.ts                 particles, tracers, impact decals, the extraction beam
  ui/
    hud.ts                 DOM overlay (not canvas): carry stack, decay timers, hold bar
    briefing.ts            mission intro: branch, message, file manifest
    debrief.ts             what shipped, what didn't, per-file
  net/
    protocol.ts            WS init/result, GitContext type, null in dev mode
  assets/
    manifest.ts            declarative asset list; the only place paths are written
    load.ts                GLTF/audio loading with a real progress bar
```

**Two rules that keep this from becoming `game.ts` again** (the current one is 1403 lines):

1. **`Game` orchestrates, systems decide.** `Game` may call `combat.resolve(world, dt)`.
   It may not contain a collision check.
2. **Only `systems/carry.ts` mutates crate state.** Every "which files survived" question
   has exactly one answer, in one file. This is the module that decides what happens to
   the user's real work — it gets read carefully and it never gets a second author.

### Rendering approach

- **Flat-shaded low-poly + strong emissives.** `MeshToonMaterial` / flat `MeshStandardMaterial`
  with a limited palette, letting bloom do the work. This style is forgiving of mixed-source
  CC0 assets and reads clearly from a top-down camera.
- **Instancing everywhere it counts.** Bullets, crates, debris, floor tiles all go through
  `InstancedMesh` pools sized at boot. Target: < 120 draw calls.
- **One shadow-casting light.** A single directional light with a tight ortho frustum around
  the player. No CSM, no shadow-casting point lights.
- **Post chain:** bloom (aggressive on emissives) → vignette → very subtle CA. Optionally a
  scanline/CRT pass on menus only, as a nod to the terminal it launched from.
- **No physics engine.** Movement is planar; collision is circle-vs-AABB against a static
  grid plus circle-vs-circle for entities. Deterministic, tiny, debuggable.
  (Rapier stays an option if crates should tumble physically — evaluate at M4, don't
  adopt speculatively.)

### Performance budget

| Metric | Target |
|---|---|
| Frame time | 16.6ms on integrated graphics (M1 / Iris Xe) at 1080p |
| Draw calls | < 120 |
| JS bundle (gz) | < 400KB (Three.js tree-shaken is ~150KB gz) |
| Total assets | < 8MB — this ships inside an npm package |
| Time to playable | < 3s from `gcmds commit` to first frame |

Everything is bundled and served from `dist/` by `cli/server.mjs`. **No CDN, no runtime
network fetches** — the game must work on a plane.

---

## 3. Controls

Top-down 3D with mouse aim is the whole reason to pick this camera — use it.

| Input | Action |
|---|---|
| WASD | Move (camera-relative) |
| Mouse | Aim — raycast from camera to the ground plane |
| LMB / hold | Fire |
| Space | Dodge roll (i-frames, cannot pick up during) |
| E | Pick up / deposit crate |
| Q | Drop one crate deliberately (to move fast, or to stash) |
| Shift | Sprint — only available when carrying ≤ 2 crates |
| R | Reload |
| C | Git revert (rewind 3s) |
| Esc | Pause / abort mission |

Full gamepad parity: right stick aims, and the twin-stick layout is arguably the better
way to play. Aim assist on gamepad only.

---

## 4. Level generation

Not procedural noise, not fully hand-authored — **chunk assembly**, which is the right
tradeoff for a game whose length is dictated by a diff stat.

- Author ~20 **room chunks** as JSON (`src/world/rooms/*.json`): a grid of tile codes plus
  prop/spawn markers. Roughly a day of authoring; they're small.
- At mission start, seed the PRNG with a hash of the commit message — **the same commit
  always generates the same map**, which makes retries fair and bug reports reproducible.
- Assemble a route: `spawn chunk → N mid chunks → extraction chunk`, where
  `N = clamp(linesAdded / 40, 2, 8)`. A one-line fix is a quick smash-and-grab; a
  400-line refactor is a long, ugly haul. This is the mechanic that makes people
  commit more often, which is the joke the whole project is built on.
- Crates are distributed across the mid chunks, weighted by each file's diff size —
  the file with 200 changed lines is the one furthest from extraction.
- One **stash cache** per mission, deliberately placed off the optimal route.

A chunk is authored as text, so it stays reviewable in a diff:

```json
{
  "id": "open-office-01",
  "size": [24, 24],
  "tiles": [
    "########################",
    "#......##........##....#",
    "#..CC..............CC..#",
    "#......##...SS...##....#",
    "########################"
  ],
  "legend": { "#": "wall", ".": "floor", "C": "cover", "S": "enemy_spawn" }
}
```

---

## 5. Assets

Everything is downloaded fresh under CC0. **Nothing from `kenney_*` or `src/art/` carries over.**

### Sources

| Source | Licence | Used for |
|---|---|---|
| [Kenney](https://kenney.nl) — Blaster Kit, Mini Arena, City Kit, Prototype Textures, Graveyard Kit | CC0 | Weapons, cover props, environment kit, placeholder textures |
| [Quaternius](https://quaternius.com) — Ultimate Modular Characters, Animated Characters | CC0 | Player + enemy meshes with baked walk/run/death animations |
| [Poly Pizza](https://poly.pizza) (filter to CC0) | CC0 | Office set dressing — desks, monitors, plants |
| Kenney Interface/Impact Sounds | CC0 | UI, hits, pickups |
| [modarchive.org](https://modarchive.org) | varies — check per track | Music (existing `chiptune.xm` is kept) |
| Existing `public/sounds/*.ogg` | CC0 | Kept as-is |

Every downloaded pack gets recorded in `ASSETS.md` with source URL, licence, and date.
This is a published npm package — that file is not optional.

### Custom "hero" meshes

Three objects carry the game's identity and are modelled specifically for it, rather than
pulled from a pack:

1. **The file crate.** A translucent prism with the filename etched on the face, an
   internal core whose colour is its language, and a pulse that quickens as it decays.
   Renders as a `CanvasTexture` label on a custom mesh — so it always shows the real filename.
2. **The extraction beacon.** A vertical light column that fills like a progress bar during
   the hold. The single most-watched object on screen.
3. **The player.** A Quaternius base mesh with a custom rig-mounted **cargo stack** —
   carried crates are physically visible on your back. You can see your git status by
   looking at yourself.

Everything else — floors, walls, glow shaders, muzzle flashes, decals, the grid — is
**procedural geometry and shaders**, which keeps the bundle small and the style coherent
across mixed-source assets.

### Enemy bestiary — the jokes are load-bearing

The office satire is the best thing the current game has, and **none of it is being
thrown out**. The three signature bits — the AI bro stampede, the meetings, the Outlook
invite mini-boss — carry over intact and get *better* in 3D, because now they can surround
you, physically block a doorway, and cast shadows.

#### 🧠 AI Bro Stampede (boss)

A herd of identical guys in identical quarter-zips, jogging at you in a wedge formation,
**each one shouting nonsense in a speech bubble that follows him in 3D**. They don't shoot.
They don't need to. They just keep coming and keep talking.

- Speech bubbles are billboarded sprites (`CanvasTexture`, generated at runtime) that spawn
  above each bro every ~2s and pop with the SFX of a Slack notification.
- Lines are drawn from a table in `src/entities/enemies/ai-bro-lines.ts` — a plain string
  array so it's trivially extensible and reviewable in a diff. Seeded by the mission RNG,
  so the same commit gets the same nonsense.
- The stampede spawns **during the extraction hold**, which is the worst possible moment,
  which is the point. They physically shove you off the pad — contact is knockback, not
  damage, so the failure mode is "I got talked off the extraction point."
- Killing one makes the rest speed up ("he's just early"). The herd only ends when it's gone.

```
                 ╭──────────────────────────────╮
                 │ "we're basically an AI-first  │
                 │  org now"                     │
                 ╰──────────────╮───────────────╯
     🧍 🧍 🧍                   ▼
    🧍 🧍 🧍 🧍   ────────────────►   ☗ (you, on the pad, at 6.2s of 8.0)
     🧍 🧍 🧍
```

Starter lines (the table ships with ~60; tone target is "confidently wrong on LinkedIn"):

> "have you tried just prompting it better" · "this is basically AGI" · "I don't really
> write code anymore" · "we 10x'd velocity last sprint" · "honestly, junior devs are
> over" · "it's not a wrapper, it's an orchestration layer" · "I've been saying this
> since GPT-2" · "let me get you in a room with our AI strategy lead" · "we should
> fine-tune on our Slack" · "the model just *gets* our codebase"

#### 📅 Meetings (attend-or-avoid zones)

Meetings materialise on the map as translucent glowing floor rings with a title and a
countdown — **and you have to decide whether to attend**. This is the current game's best
mechanic and it becomes a genuine spatial dilemma in 3D.

| Meeting type | Ring colour | What it does |
|---|---|---|
| **Mandatory** (`Sprint Planning`, `All Hands`) | Amber | Attend before the countdown expires or take a penalty — a crate is force-dropped. Attending means standing in the ring, motionless, unable to shoot, while enemies close in. |
| **Optional** (`Sync re: sync`, `Quick chat?`) | Grey | Pure trap. Walk in and you're stuck for the duration. Ignore it and nothing happens. Some are decoys placed right on the optimal route. |
| **Recurring** (`Weekly 1:1`) | Amber, pulsing | Re-spawns at the same spot on a timer. Learn the map, route around it. |

Inside a ring: your speed is quartered, pickups are blocked, and a "you're on mute" HUD
banner appears while the timer runs. Attending a mandatory meeting is often the *correct*
play — this isn't a hazard you always dodge, it's a tax you decide how to pay.

Nothing places them. The director schedules meetings on its own clock and drops them
wherever the spawn logic would otherwise put an enemy — on or near the route — so there
is no source to kill and no warning before one lands.

#### 📨 Outlook Invite Swarm (mini-boss)

A slow, bloated Outlook icon that hovers over the arena and **carpet-bombs you with calendar
invites**. The mini-boss of the mid-game.

- Fires `.ics` invite projectiles — spinning, envelope-shaped, homing slowly and inaccurately,
  in dense fans. Individually harmless-looking, collectively a bullet hell.
- Each invite that hits you costs a crate *and* leaves a ghost invite in the HUD strip. Let
  three land and the HUD starts to look like a real Outlook calendar, which is the horror beat.
- Invites can be **declined**: shoot one and it pops with a satisfying "Declined" toast.
  Dodge-rolling through a fan declines everything it touches — the skill expression here is
  clearing a wall of invites in one roll.
- Phase 2 at 50% health: it stops firing individual invites and sends **one recurring series** —
  a rotating spiral that doesn't stop until the boss is dead. The subject line is "Recurring".

#### Supporting cast

| Enemy | 3D behaviour |
|---|---|
| **Recruiter** | Fast flanker. Ignores you entirely until you carry ≥ 3 crates, then beelines while shouting "quick question about your background". |
| **Intern** | Harmless alone, spawns in packs, follows you around asking to pair. Blocks doorways by existing. |
| **Merge Conflict** *(new)* | Splits into two weaker copies when damaged. Kill both halves fast or they re-merge at full health. |

#### Tone rules

1. **The joke is never in the way of the mechanic.** Every bit above is a real, readable
   threat first and a punchline second. The AI bros are a physical wall; the meetings are a
   speed debuff; the invites are bullets.
2. **Text is generated, never baked into art.** Speech bubbles, meeting titles and invite
   subjects are all runtime `CanvasTexture` — so the tables stay editable in a diff and
   nobody has to open an image editor to add a joke.
3. **The nonsense is seeded.** Same commit message → same map → same bro dialogue. Runs are
   reproducible, and a funny run can be shared as a screenshot that someone else can replay.

---

## 6. Protocol extension

The current `init` payload sends only filenames, so the game can't size crates by diff.
`cli/git-ops.mjs:getStagedDiffStats()` **already computes** per-file `added`/`removed` and
`cli/commands/commit.mjs:52` throws it away. One-line fix on the CLI side:

```jsonc
{
  "type": "init",
  "command": "commit",
  "difficulty": "basic",
  "music": true,
  "payload": {
    "files": [{ "name": "src/auth.ts", "added": 120, "removed": 4 }],  // was: string[]
    "commitMessage": "fix auth",
    "linesAdded": 340,
    "branch": "feat/login",     // new — mission name
    "repo": "git-commandos"     // new — briefing flavour
  }
}
```

`net/protocol.ts` accepts both shapes (`string | {name, added, removed}`), so an old CLI
against a new build still works. The `result` message is **unchanged** — `survivingFiles`
and `lostFiles` — so `commit.mjs`, `push.mjs` and `merge.mjs` need no changes at all.

### Mission variants (existing commands, no new CLI work)

- `commit` — the standard extraction described above.
- `push` — crates are the commits ahead of upstream; the pad is a "remote uplink" with a
  longer hold and no cover near it.
- `merge` — two convoys converge on one pad; Merge Conflict enemies spawn on contact.

---

## 7. Milestones

Each milestone ends in something runnable. `pnpm build && node cli/index.mjs quick-run`
is the acceptance harness throughout — the game must stay CLI-integrated from M2 onward.

| # | Milestone | Content | Done when |
|---|---|---|---|
| **M0** ✅ | Clear the deck | Delete `src/**`, `kenney_*`, `editor.html`. Add `three`. New empty `src/` skeleton + `ASSETS.md`. | `pnpm build` produces an empty scene at 60fps |
| **M1** ✅ | Feel | Fixed-step loop, camera rig, WASD + mouse aim, dodge roll, grid collision, procedural floor. Capsule placeholder. | Moving a capsule around a grey box room already feels good. **Do not proceed until it does.** |
| **M2** ✅ | Wire the git spine | `net/protocol.ts`, briefing screen from real `GitContext`, debrief, `sendResult`. Win = hold the extraction beacon. | `gcmds commit -m test` commits for real |
| **M3** | Combat | Weapon + instanced projectiles, 2 enemy archetypes, damage, hitstop, death. | Fights are readable from the top-down camera |
| **M4** ✅ | **Cargo** | `cargo-ledger.ts` (pure, tested) + `carry.ts` (bodies): pick up, carry stack, drop-on-hit, decay, two-way stash cache. Crates use real filenames. All three death rules and all three stash rules. | Taking 2 hits and letting one crate decay unstages exactly that file, and no other |
| **M5** | Maps | Room chunks, seeded assembly, length from `linesAdded`, crate/enemy distribution. | A 400-line diff is visibly a longer mission than a 10-line one |
| **M6** | Art pass | Real GLTF assets, the 3 hero meshes, lighting, materials, post chain. | Screenshots stop looking like a prototype |
| **M7** | Juice, audio + **the bits** | VFX, positional SFX, music, HUD, briefing/debrief polish. Speech-bubble system + AI bro line table, meeting rings (mandatory/optional/recurring), Outlook invite mini-boss with both phases. | It's fun to lose, and someone screenshots a bro line unprompted |
| **M8** | Ship | Perf pass, bundle trim, `push`/`merge` variants, README + screenshots, `ASSETS.md` audit. | Publishable |

**M4 is the milestone that matters.** It's the only code that can destroy a user's real
work. Budget disproportionate care there: it gets its own tests (the repo has none today —
this is where the first ones go), and it gets manually verified against a scratch repo with
`--extreme` before that flag is trusted again.

Rough shape: M1–M2 is the risky unknown (does 3D feel right?), M4 is the careful one,
M6–M7 is the long tail. If M1 doesn't feel good, the fallback is the 2.5D option — the
architecture above supports it by only changing `render/camera.ts` and `world/grid.ts`.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| **3D top-down readability** — enemies hidden behind walls, depth ambiguity | Player + threats get through-wall silhouettes; walls near the camera fade; ground-projected aim indicator. Validate at M1, before any art exists. |
| **Style incoherence** from mixed CC0 packs | One shared material palette applied to all imported meshes, overriding pack materials wholesale. Flat-shaded + bloom hides a multitude of sins. |
| **Scope creep into a real 3D game** — animation, IK, ragdolls | Locked at M0: no character IK, no ragdolls, no physics engine, no cutscenes. Baked animations only. |
| **Bundle size** — this ships on npm | Hard 8MB budget checked at M6. Draco-compress GLTFs, single texture atlas, no 4K anything. |
| **The rebuild kills a working game mid-flight** | `cli/` and the `dist/` contract are untouched, so `gcmds` works at every commit from M2 on. The old game stays in git history; `git checkout bdd8b3f -- src/` restores it. |
| **M4 destroying real work** | Tests + scratch-repo verification before `--extreme` is re-enabled. Ship M4 with `--extreme` disabled and turn it on deliberately. |

---

## 9. Resolved: both open questions became flags

Rather than picking one answer, each axis ships all its variants with a safe default and a
CLI override (`cli/rules.mjs`). The game never applies a stricter rule than the one asked for.

| Flag | Default | Values |
|---|---|---|
| `--extreme` | off — lost cargo is **unstaged** | on — lost cargo is **deleted from disk**, and the decay timer is halved |
| `--death=` | `cargo` — hits only knock cargo loose; you cannot be killed | `health` (4 hits, then total loss) · `fragile` (a hit while empty-handed kills you) |
| `--stash=` | `run` — the cache is a safe deposit; stashed cargo ships on a win | `persist` (stashed cargo is held out of the commit and stays staged for next run) · `off` (no cache) |

`persist` needs no disk state: the CLI simply drops those paths from the index, commits,
and re-adds them. `git stash` semantics without a `.gcmds/stash.json`.

Still open: **multiplayer / ghost runs** — out of scope, but the seeded-map decision keeps
the door open.
