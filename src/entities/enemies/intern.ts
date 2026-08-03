import { CapsuleGeometry, ConeGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { Enemy, type EnemyContext } from './enemy';
import { SpeechBubble } from '../../render/bubble';
import { PALETTE } from '../../render/palette';

const SPEED = 7.4;
const LUNGE_SPEED = 12.5;
/** Inside this range it commits and sprints the last stretch. */
const LUNGE_RANGE = 7;
const TALK_INTERVAL: [number, number] = [3.5, 8];

const LINES = [
  'can we pair on this?',
  'sorry — quick question',
  'is there a doc for this?',
  'I just want to shadow you',
  'do you have five minutes?',
  'where do I get access?',
  'should I be in this meeting?',
  'I ran npm install and it broke',
];

/**
 * The Intern — the one that does run at you.
 *
 * The counterpart to the Recruiter: no gun, no patience, closes the distance
 * and gets in your way. Individually trivial, but they arrive in packs, and
 * contact knocks cargo loose — so the pressure is that dealing with them costs
 * you the seconds you were spending on something else.
 *
 * Having both a skirmisher that holds range and a rusher that closes is what
 * makes positioning a decision: back off from one and you walk into the other.
 */
export class Intern extends Enemy {
  readonly group = new Group();
  hp = 2;
  maxHp = 2;
  radius = 0.46;

  private readonly bubble = new SpeechBubble();
  private talkTimer: number;
  private readonly body: Mesh;
  private bobPhase: number;

  constructor(rng: { range: (a: number, b: number) => number }) {
    super();
    this.talkTimer = rng.range(1, TALK_INTERVAL[1]);
    this.bobPhase = rng.range(0, Math.PI * 2);

    const material = new MeshStandardMaterial({
      color: 0x9ca9c9,
      roughness: 0.75,
      flatShading: true,
    });

    // Smaller than everything else, so a pack reads as a pack.
    this.body = new Mesh(new CapsuleGeometry(0.3, 0.56, 4, 8), material);
    this.body.position.y = 0.62;
    this.body.castShadow = true;

    const lanyard = new Mesh(
      new ConeGeometry(0.16, 0.3, 4),
      new MeshStandardMaterial({
        color: PALETTE.crate,
        emissive: PALETTE.crate,
        emissiveIntensity: 0.4,
      }),
    );
    lanyard.position.set(0.16, 0.72, 0);
    lanyard.rotation.z = Math.PI;

    this.bubble.sprite.position.set(0, 1.35, 0);
    this.group.add(this.body, lanyard, this.bubble.sprite);
    this.object = this.group;
  }

  think(dt: number, ctx: EnemyContext): void {
    super.tick(dt);
    this.bubble.update(dt);

    const distance = Math.hypot(ctx.playerX - this.x, ctx.playerZ - this.z);
    const speed = distance < LUNGE_RANGE ? LUNGE_SPEED : SPEED;
    this.moveToward(dt, ctx.grid, ctx.playerX, ctx.playerZ, speed);

    this.talkTimer -= dt;
    if (this.talkTimer <= 0) {
      this.bubble.say(ctx.rng.pick(LINES), 2.6);
      this.talkTimer = ctx.rng.range(TALK_INTERVAL[0], TALK_INTERVAL[1]);
    }

    this.tryTouch(ctx);
    this.bobPhase += dt * (distance < LUNGE_RANGE ? 17 : 11);
  }

  syncIntern(alpha: number): void {
    super.syncObject(alpha, 0);
    this.group.rotation.y = -this.yaw;
    // Eager little scurry.
    this.body.position.y = 0.62 + Math.abs(Math.sin(this.bobPhase)) * 0.11;
  }

  dispose(): void {
    this.bubble.dispose();
  }
}
