# Git Commandos — Gameplay Fix Spec

Implementation spec from a code review (2026-07-22). Work through the items in priority
order. Each item is self-contained: current behavior, required behavior, suggested
implementation, and acceptance criteria. Line numbers are hints from the reviewed
revision (`5d6894b`) and may drift — anchor on function/class names.

Conventions used in this repo (see CLAUDE.md): game code in `src/` (TypeScript, Vite),
CLI in `cli/` (Node ESM, never imports `src/`). No tests or linting exist; verify by
running `pnpm dev` (sandbox, `gitContext = null`) and the real flow:
`pnpm build && node cli/index.mjs fake-files --count=5 && node cli/index.mjs commit -m "test"`.

---

## P0-1: Wire player damage to git file loss (core mechanic, currently missing)

**Current:** CLAUDE.md documents "taking damage kills the last alive file; health
pickups revive the last dead one" — but nothing implements the first half.
`GitFile.alive` is only set to `false` on total death (`game.ts` ~line 569 marks *all*
files dead at once). `Player.takeDamage` (`src/entities/player.ts` ~154) knows nothing
about files. Consequences: on any win every file survives, the partial-win path in
`cli/commands/commit.mjs` (~75–86) is dead code, the HUD file strip never shows a lost
file mid-run, and `recoverGitFile()` / health pickups are no-ops.

**Required:** Each point of HP the player loses kills the **last currently-alive**
file in `gitFiles`. Each point of HP recovered (health pickup, rush-zone heal) revives
the **most recently killed** file — this half already exists as
`Game.recoverGitFile()` (`game.ts` ~1179); reuse it, do not duplicate.

**Implementation notes:**
- Do this in `Game`, not `Player` — `Player` must stay git-agnostic. Add a private
  helper `loseGitFile()` mirroring `recoverGitFile()` (iterate forward, kill first
  alive from the end — i.e. last alive file).
- Call sites: everywhere `this.player.takeDamage(1)` is called in `Game.update`
  (enemy bullet hit ~498, enemy contact ~509). Only kill a file if the damage
  actually landed — `takeDamage` returns void and silently no-ops during
  invincibility, so either change it to return `boolean` (damage applied) or compare
  `hp` before/after. Returning `boolean` is cleaner.
- The rush-zone heal (`game.ts` ~220–227) increments `hp` directly — it must also
  call `recoverGitFile()` (the health pickup path already does).
- Death (`hp` reaches 0) already marks all files dead; keep that as the final
  backstop, it becomes a no-op if per-hit loss is correct.
- Show a popup when a file dies (there is `addPopup`; mirror the existing
  `RECOVERED: <basename>` popup with e.g. `LOST: <basename>`).

**Accept:** In git mode with 5 staged fake files: take 2 hits → HUD strip shows 2
struck-through files; grab a health pickup → one revives; win → CLI commits 4 files
and unstages 1 (basic mode). Sandbox mode (`pnpm dev`) unaffected (guard on
`this.gitContext`, as `recoverGitFile` already does).

---

## P0-2: Melee hits once per swing, not once per frame

**Current:** While `meleeTimer > 0` (0.2 s ≈ 12 ticks at 60 Hz), the melee block in
`Game.update` (~248–283) applies `takeDamage(2)` to every overlapping enemy **every
tick** → up to ~24 damage per swing. One knife swipe kills the 18 HP AiBroStampede
boss and the 5 HP OutlookSwarm instantly.

**Required:** A single swing damages each enemy at most once (2 damage). Bullet
deflection and invite destruction may stay per-frame (they destroy their target, so
they're naturally idempotent).

**Implementation:** Track hit entities per swing. E.g. `private meleeHitEnemies =
new Set<Enemy>()` on `Game`, cleared in `Player.melee()`'s call site (or add the set
to `Player` and clear inside `melee()`). Skip enemies already in the set.

**Accept:** Knife swipe on AiBroStampede removes exactly 2 HP (it survives; takes 9
swings). Grunts (1–2 HP) still die in one swipe.

---

## P0-3: Pistol becomes infinite; never strand the player weaponless

**Current:** `Player.fire()` (`src/entities/player.ts` ~90–99) decrements `ammo`;
when it hits 0 it "falls back to pistol" but sets `ammo = 0`, so `hasAmmo()` is false
forever and the player is knife-only for the rest of a 4+ minute level. Player starts
with only 30 pistol rounds.

**Required:** The pistol has **infinite ammo**. Picked-up weapons (smg / machinegun /
shotgun) consume ammo; when their ammo runs out the player reverts to the infinite
pistol.

**Implementation:**
- Treat `weapon === 'pistol'` as infinite: `hasAmmo()` returns true for pistol;
  `fire()` skips the decrement for pistol.
- On ammo depletion of a non-pistol weapon, set `weapon = 'pistol'` (ammo value then
  irrelevant; set to 0 or leave).
- HUD (`src/systems/hud.ts` ~106–113): currently shows `KNIFE` when `ammo <= 0`.
  Change to show `PISTOL: ∞` (or just `PISTOL`) when the pistol is equipped, and
  `NAME: <ammo>` otherwise. The knife/melee still exists (Z with... actually melee
  now only triggers if you keep it reachable — see below).
- `Game.update` shooting block (~233–245): the `canMelee()` branch currently fires
  only when out of ammo. With an infinite pistol that branch becomes unreachable.
  Keep melee available: it's a deliberate close-range option and P0-2 balances it.
  Bind it to a dedicated key (`X` is free — `Input.blame` exists and is unused) and
  fire it regardless of ammo. Update the info overlay (`renderInfoOverlay`) and HUD
  hint text accordingly.
- `ammo` pickup while holding pistol: currently grants pistol ammo — make it a no-op
  fallback: grant ammo for the current weapon only if non-pistol; otherwise convert
  to +25 score with a popup (cheap, avoids a useless pickup).

**Accept:** Fire continuously for 60 s with no pickups — player can always shoot.
Picking up SMG → ammo counts down → at 0 reverts to pistol and keeps firing. X stabs.

---

## P1-1: Shorten minimum level, make the finish unmissable

**Current:** `Game` constructor (~86–88): `gameRows = clamp(320 + files*72 +
lines*0.2, 320, 1520)`. At 18 px/s camera and 16 px tiles that is **~4.5 min minimum,
~22 min max** — far too long for a commit gate. Worse, the world wraps and the END
pad (`world.ts`, `END_AREA`, 14 of 24 tiles wide) can be dodged by hugging an edge →
the level silently loops forever.

**Required:**
1. New length formula: `gameRows = clamp(140 + files*24 + lines*0.08, 140, 480)`
   → roughly 2 min minimum, ~7 min max. Keep the CLI `payload.gameRows` override
   working (it takes precedence, unchanged).
2. Finish cannot be missed: when the END area row is on screen, win if the player's
   **row band** overlaps it regardless of X. Simplest: extend the win check
   (`game.ts` ~366–379) to ignore X, or widen `END_AREA` to full width
   (`AREA_W = COLS`) at generation time. Full-width pad is preferred — it also
   reads visually as a finish line.
3. Add an off-screen indicator: while the END area is below/above the horizon,
   nothing; this is a vertical scroller so the end always arrives by scrolling —
   the full-width pad alone is sufficient. (No arrow needed if 2 is done.)
4. Derive the intro time estimate (`renderLevelIntro`, ~1242) and `END_AREA.row`
   placement from shared constants instead of the magic `40` / `(gameRows-21)` pair.
   Keep behavior identical otherwise; `initWorld` in `world.ts` (~394–401) is where
   `END_AREA.row` is set (note the stale "~87%" comment — remove it).

**Accept:** `gcmds fake-files --count=3` + commit → intro estimate ≈ 2–2.5 min and
matches actual playtime within ~15%; reaching the end anywhere across the screen
width wins; a full run cannot loop past the end.

---

## P1-2: Collision fixes

### a) Recruiter vs world — bounce is ineffective
`Game.update` (~423–428) restores position and flips `vx` on world collision, but
`Recruiter.ai` (`src/entities/enemies/recruiter.ts` ~30) recomputes
`x = baseX + sin(sineOffset) * 30` every frame, so the flip does nothing; recruiters
jitter against / clip into buildings.

**Fix:** On world collision in the game loop, adjust the recruiter's `baseX` by the
restore delta (i.e. `enemy.baseX += ex - enemy.x` before restoring) — expose `baseX`
or add a `nudge(dx)` method on `Recruiter`. Alternative accepted: make `ai()`
integrate `x += vx*dt` with a sine-driven `vx` instead of absolute positioning. Either
way, a recruiter meeting a building must slide/bounce visibly rather than vibrate
inside it.

### b) `hitboxPadding` — implement or delete
`Projectile.hitboxPadding` (`src/entities/projectile.ts` ~9) is set by
`Recruiter.fire` (=9) but `getBounds()` ignores it. Decide: **delete the field and the
assignment** (preferred — the 4×4 box is fine), or make `getBounds()` apply it. Do not
leave it dead.

### c) Shrink the player hurtbox
Player collision uses the full 24×24 sprite. Add a centered hurtbox for *incoming*
damage only (enemy bullets, enemy contact, invites): 14×14 centered on the sprite.
Implement as `Player.getHurtBounds()` used by the damage checks in `Game.update`
(~496–536). World collision, pickups, and the end-area check keep the full box
(pickups feeling generous is good).

### d) NaN guard in Recruiter.fire
`recruiter.ts` ~56: `dist` can be 0 → NaN velocities. Use
`const dist = Math.sqrt(...) || 1;` (same guard `OutlookSwarm.spawnInvite` uses).

**Accept (P1-2):** Recruiters visibly bounce off buildings; grep shows no unused
`hitboxPadding`; player can graze bullets that visually overlap the sprite's edge
pixels without taking damage.

---

## P1-3: Spawn system — weighted table + progress-based difficulty

**Current:** `Game.spawnWave` (~992–1066) is an if/else chain over one `Math.random()`
with gap ranges (0.7–0.92 and 0.96–0.98 both fall into the trailing `else`), and
difficulty scales on `gameTime` only: `difficultyScale` caps at 2× by 100 s, spawn
interval floors at ~133 s (`update` ~388–392). In a 2–7 min level the whole back half
is flat.

**Required:**
1. Refactor to a weighted spawn table — an array of
   `{ weight, spawn: () => void }` entries; roll once, walk the cumulative weights.
   Keep current relative frequencies: recruiters-top 25, interns-top 20,
   side-interns 25, side-recruiters 22, outlook-boss 4, ai-bro 2 (out of ~100 —
   exact normalization is fine). Keep the existing guards (boss uniqueness checks,
   the 70% spawn suppression while an outlook boss is active, `span.h >= 32`
   side-spawn requirement).
2. Scale difficulty by **level progress** (fraction of total scroll completed:
   `this.camera.y / (this.gameRows * TILE_SIZE)` clamped 0..1), not wall time:
   - `difficultyScale = 1 + progress * 1.5` (1 → 2.5 across the level)
   - spawn interval base: `3.5 - progress * 2.0` (3.5 s → 1.5 s), keep `+ rand*2`
   - keep the two *guaranteed* boss spawns but trigger on progress: outlook at 15%,
     ai-bro at 45% (replaces the 20 s / 50 s timers).
3. Replace the `(enemy as any)._sideSpawn` hack with a real
   `sideSpawn = false` field on `Enemy` (`src/entities/enemies/enemy.ts`). Update the
   two set-sites in `spawnWave` and the read-sites in `update` (~398, 408).

**Accept:** TypeScript compiles with no `as any` for `_sideSpawn`; playing start vs
end of a level shows a clear density difference; both bosses appear once per run at
roughly 15% / 45% progress; weapon-tier gating in `maybeDropPickup` (~1107) switches
from `gameTime` thresholds to progress (`< 0.15` smg, `< 0.4` +machinegun, else all).

---

## P2-1: Pickup polish

- **`cherry-pick` is unreachable:** `maybeDropPickup` (~1102–1125) never rolls it.
  Add it to the table: new roll split — weapon 0.40, ammo 0.20, health 0.15,
  revert 0.13, cherry-pick 0.07, stash 0.05.
- **Ammo and stash share a sprite:** `pickup.ts` ~52–59 maps both `stash` and `ammo`
  (and default) to col 8 row 1. Give `ammo` a distinct tile — pick any unused
  cell in the same weapon sheet (verify visually in `pnpm dev`); if none looks right,
  render `ammo` as the current weapon's sprite at half size with an "A" glyph overlay.
- Machine gun drains 80 ammo in ~1.3 s of held fire (0.05 s rate × 3-pellet spread
  is per-shot ammo, that part is fine — it's just fast). Raise machinegun
  `ammoOnPickup` to 120 in `src/weapons.ts` and lower its `fireRate` cost by leaving
  rate but that's enough; no other weapon rebalance.

---

## P2-2: Meeting modal key handling

`Game.pickModalKeys` (~825–832) and the modal input block (~173–188):
- Remove `I` and `X` from the pool (`I` toggles the info overlay while answering,
  `X` becomes the melee key per P0-3). New pool: `BFGHJKLMNOPRTUVY`.
- Use only `justPressed`, drop the `isDown` fallback — holding a key when the modal
  spawns must not auto-answer it.
- Colliding with an invite currently deals no damage (shake + sound only). Keep it
  damage-free (it's a fun tax, and P0-1 makes real damage costly) — but the modal
  should cost *something*: while the modal is up the player already keeps playing;
  instead make **Accept** apply `player.vx/vy *= 0.5` slow for 3 s (meeting brain)
  via a `meetingSlowTimer` on `Game`, and Decline stays +50 score. Mention both on
  the modal buttons ("Accept [B] -slow" is too cramped — just add a one-line hint
  under the buttons: "accepting slows you down").

---

## P2-3: Announcement zones scroll with the world

`src/systems/announcements.ts`: zones are spawned in screen coordinates
(`spawnZone` ~79–81) and `screenY()` (~102) returns `worldY` untransformed — the
field name lies, and zones float stationary over scrolling ground.

**Fix:** Store spawn-time camera Y (`update` already receives `_cameraY` — un-ignore
it): `zone.worldY = screenYAtSpawn + cameraYAtSpawn`, and
`screenY(z) = z.worldY - cameraY` (pass `cameraY` through to the collision/render
helpers — `Game` calls them and has `this.camera.y`). Zones then ride the terrain.
Keep durations as-is; a zone that scrolls off the bottom before its timer ends just
expires off-screen, which is fine. Note the world wraps via modulo in `world.ts`;
zones live only seconds so simple subtraction is sufficient — no wrap handling.

---

## P2-4: Small cleanups (single pass)

- `src/core/input.ts` keydown handler: call `e.preventDefault()` only for keys the
  game uses (arrows, WASD, Space, Z/X/C/Q/E/I, Enter) so browser shortcuts (F5,
  Cmd+R, F12) work.
- Stale comment `player.ts` ~49 ("vertical movement keeps sprite facing up") — the
  code intentionally rotates via `atan2`; fix the comment, keep the behavior.
- `Input.blame` getter: repurposed as melee key by P0-3 — rename getter to `melee`.
- Delete `previousKeys` bookkeeping in `Input.endFrame` if still unused after the
  above (it currently is).

---

## Explicitly out of scope

- Bullets passing through buildings: **keep** (design choice; terrain-as-cover would
  need enemy-AI awareness it doesn't have).
- Any CLI behavior change beyond what P1-1 requires (formula lives in `src/`).
- Art/sound/music, new enemies, mobile input.

## Verification checklist (run after all items)

1. `pnpm build` — clean TypeScript compile, no `as any` casts added.
2. `pnpm dev` sandbox: title → play → melee with X, infinite pistol, weapon pickups
   cycle correctly, recruiters bounce off buildings, both bosses appear, finish line
   spans full width and ends the run.
3. Git flow: `node cli/index.mjs fake-files --count=5`, then
   `node cli/index.mjs commit -m "spec test"`. Take hits → files strike through one
   at a time; heal → last lost file revives; win with 1 file lost → CLI unstages
   exactly that file and commits 4. Lose → all 5 unstaged, no commit.
4. `node cli/index.mjs fake-files --clean` to reset.
