import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  MathUtils,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Scene,
} from 'three';
import { PALETTE } from '../render/palette';
import { CAMERA_PITCH_DEGREES } from '../render/camera';
import { outlookIconTexture } from '../render/invite';
import type { Grid } from '../world/grid';

export const enum Faction {
  Player = 0,
  Enemy = 1,
}

const CAPACITY = 768;
/** Bullets are stepped in substeps so fast ones can't tunnel through walls. */
const MAX_STEP_DISTANCE = 0.5;
/**
 * How the player's tracers are drawn relative to their collision size. Enemy
 * fire keeps its full bulk — incoming rounds are supposed to be easy to read.
 */
const PLAYER_TRACER = { length: 0.8, thickness: 0.45 } as const;

/**
 * Every projectile in the game, in flat arrays behind one InstancedMesh.
 *
 * A firefight needs hundreds of these alive at once, so they are pooled rather
 * than allocated, and drawn in a single call rather than one per bullet.
 *
 * The pool was sized for the Invite Storm's fans and spirals, which it no
 * longer has — it throws now. Nothing currently fires an `invite` projectile at
 * all, so that branch and the homing field are unused capability rather than
 * live code; both are cheap to keep and the next enemy that wants either has
 * them ready.
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

  /** Homing: 0 = straight. Unused since the Invite Storm stopped firing. */
  private readonly homing = new Float32Array(CAPACITY);
  /** 1 = draw as an invite sprite rather than a tracer. */
  private readonly invite = new Uint8Array(CAPACITY);

  private readonly mesh: InstancedMesh;
  /**
   * Invites get their own mesh because they need a different geometry and a
   * texture. Two draw calls for every projectile in the game rather than one is
   * a price worth paying — a fan of Outlook icons sweeping the street is the
   * image this fight is built around, and it cannot be a tinted box.
   */
  private readonly inviteMesh: InstancedMesh;
  private readonly dummy = new Object3D();
  private readonly colour = new Color();
  private readonly white = new Color(0xffffff);
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

    // Pre-rotated to face the camera. The rig never yaws, so this one fixed
    // tilt is an exact billboard for free — no per-frame orientation work, and
    // the icon stays square-on however the invite is travelling.
    const iconGeometry = new PlaneGeometry(0.62, 0.62);
    iconGeometry.rotateX(-MathUtils.degToRad(CAMERA_PITCH_DEGREES));
    // alphaTest rather than transparent: hundreds of these overlap at once, and
    // a transparent material would need them depth-sorted against each other
    // every frame. Cutout keeps depth writes and the single draw call.
    const iconMaterial = new MeshBasicMaterial({
      map: outlookIconTexture(),
      alphaTest: 0.5,
      toneMapped: false,
    });
    this.inviteMesh = new InstancedMesh(iconGeometry, iconMaterial, CAPACITY);
    this.inviteMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.inviteMesh.frustumCulled = false;
    this.inviteMesh.count = 0;
    scene.add(this.inviteMesh);
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
    /** Draw as an Outlook icon instead of a tracer. */
    invite?: boolean;
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
    this.invite[slot] = opts.invite ? 1 : 0;
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

  /** Push the live set into the instanced meshes. Call once per frame. */
  sync(): void {
    let n = 0;
    let icons = 0;

    for (let i = 0; i < CAPACITY; i++) {
      if (!this.alive[i]) continue;

      if (this.invite[i]) {
        // Deliberately not oriented to travel. The geometry is already square
        // to the camera, and yawing it toward its heading would turn the icon
        // edge-on the moment it flew sideways — the one thing that stops it
        // being recognisable. It drifts instead of spinning, like a card.
        this.dummy.position.set(this.x[i], 0.85, this.z[i]);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.setScalar(Math.max(1, this.radius[i] / 0.2));
        this.dummy.updateMatrix();
        this.inviteMesh.setMatrixAt(icons, this.dummy.matrix);
        icons++;
        continue;
      }

      const enemy = this.faction[i] === Faction.Enemy;
      this.dummy.position.set(this.x[i], 0.85, this.z[i]);
      this.dummy.rotation.set(0, -Math.atan2(this.vz[i], this.vx[i]), enemy ? this.spin[i] : 0);
      const scale = this.radius[i] / 0.18;
      if (enemy) {
        this.dummy.scale.setScalar(scale);
      } else {
        // Your own rounds are drawn thinner than they collide. At seven pellets
        // a shotgun blast was a wall of boxes that hid whatever you were aiming
        // at — and what you need to see in that moment is the enemy, not the
        // ammunition. Deliberately visual only: `radius` is the hitbox and
        // shrinking that would quietly make every weapon worse.
        this.dummy.scale.set(
          scale * PLAYER_TRACER.length,
          scale * PLAYER_TRACER.thickness,
          scale * PLAYER_TRACER.thickness,
        );
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(n, this.dummy.matrix);
      this.colour.setHex(enemy ? PALETTE.invite : PALETTE.tracer);
      this.mesh.setColorAt(n, this.colour);
      n++;
    }

    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    this.inviteMesh.count = icons;
    this.inviteMesh.instanceMatrix.needsUpdate = true;
    // The icon carries its own colour; tinting it would only muddy the mark.
    if (this.inviteMesh.instanceColor) {
      for (let i = 0; i < icons; i++) this.inviteMesh.setColorAt(i, this.white);
      this.inviteMesh.instanceColor.needsUpdate = true;
    }
  }

  get activeCount(): number {
    return this.mesh.count + this.inviteMesh.count;
  }
}
