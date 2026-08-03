import { Group, Mesh, MeshStandardMaterial } from 'three';
import { Enemy, type EnemyContext } from './enemy';
import { createInviteMesh } from '../../render/invite';

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
/** How far the invite reclines, so its face is readable from the game camera. */
const BASE_LEAN = -0.5;

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
 * It is a giant Outlook icon. See the licence note in `render/invite.ts` — the
 * mark is reproduced at the project owner's direction and is the one asset in
 * the repository that is not CC0.
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
  /** The whole invite, lifted clear of the ground so it reads as hovering. */
  private readonly body = new Group();
  private readonly card: Mesh;
  private readonly glow: MeshStandardMaterial;

  constructor() {
    super();

    const invite = createInviteMesh(1.9, 0.34);
    this.body.add(invite.group);
    this.body.position.y = 3.1;
    this.card = invite.card;
    this.glow = invite.glow;

    this.group.add(this.body);
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
        invite: true,
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
        invite: true,
      });
    }
  }

  syncSwarm(alpha: number): void {
    super.syncObject(alpha, 0);
    // `yaw` is a bearing measured from +X, and the invite is authored facing
    // +Z, so turning it to face the player is a quarter turn off the bearing.
    // The old `-yaw` was fine for the octahedron this replaced — a shape with
    // no front cannot be pointed the wrong way — but it left the calendar face
    // permanently edge-on to the camera.
    this.group.rotation.y = Math.PI / 2 - this.yaw;

    const hover = Math.sin(this.bob * 1.4) * 0.28;
    this.body.position.y = 3.1 + hover;
    // A slow lean rather than a spin: the calendar face has to stay pointed at
    // the player to be readable, and a rotating invite is just a blue blob.
    this.body.rotation.z = Math.sin(this.bob * 0.9) * 0.09;
    // Leant back on its heels. An upright invite is edge-on to a camera pitched
    // 57° down, so the calendar face — the only part that identifies what this
    // thing is — is exactly the part you cannot see. The lean trades a little
    // realism for the object being recognisable from where it is actually
    // viewed from.
    this.body.rotation.x = BASE_LEAN + Math.sin(this.bob * 1.1 + 0.7) * 0.06;
    // The card rattles in its envelope as the thing gets angrier.
    const wounded = 1 - this.hp / this.maxHp;
    this.card.rotation.z = Math.sin(this.bob * (4 + wounded * 22)) * 0.03 * (0.4 + wounded);

    // Visibly agitated once the recurring series starts.
    this.glow.emissiveIntensity = 0.34 + wounded * (0.6 + Math.sin(this.bob * 18) * 0.35);
  }
}
