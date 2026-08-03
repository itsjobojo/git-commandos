import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { Enemy, type EnemyContext } from './enemy';
import { SpeechBubble } from '../../render/bubble';
import { PALETTE } from '../../render/palette';

const IDLE_SPEED = 2.2;
const HUNT_SPEED = 8.8;
/** Below this much cargo, you are not worth approaching. */
const INTEREST_THRESHOLD = 3;
const SHOT_INTERVAL = 1.35;

const OPENERS = [
  'quick question about your background',
  'saw your profile — impressive stuff',
  'are you open to new opportunities?',
  'we move fast and the equity is generous',
  'is now a bad time?',
  'I think you\'d be a great culture fit',
];

/**
 * The Recruiter.
 *
 * Ignores you entirely until you're hauling real cargo, then commits hard.
 * The behaviour is the joke — nobody is interested until you're visibly
 * carrying something valuable — and it doubles as the pressure that punishes
 * greedy full-load runs.
 */
export class Recruiter extends Enemy {
  readonly group = new Group();
  hp = 5;
  maxHp = 5;
  radius = 0.5;

  private shotTimer = 0;
  private interested = false;
  private readonly bubble = new SpeechBubble();
  private wander = { x: 0, z: 0, timer: 0 };

  constructor() {
    super();

    const suit = new MeshStandardMaterial({
      color: PALETTE.hostile,
      roughness: 0.6,
      flatShading: true,
    });
    const body = new Mesh(new CapsuleGeometry(0.36, 0.72, 4, 8), suit);
    body.position.y = 0.8;
    body.castShadow = true;

    const phone = new Mesh(
      new BoxGeometry(0.18, 0.3, 0.05),
      new MeshStandardMaterial({ color: 0x0d1117, emissive: 0x2b7fff, emissiveIntensity: 0.5 }),
    );
    phone.position.set(0.3, 1.05, 0);

    this.bubble.sprite.position.set(0, 1.7, 0);
    this.group.add(body, phone, this.bubble.sprite);
    this.object = this.group;
  }

  think(dt: number, ctx: EnemyContext): void {
    super.tick(dt);
    this.bubble.update(dt);

    const wasInterested = this.interested;
    this.interested = ctx.playerCarrying >= INTEREST_THRESHOLD;

    if (this.interested && !wasInterested) {
      this.bubble.say(ctx.rng.pick(OPENERS), 2.8);
    }

    if (!this.interested) {
      this.drift(dt, ctx);
      return;
    }

    this.moveToward(dt, ctx.grid, ctx.playerX, ctx.playerZ, HUNT_SPEED);

    this.shotTimer -= dt;
    const dx = ctx.playerX - this.x;
    const dz = ctx.playerZ - this.z;
    const distance = Math.hypot(dx, dz) || 1;

    // Only shoot from inside the visible frame. Fire from further out and the
    // shots appear to come from nothing, which reads as a bug rather than a
    // threat you failed to spot.
    if (
      this.shotTimer <= 0 &&
      distance < 11 &&
      ctx.grid.hasClearShot(this.x, this.z, ctx.playerX, ctx.playerZ)
    ) {
      ctx.fire({
        x: this.x,
        z: this.z,
        dirX: dx / distance,
        dirZ: dz / distance,
        speed: 15,
        damage: 1,
      });
      this.shotTimer = SHOT_INTERVAL;
    }

    this.tryTouch(ctx);
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
  }

  dispose(): void {
    this.bubble.dispose();
  }
}
