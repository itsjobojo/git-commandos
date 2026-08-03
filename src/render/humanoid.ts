import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { color } from './palette';

/**
 * Articulated humanoids, built out of boxes.
 *
 * Everything on screen used to be a capsule with an accessory glued to it. This
 * builds actual bodies — head, shoulders, two arms, two legs — that walk. It is
 * procedural rather than an imported GLTF for one measurable reason: the camera
 * sits 26 units out at a 57° pitch, so a 1.7-unit character is roughly ninety
 * pixels tall. Silhouette and gross limb motion survive that; skin weights and
 * baked clips do not, and they would cost an asset pipeline the game does not
 * have plus megabytes it cannot spare.
 *
 * ## The draw-call rule
 *
 * A part is its own mesh only if it rotates independently or glows
 * independently. Everything else is merged into whichever part it rides on and
 * tinted per-vertex, so one material covers the whole body. A naive rig is
 * fourteen meshes; a herd of bros would be two hundred draw calls on its own.
 * This is four to six.
 *
 * `vertexColors: true` is safe here precisely because we write the attribute
 * ourselves in `tinted()` — the failure it usually causes is setting the flag
 * on geometry that has no colour attribute, which renders black.
 *
 * ## Signs
 *
 * Bodies are authored facing +X, because entities apply `rotation.y = -yaw` and
 * yaw is a bearing from +X. Right-handed, so +Z is the character's right.
 *
 * A **positive** rotation about Z swings a *hanging* limb **forward** and tips a
 * *standing* torso **backward**. Every angle in the poser follows from that one
 * fact: leg swing is positive-forward, and lean is negative.
 */

const TAU = Math.PI * 2;

/** How fast the walk cycle opens and closes. Higher = snappier starts. */
const STRIDE_EASE = 9;
/** Shoulder angle when both hands are on a weapon. */
const BRACE_SHOULDER = 0.85;
/** How far the shoulders rotate inward so the hands meet in front. */
const BRACE_CONVERGE = 0.64;
/** Chest rise at a standstill. Barely visible, which is the point. */
const BREATH = 0.01;

/**
 * Proportions, as fractions of `height` (ground to the top of the head).
 *
 * A five-heads-tall figure with a heavy boot and a wide yoke — deliberately not
 * human proportions. At this camera distance the only things that survive are
 * the head, the shoulder line, and where the feet are, so those are the three
 * things that get exaggerated.
 *
 * The legs are spaced far enough apart to show daylight between them. A
 * realistic stance merges into one dark column at this size, and a body with
 * one leg reads as a body with none.
 */
const P = {
  hip: 0.44,
  shoulder: 0.755,
  /** Hip pivots, either side of the centreline. Scaled by bulk. */
  legSpacing: 0.09,
  /** Shoulder pivots. Scaled by bulk. */
  armSpacing: 0.245,
  /** Elbow, in shoulder-local space. */
  elbow: -0.17,
  /** Hand, in elbow-local space. */
  hand: -0.185,
  handFwd: 0.012,
} as const;

type Vec3 = readonly [x: number, y: number, z: number];

/** A hand-authored slab, merged into whichever part it rides on. */
export interface HumanoidBox {
  readonly size: Vec3;
  /** Centre, in the owning part's local space. */
  readonly at: Vec3;
  /** Radians, applied before the translation: [about Z, about X]. */
  readonly tilt?: readonly [z: number, x: number];
  readonly colour: number;
}

/**
 * Extra geometry folded into a part, so a prop costs no extra draw call.
 *
 * Hand extras are given in hand-local space and baked through the elbow — "the
 * laptop is in his hand" rather than "the laptop is 0.3 up and 0.42 forward of
 * the shoulder, before the bend".
 */
export interface HumanoidExtras {
  /** Hip-local. */
  readonly torso?: readonly HumanoidBox[];
  readonly leftHand?: readonly HumanoidBox[];
  readonly rightHand?: readonly HumanoidBox[];
}

export interface HumanoidColours {
  /** Jacket, quarter-zip, plate carrier — the identity colour. */
  readonly garment: number;
  readonly legs: number;
  /** Boots and other near-black trim. */
  readonly boot: number;
  /** Head and hands. */
  readonly skin: number;
  /** Headgear, backpack, secondary panels. */
  readonly gear: number;
}

export type Headgear = 'none' | 'helmet' | 'cap' | 'cowl';
export type LegKind = 'walk' | 'robe';
/** A swinging arm articulates; a fixed one is frozen and merged into the torso. */
export type ArmKind = 'swing' | 'fixed';

/** Shoulder / elbow / outward angles, radians. */
type ArmAngles = readonly [shoulder: number, elbow: number, out: number];

export interface GaitTuning {
  /** Speed at which the stride is fully open. Above it nothing more happens. */
  readonly fullStrideSpeed: number;
  /** Clock rate at a standstill, rad/s. Only the breath rides on it. */
  readonly idleCadence: number;
  /**
   * Clock rate per unit of speed, rad/s. Derive it with `strideCadence()` —
   * guessing it is how you get a character moonwalking.
   */
  readonly cadencePerSpeed: number;
  /** Ceiling on the clock. Past roughly five steps a second the swing strobes. */
  readonly maxCadence: number;
  readonly legSwing: number;
  readonly armSwing: number;
  /** Where a free arm hangs when still. Forward-positive. */
  readonly armRest: number;
  /** How far the hips drop when the legs are splayed. */
  readonly bob: number;
  /** Forward pitch at full stride. */
  readonly lean: number;
  /** Side-to-side roll at full stride. */
  readonly sway: number;
}

export interface HumanoidSpec {
  /**
   * Cache key. Every body built with the same key shares one geometry set and
   * one material, which is the whole reason a herd of twenty-five is affordable.
   */
  readonly key: string;
  /** Ground to the top of the head. Headgear is allowed to overshoot it. */
  readonly height: number;
  /** Width multiplier on everything but the head. 1 is average. */
  readonly bulk: number;
  readonly colours: HumanoidColours;
  readonly headgear: Headgear;
  readonly legs: LegKind;
  readonly arms: { readonly left: ArmKind; readonly right: ArmKind };
  readonly armPose: { readonly left: ArmAngles; readonly right: ArmAngles };
  readonly backpack: boolean;
  readonly extras?: HumanoidExtras;
  /** One glow for the whole body — emissive is a uniform, not per-vertex. */
  readonly emissive: number;
  readonly emissiveIntensity: number;
  readonly roughness: number;
  readonly gait: GaitTuning;
}

export interface HumanoidParts {
  /** Pelvis up. Pivots at the hips, so bob and lean rotate about the waist. */
  readonly torso: Object3D;
  /** Shoulder pivots. Null on a fixed arm — nothing may animate it. */
  readonly leftArm: Object3D | null;
  readonly rightArm: Object3D | null;
  /** Hip pivots. Null on a robed rig. */
  readonly leftLeg: Object3D | null;
  readonly rightLeg: Object3D | null;
  /** Always present, whether or not the arm above them articulates. */
  readonly leftHand: Object3D;
  readonly rightHand: Object3D;
  /** Sternum, facing +X. Badges and lanyards. */
  readonly chest: Object3D;
  /** Just above the head. */
  readonly crown: Object3D;
}

export interface Humanoid {
  /** Parent this under the entity's own root — never under something scaled. */
  readonly group: Group;
  readonly parts: HumanoidParts;
  readonly gait: GaitTuning;
  /** Hip height. The poser's rest position for the torso. */
  readonly hipY: number;
  /** Gait clock, radians. */
  phase: number;
  /** How much of the walk cycle is showing, 0..1. Smoothed, so stops ease out. */
  stride: number;
}

export interface PoseOptions {
  /** 0 = arms swing free, 1 = both locked onto a held weapon. */
  readonly brace?: number;
  /** 1 = upright. Below 1 squashes the body; the player's roll uses it. */
  readonly squash?: number;
}

/**
 * The cadence that makes a leg of this length cover ground without sliding.
 *
 * A stride covers `2·legLength·sin(swing)` and takes π radians of clock. Foot
 * slide is the single thing that makes a procedural walk read as cheap, and
 * hand-picked cadence constants are how you get it — so this is derived. If a
 * walk looks frantic, open `legSwing` (longer stride, slower clock) rather than
 * slowing the cadence.
 */
export function strideCadence(legLength: number, legSwing: number): number {
  return Math.PI / (2 * legLength * Math.sin(legSwing));
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Paint a whole geometry one colour, so a merged body needs one material. */
function tinted(geo: BufferGeometry, hex: number): BufferGeometry {
  const c = color(hex);
  const count = geo.getAttribute('position').count;
  const rgb = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    rgb[i * 3] = c.r;
    rgb[i * 3 + 1] = c.g;
    rgb[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new BufferAttribute(rgb, 3));
  return geo;
}

function slab(size: Vec3, at: Vec3, hex: number, tilt?: readonly [number, number]): BufferGeometry {
  const geo = new BoxGeometry(size[0], size[1], size[2]);
  if (tilt) {
    if (tilt[0]) geo.rotateZ(tilt[0]);
    if (tilt[1]) geo.rotateX(tilt[1]);
  }
  geo.translate(at[0], at[1], at[2]);
  return tinted(geo, hex);
}

function boxes(list: readonly HumanoidBox[] | undefined): BufferGeometry[] {
  return (list ?? []).map((b) => slab(b.size, b.at, b.colour, b.tilt));
}

/**
 * `mergeGeometries` returns null on an attribute mismatch rather than throwing,
 * which turns a missing colour attribute into a body that silently vanishes.
 * Never call it without this.
 */
function merge(parts: BufferGeometry[], what: string): BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) {
    throw new Error(
      `humanoid: could not merge "${what}" — every part must carry the same ` +
        `attributes (position, normal, uv, color). Check that each went through tinted().`,
    );
  }
  for (const part of parts) part.dispose();
  return merged;
}

interface Rig {
  readonly torso: BufferGeometry;
  /** Shared by both legs. Null on a robed rig. */
  readonly leg: BufferGeometry | null;
  /** Null when that arm is fixed — its geometry lives in the torso. */
  readonly leftArm: BufferGeometry | null;
  readonly rightArm: BufferGeometry | null;
}

const rigCache = new Map<string, Rig>();
const matCache = new Map<string, MeshStandardMaterial>();

/** Rotate a point about Z, then Y — the same order three.js applies Euler XYZ. */
function place(geo: BufferGeometry, aboutZ: number, aboutY: number, at: Vec3): void {
  if (aboutZ) geo.rotateZ(aboutZ);
  if (aboutY) geo.rotateY(aboutY);
  geo.translate(at[0], at[1], at[2]);
}

/** Everything below the elbow, in elbow-local space. */
function forearm(spec: HumanoidSpec, side: 'left' | 'right'): BufferGeometry[] {
  const h = spec.height;
  const b = spec.bulk;
  const c = spec.colours;
  const extras = side === 'left' ? spec.extras?.leftHand : spec.extras?.rightHand;
  const parts = [
    slab([0.095 * h, 0.15 * h, 0.088 * h * b], [0, -0.075 * h, 0], c.garment),
    slab([0.11 * h, 0.08 * h, 0.105 * h], [P.handFwd * h, P.hand * h, 0], c.skin),
  ];
  // Hand extras are authored hand-local, so shift them onto the hand.
  for (const geo of boxes(extras)) {
    geo.translate(P.handFwd * h, P.hand * h, 0);
    parts.push(geo);
  }
  return parts;
}

/** A whole arm, in shoulder-local space, with the elbow bend already baked in. */
function armGeometry(spec: HumanoidSpec, side: 'left' | 'right'): BufferGeometry {
  const h = spec.height;
  const b = spec.bulk;
  const [, elbow] = spec.armPose[side];
  const lower = merge(forearm(spec, side), `${side} forearm`);
  place(lower, elbow, 0, [0, P.elbow * h, 0]);
  return merge(
    [slab([0.1 * h, 0.17 * h, 0.095 * h * b], [0, -0.085 * h, 0], spec.colours.garment), lower],
    `${side} arm`,
  );
}

function headgearGeometry(spec: HumanoidSpec): BufferGeometry[] {
  const h = spec.height;
  const g = spec.colours.gear;
  switch (spec.headgear) {
    case 'none':
      return [];
    case 'helmet':
      return [
        slab([0.215 * h, 0.1 * h, 0.225 * h], [0, 0.6 * h, 0], g),
        slab([0.11 * h, 0.05 * h, 0.21 * h], [0.125 * h, 0.545 * h, 0], g),
      ];
    case 'cap':
      // Peak pointing backwards, which is most of the characterisation.
      return [
        slab([0.175 * h, 0.07 * h, 0.2 * h], [-0.01 * h, 0.585 * h, 0], g),
        slab([0.13 * h, 0.035 * h, 0.185 * h], [-0.125 * h, 0.565 * h, 0], g),
      ];
    case 'cowl':
      return [tinted(new CylinderGeometry(0, 0.155 * h, 0.22 * h, 6), g).translate(0, 0.62 * h, 0)];
  }
}

function buildRig(spec: HumanoidSpec): Rig {
  const h = spec.height;
  const b = spec.bulk;
  const c = spec.colours;
  const hipY = P.hip * h;
  const shoulderLocal = (P.shoulder - P.hip) * h;
  const armZ = P.armSpacing * h * b;

  const torso: BufferGeometry[] = [
    slab([0.17 * h, 0.13 * h, 0.3 * h * b], [0, 0, 0], c.garment),
    slab([0.18 * h, 0.14 * h, 0.29 * h * b], [0, 0.125 * h, 0], c.garment),
    slab([0.21 * h, 0.18 * h, 0.34 * h * b], [0, 0.255 * h, 0], c.garment),
    slab([0.2 * h, 0.08 * h, 0.44 * h * b], [0, 0.315 * h, 0], c.garment),
    slab([0.08 * h, 0.05 * h, 0.09 * h], [0, 0.375 * h, 0], c.skin),
    // A fifth of the whole figure. Five heads tall reads as a character from
    // above; six and a half reads as a torso with a knob on it.
    slab([0.185 * h, 0.2 * h, 0.195 * h], [0, 0.465 * h, 0], c.skin),
    ...headgearGeometry(spec),
    ...boxes(spec.extras?.torso),
  ];

  if (spec.backpack) {
    torso.push(slab([0.11 * h, 0.24 * h, 0.26 * h * b], [-0.15 * h, 0.21 * h, 0], c.gear));
  }

  if (spec.legs === 'robe') {
    // Reaches the floor, so this rig has no legs and casts its own shadow.
    const height = hipY + 0.04 * h;
    torso.push(
      tinted(new CylinderGeometry(0.19 * h, 0.295 * h, height, 6), c.garment).translate(
        0,
        (0.04 * h - hipY) / 2,
        0,
      ),
    );
  }

  // A fixed arm is frozen at its pose and folded into the torso — two fewer
  // draw calls, and for a recruiter permanently on the phone it reads better
  // than a swinging arm anyway.
  const arm = (side: 'left' | 'right'): BufferGeometry | null => {
    const geo = armGeometry(spec, side);
    if (spec.arms[side] === 'swing') return geo;
    const [shoulder, , out] = spec.armPose[side];
    const sign = side === 'right' ? 1 : -1;
    place(geo, shoulder, sign * out, [0, shoulderLocal, sign * armZ]);
    torso.push(geo);
    return null;
  };
  const leftArm = arm('left');
  const rightArm = arm('right');

  return {
    // Merged last: the fixed arms and the robe have to be in the list first.
    torso: merge(torso, `${spec.key} torso`),
    leg:
      spec.legs === 'robe'
        ? null
        : merge(
            [
              // The leg runs well above the hip pivot so the pelvis never opens
              // a gap when the torso bobs down over it.
              slab([0.13 * h, 0.47 * h, 0.125 * h * b], [0, -0.155 * h, 0], c.legs),
              slab([0.185 * h, 0.07 * h, 0.135 * h * b], [0.03 * h, -0.405 * h, 0], c.boot),
            ],
            `${spec.key} leg`,
          ),
    leftArm,
    rightArm,
  };
}

function cachedRig(spec: HumanoidSpec): Rig {
  let rig = rigCache.get(spec.key);
  if (!rig) {
    rig = buildRig(spec);
    rigCache.set(spec.key, rig);
  }
  return rig;
}

function cachedMaterial(spec: HumanoidSpec): MeshStandardMaterial {
  let mat = matCache.get(spec.key);
  if (!mat) {
    mat = new MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: spec.roughness,
      metalness: 0.05,
      emissive: spec.emissive,
      emissiveIntensity: spec.emissiveIntensity,
    });
    matCache.set(spec.key, mat);
  }
  return mat;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Build one body. `phase` offsets its gait clock, so a herd doesn't march in
 * lockstep — pass a per-entity value, never `Math.random()`.
 *
 * There is deliberately no `dispose()`. Geometry and material are shared across
 * every body with the same key and live for the process, so disposing one
 * instance would pull them out from under all the others.
 */
export function createHumanoid(spec: HumanoidSpec, phase: number): Humanoid {
  const rig = cachedRig(spec);
  const mat = cachedMaterial(spec);
  const h = spec.height;
  const b = spec.bulk;
  const hipY = P.hip * h;
  const group = new Group();

  const torso = new Object3D();
  torso.position.y = hipY;
  const torsoMesh = new Mesh(rig.torso, mat);
  torsoMesh.castShadow = true;
  torso.add(torsoMesh);
  group.add(torso);

  const chest = new Object3D();
  chest.position.set(0.105 * h, 0.255 * h, 0);
  const crown = new Object3D();
  crown.position.set(0, 0.6 * h, 0);
  torso.add(chest, crown);

  const shoulderLocal = (P.shoulder - P.hip) * h;
  const armZ = P.armSpacing * h * b;
  const buildArm = (side: 'left' | 'right'): { pivot: Object3D; hand: Object3D } => {
    const sign = side === 'right' ? 1 : -1;
    const [shoulder, elbow, out] = spec.armPose[side];
    // The pivot chain exists whether or not the arm articulates: props need
    // somewhere to hang, and a fixed arm's hand has to land at the same place
    // its baked geometry did.
    const pivot = new Object3D();
    pivot.position.set(0, shoulderLocal, sign * armZ);
    pivot.rotation.set(0, sign * out, shoulder);
    const elbowPivot = new Object3D();
    elbowPivot.position.y = P.elbow * h;
    elbowPivot.rotation.z = elbow;
    const hand = new Object3D();
    hand.position.set(P.handFwd * h, P.hand * h, 0);
    elbowPivot.add(hand);
    pivot.add(elbowPivot);
    torso.add(pivot);

    const geo = side === 'right' ? rig.rightArm : rig.leftArm;
    // Arms are small enough that their shadow lands on the torso's anyway.
    if (geo) pivot.add(new Mesh(geo, mat));
    return { pivot, hand };
  };
  const left = buildArm('left');
  const right = buildArm('right');

  let leftLeg: Object3D | null = null;
  let rightLeg: Object3D | null = null;
  if (rig.leg) {
    // Legs hang off the group, not the torso: they have to stay planted while
    // the torso bobs over them.
    const legZ = P.legSpacing * h * b;
    const buildLeg = (sign: number): Object3D => {
      const pivot = new Object3D();
      pivot.position.set(0, hipY, sign * legZ);
      const mesh = new Mesh(rig.leg as BufferGeometry, mat);
      // The legs are what anchors the shadow under the feet. A torso-only
      // caster throws its shadow clear of the body and reads as detached.
      mesh.castShadow = true;
      pivot.add(mesh);
      group.add(pivot);
      return pivot;
    };
    leftLeg = buildLeg(-1);
    rightLeg = buildLeg(1);
  }

  return {
    group,
    gait: spec.gait,
    hipY,
    phase: phase % TAU,
    stride: 0,
    parts: {
      torso,
      leftArm: spec.arms.left === 'swing' ? left.pivot : null,
      rightArm: spec.arms.right === 'swing' ? right.pivot : null,
      leftLeg,
      rightLeg,
      leftHand: left.hand,
      rightHand: right.hand,
      chest,
      crown,
    },
  };
}

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/**
 * Advance the gait clock. Call once per fixed step.
 *
 * `speed` must be ground *actually covered* — `hypot(x - px, z - pz) / dt`, not
 * `hypot(vx, vz)`. `Enemy.moveToward` writes the intended velocity even when a
 * wall eats the step, and an organizer holding its band never clears its
 * velocity at all; both would otherwise walk on the spot at full stride.
 *
 * The easing lives here rather than in the poser so it is frame-rate
 * independent, which is what makes a sprint-to-stop ease shut over about a
 * sixth of a second instead of freezing mid-stride.
 */
export function advanceGait(h: Humanoid, dt: number, speed: number): void {
  const g = h.gait;
  const target = Math.min(1, speed / g.fullStrideSpeed);
  h.stride += (target - h.stride) * Math.min(1, dt * STRIDE_EASE);
  const cadence = Math.min(
    g.maxCadence,
    g.idleCadence * (1 - h.stride) + speed * g.cadencePerSpeed,
  );
  h.phase = (h.phase + dt * cadence) % TAU;
}

/** Write the pose. Call once per rendered frame. Allocates nothing. */
export function poseHumanoid(h: Humanoid, opts?: PoseOptions): void {
  const g = h.gait;
  const p = h.parts;
  const s = h.stride;
  const swing = Math.sin(h.phase);
  const brace = opts?.brace ?? 0;

  if (p.leftLeg && p.rightLeg) {
    p.leftLeg.rotation.z = swing * g.legSwing * s;
    p.rightLeg.rotation.z = -swing * g.legSwing * s;
  }

  // Arms oppose the legs. That opposition is most of what makes a walk read as
  // a walk — without it a figure looks like it is being dragged.
  const held = BRACE_SHOULDER + swing * 0.05 * s;
  if (p.leftArm) {
    const free = -swing * g.armSwing * s + g.armRest;
    p.leftArm.rotation.z = free + (held - free) * brace;
    p.leftArm.rotation.y = -BRACE_CONVERGE * brace;
  }
  if (p.rightArm) {
    const free = swing * g.armSwing * s + g.armRest;
    p.rightArm.rotation.z = free + (held - free) * brace;
    p.rightArm.rotation.y = BRACE_CONVERGE * brace;
  }

  // The hips drop when the legs are splayed and rise when they pass each other,
  // so the bob beats at twice the swing. Getting this inverted is what makes a
  // walk look like a bounce.
  p.torso.position.y = h.hipY - Math.abs(swing) * g.bob * s + swing * BREATH * (1 - s);
  p.torso.rotation.z = -g.lean * s;
  p.torso.rotation.x = swing * g.sway * s;

  const q = opts?.squash ?? 1;
  h.group.scale.set(1 / q, q, 1 / q);
}
