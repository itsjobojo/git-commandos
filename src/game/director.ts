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
const MAX_LIVE_ENEMIES = 18;

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
  private elapsed = 0;

  constructor(
    private readonly scene: Scene,
    private readonly combat: CombatSystem,
    private readonly meetings: MeetingSystem,
    private readonly grid: Grid,
    private readonly rng: Rng,
    /** Scales with the diff — a bigger commit is a busier map. */
    private readonly intensity: number,
  ) {}

  update(dt: number, ctx: DirectorContext): void {
    this.elapsed += dt;

    this.updateRecruiters(dt, ctx);
    this.updateOrganizer(ctx);
    this.updateOutlook(ctx);
    this.updateStampede(ctx);
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
    const pressure = 1 + ctx.carrying * 0.35 + this.intensity * 0.5;
    this.recruiterTimer = this.rng.range(7, 12) / pressure;
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
   * The herd. Released once the extraction hold is genuinely underway, so it
   * lands while you are pinned on the pad and cannot simply walk away.
   */
  private updateStampede(ctx: DirectorContext): void {
    if (this.stampedeReleased || !ctx.extracting || ctx.extractionProgress < 0.25) return;
    this.stampedeReleased = true;

    const herdSize = 4 + Math.round(this.intensity * 4);
    for (let i = 0; i < herdSize; i++) {
      const bro = new AiBro(this.rng);
      // Arrive as a wedge from one side rather than surrounding you — you
      // should be able to see them coming and choose to hold anyway.
      const angle = this.rng.range(0, Math.PI * 2);
      const spread = (i - herdSize / 2) * 1.6;
      bro.setPosition(
        ctx.playerX + Math.cos(angle) * MIN_SPAWN_DISTANCE - Math.sin(angle) * spread,
        ctx.playerZ + Math.sin(angle) * MIN_SPAWN_DISTANCE + Math.cos(angle) * spread,
      );
      this.grid.resolveCircle(bro, bro.radius);
      this.combat.add(bro, this.scene);
    }
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
        this.meetings.schedule(this.rng, mandatory ? 'mandatory' : 'optional', x, z);
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
