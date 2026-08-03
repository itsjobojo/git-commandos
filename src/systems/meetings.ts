import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  SRGBColorSpace,
  Scene,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
} from 'three';
import { PALETTE } from '../render/palette';
import { BlobProfile } from './blob';
import type { Rng } from '../core/rng';

/**
 * Two opposite things, deliberately:
 *
 * - `mandatory` (amber) is a *shelter*. Enemy fire can't touch you inside it,
 *   and seeing it through earns you a grace shield on the way out. The cost is
 *   the detour and the countdown — you have to break off whatever you were
 *   doing and go.
 * - `avoid` (red) is a trap. Step in and you're in molasses until you crawl
 *   out. It never damages you; it just takes your most valuable resource,
 *   which is time.
 */
export type MeetingKind = 'mandatory' | 'avoid';
export type MeetingEvent = 'attended' | 'missed' | null;

const MANDATORY_TITLES = [
  'Sprint Planning',
  'All Hands',
  'Quarterly Roadmap Review',
  'Incident Retro',
  'Weekly 1:1',
  'Design Review',
  'Backlog Grooming',
];

const AVOID_TITLES = [
  'Quick chat?',
  'Sync re: sync',
  'Coffee & Culture',
  'Optional: AI Guild',
  'Lunch & Learn',
  'Brainstorm (no agenda)',
  '15 min? Wont take long',
];

/**
 * Meetings vary a lot in footprint. A "Quick chat?" should be a small tight
 * puddle you can step around; an "All Hands" should be a sprawl you have to
 * commit to crossing or route right around. One uniform size made every blob
 * the same tactical problem.
 */
const RADIUS_RANGE: [number, number] = [2.6, 7.2];
const WOBBLE_RANGE: [number, number] = [0.16, 0.46];
/** Used only for spacing new meetings apart before their size is known. */
const NOMINAL_RADIUS = 4.5;
/**
 * Mandatory meetings live long enough to actually be reachable from across the
 * map — there is no point compelling you to attend something that expires
 * before you can get there.
 */
const MANDATORY_WINDOW = 26;
const AVOID_LIFETIME: [number, number] = [10, 18];
/** How long you must stand in the ring to have attended. */
const ATTENDANCE_SECONDS = 2.6;
/** Speed multiplier inside an `avoid` blob. Molasses. */
export const MEETING_SLOW = 0.18;
/** Seconds of protection carried out of a mandatory meeting. */
export const SHELTER_GRACE = 6;
/** How long the splat takes to land and settle. */
const SPLAT_SECONDS = 0.45;
const MAX_LIVE_MEETINGS = 3;

/**
 * A meeting's timers and outcome — no Three.js, no DOM.
 *
 * Split out from the rendered `Meeting` for the same reason the cargo ledger
 * is split from the crates. The bug that forced this — an `avoid` countdown
 * starting at Infinity, so it could never reach zero and blobs piled up on the
 * map forever — is exactly what a headless test catches in a second.
 */
export class MeetingState {
  attendance = 0;
  attended = false;
  expired = false;
  /** Seconds until this meeting resolves itself. */
  timeLeft: number;

  constructor(
    readonly kind: MeetingKind,
    readonly title: string,
    readonly x: number,
    readonly z: number,
    readonly duration: number,
    readonly profile: BlobProfile,
  ) {
    this.timeLeft = kind === 'mandatory' ? MANDATORY_WINDOW : duration;
    this.totalTime = this.timeLeft;
  }

  /** What `timeLeft` started at, so a bar can show the fraction remaining. */
  readonly totalTime: number;

  contains(px: number, pz: number): boolean {
    return this.profile.contains(px - this.x, pz - this.z);
  }

  get done(): boolean {
    return this.attended || this.expired;
  }

  /** 0..1 — how close a mandatory meeting is to marking you absent. */
  get urgency(): number {
    if (this.kind !== 'mandatory') return 0;
    return 1 - Math.max(0, this.timeLeft) / MANDATORY_WINDOW;
  }

  /** 0..1 progress toward having attended. */
  get attendanceProgress(): number {
    return Math.min(1, this.attendance / ATTENDANCE_SECONDS);
  }

  /** @returns the transition that happened this step, if any. */
  update(dt: number, px: number, pz: number): MeetingEvent {
    if (this.done) return null;

    // Only mandatory meetings can be "attended" — standing in an avoid blob
    // achieves nothing except losing time.
    if (this.kind === 'mandatory' && this.contains(px, pz)) {
      this.attendance += dt;
      if (this.attendance >= ATTENDANCE_SECONDS) {
        this.attended = true;
        return 'attended';
      }
    }

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.expired = true;
      return this.kind === 'mandatory' ? 'missed' : null;
    }
    return null;
  }
}

/** A meeting with a body: the splat on the floor, its title and countdown. */
export class Meeting {
  readonly state: MeetingState;
  readonly group = new Group();
  private readonly fill: Mesh;
  private readonly outline: Mesh;
  private readonly countdown: Sprite;
  private countdownTexture: CanvasTexture | null = null;
  private lastShownSecond = -1;
  private lastShownBar = -1;
  private splat = 0;

  constructor(kind: MeetingKind, title: string, x: number, z: number, duration: number, rng: Rng) {
    // Size, lumpiness and lobe count all vary, so no two blobs occupy space
    // the same way.
    const radius = rng.range(RADIUS_RANGE[0], RADIUS_RANGE[1]);
    const profile = BlobProfile.generate(
      radius,
      rng,
      40,
      rng.range(WOBBLE_RANGE[0], WOBBLE_RANGE[1]),
      rng.int(2, 5),
    );
    this.state = new MeetingState(kind, title, x, z, duration, profile);

    const colour = kind === 'mandatory' ? PALETTE.meeting : PALETTE.meetingAvoid;

    this.fill = new Mesh(
      blobGeometry(profile, 1),
      new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.13 }),
    );
    this.outline = new Mesh(
      blobGeometry(profile, 1, 0.9),
      new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.75 }),
    );
    this.outline.position.y = 0.01;

    const label = new Sprite(
      new SpriteMaterial({ map: titleTexture(title, kind), transparent: true, depthTest: false }),
    );
    label.scale.set(4.2, 1.05, 1);
    label.position.y = 1.6 + radius * 0.28;
    label.center.set(0.5, 0);

    // Both kinds get a clock. Knowing an avoid blob clears in 4s turns it from
    // a wall into a decision: wait it out, or spend the time going around.
    this.countdown = new Sprite(new SpriteMaterial({ transparent: true, depthTest: false }));
    this.countdown.scale.set(2.6, 1.0, 1);
    this.countdown.position.y = 2.7 + radius * 0.28;
    this.countdown.center.set(0.5, 0);

    this.group.position.set(x, 0.07, z);
    this.group.add(this.fill, this.outline, label, this.countdown);
    this.group.scale.setScalar(0.01);
  }

  get title(): string {
    return this.state.title;
  }

  get kind(): MeetingKind {
    return this.state.kind;
  }

  get done(): boolean {
    return this.state.done;
  }

  get x(): number {
    return this.state.x;
  }

  get z(): number {
    return this.state.z;
  }

  /** Longest reach of the blob, for spacing and framing. */
  get radius(): number {
    return this.state.profile.maxRadius;
  }

  contains(px: number, pz: number): boolean {
    return this.state.contains(px, pz);
  }

  update(dt: number, px: number, pz: number, time: number): MeetingEvent {
    const event = this.state.update(dt, px, pz);

    // Splat in: overshoot then settle, so it reads as landing rather than
    // fading up.
    if (this.splat < 1) {
      this.splat = Math.min(1, this.splat + dt / SPLAT_SECONDS);
      const t = this.splat;
      const overshoot = 1 + Math.sin(t * Math.PI) * 0.22;
      this.group.scale.setScalar(t * overshoot);
    }

    const pulseRate = this.state.kind === 'mandatory' ? 3 + this.state.urgency * 12 : 2.2;
    const material = this.outline.material as MeshBasicMaterial;
    material.opacity = 0.5 + Math.sin(time * pulseRate) * 0.25;

    if (this.state.kind === 'mandatory') {
      (this.fill.material as MeshBasicMaterial).opacity =
        0.13 + this.state.attendanceProgress * 0.22;
    }
    this.updateCountdown();

    return event;
  }

  /**
   * Redraw only when the number or the bar visibly changes — a canvas redraw
   * every frame for three meetings would be pure waste, and at this size 40
   * steps of bar is already smooth.
   */
  private updateCountdown(): void {
    const seconds = Math.max(0, Math.ceil(this.state.timeLeft));
    const remaining = Math.max(0, Math.min(1, this.state.timeLeft / this.state.totalTime));
    const barStep = Math.round(remaining * 40);
    if (seconds === this.lastShownSecond && barStep === this.lastShownBar) return;

    this.lastShownSecond = seconds;
    this.lastShownBar = barStep;
    this.countdownTexture?.dispose();
    this.countdownTexture = countdownTexture(seconds, remaining, this.state.kind);
    const material = this.countdown.material as SpriteMaterial;
    material.map = this.countdownTexture;
    material.needsUpdate = true;
  }

  dispose(): void {
    this.countdownTexture?.dispose();
  }
}

export class MeetingSystem {
  readonly meetings: Meeting[] = [];

  constructor(private readonly scene: Scene) {}

  private cannotSchedule(x: number, z: number): boolean {
    const live = this.meetings.filter((m) => !m.done);
    if (live.length >= MAX_LIVE_MEETINGS) return true;
    // Overlapping blobs are unreadable and stack their effects.
    return live.some((m) => Math.hypot(m.x - x, m.z - z) < m.radius + NOMINAL_RADIUS + 4);
  }

  /** @returns the new meeting, or null if the calendar wouldn't take it. */
  schedule(rng: Rng, kind: MeetingKind, x: number, z: number): Meeting | null {
    if (this.cannotSchedule(x, z)) return null;
    const titles = kind === 'mandatory' ? MANDATORY_TITLES : AVOID_TITLES;
    const duration = rng.range(AVOID_LIFETIME[0], AVOID_LIFETIME[1]);
    const meeting = new Meeting(kind, rng.pick(titles), x, z, duration, rng);
    this.meetings.push(meeting);
    this.scene.add(meeting.group);
    return meeting;
  }

  /** The live meeting the player is standing in, if any. */
  current(px: number, pz: number): Meeting | null {
    return this.meetings.find((m) => !m.done && m.contains(px, pz)) ?? null;
  }

  update(
    dt: number,
    px: number,
    pz: number,
    time: number,
    events: { onAttended?: (m: Meeting) => void; onMissed?: (m: Meeting) => void },
  ): void {
    for (let i = this.meetings.length - 1; i >= 0; i--) {
      const meeting = this.meetings[i];
      const change = meeting.update(dt, px, pz, time);
      if (change === 'attended') events.onAttended?.(meeting);
      if (change === 'missed') events.onMissed?.(meeting);

      if (meeting.done) {
        meeting.group.scale.multiplyScalar(0.88);
        if (meeting.group.scale.x < 0.05) {
          this.scene.remove(meeting.group);
          meeting.dispose();
          this.meetings.splice(i, 1);
        }
      }
    }
  }
}

/** Flat blob on the XZ plane. With `innerScale`, an irregular ring instead. */
function blobGeometry(profile: BlobProfile, scale = 1, innerScale = 0): ShapeGeometry {
  const shape = new Shape();
  const outer = profile.points(scale);
  shape.moveTo(outer[0].x, outer[0].z);
  for (let i = 1; i < outer.length; i++) shape.lineTo(outer[i].x, outer[i].z);
  shape.closePath();

  if (innerScale > 0) {
    const hole = new Shape();
    const inner = profile.points(scale * innerScale);
    hole.moveTo(inner[0].x, inner[0].z);
    for (let i = 1; i < inner.length; i++) hole.lineTo(inner[i].x, inner[i].z);
    hole.closePath();
    shape.holes.push(hole);
  }

  const geometry = new ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function titleTexture(title: string, kind: MeetingKind): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 34px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.95)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = kind === 'mandatory' ? '#fbbf24' : '#ef4444';
  ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 14);

  ctx.font = '22px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = kind === 'mandatory' ? '#c9a44b' : '#b04040';
  ctx.fillText(
    kind === 'mandatory' ? 'ATTEND — SAFE FROM FIRE' : 'AVOID',
    canvas.width / 2,
    canvas.height / 2 + 26,
  );

  return toTexture(canvas);
}

/** Seconds remaining, over a bar that drains left to right as it runs out. */
function countdownTexture(seconds: number, remaining: number, kind: MeetingKind): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 100;
  const ctx = canvas.getContext('2d')!;

  const urgent = remaining < 0.25;
  const colour = kind === 'mandatory' ? (urgent ? '#f87171' : '#fbbf24') : '#ef4444';

  ctx.font = 'bold 52px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.95)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = colour;
  ctx.fillText(`${seconds}s`, canvas.width / 2, 34);

  const barW = 200;
  const barH = 12;
  const barX = (canvas.width - barW) / 2;
  const barY = 70;

  ctx.shadowBlur = 6;
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.fillRect(barX, barY, barW, barH);

  ctx.shadowBlur = 0;
  ctx.fillStyle = colour;
  ctx.fillRect(barX, barY, barW * remaining, barH);

  ctx.strokeStyle = 'rgba(255,255,255,.28)';
  ctx.lineWidth = 2;
  ctx.strokeRect(barX, barY, barW, barH);

  return toTexture(canvas);
}

function toTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}
