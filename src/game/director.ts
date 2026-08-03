import type { Scene } from 'three';
import { AiBro } from '../entities/enemies/ai-bro';
import { MeetingOrganizer } from '../entities/enemies/meeting-organizer';
import { OutlookSwarm } from '../entities/enemies/outlook';
import { Recruiter } from '../entities/enemies/recruiter';
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
const MAX_LIVE_ENEMIES = 12;

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
  private organizerSpawned = false;
  private outlookSpawned = false;
  private stampedeReleased = false;
  private stampedeTimer = 20;
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
  ) {}

  update(dt: number, ctx: DirectorContext): void {
    this.elapsed += dt;

    this.updateRecruiters(dt, ctx);
    this.updateOrganizer(ctx);
    this.updateOutlook(ctx);
    this.updateStampede(dt, ctx);
    this.updateScheduledMeetings(ctx);
  }

  private updateRecruiters(dt: number, ctx: DirectorContext): void {
    this.recruiterTimer -= dt;
    if (this.recruiterTimer > 0) return;
    if (this.combat.liveEnemies >= MAX_LIVE_ENEMIES) return;

    const recruiter = new Recruiter();
    const spot = this.spawnPoint(ctx);
    recruiter.setPosition(spot.x, spot.z);
    this.combat.add(recruiter, this.scene);

    // The more you're carrying, the more interest you attract.
    const pressure = 1 + ctx.carrying * 0.25 + this.intensity * 0.4;
    this.recruiterTimer = this.rng.range(10, 16) / pressure;
  }

  private updateOrganizer(ctx: DirectorContext): void {
    if (this.organizerSpawned || this.elapsed < 12) return;
    this.organizerSpawned = true;
    const organizer = new MeetingOrganizer();
    const spot = this.spawnPoint(ctx);
    organizer.setPosition(spot.x, spot.z);
    this.combat.add(organizer, this.scene);
  }

  /** Mid-game: once you're actually committed to the haul. */
  private updateOutlook(ctx: DirectorContext): void {
    if (this.outlookSpawned) return;
    if (ctx.carrying < 2 && this.elapsed < 45) return;
    this.outlookSpawned = true;
    const boss = new OutlookSwarm();
    const spot = this.spawnPoint(ctx);
    boss.setPosition(spot.x, spot.z);
    this.combat.add(boss, this.scene);
  }

  /**
   * Stampede waves.
   *
   * The herd runs the route from one end to the other and out the far side —
   * it is not hunting you, you are simply standing in a corridor it is about
   * to come down. Waves are frequent during the extraction hold, when you are
   * pinned on the pad and can't just step aside.
   */
  private updateStampede(dt: number, ctx: DirectorContext): void {
    this.stampedeTimer -= dt;
    if (this.stampedeTimer > 0) return;

    // Only start once you're actually on the route, not while still landing.
    if (!this.stampedeReleased && this.elapsed < 25 && !ctx.extracting) {
      this.stampedeTimer = 4;
      return;
    }
    this.stampedeReleased = true;
    this.releaseStampede(ctx);
    this.stampedeTimer = ctx.extracting
      ? this.rng.range(11, 16)
      : this.rng.range(28, 40);
  }

  private releaseStampede(ctx: DirectorContext): void {
    if (this.combat.liveEnemies >= MAX_LIVE_ENEMIES) return;

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
    if (legs.length < 2) return;

    const origin = legs[0];
    const herdSize = 5 + Math.round(this.intensity * 4);
    for (let i = 0; i < herdSize; i++) {
      const bro = new AiBro(this.rng);
      // Spawn in carved space. Placing them by raw offset dropped them inside
      // solid rock, where resolveCircle can't free them and the whole herd
      // just stood still.
      const spot = this.openNear(origin.x, origin.z, 6);
      bro.setPosition(spot.x, spot.z);
      this.grid.resolveCircle(bro, bro.radius);
      // Include the entry waypoint: it's the one point they definitely have a
      // clear line to from where they spawned, and it puts them in the mouth
      // of the corridor before they commit to the run.
      bro.setRoute(legs);
      this.combat.add(bro, this.scene);
    }
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
        this.meetings.schedule(this.rng, mandatory ? 'mandatory' : 'avoid', x, z);
      }
      enemy.resetSchedule(this.rng.range(9, 15));
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
