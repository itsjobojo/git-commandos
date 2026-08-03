import { Group, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { Enemy, type EnemyContext } from './enemy';
import { createInviteMesh } from '../../render/invite';
import { advanceGait, createHumanoid, poseHumanoid, type Humanoid } from '../../render/humanoid';
import { CAST } from '../../render/cast';

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
 * How high the held invite floats: high enough that its lower edge clears the
 * cowl and lands just under the raised hands, so they read as gripping it.
 */
const HOLD_HEIGHT = 3.4;

/**
 * The Invite Swarm — mid-game mini-boss.
 *
 * Somebody is sending these. It walks the arena head and shoulders above
 * everything else, both arms locked overhead around a calendar invite, and
 * carpet-bombs you out of it. Individually each invite looks harmless;
 * collectively it's a bullet hell. Invites can be *declined* by shooting them,
 * and rolling through a fan declines everything it touches — that's the skill
 * expression.
 *
 * At half health it stops sending individual invites and starts one recurring
 * series: a spiral that doesn't stop until the boss is dead.
 *
 * It used to be the icon alone, floating and bodiless, which read as a logo
 * rather than an antagonist. The invite it holds is still an Outlook mark — see
 * the licence note in `render/invite.ts`, it is the one asset in the repository
 * that is not CC0.
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
  /** The held invite, above the raised hands. */
  private readonly body = new Group();
  private readonly card: Mesh;
  private readonly glow: MeshStandardMaterial;
  private readonly rig: Humanoid;

  constructor() {
    super();

    this.rig = createHumanoid(CAST['invite-swarm'], (this.id * 2.399963) % (Math.PI * 2));

    const invite = createInviteMesh(1, 0.34);
    this.body.add(invite.group);
    this.body.position.y = HOLD_HEIGHT;
    this.card = invite.card;
    this.glow = invite.glow;

    // The invite is not parented to a hand — it hangs off its own holder just
    // above them, so it can keep leaning and rattling on its own axes while the
    // arms hold still. Same trick as the organizer's calendar disc.
    //
    // The quarter turn is the whole reason the holder exists: the body is
    // authored facing +X like every other rig, and the invite is authored
    // facing +Z, so the two need different yaws off the same bearing.
    const holder = new Object3D();
    holder.rotation.y = Math.PI / 2;
    holder.add(this.body);

    this.group.add(this.rig.group, holder);
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
    // Ahead of every early return below: it spends most of the fight holding
    // its range and not firing, and a boss that slides with its legs still is
    // worse than one with no legs at all.
    advanceGait(this.rig, dt, Math.hypot(this.x - this.px, this.z - this.pz) / dt);

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
    // Back to the rig convention now that there is a body: authored facing +X,
    // so `-yaw`. The invite still has to face the player square-on — an upright
    // calendar edge-on to the camera is just a blue sliver — and it gets there
    // through the quarter turn baked into its holder.
    this.group.rotation.y = -this.yaw;
    poseHumanoid(this.rig);

    const hover = Math.sin(this.bob * 1.4) * 0.28;
    this.body.position.y = HOLD_HEIGHT + hover;
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
