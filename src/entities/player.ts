import { ConeGeometry, Group, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { Entity, angleDelta } from './entity';
import { createWeaponModel } from '../render/weapon-models';
import { advanceGait, createHumanoid, poseHumanoid, type Humanoid } from '../render/humanoid';
import { CAST } from '../render/cast';
import type { WeaponId } from '../systems/weapons';
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

/**
 * Each crate on your back costs this fraction of your speed, up to the cap.
 *
 * This replaced a hard "no sprinting above 2 crates" gate, which never fired:
 * most commits are one or two files, so the travel-light tradeoff didn't
 * exist. A continuous penalty means every single crate is a decision.
 */
const CARRY_SPEED_PENALTY = 0.06;
const MAX_CARRY_PENALTY = 0.42;

export class Player extends Entity {
  radius = 0.55;

  /** Set by Game each fixed step, before tick(). */
  intent: Intent | null = null;
  aimX = 0;
  aimZ = 0;
  /** How many crates are on your back — slows you and scales threat. */
  carrying = 0;
  /**
   * Speed multiplier imposed from outside — currently avoid blobs.
   * 1 = unaffected.
   */
  externalSlow = 1;
  /**
   * Seconds of shelter remaining. Enemy fire cannot touch you while this is
   * running: it's topped up continuously inside a mandatory meeting, and a
   * grace period carries out with you when you leave.
   */
  shelterTimer = 0;

  rollTimer = 0;
  rollCooldown = 0;
  invulnTimer = 0;
  private rollDirX = 0;
  private rollDirZ = 0;

  readonly cargoAnchor = new Object3D();
  private readonly rig: Humanoid;
  private readonly weaponMount = new Object3D();
  private weaponModel: Group | null = null;
  private readonly root = new Group();

  constructor(private readonly grid: Grid) {
    super();

    // The commando: helmet, chest rig, and a pack for the cargo to ride behind.
    // The anchors below are the contract — cargo and weapons hang off `root`,
    // never off the body, so the roll can squash one without deforming the
    // others.
    this.rig = createHumanoid(CAST.player, 0);

    // Weapons hang off a mount so swapping one is a model swap, not a rebuild.
    // Positioned where the braced right hand actually lands.
    this.weaponMount.position.set(0.4, 0.96, 0.17);

    // A ground-hugging cone that always points where you're facing. Cheap, but
    // it's the single biggest readability win on a top-down camera — a rig
    // does not replace it.
    const chevron = new Mesh(
      new ConeGeometry(0.3, 0.62, 3),
      new MeshStandardMaterial({
        color: PALETTE.player,
        emissive: PALETTE.playerDim,
        emissiveIntensity: 0.6,
        roughness: 0.55,
        flatShading: true,
      }),
    );
    chevron.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
    chevron.position.set(0.95, 0.08, 0);

    // Sits clear of the body so the stack — and the filenames on it — read
    // from the top-down camera. You should be able to see your git status by
    // looking at yourself.
    this.cargoAnchor.position.set(-0.72, 1.05, 0);

    this.root.add(this.rig.group, this.weaponMount, chevron, this.cargoAnchor);
    this.setWeapon('pistol');
    this.object = this.root;
  }

  /** Swap the held model. */
  setWeapon(id: WeaponId): void {
    if (this.weaponModel) this.weaponMount.remove(this.weaponModel);
    this.weaponModel = createWeaponModel(id);
    // Held smaller than the pickup version — at full size a shotgun reads as a
    // cannon strapped to someone the size of a fire hydrant. Down from 0.78
    // now the body has a waist: against a capsule the old scale passed, but
    // beside an actual pair of shoulders the shotgun was longer than the man.
    this.weaponModel.scale.setScalar(0.6);
    this.weaponMount.add(this.weaponModel);
  }

  get isRolling(): boolean {
    return this.rollTimer > 0;
  }

  get sheltered(): boolean {
    return this.shelterTimer > 0;
  }

  /** Dodge i-frames or meeting shelter — either way, nothing lands. */
  get invulnerable(): boolean {
    return this.invulnTimer > 0 || this.shelterTimer > 0;
  }

  /** 1 = unencumbered, falling toward 0.58 as the stack grows. */
  get loadFactor(): number {
    return 1 - Math.min(this.carrying * CARRY_SPEED_PENALTY, MAX_CARRY_PENALTY);
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  tick(dt: number): void {
    const i = this.intent;
    if (!i) return;

    this.rollCooldown = Math.max(0, this.rollCooldown - dt);
    this.invulnTimer = Math.max(0, this.invulnTimer - dt);
    this.shelterTimer = Math.max(0, this.shelterTimer - dt);

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
    // Ground actually covered, not intended velocity — walking into a wall
    // must not keep the legs running.
    advanceGait(this.rig, dt, Math.hypot(this.x - this.px, this.z - this.pz) / dt);
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
    const max = (i.sprint ? SPRINT_SPEED : BASE_SPEED) * this.loadFactor * this.externalSlow;
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

    // Roll squash — sells the dodge without an animation rig. It lands on the
    // rig group alone, so the cargo stack and the weapon ride the roll instead
    // of deforming with it. Scaling a group whose origin is at the feet keeps
    // the feet on the floor, which is why there's no height correction here.
    const rollT = this.rollTimer > 0 ? this.rollTimer / ROLL_DURATION : 0;
    const tuck = Math.sin(rollT * Math.PI);
    poseHumanoid(this.rig, { squash: 1 - tuck * 0.42, brace: 1 - tuck });
    // Tucked away mid-roll, which is also when you can't shoot.
    this.weaponMount.visible = !this.isRolling;
  }
}

function moveToward(value: number, target: number, maxDelta: number): number {
  const d = target - value;
  if (Math.abs(d) <= maxDelta) return target;
  return value + Math.sign(d) * maxDelta;
}
