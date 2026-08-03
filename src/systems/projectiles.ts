import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  Scene,
} from 'three';
import { PALETTE } from '../render/palette';
import type { Grid } from '../world/grid';

export const enum Faction {
  Player = 0,
  Enemy = 1,
}

const CAPACITY = 768;
/** Bullets are stepped in substeps so fast ones can't tunnel through walls. */
const MAX_STEP_DISTANCE = 0.5;

/**
 * Every projectile in the game, in flat arrays behind one InstancedMesh.
 *
 * A bullet hell needs hundreds of these alive at once — the invite swarm alone
 * fires dense fans — so they are pooled rather than allocated, and drawn in a
 * single call rather than one per bullet.
 */
export class ProjectilePool {
  private readonly x = new Float32Array(CAPACITY);
  private readonly z = new Float32Array(CAPACITY);
  private readonly vx = new Float32Array(CAPACITY);
  private readonly vz = new Float32Array(CAPACITY);
  private readonly life = new Float32Array(CAPACITY);
  private readonly damage = new Uint8Array(CAPACITY);
  private readonly faction = new Uint8Array(CAPACITY);
  private readonly radius = new Float32Array(CAPACITY);
  private readonly spin = new Float32Array(CAPACITY);
  private readonly alive = new Uint8Array(CAPACITY);

  /** Homing: 0 = straight. Used by swarm invites. */
  private readonly homing = new Float32Array(CAPACITY);

  private readonly mesh: InstancedMesh;
  private readonly dummy = new Object3D();
  private readonly colour = new Color();
  private cursor = 0;

  constructor(scene: Scene) {
    const geometry = new BoxGeometry(0.44, 0.18, 0.18);
    // NOT vertexColors — that flag makes the shader read a per-vertex `color`
    // attribute this geometry doesn't have, so every instance came out black.
    // Instance colours from setColorAt are picked up on their own.
    const material = new MeshBasicMaterial({ toneMapped: false });
    this.mesh = new InstancedMesh(geometry, material, CAPACITY);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  spawn(opts: {
    x: number;
    z: number;
    dirX: number;
    dirZ: number;
    speed: number;
    damage: number;
    faction: Faction;
    life?: number;
    radius?: number;
    homing?: number;
  }): void {
    // Find a free slot, scanning from where we last stopped. Full pool simply
    // drops the shot — better than growing without bound mid-fight.
    let slot = -1;
    for (let i = 0; i < CAPACITY; i++) {
      const candidate = (this.cursor + i) % CAPACITY;
      if (!this.alive[candidate]) {
        slot = candidate;
        break;
      }
    }
    if (slot === -1) return;
    this.cursor = (slot + 1) % CAPACITY;

    const len = Math.hypot(opts.dirX, opts.dirZ) || 1;
    this.x[slot] = opts.x;
    this.z[slot] = opts.z;
    this.vx[slot] = (opts.dirX / len) * opts.speed;
    this.vz[slot] = (opts.dirZ / len) * opts.speed;
    this.life[slot] = opts.life ?? 2.4;
    this.damage[slot] = opts.damage;
    this.faction[slot] = opts.faction;
    this.radius[slot] = opts.radius ?? 0.18;
    this.homing[slot] = opts.homing ?? 0;
    this.spin[slot] = 0;
    this.alive[slot] = 1;
  }

  kill(index: number): void {
    this.alive[index] = 0;
  }

  isAlive(index: number): boolean {
    return this.alive[index] === 1;
  }

  positionX(index: number): number {
    return this.x[index];
  }

  positionZ(index: number): number {
    return this.z[index];
  }

  radiusOf(index: number): number {
    return this.radius[index];
  }

  damageOf(index: number): number {
    return this.damage[index];
  }

  factionOf(index: number): Faction {
    return this.faction[index] as Faction;
  }

  get capacity(): number {
    return CAPACITY;
  }

  /**
   * Move every live bullet. Walls and cover both stop shots — that is what
   * makes cover worth standing behind.
   *
   * @param homeX/homeZ the point homing projectiles steer toward.
   */
  update(dt: number, grid: Grid, homeX: number, homeZ: number): void {
    for (let i = 0; i < CAPACITY; i++) {
      if (!this.alive[i]) continue;

      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive[i] = 0;
        continue;
      }

      if (this.homing[i] > 0) {
        const dx = homeX - this.x[i];
        const dz = homeZ - this.z[i];
        const d = Math.hypot(dx, dz) || 1;
        const speed = Math.hypot(this.vx[i], this.vz[i]);
        // Nudge the velocity toward the target, then renormalise so homing
        // changes direction without changing speed.
        this.vx[i] += (dx / d) * this.homing[i] * dt;
        this.vz[i] += (dz / d) * this.homing[i] * dt;
        const nl = Math.hypot(this.vx[i], this.vz[i]) || 1;
        this.vx[i] = (this.vx[i] / nl) * speed;
        this.vz[i] = (this.vz[i] / nl) * speed;
      }

      const distance = Math.hypot(this.vx[i], this.vz[i]) * dt;
      const steps = Math.max(1, Math.ceil(distance / MAX_STEP_DISTANCE));
      const stepDt = dt / steps;
      let blocked = false;

      for (let s = 0; s < steps; s++) {
        this.x[i] += this.vx[i] * stepDt;
        this.z[i] += this.vz[i] * stepDt;
        if (grid.isSolidWorld(this.x[i], this.z[i])) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        this.alive[i] = 0;
        continue;
      }

      this.spin[i] += dt * 14;
    }
  }

  /** Push the live set into the instanced mesh. Call once per frame. */
  sync(): void {
    let n = 0;
    for (let i = 0; i < CAPACITY; i++) {
      if (!this.alive[i]) continue;
      const enemy = this.faction[i] === Faction.Enemy;
      this.dummy.position.set(this.x[i], 0.85, this.z[i]);
      this.dummy.rotation.set(0, -Math.atan2(this.vz[i], this.vx[i]), enemy ? this.spin[i] : 0);
      const scale = this.radius[i] / 0.18;
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      this.colour.setHex(enemy ? PALETTE.invite : PALETTE.tracer);
      this.mesh.setColorAt(n, this.colour);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  get activeCount(): number {
    return this.mesh.count;
  }
}
