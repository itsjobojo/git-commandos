import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { Enemy, type EnemyContext } from './enemy';
import { SpeechBubble } from '../../render/bubble';
import { advanceGait, createHumanoid, poseHumanoid, type Humanoid } from '../../render/humanoid';
import { CAST } from '../../render/cast';

const IDLE_SPEED = 2.2;
const STRAFE_SPEED = 5.4;
const REPOSITION_SPEED = 6.6;
/** The band it wants to hold. Closer and it backs off, further and it closes. */
const NEAR_RANGE = 9;
const FAR_RANGE = 15;
/** Below this much cargo, you are not worth approaching. */
const INTEREST_THRESHOLD = 3;
const SHOT_INTERVAL = 1.15;
/** Shots fired before it breaks off to find cover. */
const BURST_LENGTH = 3;
const HIDE_SECONDS: [number, number] = [1.4, 2.6];

const OPENERS = [
  'quick question about your background',
  'saw your profile — impressive stuff',
  'are you open to new opportunities?',
  'we move fast and the equity is generous',
  'is now a bad time?',
  "I think you'd be a great culture fit",
];

type Stance = 'idle' | 'engage' | 'hide';

/**
 * The Recruiter — a ranged skirmisher.
 *
 * It will not walk into your gun. It holds a distance band, strafes across
 * your aim, fires a burst, then breaks line of sight and repositions before
 * coming back. Chasing you in a straight line made it free damage and gave the
 * fight nothing to read; keeping its distance means you have to push it, and
 * pushing while carrying cargo is exactly the decision this game is about.
 *
 * It ignores you entirely until you're hauling real weight — the behaviour is
 * the joke, and it doubles as the punishment for greedy full-load runs.
 */
export class Recruiter extends Enemy {
  readonly group = new Group();
  hp = 5;
  maxHp = 5;
  radius = 0.5;

  private stance: Stance = 'idle';
  private shotTimer = 0;
  private burst = 0;
  private hideTimer = 0;
  private coverX = 0;
  private coverZ = 0;
  private strafeSign = 1;
  private strafeTimer = 0;
  private lastX = 0;
  private lastZ = 0;
  private readonly bubble = new SpeechBubble();
  private wander = { x: 0, z: 0, timer: 0 };
  private readonly rig: Humanoid;

  constructor() {
    super();

    // The right arm is frozen mid-call rather than swinging: it costs two
    // fewer draw calls than an articulated one and says more about the
    // character than any amount of animation would. The phone body is merged
    // into that arm in `cast.ts`; only the screen is its own mesh, because
    // emissive is a material uniform and cannot be merged.
    this.rig = createHumanoid(CAST.recruiter, (this.id * 2.399963) % (Math.PI * 2));
    const screen = new Mesh(
      new BoxGeometry(0.012, 0.13, 0.07),
      new MeshStandardMaterial({ color: 0x0d1117, emissive: 0x2b7fff, emissiveIntensity: 0.5 }),
    );
    screen.position.set(0.048, 0, 0);
    this.rig.parts.rightHand.add(screen);

    this.bubble.sprite.position.set(0, 1.7, 0);
    this.group.add(this.rig.group, this.bubble.sprite);
    this.object = this.group;
  }

  /**
   * Split from `decide` so the gait advances on every path out of it — the
   * disinterested drift and the two blocked-shot returns included. A recruiter
   * whose legs stop the moment it declines to shoot skates across the map.
   */
  think(dt: number, ctx: EnemyContext): void {
    this.decide(dt, ctx);
    advanceGait(this.rig, dt, Math.hypot(this.x - this.px, this.z - this.pz) / dt);
  }

  private decide(dt: number, ctx: EnemyContext): void {
    super.tick(dt);
    this.bubble.update(dt);
    this.shotTimer -= dt;
    this.strafeTimer -= dt;

    const interested = ctx.playerCarrying >= INTEREST_THRESHOLD;
    if (!interested) {
      if (this.stance !== 'idle') this.stance = 'idle';
      this.drift(dt, ctx);
      return;
    }

    if (this.stance === 'idle') {
      this.stance = 'engage';
      this.bubble.say(ctx.rng.pick(OPENERS), 2.8);
    }

    if (this.stance === 'hide') this.hide(dt, ctx);
    else this.engage(dt, ctx);
  }

  /** Hold the band, strafe across their aim, fire when there's a shot. */
  private engage(dt: number, ctx: EnemyContext): void {
    const dx = ctx.playerX - this.x;
    const dz = ctx.playerZ - this.z;
    const distance = Math.hypot(dx, dz) || 1;
    const dirX = dx / distance;
    const dirZ = dz / distance;

    if (distance < NEAR_RANGE) {
      // Too close — give ground rather than trade at knife range.
      this.moveToward(dt, ctx.grid, this.x - dirX * 8, this.z - dirZ * 8, REPOSITION_SPEED);
    } else if (distance > FAR_RANGE) {
      this.moveToward(dt, ctx.grid, ctx.playerX, ctx.playerZ, REPOSITION_SPEED);
    } else {
      // In the band: slide sideways so it's never a stationary target.
      if (this.strafeTimer <= 0) {
        this.strafeSign = ctx.rng.next() < 0.5 ? -1 : 1;
        this.strafeTimer = ctx.rng.range(1.2, 2.6);
      }
      const strafeX = -dirZ * this.strafeSign;
      const strafeZ = dirX * this.strafeSign;
      this.moveToward(dt, ctx.grid, this.x + strafeX * 6, this.z + strafeZ * 6, STRAFE_SPEED);

      // Bounce off whatever it just walked into instead of grinding on it.
      if (Math.hypot(this.x - this.lastX, this.z - this.lastZ) < STRAFE_SPEED * dt * 0.3) {
        this.strafeSign *= -1;
        this.strafeTimer = ctx.rng.range(1.2, 2.6);
      }
    }
    this.lastX = this.x;
    this.lastZ = this.z;

    // Always face the player while engaging, whichever way it's moving.
    this.yaw = Math.atan2(dz, dx);

    if (this.shotTimer > 0) return;
    if (!ctx.grid.hasClearShot(this.x, this.z, ctx.playerX, ctx.playerZ)) return;
    if (distance > FAR_RANGE + 2) return;

    ctx.fire({
      x: this.x,
      z: this.z,
      dirX,
      dirZ,
      speed: 15,
      damage: 1,
    });
    this.shotTimer = SHOT_INTERVAL;
    this.burst++;

    if (this.burst >= BURST_LENGTH) {
      this.burst = 0;
      const cover = this.findCover(ctx);
      if (cover) {
        this.coverX = cover.x;
        this.coverZ = cover.z;
        this.hideTimer = ctx.rng.range(HIDE_SECONDS[0], HIDE_SECONDS[1]);
        this.stance = 'hide';
      }
    }
  }

  /** Break line of sight, sit for a beat, then come back out. */
  private hide(dt: number, ctx: EnemyContext): void {
    this.hideTimer -= dt;
    this.moveToward(dt, ctx.grid, this.coverX, this.coverZ, REPOSITION_SPEED);
    const arrived = Math.hypot(this.coverX - this.x, this.coverZ - this.z) < 1.2;
    if (arrived || this.hideTimer <= 0) this.stance = 'engage';
  }

  /**
   * Somewhere nearby that the player cannot shoot into — cover is simply a
   * position with no clear line back, which falls out of the same raycast the
   * shooting uses.
   */
  private findCover(ctx: EnemyContext): { x: number; z: number } | null {
    for (let attempt = 0; attempt < 18; attempt++) {
      const angle = ctx.rng.range(0, Math.PI * 2);
      const reach = ctx.rng.range(4, 11);
      const x = this.x + Math.cos(angle) * reach;
      const z = this.z + Math.sin(angle) * reach;
      if (ctx.grid.isSolidWorld(x, z)) continue;
      if (ctx.grid.hasClearShot(x, z, ctx.playerX, ctx.playerZ)) continue;
      const d = Math.hypot(x - ctx.playerX, z - ctx.playerZ);
      if (d < NEAR_RANGE - 2 || d > FAR_RANGE + 6) continue;
      return { x, z };
    }
    return null;
  }

  /** Milling about, waiting for someone worth talking to. */
  private drift(dt: number, ctx: EnemyContext): void {
    this.wander.timer -= dt;
    if (this.wander.timer <= 0) {
      this.wander.x = this.x + ctx.rng.range(-8, 8);
      this.wander.z = this.z + ctx.rng.range(-8, 8);
      this.wander.timer = ctx.rng.range(1.5, 3.5);
    }
    this.moveToward(dt, ctx.grid, this.wander.x, this.wander.z, IDLE_SPEED);
  }

  syncRecruiter(alpha: number): void {
    super.syncObject(alpha, 0);
    this.group.rotation.y = -this.yaw;
    poseHumanoid(this.rig);
  }

  dispose(): void {
    this.bubble.dispose();
  }
}
