import type { Scene } from 'three';
import { Faction, ProjectilePool } from './projectiles';
import { Enemy, type EnemyContext } from '../entities/enemies/enemy';
import { AiBro } from '../entities/enemies/ai-bro';
import type { Player } from '../entities/player';
import type { Grid } from '../world/grid';
import type { Rng } from '../core/rng';
import { MUZZLE_OFFSET, type Loadout, type WeaponId } from './weapons';
import { aimEnvelope, blankEnvelope, type AimEnvelope } from './aim';
import { alertFrom, senseStep, type SenseWorld } from './awareness';
import type { NoiseBus } from './noise';

/** The reused `SenseWorld` is written every step; the interface itself is not. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Far enough that the player has left the area for good, not just stepped out. */
const RETIRE_DISTANCE = 45;
const RETIRE_SECONDS = 20;
/** How far "contact!" carries. Shorter than an SMG so it cannot out-shout you. */
const SHOUT_RADIUS = 18;

export interface CombatEvents {
  onEnemyKilled?: (enemy: Enemy) => void;
  /** A round left the player's muzzle. @param x/z where the muzzle was. */
  onPlayerShot?: (weapon: WeaponId, x: number, z: number) => void;
  /** A player round connected without killing. @param x/z the point of impact. */
  /**
   * A player round connected without killing.
   *
   * Carries the enemy as well as the impact point: the body is where the
   * feedback has to land to be legible, while the impact point is where the
   * round actually struck. They are usually about a radius apart.
   */
  onEnemyHit?: (enemy: Enemy, x: number, z: number) => void;
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
  private readonly envelope = blankEnvelope();
  /**
   * Reused across every enemy, every step. A fresh object per enemy per step is
   * hundreds of allocations a second at a full spawn cap, for a value nothing
   * keeps. Built in the constructor because it needs `grid`.
   */
  private readonly senseWorld: Mutable<SenseWorld>;

  constructor(
    scene: Scene,
    private readonly grid: Grid,
    private readonly loadout: Loadout,
    /**
     * Deliberately *not* the mission Rng. Scatter has to be seeded so a replay
     * of the same commit fires the same pellets, but it must not draw from the
     * stream that lays out the map and paces the director — otherwise pulling
     * the trigger reshuffles the level, and "same commit, same map" stops being
     * true the moment you shoot.
     */
    private readonly rng: Rng,
    private readonly noise: NoiseBus,
    private readonly events: CombatEvents = {},
  ) {
    this.projectiles = new ProjectilePool(scene);
    this.senseWorld = {
      x: 0,
      z: 0,
      yaw: 0,
      seed: 0,
      bodyX: 0,
      bodyZ: 0,
      conspicuous: 0,
      noises: this.noise.current,
      floorState: null,
      floorX: 0,
      floorZ: 0,
      grid,
    };
  }

  /**
   * Where the held weapon can currently put a round. The indicator draws this
   * exact object, so what you see is what `updatePlayerFire` will do.
   */
  aimEnvelope(player: Player): AimEnvelope {
    const weapon = this.loadout.weapon;
    return aimEnvelope(
      this.grid,
      player.x,
      player.z,
      player.yaw,
      weapon.spread,
      // The sight, not the lethal range — see WeaponSpec.sightLength.
      weapon.sightLength,
      this.envelope,
    );
  }

  add(enemy: Enemy, scene: Scene): void {
    this.enemies.push(enemy);
    scene.add(enemy.group);
  }

  get liveEnemies(): number {
    return this.enemies.reduce((n, e) => n + (e.dying ? 0 : 1), 0);
  }

  /**
   * Enemies that are actually in the fight — what the spawn cap counts.
   *
   * Once enemies can forget you, counting bodies deadlocks the director: a
   * handful of dormant enemies parked in a corner nobody will ever revisit
   * would hold the cap forever, and the rest of the run happens on an empty
   * map. Only something that has noticed you is applying pressure, so only that
   * should occupy a slot.
   */
  get engagedEnemies(): number {
    return this.enemies.reduce(
      (n, e) => n + (!e.dying && e.sense.state !== 'unaware' ? 1 : 0),
      0,
    );
  }

  /**
   * Retire enemies that lost you a long time ago and are far away.
   *
   * The other half of the deadlock fix. Nothing but the AI-bro stampede ever
   * despawned before, which was fine when everything beelined at you forever
   * and is not fine now that they give up.
   */
  private retireForgotten(dt: number, player: Player, scene: Scene): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (enemy.dying || enemy.senseProfile.locked) continue;
      if (enemy.sense.state !== 'unaware') {
        enemy.forgottenFor = 0;
        continue;
      }
      const distance = Math.hypot(enemy.x - player.x, enemy.z - player.z);
      if (distance < RETIRE_DISTANCE) {
        enemy.forgottenFor = 0;
        continue;
      }
      enemy.forgottenFor += dt;
      if (enemy.forgottenFor < RETIRE_SECONDS) continue;
      scene.remove(enemy.group);
      (enemy as { dispose?: () => void }).dispose?.();
      this.enemies.splice(i, 1);
    }
  }

  update(dt: number, player: Player, ctx: EnemyContext, firing: boolean, scene: Scene): void {
    this.updatePlayerFire(dt, player, firing);

    this.noise.swap();
    this.senseWorld.noises = this.noise.current;
    this.senseWorld.floorState = ctx.extracting ? 'suspicious' : null;
    this.senseWorld.floorX = ctx.padX;
    this.senseWorld.floorZ = ctx.padZ;

    // Sense first, act second, in two separate passes.
    //
    // One interleaved pass would make an enemy's shout audible to whoever
    // happens to sit later in the array and inaudible to whoever sits earlier —
    // a stealth bug that depends on spawn order, which is exactly the kind
    // nobody ever reproduces.
    for (const enemy of this.enemies) {
      if (enemy.dying) continue;
      this.senseWorld.x = enemy.x;
      this.senseWorld.z = enemy.z;
      this.senseWorld.yaw = enemy.yaw;
      this.senseWorld.seed = enemy.id;
      this.senseWorld.bodyX = ctx.bodyX;
      this.senseWorld.bodyZ = ctx.bodyZ;
      this.senseWorld.conspicuous = ctx.conspicuous;
      const wasAlerted = enemy.sense.state === 'alerted';
      senseStep(enemy.sense, enemy.senseProfile, dt, this.senseWorld);
      // Shout on the *transition*, so it fires once. Bounded by the rule that
      // sound only ever promotes to suspicious: neighbours come and look, they
      // do not inherit the contact, so this converges instead of cascading
      // across the whole map from one sighting.
      if (!wasAlerted && enemy.sense.state === 'alerted') {
        this.noise.emit(enemy.x, enemy.z, SHOUT_RADIUS);
      }
    }

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
    this.retireForgotten(dt, player, scene);
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
    const muzzleX = player.x + Math.cos(player.yaw) * MUZZLE_OFFSET;
    const muzzleZ = player.z + Math.sin(player.yaw) * MUZZLE_OFFSET;

    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      const angle = player.yaw + this.rng.range(-1, 1) * weapon.spread;
      // Pellets string out by varying their speed, so life is derived from the
      // speed this pellet actually got. Every one of them then dies at exactly
      // `range` — which is what the indicator drew, and the reason it can be
      // trusted rather than treated as decoration.
      const speed = weapon.speed * this.rng.range(0.9, 1.1);
      this.projectiles.spawn({
        x: muzzleX,
        z: muzzleZ,
        dirX: Math.cos(angle),
        dirZ: Math.sin(angle),
        speed,
        life: weapon.range / speed,
        damage: weapon.damage,
        faction: Faction.Player,
      });
    }

    player.vx -= Math.cos(player.yaw) * weapon.recoil;
    player.vz -= Math.sin(player.yaw) * weapon.recoil;
    // One report per trigger pull, so a shotgun blast is one loud noise rather
    // than seven — same reasoning as the audio cue below it.
    this.noise.emit(muzzleX, muzzleZ, weapon.noise);
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
          // You shot me, so I look at you — whatever I was looking at before.
          // Without this a player standing behind an unaware enemy is simply
          // invulnerable to it.
          alertFrom(enemy.sense, enemy.senseProfile, player.x, player.z);
          if (enemy.damage(this.projectiles.damageOf(i))) {
            this.events.onEnemyKilled?.(enemy);
          } else {
            this.events.onEnemyHit?.(enemy, bx, bz);
          }
          break;
        }
        continue;
      }

      // Enemy fire. Shooting an incoming invite declines it — kept for any
      // future sender, though the Invite Storm throws rather than fires now.
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
