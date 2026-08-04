import type { Scene } from 'three';
import { AiBro } from '../entities/enemies/ai-bro';
import { MeetingOrganizer } from '../entities/enemies/meeting-organizer';
import { InviteStorm } from '../entities/enemies/invite-storm';
import { Recruiter } from '../entities/enemies/recruiter';
import { Intern } from '../entities/enemies/intern';
import type { CombatSystem } from '../systems/combat';
import type { MeetingSystem } from '../systems/meetings';
import type { Rng } from '../core/rng';
import type { Grid } from '../world/grid';

/** Don't spawn anything closer to the player than this. */
const MIN_SPAWN_DISTANCE = 22;
/**
 * Kept low on purpose. Past roughly a dozen the screen stops reading as
 * distinct threats you can plan around and becomes undifferentiated noise.
 */
const MAX_LIVE_ENEMIES = 10;
/**
 * Rushers are back on.
 *
 * They were parked because an omniscient beeline rusher is undodgeable: it
 * spawns knowing where you are and walks at you until one of you is dead, which
 * reads as noise rather than pressure. Awareness is the fix rather than a
 * workaround for it — an Intern now idles until it actually sees you and then
 * commits totally, so the pack is something you can avoid, bait, or walk into.
 * They are also what keeps a light-cargo run from being empty, since the
 * Recruiter still wants three crates before it is interested.
 */
const SPAWN_INTERNS = true;
/**
 * Quiet window after a big event. Constant pressure flattens into background
 * noise; the threat only lands if there's a lull to break.
 */
const LULL_SECONDS = 7;
/**
 * How long the opening stays quiet, and how long the ramp to full pressure
 * takes. You need room at the start to find your footing, learn the route and
 * pick up the machine gun before anything serious happens — dropping you
 * straight into the deep end just makes the first thirty seconds the hardest
 * part of the run.
 */
const GRACE_SECONDS = 10;
const RAMP_SECONDS = 55;
/** Hard ceiling per run — see updateStampede. */
const MAX_STAMPEDES = 2;
/** How long a completely undetected player gets before the map leans in. */
const UNDETECTED_PATIENCE = 25;

export interface DirectorEvents {
  /** A named thing is arriving and the player should be told about it. */
  onEvent?: (title: string, subtitle: string, kind: 'warn' | 'bad' | 'info') => void;
}

export interface DirectorContext {
  playerX: number;
  playerZ: number;
  /** 0..1 — how far through the extraction hold. */
  extractionProgress: number;
  extracting: boolean;
  carrying: number;
}

/**
 * Spawn pacing.
 *
 * Pressure tracks what the player is doing rather than a clock: hauling cargo
 * draws recruiters, the mini-boss shows up once you're committed to the route,
 * and the AI bro herd arrives during the extraction hold — the worst possible
 * moment, which is the point.
 */
export class Director {
  private recruiterTimer = 11;
  private internTimer = 16;
  private organizerSpawned = false;
  private stormSpawned = false;
  private stampedesReleased = 0;
  private midRunStampedeDone = false;
  private extractionStampedeDone = false;
  /** Seconds until the one mid-route stampede. */
  private stampedeTimer = 52;
  private quietUntil = 0;
  private elapsed = 0;
  /** Seconds since anything on the map last knew where the player was. */
  private undetectedFor = 0;

  constructor(
    private readonly scene: Scene,
    private readonly combat: CombatSystem,
    private readonly meetings: MeetingSystem,
    private readonly grid: Grid,
    private readonly rng: Rng,
    /** The route, spawn first and extraction last — stampedes run along it. */
    private readonly route: Array<{ x: number; z: number }>,
    /** Scales with the diff — a bigger commit is a busier map. */
    private readonly intensity: number,
    private readonly events: DirectorEvents = {},
  ) {
    // Arc length at each waypoint, so "thirty metres further along the route"
    // is a lookup rather than a walk.
    let total = 0;
    this.routeArc = this.route.map((point, i) => {
      if (i > 0) total += Math.hypot(point.x - this.route[i - 1].x, point.z - this.route[i - 1].z);
      return total;
    });
  }

  /** Cumulative distance along `route`, one entry per waypoint. */
  private readonly routeArc: number[];

  /** True while the map is deliberately quiet after a big moment. */
  private get lulling(): boolean {
    return this.elapsed < this.quietUntil || this.elapsed < GRACE_SECONDS;
  }

  /**
   * 1 at the start, falling toward 0 as the run goes on. Spawn intervals are
   * multiplied by it, so early waves are far apart and the map only reaches
   * full pressure once you're properly under way.
   */
  private get earlyRelief(): number {
    return 1 + 0.9 * (1 - Math.min(1, this.elapsed / RAMP_SECONDS));
  }

  update(dt: number, ctx: DirectorContext): void {
    this.elapsed += dt;
    this.updatePressure(dt, ctx);

    this.updateRecruiters(dt, ctx);
    if (SPAWN_INTERNS) this.updateInterns(dt, ctx);
    this.updateOrganizer(ctx);
    this.updateInviteStorm(ctx);
    this.updateStampede(dt, ctx);
    this.updateScheduledMeetings();
  }

  /**
   * Escalate when nothing has noticed you for a long time.
   *
   * Stealth cuts both ways: successfully avoiding everything also makes the run
   * *longer*, and a map where the player is doing well is exactly the map the
   * director stops contributing to — every enemy it spawns lands 22 units away,
   * unaware, and quietly retires. Undetected is meant to be a tense way to
   * play, not a way to switch the game off, so a long silence pulls the next
   * wave in sooner instead of rewarding waiting.
   */
  private updatePressure(dt: number, ctx: DirectorContext): void {
    if (this.combat.engagedEnemies > 0) {
      this.undetectedFor = 0;
      return;
    }
    this.undetectedFor += dt;
    if (this.undetectedFor < UNDETECTED_PATIENCE) return;
    this.undetectedFor = 0;
    // Only if they are actually hauling something. Sneaking out empty-handed
    // has already cost them the commit; there is nothing to punish.
    if (ctx.carrying <= 0) return;
    this.recruiterTimer = Math.min(this.recruiterTimer, 2);
    this.internTimer = Math.min(this.internTimer, 3);
  }

  private updateRecruiters(dt: number, ctx: DirectorContext): void {
    this.recruiterTimer -= dt;
    if (this.recruiterTimer > 0 || this.lulling) return;
    if (this.combat.engagedEnemies >= MAX_LIVE_ENEMIES) return;

    const recruiter = new Recruiter();
    const spot = this.spawnPoint(ctx);
    recruiter.setPosition(spot.x, spot.z);
    this.combat.add(recruiter, this.scene);

    // The more you're carrying, the more interest you attract.
    const pressure = 1 + ctx.carrying * 0.2 + this.intensity * 0.35;
    this.recruiterTimer = (this.rng.range(11, 18) / pressure) * this.earlyRelief;
  }

  /**
   * Interns arrive in packs. One is nothing; four coming at you while a
   * Recruiter holds range is the pincer the two archetypes exist to create.
   */
  private updateInterns(dt: number, ctx: DirectorContext): void {
    this.internTimer -= dt;
    if (this.internTimer > 0 || this.lulling) return;
    if (this.combat.engagedEnemies >= MAX_LIVE_ENEMIES) return;

    const packSize = 2 + this.rng.int(0, 2 + Math.round(this.intensity * 2));
    const anchor = this.spawnPoint(ctx);
    for (let i = 0; i < packSize; i++) {
      const intern = new Intern(this.rng);
      const spot = this.openNear(anchor.x, anchor.z, 4);
      intern.setPosition(spot.x, spot.z);
      this.grid.resolveCircle(intern, intern.radius);
      this.combat.add(intern, this.scene);
    }
    this.internTimer = (this.rng.range(14, 22) / (1 + this.intensity * 0.5)) * this.earlyRelief;
  }

  private updateOrganizer(ctx: DirectorContext): void {
    if (this.organizerSpawned || this.elapsed < 38) return;
    this.organizerSpawned = true;
    const organizer = new MeetingOrganizer();
    const spot = this.spawnPoint(ctx);
    organizer.setPosition(spot.x, spot.z);
    this.combat.add(organizer, this.scene);
    this.events.onEvent?.('THE ORGANIZER', 'your calendar is no longer yours', 'warn');
  }

  /** Mid-game: once you're actually committed to the haul. */
  private updateInviteStorm(ctx: DirectorContext): void {
    if (this.stormSpawned) return;
    if (this.elapsed < 72) return;
    this.stormSpawned = true;
    const boss = new InviteStorm();
    const spot = this.spawnPoint(ctx);
    boss.setPosition(spot.x, spot.z);
    this.combat.add(boss, this.scene);
    this.events.onEvent?.('OUTLOOK INVITE STORM', 'decline everything', 'bad');
    this.quietUntil = this.elapsed + LULL_SECONDS;
  }

  /**
   * Stampedes are set pieces, not attrition.
   *
   * At most two in a run: one mid-route so you learn what it is, and one
   * during the extraction hold — the signature moment, when you're pinned on
   * the pad and can't simply step aside. On a loop it became weather; rationed
   * to two, each one is an event.
   */
  private updateStampede(dt: number, ctx: DirectorContext): void {
    if (this.stampedesReleased >= MAX_STAMPEDES) return;

    // Never two herds at once. Overlapping waves stop reading as a stampede
    // and become a permanent crowd, which is the opposite of the point — the
    // whole effect depends on it arriving, passing, and leaving.
    if (this.combat.enemies.some((e) => e instanceof AiBro && !e.dying)) return;

    const holdUnderway = ctx.extracting && ctx.extractionProgress > 0.2;
    if (holdUnderway && !this.extractionStampedeDone) {
      this.extractionStampedeDone = true;
      this.launchStampede(ctx);
      return;
    }

    if (this.midRunStampedeDone) return;
    this.stampedeTimer -= dt;
    if (this.stampedeTimer > 0) return;
    this.midRunStampedeDone = true;
    this.launchStampede(ctx);
  }

  private launchStampede(ctx: DirectorContext): void {
    if (!this.releaseStampede(ctx)) return;
    this.stampedesReleased++;
    this.events.onEvent?.('AI BRO STAMPEDE', 'get out of the lane', 'warn');
    this.quietUntil = this.elapsed + LULL_SECONDS;
  }

  /** @returns true if a herd actually went out. */
  private releaseStampede(ctx: DirectorContext): boolean {

    // Enter from whichever end of the route is further from the player, and
    // run the whole thing. That guarantees both a distant spawn — the herd has
    // to be something you see coming, never something that materialises on top
    // of you — and the longest possible run through wherever you're standing.
    // Walking back from the player's nearest waypoint doesn't work: standing
    // at either end of the route leaves no "behind" to back into.
    const head = this.route[0];
    const tail = this.route[this.route.length - 1];
    const fromHead = Math.hypot(head.x - ctx.playerX, head.z - ctx.playerZ);
    const fromTail = Math.hypot(tail.x - ctx.playerX, tail.z - ctx.playerZ);
    const legs = fromHead >= fromTail ? this.route.slice() : this.route.slice().reverse();
    if (legs.length < 2) return false;

    const origin = legs[0];
    // A herd has to look like a herd. Bros are transient, unarmed and leave on
    // their own, so they're exempt from the live-enemy cap that governs
    // attrition spawns.
    const herdSize = 16 + Math.round(this.intensity * 12);
    for (let i = 0; i < herdSize; i++) {
      const bro = new AiBro(this.rng);
      // Spawn in carved space. Placing them by raw offset dropped them inside
      // solid rock, where resolveCircle can't free them and the whole herd
      // just stood still.
      const spot = this.openNear(origin.x, origin.z, 13);
      bro.setPosition(spot.x, spot.z);
      this.grid.resolveCircle(bro, bro.radius);
      // Include the entry waypoint: it's the one point they definitely have a
      // clear line to from where they spawned, and it puts them in the mouth
      // of the corridor before they commit to the run.
      bro.setRoute(legs);
      this.combat.add(bro, this.scene);
    }
    return true;
  }

  /** A nearby point that isn't inside a wall. */
  private openNear(x: number, z: number, spread: number): { x: number; z: number } {
    for (let attempt = 0; attempt < 24; attempt++) {
      const px = x + this.rng.range(-spread, spread);
      const pz = z + this.rng.range(-spread, spread);
      if (!this.grid.isSolidWorld(px, pz)) return { x: px, z: pz };
    }
    return { x, z };
  }

  /**
   * Organizers ask; the director places, because it owns the meeting system.
   *
   * Takes no player position any more — every meeting is placed relative to
   * what an organizer actually saw.
   */
  private updateScheduledMeetings(): void {
    for (const enemy of this.combat.enemies) {
      if (!(enemy instanceof MeetingOrganizer) || enemy.dying) continue;
      if (!enemy.wantsToSchedule()) continue;

      const mandatory = this.rng.next() < 0.55;
      // Mandatory meetings land on you; optional ones are placed just ahead,
      // on the route you were probably about to take. "On you" now means where
      // the organizer last *saw* you — break its line of sight and the meeting
      // lands on the spot you already left.
      const seenX = enemy.believedX;
      const seenZ = enemy.believedZ;
      const x = mandatory ? seenX : seenX + this.rng.range(-14, 14);
      const z = mandatory ? seenZ : seenZ + this.rng.range(-14, 14);
      if (!this.grid.isSolidWorld(x, z)) {
        const meeting = this.meetings.schedule(this.rng, mandatory ? 'mandatory' : 'avoid', x, z);
        if (meeting) {
          this.events.onEvent?.(
            mandatory ? `MANDATORY: ${meeting.title}` : `AVOID: ${meeting.title}`,
            mandatory ? 'attend it — safe from fire inside' : 'step in and you are stuck',
            mandatory ? 'info' : 'bad',
          );
        }
      }
      enemy.resetSchedule(this.rng.range(18, 28) * this.earlyRelief);
    }
  }

  /**
   * Somewhere the player is going to walk into.
   *
   * Spawning on a ring around the player only ever asked whether the cell was
   * solid, which is a much weaker question than it looks on a map that is
   * mostly rock: a spot twenty-five metres away can be a room on the far side
   * of a wall, or a dead end the route never visits. Enemies placed there are
   * enemies the player walks past without ever meeting, and the map reads as
   * emptier than the spawn budget says it is.
   *
   * So the route decides. Most spawns land ahead of the player along it, which
   * is carved ground they are by definition on their way through; some land
   * behind, so the pressure is not always from one direction. The ring is kept
   * only for the case where neither works — near the pad, there is no "ahead"
   * left.
   */
  private spawnPoint(ctx: DirectorContext): { x: number; z: number } {
    const forward = this.rng.next() < 0.75;
    const onRoute =
      this.routeSpawn(ctx, forward) ?? this.routeSpawn(ctx, !forward);
    if (onRoute) return onRoute;

    for (let attempt = 0; attempt < 30; attempt++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const distance = MIN_SPAWN_DISTANCE + this.rng.range(0, 12);
      const x = ctx.playerX + Math.cos(angle) * distance;
      const z = ctx.playerZ + Math.sin(angle) * distance;
      if (!this.grid.isSolidWorld(x, z)) return { x, z };
    }
    // Fall back to anywhere open rather than giving up on the spawn.
    return { x: ctx.playerX + MIN_SPAWN_DISTANCE, z: ctx.playerZ };
  }

  /**
   * A point further along the route than the player, in world units clear of
   * them.
   *
   * The straight-line check is not redundant with the distance walked: the
   * route doubles back on itself, so thirty metres of corridor can leave you
   * eight metres away as the crow flies — which is a spawn in the player's lap.
   */
  private routeSpawn(ctx: DirectorContext, forward: boolean): { x: number; z: number } | null {
    if (this.route.length < 2) return null;
    const from = this.arcOf(ctx.playerX, ctx.playerZ);

    for (let walked = MIN_SPAWN_DISTANCE; walked <= MIN_SPAWN_DISTANCE + 44; walked += 3) {
      const point = this.pointAtArc(from + (forward ? walked : -walked));
      if (!point) return null;
      if (Math.hypot(point.x - ctx.playerX, point.z - ctx.playerZ) < MIN_SPAWN_DISTANCE) continue;

      const spot = this.openNear(point.x, point.z, 5);
      if (this.grid.isSolidWorld(spot.x, spot.z)) continue;
      // Re-check after the jitter, not before: scattering five metres off the
      // centreline can hand back most of the standoff the walk just bought.
      if (Math.hypot(spot.x - ctx.playerX, spot.z - ctx.playerZ) < MIN_SPAWN_DISTANCE) continue;
      return spot;
    }
    return null;
  }

  /** How far along the route the nearest point to (x, z) sits. */
  private arcOf(x: number, z: number): number {
    let best = 0;
    let bestDistance = Infinity;

    for (let i = 0; i < this.route.length - 1; i++) {
      const a = this.route[i];
      const b = this.route[i + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lengthSq = dx * dx + dz * dz;
      const t = lengthSq === 0 ? 0 : clamp01(((x - a.x) * dx + (z - a.z) * dz) / lengthSq);
      const distance = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = this.routeArc[i] + t * Math.sqrt(lengthSq);
      }
    }
    return best;
  }

  /** The point `arc` units along the route, or null if that is off either end. */
  private pointAtArc(arc: number): { x: number; z: number } | null {
    const total = this.routeArc[this.routeArc.length - 1];
    // Stop short of the pad. A spawn on the extraction point itself lands on
    // top of whoever is standing there holding it.
    if (arc < 0 || arc > total - MIN_SPAWN_DISTANCE * 0.5) return null;

    for (let i = 0; i < this.route.length - 1; i++) {
      if (arc > this.routeArc[i + 1]) continue;
      const legLength = this.routeArc[i + 1] - this.routeArc[i];
      const t = legLength === 0 ? 0 : (arc - this.routeArc[i]) / legLength;
      return {
        x: this.route[i].x + (this.route[i + 1].x - this.route[i].x) * t,
        z: this.route[i].z + (this.route[i + 1].z - this.route[i].z) * t,
      };
    }
    return null;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
