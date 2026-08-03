import {
  BoxGeometry,
  CapsuleGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { Entity, angleDelta } from './entity';
import { PALETTE } from '../render/palette';
import type { Grid } from '../world/grid';
import type { Intent } from '../core/input';

const BASE_SPEED = 8.2;
const SPRINT_SPEED = 11.6;
const ACCEL = 95;
const FRICTION = 78;
const TURN_RATE = 18;

const ROLL_SPEED = 18.5;
const ROLL_DURATION = 0.26;
const ROLL_COOLDOWN = 0.42;
/** i-frames run slightly shorter than the roll so it can't be spammed as armour. */
const ROLL_IFRAMES = 0.22;

/** Sprinting is a reward for travelling light — see REBUILD.md §1. */
export const SPRINT_CRATE_LIMIT = 2;

export class Player extends Entity {
  radius = 0.55;

  /** Set by Game each fixed step, before tick(). */
  intent: Intent | null = null;
  aimX = 0;
  aimZ = 0;
  /** How many crates are on your back — gates sprint and scales threat. */
  carrying = 0;

  rollTimer = 0;
  rollCooldown = 0;
  invulnTimer = 0;
  private rollDirX = 0;
  private rollDirZ = 0;

  readonly cargoAnchor = new Object3D();
  private readonly body: Mesh;
  private readonly barrel: Mesh;
  private readonly root = new Group();

  constructor(private readonly grid: Grid) {
    super();

    const skin = new MeshStandardMaterial({
      color: PALETTE.player,
      emissive: PALETTE.playerDim,
      emissiveIntensity: 0.6,
      roughness: 0.55,
      metalness: 0.1,
      flatShading: true,
    });
    const dark = new MeshStandardMaterial({
      color: 0x0d1a14,
      roughness: 0.7,
      flatShading: true,
    });

    // Placeholder silhouette. M6 swaps this for the custom hero mesh; the
    // anchors (cargoAnchor, barrel) are the contract that survives.
    this.body = new Mesh(new CapsuleGeometry(0.42, 0.86, 4, 10), skin);
    this.body.position.y = 0.86;
    this.body.castShadow = true;

    const visor = new Mesh(new BoxGeometry(0.5, 0.16, 0.24), dark);
    visor.position.set(0.22, 1.22, 0);

    this.barrel = new Mesh(new BoxGeometry(0.8, 0.14, 0.14), dark);
    this.barrel.position.set(0.62, 0.92, 0.16);

    // A ground-hugging cone that always points where you're facing. Cheap, but
    // it's the single biggest readability win on a top-down camera.
    const chevron = new Mesh(new ConeGeometry(0.3, 0.62, 3), skin);
    chevron.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
    chevron.position.set(0.95, 0.08, 0);

    // Sits clear of the body so the stack — and the filenames on it — read
    // from the top-down camera. You should be able to see your git status by
    // looking at yourself.
    this.cargoAnchor.position.set(-0.72, 1.05, 0);

    this.root.add(this.body, visor, this.barrel, chevron, this.cargoAnchor);
    this.object = this.root;
  }

  get isRolling(): boolean {
    return this.rollTimer > 0;
  }

  get invulnerable(): boolean {
    return this.invulnTimer > 0;
  }

  get canSprint(): boolean {
    return this.carrying <= SPRINT_CRATE_LIMIT;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  tick(dt: number): void {
    const i = this.intent;
    if (!i) return;

    this.rollCooldown = Math.max(0, this.rollCooldown - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);

    if (i.dodge && this.rollTimer <= 0 && this.rollCooldown <= 0) this.startRoll(i);

    if (this.rollTimer > 0) {
      this.rollTimer -= dt;
      // Ease out so the roll ends in a controllable position rather than a skid.
      const t = Math.max(0, this.rollTimer / ROLL_DURATION);
      const speed = ROLL_SPEED * (0.35 + 0.65 * t);
      this.vx = this.rollDirX * speed;
      this.vz = this.rollDirZ * speed;
      if (this.rollTimer <= 0) this.rollCooldown = ROLL_COOLDOWN;
    } else {
      this.drive(dt, i);
    }

    this.integrate(dt);
    this.turn(dt);
  }

  private startRoll(i: Intent): void {
    // Roll where you're moving; if standing still, roll where you're looking.
    let dx = i.moveX;
    let dz = i.moveZ;
    if (dx === 0 && dz === 0) {
      dx = Math.cos(this.yaw);
      dz = Math.sin(this.yaw);
    }
    const len = Math.hypot(dx, dz) || 1;
    this.rollDirX = dx / len;
    this.rollDirZ = dz / len;
    this.rollTimer = ROLL_DURATION;
    this.invulnTimer = Math.max(this.invulnTimer, ROLL_IFRAMES);
  }

  private drive(dt: number, i: Intent): void {
    const wants = i.moveX !== 0 || i.moveZ !== 0;
    const max = i.sprint && this.canSprint ? SPRINT_SPEED : BASE_SPEED;
    const rate = (wants ? ACCEL : FRICTION) * dt;
    this.vx = moveToward(this.vx, i.moveX * max, rate);
    this.vz = moveToward(this.vz, i.moveZ * max, rate);
  }

  private integrate(dt: number): void {
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (this.grid.resolveCircle(this, this.radius)) {
      // Kill the velocity component that drove us into the wall so we slide
      // along it instead of grinding to a halt.
      const nx = this.x - (this.px + this.vx * dt);
      const nz = this.z - (this.pz + this.vz * dt);
      const len = Math.hypot(nx, nz);
      if (len > 1e-6) {
        const dot = (this.vx * nx + this.vz * nz) / len;
        if (dot < 0) {
          this.vx -= (nx / len) * dot;
          this.vz -= (nz / len) * dot;
        }
      }
    }
  }

  private turn(dt: number): void {
    const targetYaw = this.isRolling
      ? Math.atan2(this.rollDirZ, this.rollDirX)
      : Math.atan2(this.aimZ - this.z, this.aimX - this.x);
    this.yaw += angleDelta(this.yaw, targetYaw) * Math.min(1, TURN_RATE * dt);
  }

  syncObject(alpha: number): void {
    super.syncObject(alpha, 0);
    this.root.rotation.y = -this.yaw;

    // Roll squash — sells the dodge without an animation rig.
    const rollT = this.rollTimer > 0 ? this.rollTimer / ROLL_DURATION : 0;
    const squash = 1 - Math.sin(rollT * Math.PI) * 0.42;
    this.body.scale.set(1 / squash, squash, 1 / squash);
    this.body.position.y = 0.86 * squash;
    this.barrel.visible = !this.isRolling;
  }
}

function moveToward(value: number, target: number, maxDelta: number): number {
  const d = target - value;
  if (Math.abs(d) <= maxDelta) return target;
  return value + Math.sign(d) * maxDelta;
}
