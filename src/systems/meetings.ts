import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  Sprite,
  SpriteMaterial,
} from 'three';
import { PALETTE } from '../render/palette';
import type { Rng } from '../core/rng';

export type MeetingKind = 'mandatory' | 'optional';

const MANDATORY_TITLES = [
  'Sprint Planning',
  'All Hands',
  'Quarterly Roadmap Review',
  'Incident Retro',
  'Weekly 1:1',
  'Design Review',
  'Backlog Grooming',
];

const OPTIONAL_TITLES = [
  'Quick chat?',
  'Sync re: sync',
  'Coffee & Culture',
  'Optional: AI Guild',
  'Lunch & Learn',
  'Brainstorm (no agenda)',
  '15 min? Wont take long',
];

const RADIUS = 3.6;
/** How long a mandatory meeting waits before you are marked absent. */
const MANDATORY_WINDOW = 14;
/** How long you must stand in the ring to have attended. */
const ATTENDANCE_SECONDS = 2.6;
/** Speed multiplier while stuck in a meeting. */
export const MEETING_SLOW = 0.25;

export class Meeting {
  attendance = 0;
  attended = false;
  /** Counts down only for mandatory meetings. */
  deadline: number;
  expired = false;
  readonly group = new Group();
  private readonly ring: Mesh;
  private readonly label: Sprite;

  constructor(
    readonly kind: MeetingKind,
    readonly title: string,
    readonly x: number,
    readonly z: number,
    readonly duration: number,
  ) {
    this.deadline = kind === 'mandatory' ? MANDATORY_WINDOW : Infinity;

    const colour = kind === 'mandatory' ? PALETTE.meeting : PALETTE.meetingOptional;
    this.ring = new Mesh(
      new RingGeometry(RADIUS - 0.22, RADIUS, 48),
      new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.7 }),
    );
    this.ring.rotation.x = -Math.PI / 2;

    const fill = new Mesh(
      new RingGeometry(0, RADIUS - 0.22, 40),
      new MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.09 }),
    );
    fill.rotation.x = -Math.PI / 2;

    this.label = new Sprite(
      new SpriteMaterial({ map: titleTexture(title, kind), transparent: true, depthTest: false }),
    );
    this.label.scale.set(4.2, 1.05, 1);
    this.label.position.y = 2.4;
    this.label.center.set(0.5, 0);

    this.group.position.set(x, 0.07, z);
    this.group.add(this.ring, fill, this.label);
  }

  contains(px: number, pz: number): boolean {
    return Math.hypot(px - this.x, pz - this.z) <= RADIUS;
  }

  get done(): boolean {
    return this.attended || this.expired;
  }

  /** @returns 'attended' | 'missed' | null on the step the state changes. */
  update(dt: number, px: number, pz: number, time: number): 'attended' | 'missed' | null {
    if (this.done) return null;

    const inside = this.contains(px, pz);
    if (inside) {
      this.attendance += dt;
      if (this.attendance >= ATTENDANCE_SECONDS) {
        this.attended = true;
        return 'attended';
      }
    }

    if (this.kind === 'mandatory') {
      this.deadline -= dt;
      if (this.deadline <= 0) {
        this.expired = true;
        return 'missed';
      }
    } else if ((this.deadline -= dt) <= -this.duration) {
      // Optional meetings simply end. Ignoring one costs nothing, which is
      // what makes them a trap worth learning rather than a hazard.
      this.expired = true;
    }

    const urgency = this.kind === 'mandatory' ? 1 - Math.max(0, this.deadline) / MANDATORY_WINDOW : 0;
    const material = this.ring.material as MeshBasicMaterial;
    material.opacity = 0.45 + Math.sin(time * (3 + urgency * 12)) * 0.25;
    return null;
  }
}

/**
 * Meetings you have to decide about.
 *
 * Mandatory ones cost you a crate if you don't attend, and attending means
 * standing still, slowed, unable to pick anything up, while everything else on
 * the map closes in. Optional ones are pure trap — often placed right on the
 * fastest route. Neither is a hazard you always dodge; it's a tax you choose
 * how to pay.
 */
export class MeetingSystem {
  readonly meetings: Meeting[] = [];

  constructor(private readonly scene: Scene) {}

  schedule(rng: Rng, kind: MeetingKind, x: number, z: number): Meeting {
    const titles = kind === 'mandatory' ? MANDATORY_TITLES : OPTIONAL_TITLES;
    const meeting = new Meeting(kind, rng.pick(titles), x, z, rng.range(8, 16));
    this.meetings.push(meeting);
    this.scene.add(meeting.group);
    return meeting;
  }

  /** True while the player is stuck in any live meeting. */
  isPlayerDetained(px: number, pz: number): boolean {
    return this.meetings.some((m) => !m.done && m.contains(px, pz));
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
        // Linger briefly so the outcome is legible, then clear the ring.
        meeting.group.scale.multiplyScalar(0.9);
        if (meeting.group.scale.x < 0.05) {
          this.scene.remove(meeting.group);
          this.meetings.splice(i, 1);
        }
      }
    }
  }
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
  ctx.fillStyle = kind === 'mandatory' ? '#fbbf24' : '#93a5ac';
  ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 14);

  ctx.font = '22px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.fillStyle = kind === 'mandatory' ? '#c9a44b' : '#6b7d79';
  ctx.fillText(kind === 'mandatory' ? 'MANDATORY' : 'optional', canvas.width / 2, canvas.height / 2 + 26);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}
