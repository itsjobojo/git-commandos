import type { Scene } from 'three';
import { Faction, ProjectilePool } from './projectiles';
import { Enemy, type EnemyContext } from '../entities/enemies/enemy';
import { AiBro } from '../entities/enemies/ai-bro';
import type { Player } from '../entities/player';
import type { Grid } from '../world/grid';
import type { Loadout, WeaponId } from './weapons';

export interface CombatEvents {
  onEnemyKilled?: (enemy: Enemy) => void;
  /** A round left the player's muzzle. @param x/z where the muzzle was. */
  onPlayerShot?: (weapon: WeaponId, x: number, z: number) => void;
  /** A player round connected without killing. @param x/z the point of impact. */
  onEnemyHit?: (x: number, z: number) => void;
  /** @param sourceX/sourceZ where the hit came from, for directional feedback. */
  onPlayerHit?: (sourceX: number, sourceZ: number) => boolean;
  shake?: (amount: number) => void;
  /** The held weapon just ran dry and dropped back to the sidearm. */
  onOutOfAmmo?: () => void;
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
    private readonly loadout: Loadout,
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
      // Without this the renderer interpolates from wherever the enemy spawned
      // to where it is now, every frame — so it appears in two places at once
      // AND your shots miss, because the hitbox is nowhere near the ghost you
      // were aiming at.
      enemy.savePrevious();
      enemy.think(dt, ctx);
    }

    this.separate(player);
    this.applyShoves(player);
    this.projectiles.update(dt, this.grid, player.x, player.z);
    this.resolveHits(player);
    this.reap(scene, dt);
  }

  /**
   * Push overlapping bodies apart.
   *
   * Without this they converge to the same point and stack, so a pack reads as
   * a single enemy — one of them is simply inside another and invisible. Three
   * relaxation passes settles a rushing pack without letting a crowd jitter;
   * the grid gets the final say so nothing is ever shoved into a wall.
   */
  private separate(player: Player): void {
    const live = this.enemies.filter((e) => !e.dying);

    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i];
          const b = live[j];
          const minimum = a.radius + b.radius;
          let dx = b.x - a.x;
          let dz = b.z - a.z;
          let distance = Math.hypot(dx, dz);

          if (distance >= minimum) continue;
          if (distance < 1e-4) {
            // Exactly coincident — nudge along an arbitrary but stable axis.
            dx = (a.id % 2 === 0 ? 1 : -1) * 0.01;
            dz = 0.01;
            distance = Math.hypot(dx, dz);
          }

          const push = (minimum - distance) * 0.5;
          const nx = (dx / distance) * push;
          const nz = (dz / distance) * push;
          a.x -= nx;
          a.z -= nz;
          b.x += nx;
          b.z += nz;
        }
      }
    }

    for (const enemy of live) {
      // Don't let anything stand inside the player either — being unable to
      // see what's hitting you is the same bug from the other direction.
      const dx = enemy.x - player.x;
      const dz = enemy.z - player.z;
      const minimum = enemy.radius + player.radius;
      const distance = Math.hypot(dx, dz);
      if (distance < minimum && distance > 1e-4) {
        const push = minimum - distance;
        enemy.x += (dx / distance) * push;
        enemy.z += (dz / distance) * push;
      }
      this.grid.resolveCircle(enemy, enemy.radius);
    }
  }

  private updatePlayerFire(dt: number, player: Player, firing: boolean): void {
    this.fireCooldown -= dt;
    // No shooting mid-roll — the dodge has to cost you something.
    if (!firing || player.isRolling || this.fireCooldown > 0) return;

    const weapon = this.loadout.weapon;
    const muzzleX = player.x + Math.cos(player.yaw) * 0.8;
    const muzzleZ = player.z + Math.sin(player.yaw) * 0.8;

    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const angle = player.yaw + (Math.random() * 2 - 1) * weapon.spread;
      this.projectiles.spawn({
        x: muzzleX,
        z: muzzleZ,
        dirX: Math.cos(angle),
        dirZ: Math.sin(angle),
        speed: weapon.speed * (0.9 + Math.random() * 0.2),
        damage: weapon.damage,
        faction: Faction.Player,
      });
    }

    player.vx -= Math.cos(player.yaw) * weapon.recoil;
    player.vz -= Math.sin(player.yaw) * weapon.recoil;
    // One report per trigger pull, not per pellet — seven overlapping copies of
    // the same sample is a click, not a shotgun.
    this.events.onPlayerShot?.(weapon.id, muzzleX, muzzleZ);
    if (weapon.recoil > 3) this.events.shake?.(0.14);
    this.fireCooldown = weapon.fireInterval;

    // Ammo is spent per trigger pull, not per pellet — a shotgun shell is one
    // shell however many pellets come out of it.
    if (this.loadout.spendRound()) this.events.onOutOfAmmo?.();
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
          } else {
            this.events.onEnemyHit?.(bx, bz);
          }
          break;
        }
        continue;
      }

      // Enemy fire. Shooting an incoming invite declines it, which is the
      // invite swarm's whole counterplay.
      const r = br + player.radius;
      const dx = player.x - bx;
      const dz = player.z - bz;
      if (dx * dx + dz * dz > r * r) continue;
      this.projectiles.kill(i);
      if (!player.invulnerable) this.events.onPlayerHit?.(bx, bz);
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
