import type { Scene } from 'three';
import { AiBro } from '../entities/enemies/ai-bro';
import { MeetingOrganizer } from '../entities/enemies/meeting-organizer';
import { OutlookSwarm } from '../entities/enemies/outlook';
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
 * Rushers are parked for now. The Intern class stays — it's the counterpart to
 * the Recruiter and worth having — but with everything else on the map at once
 * the pincer read as noise rather than pressure.
 */
const SPAWN_INTERNS = false;
/**
 * Quiet window after a big event. Constant pressure flattens into background
 * noise; the threat only lands if there's a lull to break.
 */
const LULL_SECONDS = 7;
/** Hard ceiling per run — see updateStampede. */
const MAX_STAMPEDES = 2;

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
  private recruiterTimer = 6;
  private internTimer = 16;
  private organizerSpawned = false;
  private outlookSpawned = false;
  private stampedesReleased = 0;
  private midRunStampedeDone = false;
  private extractionStampedeDone = false;
  /** Seconds until the one mid-route stampede. */
  private stampedeTimer = 48;
  private quietUntil = 0;
  private elapsed = 0;

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
  ) {}

  /** True while the map is deliberately quiet after a big moment. */
  private get lulling(): boolean {
    return this.elapsed < this.quietUntil;
  }

  update(dt: number, ctx: DirectorContext): void {
    this.elapsed += dt;

    this.updateRecruiters(dt, ctx);
    if (SPAWN_INTERNS) this.updateInterns(dt, ctx);
    this.updateOrganizer(ctx);
    this.updateOutlook(ctx);
    this.updateStampede(dt, ctx);
    this.updateScheduledMeetings(ctx);
  }

  private updateRecruiters(dt: number, ctx: DirectorContext): void {
    this.recruiterTimer -= dt;
    if (this.recruiterTimer > 0 || this.lulling) return;
    if (this.combat.liveEnemies >= MAX_LIVE_ENEMIES) return;

    const recruiter = new Recruiter();
    const spot = this.spawnPoint(ctx);
    recruiter.setPosition(spot.x, spot.z);
    this.combat.add(recruiter, this.scene);

    // The more you're carrying, the more interest you attract.
    const pressure = 1 + ctx.carrying * 0.2 + this.intensity * 0.35;
    this.recruiterTimer = this.rng.range(16, 26) / pressure;
  }

  /**
   * Interns arrive in packs. One is nothing; four coming at you while a
   * Recruiter holds range is the pincer the two archetypes exist to create.
   */
  private updateInterns(dt: number, ctx: DirectorContext): void {
    this.internTimer -= dt;
    if (this.internTimer > 0 || this.lulling) return;
    if (this.combat.liveEnemies >= MAX_LIVE_ENEMIES) return;

    const packSize = 2 + this.rng.int(0, 2 + Math.round(this.intensity * 2));
    const anchor = this.spawnPoint(ctx);
    for (let i = 0; i < packSize; i++) {
      const intern = new Intern(this.rng);
      const spot = this.openNear(anchor.x, anchor.z, 4);
      intern.setPosition(spot.x, spot.z);
      this.grid.resolveCircle(intern, intern.radius);
      this.combat.add(intern, this.scene);
    }
    this.internTimer = this.rng.range(14, 22) / (1 + this.intensity * 0.5);
  }

  private updateOrganizer(ctx: DirectorContext): void {
    if (this.organizerSpawned || this.elapsed < 28) return;
    this.organizerSpawned = true;
    const organizer = new MeetingOrganizer();
    const spot = this.spawnPoint(ctx);
    organizer.setPosition(spot.x, spot.z);
    this.combat.add(organizer, this.scene);
    this.events.onEvent?.('THE ORGANIZER', 'your calendar is no longer yours', 'warn');
  }

  /** Mid-game: once you're actually committed to the haul. */
  private updateOutlook(ctx: DirectorContext): void {
    if (this.outlookSpawned) return;
    if (this.elapsed < 65) return;
    this.outlookSpawned = true;
    const boss = new OutlookSwarm();
    const spot = this.spawnPoint(ctx);
    boss.setPosition(spot.x, spot.z);
    this.combat.add(boss, this.scene);
    this.events.onEvent?.('OUTLOOK INVITE SWARM', 'decline everything', 'bad');
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

  /** Organizers ask; the director places, because it owns the meeting system. */
  private updateScheduledMeetings(ctx: DirectorContext): void {
    for (const enemy of this.combat.enemies) {
      if (!(enemy instanceof MeetingOrganizer) || enemy.dying) continue;
      if (!enemy.wantsToSchedule()) continue;

      const mandatory = this.rng.next() < 0.55;
      // Mandatory meetings land on you; optional ones are placed just ahead,
      // on the route you were probably about to take.
      const x = mandatory ? ctx.playerX : ctx.playerX + this.rng.range(-14, 14);
      const z = mandatory ? ctx.playerZ : ctx.playerZ + this.rng.range(-14, 14);
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
      enemy.resetSchedule(this.rng.range(18, 28));
    }
  }

  /** A point out of sight and out of reach, so nothing spawns on your head. */
  private spawnPoint(ctx: DirectorContext): { x: number; z: number } {
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
}
