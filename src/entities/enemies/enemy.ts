import type { Group } from 'three';
import { Entity } from '../entity';
import type { Grid } from '../../world/grid';
import type { Rng } from '../../core/rng';

/**
 * What an enemy is allowed to know and do.
 *
 * Deliberately narrow: enemies can see the player, the map, and fire. They
 * cannot touch the cargo ledger, end the run, or reach git state. Damage flows
 * one way — an enemy asks to hit the player, and `Game` decides what that
 * costs, because only `Game` knows the death rule.
 */
export interface EnemyContext {
  readonly playerX: number;
  readonly playerZ: number;
  /** How much cargo the player is hauling — several archetypes key off this. */
  readonly playerCarrying: number;
  readonly grid: Grid;
  readonly rng: Rng;
  /** Real elapsed seconds, for animation that must not stop during hitstop. */
  readonly time: number;
  /** True once the extraction hold has started — the cue to escalate. */
  readonly extracting: boolean;

  fire(opts: {
    x: number;
    z: number;
    dirX: number;
    dirZ: number;
    speed: number;
    damage: number;
    life?: number;
    radius?: number;
    homing?: number;
  }): void;
  /** Ask to land a hit on the player. Returns true if it actually landed. */
  hitPlayer(): boolean;
  shake(amount: number): void;
}

export abstract class Enemy extends Entity {
  hp = 3;
  maxHp = 3;
  /** Contact damage cooldown, so touching the player doesn't hit every step. */
  protected touchCooldown = 0;
  /** Set on death so the world can drop effects before removal. */
  dying = false;
  deathTimer = 0;

  abstract readonly group: Group;

  /** Per-step behaviour. */
  abstract think(dt: number, ctx: EnemyContext): void;

  tick(dt: number): void {
    if (this.touchCooldown > 0) this.touchCooldown -= dt;
  }

  /** @returns true if this killed it. */
  damage(amount: number): boolean {
    if (this.dying) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.dying = true;
      this.deathTimer = 0.32;
      return true;
    }
    return false;
  }

  /** Standard contact attack, rate-limited. */
  protected tryTouch(ctx: EnemyContext, reach = 0.4): void {
    if (this.touchCooldown > 0) return;
    const d = Math.hypot(ctx.playerX - this.x, ctx.playerZ - this.z);
    if (d > this.radius + reach + 0.55) return;
    if (ctx.hitPlayer()) this.touchCooldown = 1.2;
  }

  /** Move toward a point, sliding along walls rather than sticking to them. */
  protected moveToward(dt: number, grid: Grid, tx: number, tz: number, speed: number): void {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    this.vx = (dx / d) * speed;
    this.vz = (dz / d) * speed;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    grid.resolveCircle(this, this.radius);
    this.yaw = Math.atan2(dz, dx);
  }
}
