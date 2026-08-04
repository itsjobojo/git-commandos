import { AdditiveBlending, DoubleSide, Group, Mesh, MeshBasicMaterial } from 'three';
import { PALETTE, color } from './palette';
import { unitWedgeGeometry } from './wedge';
import type { Sense } from '../systems/awareness';

/**
 * What each enemy is looking at, and whether it has seen you.
 *
 * The awareness rules are invisible without this: "it hasn't spotted me" and
 * "it spotted me and I got lucky" look identical from a top-down camera, and a
 * stealth layer you cannot read is just enemies behaving strangely. The cone is
 * the contract — stay out of it and you are genuinely safe.
 *
 * Pooled and driven from `Game` rather than parented to `enemy.group`, for two
 * reasons. The group is scaled by the hit-flash pop and by the death collapse,
 * so a child cone would pulse on every hit and tip over with the corpse. And
 * the group's rotation is *body* facing, while the cone follows `lookYaw` — the
 * lag between the two is precisely what "turns to look" looks like.
 */
const MAX_CONES = 6;
/**
 * Max reach is 24 and the camera frames roughly 16 units either side, so a cone
 * whose apex is beyond this contributes nothing on screen.
 */
const CULL_DISTANCE = 26;

interface Candidate {
  x: number;
  z: number;
  sense: Sense | null;
  distance: number;
}

export class VisionCones {
  readonly group = new Group();
  private readonly meshes: Mesh[] = [];
  private readonly materials: MeshBasicMaterial[] = [];
  private readonly candidates: Candidate[] = [];
  private count = 0;
  private playerX = 0;
  private playerZ = 0;

  constructor() {
    this.group.name = 'vision-cones';
    const geometry = unitWedgeGeometry();
    for (let i = 0; i < MAX_CONES; i++) {
      // Additive throughout, set once. Switching blend modes per frame costs a
      // shader recompile, and additive grey on a near-black floor already reads
      // as the dim furniture the unaware state wants to be.
      const material = new MeshBasicMaterial({
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        // Picks up the apex-to-edge ramp baked into the unit wedge.
        vertexColors: true,
      });
      const mesh = new Mesh(geometry, material);
      mesh.visible = false;
      mesh.position.y = 0.03;
      this.materials.push(material);
      this.meshes.push(mesh);
      this.group.add(mesh);
      this.candidates.push({ x: 0, z: 0, sense: null, distance: 0 });
    }
    // Under the player's own aim indicator at 0.045, so the two never fight.
    this.group.renderOrder = 980;
  }

  begin(playerX: number, playerZ: number): void {
    this.count = 0;
    this.playerX = playerX;
    this.playerZ = playerZ;
  }

  /**
   * Offer an enemy for drawing. Keeps the nearest `MAX_CONES` by insertion into
   * a sorted fixed array — no allocation, and no sort of a list that is at most
   * eight long anyway.
   */
  add(x: number, z: number, sense: Sense): void {
    // A profile with no eyes draws no cone: the stampede is a hazard, not a
    // hunter, and promising "stay out of this arc and you're safe" about a body
    // that shoves on contact would be actively false.
    if (sense.halfAngle <= 0 || sense.reach <= 0) return;

    const distance = Math.hypot(x - this.playerX, z - this.playerZ);
    if (distance > CULL_DISTANCE) return;

    let slot = this.count < MAX_CONES ? this.count++ : -1;
    if (slot === -1) {
      // Full: only worth keeping if it beats the current furthest.
      if (distance >= this.candidates[MAX_CONES - 1].distance) return;
      slot = MAX_CONES - 1;
    }
    while (slot > 0 && this.candidates[slot - 1].distance > distance) {
      const previous = this.candidates[slot - 1];
      const current = this.candidates[slot];
      current.x = previous.x;
      current.z = previous.z;
      current.sense = previous.sense;
      current.distance = previous.distance;
      slot--;
    }
    const target = this.candidates[slot];
    target.x = x;
    target.z = z;
    target.sense = sense;
    target.distance = distance;
  }

  /** @param t real elapsed seconds, for the alerted pulse. */
  end(t: number): void {
    for (let i = 0; i < MAX_CONES; i++) {
      const mesh = this.meshes[i];
      if (i >= this.count) {
        mesh.visible = false;
        continue;
      }

      const candidate = this.candidates[i];
      const sense = candidate.sense!;
      mesh.visible = true;
      mesh.position.x = candidate.x;
      mesh.position.z = candidate.z;
      // Local +X is the facing; the codebase renders yaw as a negated Y turn.
      mesh.rotation.y = -sense.lookYaw;
      // Scaling the unit wedge this way yields an apex half-angle of exactly
      // `halfAngle` at any reach — see render/wedge.ts.
      mesh.scale.set(sense.reach, 1, sense.reach * Math.tan(sense.halfAngle));

      // Read these against the vertex ramp in render/wedge.ts, not on their
      // own: only the wedge nearest the enemy is anywhere near full strength.
      //
      // Suspicious is the brightest, which looks backwards and is not. A cone
      // answers "where am I safe", and that question only has a useful answer
      // while the enemy is still deciding — an alerted one is already shooting
      // at you, which communicates itself. Alerted cones are also the ones that
      // arrive six at a time in a firefight, and additive blending stacks, so
      // keeping them dim is what stops a scrap turning the floor solid pink.
      const material = this.materials[i];
      if (sense.state === 'alerted') {
        material.color = color(PALETTE.hostile);
        material.opacity = 0.11 * (0.82 + Math.sin(t * 6) * 0.18);
      } else if (sense.state === 'suspicious') {
        material.color = color(PALETTE.meeting);
        material.opacity = 0.15;
      } else {
        material.color = color(PALETTE.floorLineMajor);
        material.opacity = 0.07;
      }
    }
  }

  /** How many cones are actually being drawn — one line in the debug overlay. */
  get drawn(): number {
    return this.count;
  }

  dispose(): void {
    for (const material of this.materials) material.dispose();
  }
}
