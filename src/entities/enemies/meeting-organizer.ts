import { CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { Enemy, type EnemyContext } from './enemy';
import { SENSE_PROFILES } from '../../systems/awareness';
import { advanceGait, createHumanoid, poseHumanoid, type Humanoid } from '../../render/humanoid';
import { CAST } from '../../render/cast';
import { PALETTE } from '../../render/palette';

const KEEP_DISTANCE = 15;
const SPEED = 3.4;

/**
 * The Meeting Organizer.
 *
 * Never attacks. Keeps its distance and drops a meeting on your position every
 * few seconds. Killing it stops new meetings but does not clear the ones
 * already scheduled — which makes it, correctly, the highest-priority target
 * in the game.
 */
export class MeetingOrganizer extends Enemy {
  readonly group = new Group();
  hp = 8;
  maxHp = 8;
  radius = 0.55;

  /** Seconds until the next meeting is scheduled. Read by the director. */
  scheduleTimer = 6;
  private spin = 0;
  private readonly disc: Mesh;
  private readonly rig: Humanoid;

  constructor() {
    super(SENSE_PROFILES.organizer);

    // Robed and cowled, both hands clasped: no legs, no stride, it glides.
    this.rig = createHumanoid(CAST.organizer, (this.id * 2.399963) % (Math.PI * 2));

    // A slowly rotating calendar disc — you can spot it across the map. It
    // stays a child of the group rather than the rig, so it does not inherit
    // the glide: a calendar that floats free of its owner is the read.
    this.disc = new Mesh(
      new CylinderGeometry(0.85, 0.85, 0.08, 6),
      new MeshStandardMaterial({
        color: PALETTE.meeting,
        emissive: PALETTE.meeting,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.55,
      }),
    );
    this.disc.position.y = 1.95;

    this.group.add(this.rig.group, this.disc);
    this.object = this.group;
  }

  think(dt: number, ctx: EnemyContext): void {
    super.tick(dt);
    this.spin += dt * 1.6;

    // Retreat if crowded, close if too far — it wants line of sight on you,
    // because it schedules meetings where you are. Which is now literal: it
    // works off the last position it actually saw, so it is a spotter, and
    // killing it blinds the room.
    const dx = this.sense.targetX - this.x;
    const dz = this.sense.targetZ - this.z;
    const distance = Math.hypot(dx, dz) || 1;
    const target =
      distance < KEEP_DISTANCE - 3
        ? { x: this.x - (dx / distance) * 8, z: this.z - (dz / distance) * 8 }
        : distance > KEEP_DISTANCE + 3
          ? { x: this.sense.targetX, z: this.sense.targetZ }
          : null;

    if (target) this.moveToward(dt, ctx.grid, target.x, target.z, SPEED);
    this.yaw = Math.atan2(dz, dx);

    if (this.scheduleTimer > 0) this.scheduleTimer -= dt;

    // Ground actually covered: it skips `moveToward` entirely while holding its
    // band, which would leave a stale velocity gliding forever.
    advanceGait(this.rig, dt, Math.hypot(this.x - this.px, this.z - this.pz) / dt);
  }

  /**
   * True when it wants to place a meeting; the director does the placing.
   *
   * Gated on having noticed you: an organizer that has not seen you dropping a
   * mandatory meeting on your exact position is the same wallhack the whole
   * stealth layer exists to remove, just wearing a calendar.
   */
  wantsToSchedule(): boolean {
    return this.scheduleTimer <= 0 && this.sense.state !== 'unaware';
  }

  /** Where it believes you are — the director places meetings here. */
  get believedX(): number {
    return this.sense.targetX;
  }

  get believedZ(): number {
    return this.sense.targetZ;
  }

  resetSchedule(seconds: number): void {
    this.scheduleTimer = seconds;
  }

  syncOrganizer(alpha: number): void {
    super.syncObject(alpha, 0);
    this.group.rotation.y = -this.yaw;
    this.disc.rotation.y = this.spin;
    poseHumanoid(this.rig);
  }
}
