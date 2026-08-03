import { MathUtils, PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';

const PITCH = MathUtils.degToRad(55);
const GROUND = new Plane(new Vector3(0, 1, 0), 0);

/**
 * Top-down camera rig.
 *
 * Three things make a fixed overhead camera feel alive rather than like a
 * security cam: it lags behind the player instead of being welded to them, it
 * leans toward where you're aiming (so you see what you're shooting at before
 * it sees you), and it can be kicked. All three live here.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;

  /** Distance from the look-at point along the view axis. */
  distance = 22;
  /** How far the camera leans toward the aim point, in world units. */
  leanAmount = 0.22;
  maxLean = 4.5;
  /** Higher = snappier follow. */
  followStiffness = 7;

  private readonly target = new Vector3();
  private readonly desired = new Vector3();
  private readonly offset = new Vector3();
  private readonly ray = new Raycaster();
  private readonly ndc = new Vector2();
  private trauma = 0;
  private shake = new Vector3();

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(42, aspect, 0.5, 400);
    this.updateOffset();
    this.camera.position.copy(this.offset);
    this.camera.lookAt(0, 0, 0);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Snap instantly — use on spawn, not during play. */
  warpTo(x: number, z: number): void {
    this.target.set(x, 0, z);
    this.apply();
  }

  /**
   * @param aimX/aimZ the world point the player is aiming at; the camera leans
   * a fraction of the way toward it.
   */
  update(dt: number, playerX: number, playerZ: number, aimX: number, aimZ: number): void {
    this.desired.set(playerX, 0, playerZ);

    let leanX = (aimX - playerX) * this.leanAmount;
    let leanZ = (aimZ - playerZ) * this.leanAmount;
    const leanLen = Math.hypot(leanX, leanZ);
    if (leanLen > this.maxLean) {
      leanX = (leanX / leanLen) * this.maxLean;
      leanZ = (leanZ / leanLen) * this.maxLean;
    }
    this.desired.x += leanX;
    this.desired.z += leanZ;

    // Frame-rate independent exponential smoothing.
    const t = 1 - Math.exp(-this.followStiffness * dt);
    this.target.lerp(this.desired, t);

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.8);
      const s = this.trauma * this.trauma * 1.6;
      this.shake.set(
        (Math.random() * 2 - 1) * s,
        (Math.random() * 2 - 1) * s * 0.5,
        (Math.random() * 2 - 1) * s,
      );
    } else {
      this.shake.setScalar(0);
    }

    this.apply();
  }

  /** 0..1 — additive, saturating. Small hits kick less than big ones. */
  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Project a screen-space NDC point onto the ground plane. */
  screenToGround(ndcX: number, ndcY: number, out: Vector3): Vector3 {
    this.ndc.set(ndcX, ndcY);
    this.ray.setFromCamera(this.ndc, this.camera);
    if (!this.ray.ray.intersectPlane(GROUND, out)) {
      // Camera is looking parallel to the ground (shouldn't happen) — fall back
      // to a point well ahead of the look-at target.
      out.set(this.target.x, 0, this.target.z - 10);
    }
    return out;
  }

  private updateOffset(): void {
    this.offset.set(0, Math.sin(PITCH), Math.cos(PITCH)).multiplyScalar(this.distance);
  }

  private apply(): void {
    this.updateOffset();
    this.camera.position.copy(this.target).add(this.offset).add(this.shake);
    this.camera.lookAt(this.target.x + this.shake.x, this.shake.y, this.target.z + this.shake.z);
  }
}
