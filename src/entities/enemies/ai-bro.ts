import { BoxGeometry, CapsuleGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { Enemy, type EnemyContext } from './enemy';
import { SpeechBubble } from '../../render/bubble';
import { AI_BRO_LINES } from './ai-bro-lines';
import { PALETTE } from '../../render/palette';

const SPEED = 4.6;
const CHARGE_SPEED = 9.4;
/** Knockback applied on contact, in units per second. */
const SHOVE = 13;
const TALK_INTERVAL: [number, number] = [2.2, 5.5];

/**
 * The AI Bro.
 *
 * He does not shoot. He does not need to. He jogs at you in a quarter-zip,
 * shouting nonsense, and shoves you off the extraction pad — so the failure
 * mode is "I got talked off my own commit" rather than "I got shot". Contact
 * is knockback, not damage, which is the whole gag: the threat is that he
 * physically will not stop coming.
 *
 * They spawn as a herd during the extraction hold, which is the worst possible
 * moment, which is the point.
 */
export class AiBro extends Enemy {
  readonly group = new Group();
  hp = 4;
  maxHp = 4;
  radius = 0.62;

  private readonly bubble = new SpeechBubble();
  private talkTimer: number;
  private readonly body: Mesh;
  private bobPhase = Math.random() * Math.PI * 2;
  /** Rises when a herd-mate is killed — "he's just early". */
  private urgency = 1;

  constructor(rng: { range: (a: number, b: number) => number }) {
    super();
    this.talkTimer = rng.range(0.2, TALK_INTERVAL[1]);

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

  /** Called when a herd-mate dies. The rest speed up. */
  rally(): void {
    this.urgency = Math.min(1.75, this.urgency + 0.12);
  }

  think(dt: number, ctx: EnemyContext): void {
    super.tick(dt);

    // Beeline. No pathfinding — a bro does not go around things, and the walls
    // slide him along, which reads as exactly as clumsy as intended.
    const speed = (ctx.extracting ? CHARGE_SPEED : SPEED) * this.urgency;
    this.moveToward(dt, ctx.grid, ctx.playerX, ctx.playerZ, speed);

    this.talkTimer -= dt;
    if (this.talkTimer <= 0) {
      this.bubble.say(ctx.rng.pick(AI_BRO_LINES));
      this.talkTimer = ctx.rng.range(TALK_INTERVAL[0], TALK_INTERVAL[1]);
    }
    this.bubble.update(dt);

    this.shove(ctx);
    this.bobPhase += dt * (ctx.extracting ? 15 : 9);
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
