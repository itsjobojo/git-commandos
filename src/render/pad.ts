import {
  AdditiveBlending,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
} from 'three';
import { PALETTE } from './palette';

/**
 * The extraction beacon: a ground ring plus a vertical light column that fills
 * as the hold advances. It is the most-watched object on screen, so it is
 * visible from anywhere on the map — the column is tall enough to clear the
 * walls and unaffected by fog.
 */
export class Beacon {
  readonly group = new Group();
  private readonly column: Mesh;
  private readonly ring: Mesh;
  private readonly fill: Mesh;
  private readonly columnHeight: number;

  constructor(radius: number, height = 26) {
    this.columnHeight = height;

    const pad = new Mesh(
      new CylinderGeometry(radius, radius, 0.12, 40),
      new MeshStandardMaterial({
        color: PALETTE.extraction,
        emissive: PALETTE.extraction,
        emissiveIntensity: 0.35,
        roughness: 0.6,
        transparent: true,
        opacity: 0.22,
      }),
    );
    pad.position.y = 0.06;
    pad.receiveShadow = true;

    this.ring = new Mesh(
      new RingGeometry(radius * 0.93, radius, 48),
      new MeshBasicMaterial({ color: PALETTE.extraction, transparent: true, opacity: 0.85 }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.14;

    // Hollow column — the "beam". Additive so it glows without a bloom pass,
    // which does not exist until M6.
    this.column = new Mesh(
      new CylinderGeometry(radius * 0.72, radius * 0.72, height, 28, 1, true),
      new MeshBasicMaterial({
        color: PALETTE.extraction,
        transparent: true,
        opacity: 0.07,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.column.position.y = height / 2;

    // Rises with progress — a progress bar you read without looking away.
    this.fill = new Mesh(
      new CylinderGeometry(radius * 0.68, radius * 0.68, 1, 28, 1, true),
      new MeshBasicMaterial({
        color: PALETTE.extraction,
        transparent: true,
        opacity: 0.3,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.fill.scale.y = 0.001;

    this.group.add(pad, this.ring, this.column, this.fill);
  }

  setPosition(x: number, z: number): void {
    this.group.position.set(x, 0, z);
  }

  /**
   * @param progress 0..1 hold completion
   * @param active   is the player standing on it
   * @param t        real elapsed seconds, for the idle pulse
   */
  update(progress: number, active: boolean, t: number): void {
    const h = Math.max(0.001, progress * this.columnHeight);
    this.fill.scale.y = h;
    this.fill.position.y = h / 2;

    const pulse = 0.6 + Math.sin(t * (active ? 9 : 2.2)) * 0.25;
    (this.ring.material as MeshBasicMaterial).opacity = active ? pulse : pulse * 0.7;
    this.ring.scale.setScalar(active ? 1 + Math.sin(t * 9) * 0.02 : 1);
    (this.column.material as MeshBasicMaterial).opacity = active ? 0.16 : 0.07;
  }
}
