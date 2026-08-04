import { AdditiveBlending, DoubleSide, Group, Mesh, MeshBasicMaterial } from 'three';
import { PALETTE } from './palette';
import { unitRayGeometry, unitWedgeGeometry } from './wedge';
import type { AimEnvelope } from '../systems/aim';

/**
 * Where this gun puts rounds, drawn on the floor.
 *
 * A top-down camera hides the one thing that separates the three weapons: the
 * shotgun's seven pellets at 0.14 rad and the pistol's one at 0.012 look
 * identical through a ring-and-dot reticle. Drawing the actual envelope makes
 * the difference legible without a stats screen, and makes "useless at
 * distance" something you can see rather than something you read.
 *
 * The centre beam is the aiming tool; the two faint edges are the honesty. They
 * clip independently, so hugging a corner with a shotgun shows one edge
 * clearing it and the other buried in the wall — which is the moment the whole
 * feature justifies itself.
 */
const CENTRE_WIDTH = 0.035;
const EDGE_WIDTH = 0.05;
/**
 * Below this the envelope is barely wider than the beam itself, so the edges
 * and fill say nothing the centre line hasn't already said — three parallel
 * hairlines just read as a thicker, blurrier beam. The pistol lives here by
 * design: it should look like a single clean line, which *is* the honest
 * picture of a 0.012 rad weapon.
 */
const ENVELOPE_MIN_SPREAD = 0.03;

export class AimIndicator {
  readonly group = new Group();
  private readonly fill: Mesh;
  private readonly left: Mesh;
  private readonly right: Mesh;
  private readonly centre: Mesh;
  private readonly fillMaterial: MeshBasicMaterial;
  private readonly edgeMaterial: MeshBasicMaterial;
  private readonly centreMaterial: MeshBasicMaterial;

  constructor() {
    this.group.name = 'aim-indicator';
    // Just under the reticle at 0.05. Unlike the reticle this keeps depthTest
    // on: it is a decal lying on the floor, and it should disappear behind the
    // base of a wall rather than paint over it.
    this.group.position.y = 0.045;
    this.group.renderOrder = 990;

    this.fillMaterial = new MeshBasicMaterial({
      color: PALETTE.tracer,
      transparent: true,
      opacity: 0.04,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    this.edgeMaterial = new MeshBasicMaterial({
      color: PALETTE.tracer,
      transparent: true,
      opacity: 0.13,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    // Bright enough to clear the bloom threshold, so the beam actually glows.
    this.centreMaterial = new MeshBasicMaterial({
      color: PALETTE.muzzle,
      transparent: true,
      opacity: 0.32,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });

    this.fill = new Mesh(unitWedgeGeometry(), this.fillMaterial);
    this.left = new Mesh(unitRayGeometry(), this.edgeMaterial);
    this.right = new Mesh(unitRayGeometry(), this.edgeMaterial);
    this.centre = new Mesh(unitRayGeometry(), this.centreMaterial);

    this.group.add(this.fill, this.left, this.right, this.centre);
  }

  /**
   * @param envelope where the shot can actually go, straight from `CombatSystem`
   * @param visible  false while rolling or outside play — firing is blocked
   *   mid-roll, and a laser drawn then is a promise the gun won't keep
   * @param flash    0..1, kicked on each trigger pull and decayed by the caller
   */
  update(envelope: AimEnvelope, visible: boolean, flash: number): void {
    this.group.visible = visible;
    if (!visible) return;

    this.group.position.x = envelope.muzzleX;
    this.group.position.z = envelope.muzzleZ;
    // yaw counts anticlockwise from +X in world terms; Three's Y rotation runs
    // the other way, hence the negation used throughout this codebase.
    this.group.rotation.y = -envelope.yaw;

    const half = envelope.halfAngle;
    const spreadZ = Math.tan(half);

    this.centre.scale.set(envelope.centre, 1, CENTRE_WIDTH);

    const wide = half >= ENVELOPE_MIN_SPREAD;
    this.fill.visible = wide;
    this.left.visible = wide;
    this.right.visible = wide;

    if (wide) {
      this.left.scale.set(envelope.left, 1, EDGE_WIDTH);
      this.right.scale.set(envelope.right, 1, EDGE_WIDTH);
      // Local +Z is world-right of the facing after the negated Y rotation, so
      // the "left" ray takes the positive local rotation.
      this.left.rotation.y = half;
      this.right.rotation.y = -half;
      // The fill must never poke past an edge that has already hit a wall, so
      // it takes the shortest of the three.
      const shortest = Math.min(envelope.centre, envelope.left, envelope.right);
      this.fill.scale.set(shortest, 1, shortest * spreadZ);
    }

    // A kick on each shot, which doubles as a read on fire rate — the SMG
    // strobes, the shotgun thumps once.
    const kick = 1 + flash * 1.6;
    this.centreMaterial.opacity = Math.min(1, 0.55 * kick);
    this.edgeMaterial.opacity = Math.min(1, 0.22 * kick);
    this.fillMaterial.opacity = Math.min(1, 0.06 * kick);
  }

  dispose(): void {
    this.fillMaterial.dispose();
    this.edgeMaterial.dispose();
    this.centreMaterial.dispose();
  }
}
