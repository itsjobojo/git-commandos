import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { Enemy, type EnemyContext } from './enemy';
import { SpeechBubble } from '../../render/bubble';
import { AI_BRO_LINES } from './ai-bro-lines';
import { PALETTE } from '../../render/palette';

const SPEED = 8.6;
/** Knockback applied on contact, in units per second. */
const SHOVE = 13;
const TALK_INTERVAL: [number, number] = [2.2, 5.5];
/** Failsafe despawn, in case a bro gets wedged and never reaches the far end. */
const MAX_LIFETIME = 26;
/** How close to the far end counts as arrived. */
const ARRIVAL_RADIUS = 4;

/**
 * The AI Bro.
 *
 * He does not shoot and he is not chasing you — he is stampeding. The herd
 * runs a line across the map, head down, and whatever is in the way gets
 * shoved. Think buffalo, not zombies: the threat is being *in the path* of
 * something that was never aimed at you, so it's read-and-reposition rather
 * than fight-or-flee. Getting bulldozed off the extraction pad mid-hold is the
 * signature failure — talked off your own commit by someone not even talking
 * to you.
 *
 * Contact is knockback, never damage.
 */
export class AiBro extends Enemy {
  readonly group = new Group();
  hp = 4;
  maxHp = 4;
  radius = 0.62;

  private readonly bubble = new SpeechBubble();
  private talkTimer: number;
  private readonly body: Mesh;
  private bobPhase = 0;
  /** Rises when a herd-mate is killed — "he's just early". */
  private urgency = 1;
  /**
   * The corridor sequence this bro is running, spawn end first.
   *
   * A single far-away destination isn't enough on a route map: a 90° bend puts
   * a wall between the bro and the target and he grinds into it forever.
   * Following the waypoints keeps the herd flowing down the canyon.
   */
  private route: Array<{ x: number; z: number }> = [];
  private leg = 0;
  private age = 0;
  /** Watchdog: a bro pressed flat against a wall makes no progress at all. */
  private stuckFor = 0;
  private lastX = 0;
  private lastZ = 0;

  constructor(rng: { range: (a: number, b: number) => number }) {
    super();
    this.talkTimer = rng.range(0.2, TALK_INTERVAL[1]);
    this.bobPhase = rng.range(0, Math.PI * 2);

    const quarterZip = new MeshStandardMaterial({
      color: PALETTE.bro,
      roughness: 0.72,
      flatShading: true,
    });
    const trousers = new MeshStandardMaterial({
      color: 0x2b2f38,
      roughness: 0.85,
      flatShading: true,
    });

    this.body = new Mesh(new CapsuleGeometry(0.44, 0.78, 4, 10), quarterZip);
    this.body.position.y = 0.88;
    this.body.castShadow = true;

    // A laptop, permanently open, carried like a clipboard.
    const laptop = new Mesh(new BoxGeometry(0.52, 0.06, 0.4), trousers);
    laptop.position.set(0.42, 0.98, 0);
    laptop.rotation.z = -0.35;

    const legs = new Mesh(new BoxGeometry(0.4, 0.5, 0.5), trousers);
    legs.position.y = 0.26;

    this.bubble.sprite.position.set(0, 1.75, 0);

    this.group.add(this.body, laptop, legs, this.bubble.sprite);
    this.object = this.group;
  }

  /** Give this bro the corridor to run, in order. */
  setRoute(points: Array<{ x: number; z: number }>): void {
    this.route = points;
    this.leg = 0;
  }

  /** Called when a herd-mate dies. The rest speed up. */
  rally(): void {
    this.urgency = Math.min(1.75, this.urgency + 0.12);
  }

  think(dt: number, ctx: EnemyContext): void {
    super.tick(dt);
    this.age += dt;

    // Run the corridor. No interest in the player whatsoever — you are just
    // standing in it.
    const target = this.route[this.leg];
    if (target) {
      this.moveToward(dt, ctx.grid, target.x, target.z, SPEED * this.urgency);
      if (Math.hypot(target.x - this.x, target.z - this.z) < ARRIVAL_RADIUS) this.leg++;

      // moveToward has no wall-slide correction, so a bro whose next waypoint
      // sits straight through rock pushes into it and nets zero movement.
      // Rather than teach the herd to pathfind, notice it and skip ahead — a
      // stampede that visibly stalls against a corner is worse than one that
      // takes a slightly odd line.
      const progress = Math.hypot(this.x - this.lastX, this.z - this.lastZ);
      this.stuckFor = progress < SPEED * dt * 0.25 ? this.stuckFor + dt : 0;
      if (this.stuckFor > 0.8) {
        this.leg++;
        this.stuckFor = 0;
      }
      this.lastX = this.x;
      this.lastZ = this.z;
    }

    if (this.leg >= this.route.length || this.age > MAX_LIFETIME) {
      // Ran through and out the far side. Not a kill — just gone.
      this.dying = true;
      this.deathTimer = 0.32;
    }

    this.talkTimer -= dt;
    if (this.talkTimer <= 0) {
      this.bubble.say(ctx.rng.pick(AI_BRO_LINES));
      this.talkTimer = ctx.rng.range(TALK_INTERVAL[0], TALK_INTERVAL[1]);
    }
    this.bubble.update(dt);

    this.shove(ctx);
    this.bobPhase += dt * 15;
  }

  /**
   * Contact shoves rather than damages. Being pushed off the pad pauses the
   * hold, which costs you far more than a hit would.
   */
  private shove(ctx: EnemyContext): void {
    if (this.touchCooldown > 0) return;
    const dx = ctx.playerX - this.x;
    const dz = ctx.playerZ - this.z;
    const d = Math.hypot(dx, dz);
    if (d > this.radius + 0.85) return;
    this.shoveX = (dx / (d || 1)) * SHOVE;
    this.shoveZ = (dz / (d || 1)) * SHOVE;
    this.shovedThisStep = true;
    this.touchCooldown = 0.55;
    ctx.shake(0.18);
  }

  /** Read and cleared by the combat system each step. */
  shoveX = 0;
  shoveZ = 0;
  shovedThisStep = false;

  syncBro(alpha: number): void {
    super.syncObject(alpha, 0);
    this.group.rotation.y = -this.yaw;
    // Earnest, slightly too-fast jog.
    this.body.position.y = 0.88 + Math.abs(Math.sin(this.bobPhase)) * 0.09;
    this.body.rotation.z = Math.sin(this.bobPhase) * 0.06;
  }

  dispose(): void {
    this.bubble.dispose();
  }
}
