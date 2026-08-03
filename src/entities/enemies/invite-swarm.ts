import { BoxGeometry, Group, Mesh, MeshStandardMaterial, OctahedronGeometry } from 'three';
import { Enemy, type EnemyContext } from './enemy';
import { PALETTE } from '../../render/palette';

const DRIFT_SPEED = 2.1;
const PREFERRED_RANGE = 13;
/**
 * Fire rates are deliberately restrained. The first pass put ~27 invites a
 * second in the air with 4s lifetimes, which filled the screen and stopped
 * reading as individual dodgeable threats — a wall of noise is not a bullet
 * hell, it's a fog.
 */
const FAN_INTERVAL = 2.4;
const FAN_COUNT = 7;
const SPIRAL_INTERVAL = 0.24;
const SPIRAL_ARMS = 2;
const INVITE_LIFE = 2.6;
/** Seconds between invite bombs. */
const BOMB_INTERVAL: [number, number] = [6.5, 9.5];

/**
 * The Invite Swarm — mid-game mini-boss.
 *
 * A bloated calendar that hovers over the arena and carpet-bombs you with
 * meeting invites. Individually each one looks harmless; collectively it's a
 * bullet hell. Invites can be *declined* by shooting them, and rolling through
 * a fan declines everything it touches — that's the skill expression.
 *
 * At half health it stops sending individual invites and starts one recurring
 * series: a spiral that doesn't stop until the boss is dead.
 *
 * Deliberately unbranded: no real product name or logo appears anywhere. The
 * joke is the behaviour, not the trademark, and this ships as an npm package.
 */
export class InviteSwarm extends Enemy {
  readonly group = new Group();
  hp = 26;
  maxHp = 26;
  radius = 1.5;

  private fireTimer = 1.2;
  private bombTimer = 3;
  private spiralAngle = 0;
  private bob = 0;
  private readonly shell: Mesh;
  private readonly envelope: Mesh;

  constructor() {
    super();

    const shellMaterial = new MeshStandardMaterial({
      color: PALETTE.invite,
      emissive: PALETTE.invite,
      emissiveIntensity: 0.35,
      roughness: 0.4,
      flatShading: true,
    });
    this.shell = new Mesh(new OctahedronGeometry(1.5, 0), shellMaterial);
    this.shell.position.y = 3.1;
    this.shell.castShadow = true;

    this.envelope = new Mesh(
      new BoxGeometry(1.5, 1.05, 0.16),
      new MeshStandardMaterial({ color: 0xf2f6ff, roughness: 0.6, flatShading: true }),
    );
    this.envelope.position.y = 3.1;

    this.group.add(this.shell, this.envelope);
    this.object = this.group;
  }

  /** Phase 2: the recurring series. */
  get recurring(): boolean {
    return this.hp <= this.maxHp / 2;
  }

  think(dt: number, ctx: EnemyContext): void {
    super.tick(dt);
    this.bob += dt;

    // Hold a distance — it wants to be seen, not touched.
    const dx = ctx.playerX - this.x;
    const dz = ctx.playerZ - this.z;
    const distance = Math.hypot(dx, dz) || 1;
    const drift = distance > PREFERRED_RANGE ? 1 : distance < PREFERRED_RANGE - 4 ? -1 : 0;
    if (drift !== 0) {
      this.moveToward(
        dt,
        ctx.grid,
        this.x + (dx / distance) * drift * 10,
        this.z + (dz / distance) * drift * 10,
        DRIFT_SPEED,
      );
    }
    this.yaw = Math.atan2(dz, dx);

    // Bombs are the signature attack — the fans are just cover fire between
    // them.
    this.bombTimer -= dt;
    if (this.bombTimer <= 0) {
      // Lead the target slightly so standing still is the worst option.
      ctx.throwBomb(this.x, this.z, ctx.playerX, ctx.playerZ);
      this.bombTimer = ctx.rng.range(BOMB_INTERVAL[0], BOMB_INTERVAL[1]) * (this.recurring ? 0.6 : 1);
    }

    this.fireTimer -= dt;
    if (this.fireTimer > 0) return;

    if (this.recurring) {
      this.fireSpiral(ctx);
      this.fireTimer = SPIRAL_INTERVAL;
    } else {
      this.fireFan(ctx, dx / distance, dz / distance);
      this.fireTimer = FAN_INTERVAL;
    }
  }

  /** A wall of invites you can dodge-roll through. */
  private fireFan(ctx: EnemyContext, dirX: number, dirZ: number): void {
    const base = Math.atan2(dirZ, dirX);
    const spread = 0.8;
    for (let i = 0; i < FAN_COUNT; i++) {
      const angle = base + (i / (FAN_COUNT - 1) - 0.5) * spread;
      ctx.fire({
        x: this.x,
        z: this.z,
        dirX: Math.cos(angle),
        dirZ: Math.sin(angle),
        speed: 11,
        damage: 1,
        life: INVITE_LIFE,
        radius: 0.28,
        // Gentle enough that a dodge-roll still beats it — homing should make
        // invites feel persistent, not inescapable.
        homing: 1.1,
      });
    }
  }

  /** Phase 2. Subject line: "Recurring". It does not stop. */
  private fireSpiral(ctx: EnemyContext): void {
    this.spiralAngle += 0.7;
    for (let arm = 0; arm < SPIRAL_ARMS; arm++) {
      const angle = this.spiralAngle + (arm * Math.PI * 2) / SPIRAL_ARMS;
      ctx.fire({
        x: this.x,
        z: this.z,
        dirX: Math.cos(angle),
        dirZ: Math.sin(angle),
        speed: 9,
        damage: 1,
        life: INVITE_LIFE,
        radius: 0.26,
      });
    }
  }

  syncSwarm(alpha: number): void {
    super.syncObject(alpha, 0);
    this.group.rotation.y = -this.yaw;
    const hover = Math.sin(this.bob * 1.4) * 0.28;
    this.shell.position.y = 3.1 + hover;
    this.envelope.position.y = 3.1 + hover;
    this.shell.rotation.y += 0.01;
    // Visibly agitated once the recurring series starts.
    const wounded = 1 - this.hp / this.maxHp;
    (this.shell.material as MeshStandardMaterial).emissiveIntensity =
      0.35 + wounded * (0.6 + Math.sin(this.bob * 18) * 0.35);
  }
}
