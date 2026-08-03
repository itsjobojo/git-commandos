import type { Scene } from 'three';
import { Faction, ProjectilePool } from './projectiles';
import { Enemy, type EnemyContext } from '../entities/enemies/enemy';
import { AiBro } from '../entities/enemies/ai-bro';
import type { Player } from '../entities/player';
import type { Grid } from '../world/grid';

/** Player weapon. One gun for now; pickups are a later milestone. */
export const WEAPON = {
  fireInterval: 0.12,
  speed: 34,
  damage: 1,
  spread: 0.045,
  /** Pushes you back slightly, which also sells the shot. */
  recoil: 1.2,
} as const;

export interface CombatEvents {
  onEnemyKilled?: (enemy: Enemy) => void;
  onPlayerHit?: () => boolean;
  shake?: (amount: number) => void;
}

/**
 * Bullets, hits and death.
 *
 * The one rule this system does *not* own is what a hit costs the player —
 * that depends on the death rule, which only `Game` knows. Combat asks, `Game`
 * decides, and the cargo ledger records. Keeping that chain one-directional is
 * what stops enemy code from ever touching git state.
 */
export class CombatSystem {
  readonly enemies: Enemy[] = [];
  readonly projectiles: ProjectilePool;
  private fireCooldown = 0;

  constructor(
    scene: Scene,
    private readonly grid: Grid,
    private readonly events: CombatEvents = {},
  ) {
    this.projectiles = new ProjectilePool(scene);
  }

  add(enemy: Enemy, scene: Scene): void {
    this.enemies.push(enemy);
    scene.add(enemy.group);
  }

  get liveEnemies(): number {
    return this.enemies.reduce((n, e) => n + (e.dying ? 0 : 1), 0);
  }

  update(dt: number, player: Player, ctx: EnemyContext, firing: boolean, scene: Scene): void {
    this.updatePlayerFire(dt, player, firing);

    for (const enemy of this.enemies) {
      if (enemy.dying) continue;
      enemy.think(dt, ctx);
    }

    this.applyShoves(player);
    this.projectiles.update(dt, this.grid, player.x, player.z);
    this.resolveHits(player);
    this.reap(scene, dt);
  }

  private updatePlayerFire(dt: number, player: Player, firing: boolean): void {
    this.fireCooldown -= dt;
    // No shooting mid-roll — the dodge has to cost you something.
    if (!firing || player.isRolling || this.fireCooldown > 0) return;

    const angle = player.yaw + (Math.random() * 2 - 1) * WEAPON.spread;
    this.projectiles.spawn({
      x: player.x + Math.cos(player.yaw) * 0.8,
      z: player.z + Math.sin(player.yaw) * 0.8,
      dirX: Math.cos(angle),
      dirZ: Math.sin(angle),
      speed: WEAPON.speed,
      damage: WEAPON.damage,
      faction: Faction.Player,
    });
    player.vx -= Math.cos(player.yaw) * WEAPON.recoil;
    player.vz -= Math.sin(player.yaw) * WEAPON.recoil;
    this.fireCooldown = WEAPON.fireInterval;
  }

  /** AI bros push rather than shoot — apply and clear their impulse. */
  private applyShoves(player: Player): void {
    for (const enemy of this.enemies) {
      if (!(enemy instanceof AiBro) || !enemy.shovedThisStep) continue;
      player.vx += enemy.shoveX;
      player.vz += enemy.shoveZ;
      enemy.shovedThisStep = false;
    }
  }

  private resolveHits(player: Player): void {
    for (let i = 0; i < this.projectiles.capacity; i++) {
      if (!this.projectiles.isAlive(i)) continue;
      const bx = this.projectiles.positionX(i);
      const bz = this.projectiles.positionZ(i);
      const br = this.projectiles.radiusOf(i);

      if (this.projectiles.factionOf(i) === Faction.Player) {
        for (const enemy of this.enemies) {
          if (enemy.dying) continue;
          const r = br + enemy.radius;
          const dx = enemy.x - bx;
          const dz = enemy.z - bz;
          if (dx * dx + dz * dz > r * r) continue;
          this.projectiles.kill(i);
          if (enemy.damage(this.projectiles.damageOf(i))) {
            this.events.onEnemyKilled?.(enemy);
          }
          break;
        }
        continue;
      }

      // Enemy fire. Shooting an incoming invite declines it, which is the
      // Outlook boss's whole counterplay.
      const r = br + player.radius;
      const dx = player.x - bx;
      const dz = player.z - bz;
      if (dx * dx + dz * dz > r * r) continue;
      this.projectiles.kill(i);
      if (!player.invulnerable) this.events.onPlayerHit?.();
    }
  }

  /** Remove the dead once their collapse animation finishes. */
  private reap(scene: Scene, dt: number): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy.dying) continue;
      enemy.deathTimer -= dt;
      const t = Math.max(0, enemy.deathTimer / 0.32);
      enemy.group.scale.setScalar(t);
      enemy.group.rotation.z = (1 - t) * 1.4;
      if (enemy.deathTimer <= 0) {
        scene.remove(enemy.group);
        (enemy as { dispose?: () => void }).dispose?.();
        this.enemies.splice(i, 1);
      }
    }
  }
}
