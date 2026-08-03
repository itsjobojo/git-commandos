import { ConeGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { Enemy, type EnemyContext } from './enemy';
import { SpeechBubble } from '../../render/bubble';
import { advanceGait, createHumanoid, poseHumanoid, type Humanoid } from '../../render/humanoid';
import { CAST } from '../../render/cast';
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
  private readonly rig: Humanoid;

  constructor(rng: { range: (a: number, b: number) => number }) {
    super();
    // Two draws, in this order. The map and every line of dialogue come off the
    // same seeded stream, so adding, dropping or reordering a draw here changes
    // the whole mission for a given commit message.
    this.talkTimer = rng.range(1, TALK_INTERVAL[1]);
    // Smaller than everything else, so a pack reads as a pack. The phase offset
    // is what stops a pack marching in lockstep.
    this.rig = createHumanoid(CAST.intern, rng.range(0, Math.PI * 2));

    // Kept as its own mesh: it's the only thing on an intern that glows, and
    // emissive is a material uniform, so it cannot be merged into the body.
    const lanyard = new Mesh(
      new ConeGeometry(0.16, 0.3, 4),
      new MeshStandardMaterial({
        color: PALETTE.crate,
        emissive: PALETTE.crate,
        emissiveIntensity: 0.4,
      }),
    );
    lanyard.position.set(0.04, -0.1, 0);
    lanyard.rotation.z = Math.PI;
    this.rig.parts.chest.add(lanyard);

    this.bubble.sprite.position.set(0, 1.35, 0);
    this.group.add(this.rig.group, this.bubble.sprite);
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
    advanceGait(this.rig, dt, Math.hypot(this.x - this.px, this.z - this.pz) / dt);
  }

  syncIntern(alpha: number): void {
    super.syncObject(alpha, 0);
    this.group.rotation.y = -this.yaw;
    poseHumanoid(this.rig);
  }

  dispose(): void {
    this.bubble.dispose();
  }
}
