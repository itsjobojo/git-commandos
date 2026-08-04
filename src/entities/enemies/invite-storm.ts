import { Group, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { Enemy, type EnemyContext } from './enemy';
import { SENSE_PROFILES } from '../../systems/awareness';
import { createInviteMesh } from '../../render/invite';
import { advanceGait, createHumanoid, poseHumanoid, type Humanoid } from '../../render/humanoid';
import { CAST } from '../../render/cast';

const DRIFT_SPEED = 2.1;
const PREFERRED_RANGE = 13;
/**
 * Seconds between throws — the whole attack now, so far shorter than when this
 * was the punctuation between volleys of fire.
 */
const THROW_INTERVAL: [number, number] = [2.4, 3.4];
/** How many invites go out at once, before and after the series starts. */
const VOLLEY = 1;
const RECURRING_VOLLEY = 3;
/** How far off you the extra invites in a volley land. */
const SCATTER = 5.5;
/** How far the invite reclines, so its face is readable from the game camera. */
const BASE_LEAN = -0.5;

/**
 * How high the held invite floats: high enough that its lower edge clears the
 * cowl and lands just under the raised hands, so they read as gripping it.
 */
const HOLD_HEIGHT = 3.2;

/**
 * The Outlook Invite Storm — mid-game mini-boss.
 *
 * Somebody is sending these. It walks the arena head and shoulders above
 * everything else, both arms locked overhead around a calendar invite, and
 * lobs them at your feet. Each one arcs, lands, sits there flashing, and opens
 * a meeting over the whole screen when the fuse runs out.
 *
 * It used to shoot them too — fans and spirals of homing invites, on top of the
 * throwing. Two attacks made of the same object mostly obscured each other: the
 * projectiles filled the air the ground markers needed to be read against, and
 * the thing you were actually meant to fear was the one you could no longer
 * see. Throwing alone gives the fight a shape you can read — the floor tells
 * you where not to be, and it is always your own feet that put you there.
 *
 * At half health it stops sending single invites and starts a recurring series:
 * three at once, scattered around you, until the boss is dead.
 *
 * It used to be the icon alone, floating and bodiless, which read as a logo
 * rather than an antagonist. The invite it holds is still an Outlook mark — see
 * the licence note in `render/invite.ts`, it is the one asset in the repository
 * that is not CC0.
 */
export class InviteStorm extends Enemy {
  readonly group = new Group();
  hp = 26;
  maxHp = 26;
  radius = 1.5;

  private throwTimer = 2;
  private bob = 0;
  /** The held invite, above the raised hands. */
  private readonly body = new Group();
  private readonly card: Mesh;
  private readonly glow: MeshStandardMaterial;
  private readonly rig: Humanoid;

  constructor() {
    super(SENSE_PROFILES.boss);

    this.rig = createHumanoid(CAST['invite-storm'], (this.id * 2.399963) % (Math.PI * 2));

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
    const dx = ctx.bodyX - this.x;
    const dz = ctx.bodyZ - this.z;
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

    this.throwTimer -= dt;
    if (this.throwTimer > 0) return;
    this.throwVolley(ctx);
    this.throwTimer =
      ctx.rng.range(THROW_INTERVAL[0], THROW_INTERVAL[1]) * (this.recurring ? 0.62 : 1);
  }

  /**
   * One invite at your feet, or three around them once the series starts.
   *
   * The first always lands on you, so standing still is never the answer; the
   * rest are scattered, so neither is a short sidestep. Where they land is
   * rolled rather than patterned — a fixed triangle around the player is a shape
   * you learn once and then walk out of the same way every time.
   */
  private throwVolley(ctx: EnemyContext): void {
    const count = this.recurring ? RECURRING_VOLLEY : VOLLEY;
    for (let i = 0; i < count; i++) {
      const offset = i === 0 ? 0 : ctx.rng.range(SCATTER * 0.5, SCATTER);
      const angle = ctx.rng.range(0, Math.PI * 2);
      ctx.throwBomb(
        this.x,
        this.z,
        ctx.bodyX + Math.cos(angle) * offset,
        ctx.bodyZ + Math.sin(angle) * offset,
      );
    }
  }

  syncStorm(alpha: number): void {
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
