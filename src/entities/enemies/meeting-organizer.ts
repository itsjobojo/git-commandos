import { ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { Enemy, type EnemyContext } from './enemy';
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

  constructor() {
    super();

    const material = new MeshStandardMaterial({
      color: PALETTE.meeting,
      emissive: PALETTE.meeting,
      emissiveIntensity: 0.28,
      roughness: 0.55,
      flatShading: true,
    });

    const body = new Mesh(new ConeGeometry(0.5, 1.5, 6), material);
    body.position.y = 0.9;
    body.castShadow = true;

    // A slowly rotating calendar disc — you can spot it across the map.
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

    this.group.add(body, this.disc);
    this.object = this.group;
  }

  think(dt: number, ctx: EnemyContext): void {
    super.tick(dt);
    this.spin += dt * 1.6;

    // Retreat if crowded, close if too far — it wants line of sight on you,
    // because it schedules meetings where you are.
    const dx = ctx.playerX - this.x;
    const dz = ctx.playerZ - this.z;
    const distance = Math.hypot(dx, dz) || 1;
    const target =
      distance < KEEP_DISTANCE - 3
        ? { x: this.x - (dx / distance) * 8, z: this.z - (dz / distance) * 8 }
        : distance > KEEP_DISTANCE + 3
          ? { x: ctx.playerX, z: ctx.playerZ }
          : null;

    if (target) this.moveToward(dt, ctx.grid, target.x, target.z, SPEED);
    this.yaw = Math.atan2(dz, dx);

    if (this.scheduleTimer > 0) this.scheduleTimer -= dt;
  }

  /** True when it wants to place a meeting; the director does the placing. */
  wantsToSchedule(): boolean {
    return this.scheduleTimer <= 0;
  }

  resetSchedule(seconds: number): void {
    this.scheduleTimer = seconds;
  }

  syncOrganizer(alpha: number): void {
    super.syncObject(alpha, 0);
    this.group.rotation.y = -this.yaw;
    this.disc.rotation.y = this.spin;
  }
}
