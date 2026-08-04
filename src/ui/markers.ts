import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';

/**
 * Edge-of-screen markers for things that matter and are not on screen.
 *
 * A pitched top-down camera shows roughly 16 world units either side of the
 * player and only ~9 behind. Recruiters open fire at 15, so before this
 * existed the ordinary experience of the game was losing cargo to something
 * you never saw. The camera pull-back closed part of that gap; this closes
 * the rest, and it is the only thing that can — the map is far larger than
 * any sane framing, so the beacon is off-screen for most of a run.
 *
 * Markers are DOM rather than sprites: they must stay crisp, stay upright, and
 * never be occluded by a wall, none of which a world-space sprite gives you.
 */

export type MarkerKind = 'objective' | 'cargo' | 'hostile' | 'herd';

interface KindStyle {
  colour: string;
  /** Higher wins when markers pile up on the same screen edge. */
  priority: number;
  /** Marked-up shapes read faster than colour alone, and survive colourblindness. */
  glyph: string;
  size: number;
}

const KIND: Record<MarkerKind, KindStyle> = {
  // Green, and the only marker that is always present — the run has exactly one
  // destination and you should never have to guess where it is.
  objective: { colour: '#4ade80', priority: 3, glyph: '▲', size: 15 },
  // Amber and pulsing. A dropped file is the actual failure condition of the
  // game, so it outranks anything trying to kill you.
  cargo: { colour: '#fbbf24', priority: 4, glyph: '▲', size: 15 },
  hostile: { colour: '#f472b6', priority: 2, glyph: '▲', size: 13 },
  herd: { colour: '#fb923c', priority: 1, glyph: '▲', size: 17 },
};

/**
 * The marker ring, as an ellipse in NDC.
 *
 * An ellipse rather than a rectangle specifically because the HUD lives in the
 * corners — cargo manifest bottom-left, weapon and load bottom-right — and a
 * rectangular ring puts markers exactly there. A rect ring was tried first and
 * parked the extraction arrow on top of the word CARGO.
 *
 * The centre is nudged upward and the vertical radius kept short of the
 * horizontal one, which reserves the bottom band of the screen for the HUD.
 */
const RING_X = 0.93;
const RING_Y = 0.78;
/** Ring centre, above screen centre, so the ring's low point clears the HUD. */
const RING_CY = 0.12;

/** Above this many hostile markers the edge reads as noise rather than threat. */
const MAX_HOSTILE = 6;

interface Slot {
  root: HTMLDivElement;
  arrow: HTMLDivElement;
  label: HTMLDivElement;
  kind: MarkerKind | null;
}

interface Pending {
  ndcX: number;
  ndcY: number;
  kind: MarkerKind;
  label: string;
}

export class EdgeMarkers {
  private readonly root: HTMLDivElement;
  private readonly slots: Slot[] = [];
  private readonly pending: Pending[] = [];
  private readonly projected = new Vector3();
  private hostileCount = 0;

  constructor(parent: HTMLElement) {
    ensureStyles();
    this.root = document.createElement('div');
    this.root.style.cssText = 'position:absolute; inset:0; pointer-events:none; overflow:hidden;';
    parent.appendChild(this.root);
  }

  /** Start a frame. Call once, before any `add`. */
  begin(): void {
    this.pending.length = 0;
    this.hostileCount = 0;
  }

  /**
   * Offer a world position as a marker.
   *
   * Points already on screen are dropped — the object is right there, and an
   * arrow pointing at something you can see is pure clutter.
   */
  add(camera: PerspectiveCamera, x: number, z: number, kind: MarkerKind, label = ''): void {
    if (kind === 'hostile' && this.hostileCount >= MAX_HOSTILE) return;

    this.projected.set(x, 0.8, z).project(camera);

    // Behind the camera, projection mirrors the point through the origin, so
    // the raw NDC points the wrong way. Flipping restores the true bearing.
    const behind = this.projected.z > 1;
    const ndcX = behind ? -this.projected.x : this.projected.x;
    const ndcY = behind ? -this.projected.y : this.projected.y;

    // "On screen" is the real viewport, not the ring — an object between the
    // ring and the screen edge is still visible and does not want an arrow.
    const onScreen = !behind && Math.abs(ndcX) < 1 && Math.abs(ndcY) < 1;
    if (onScreen) return;

    // Degenerate case: dead centre but off screen can't happen, but guard the
    // division anyway rather than emit a NaN transform.
    if (ndcX === 0 && ndcY === 0) return;

    if (kind === 'hostile') this.hostileCount++;
    this.pending.push({ ndcX, ndcY, kind, label });
  }

  /** Finish the frame: lay out what was added and hide the rest. */
  end(width: number, height: number): void {
    // Cargo first, then objective, then threats — if the edge gets busy, the
    // markers that survive are the ones about the user's actual files.
    this.pending.sort((a, b) => KIND[b.kind].priority - KIND[a.kind].priority);

    for (let i = 0; i < this.pending.length; i++) {
      const item = this.pending[i];
      const slot = this.slotAt(i);
      const style = KIND[item.kind];

      // Cast the bearing out to the ellipse. Scaling each axis by its radius
      // turns it into a unit circle, where the crossing is just the reciprocal
      // of the direction's length — no per-quadrant cases, and no division by
      // zero for an axis-aligned bearing.
      const ux = item.ndcX / RING_X;
      const uy = item.ndcY / RING_Y;
      const len = Math.hypot(ux, uy) || 1;
      const edgeX = (ux / len) * RING_X;
      const edgeY = (uy / len) * RING_Y + RING_CY;

      const px = (edgeX * 0.5 + 0.5) * width;
      const py = (-edgeY * 0.5 + 0.5) * height;
      // Aim along the true bearing, not at the placed position — the ring's
      // centre offset would otherwise skew every arrow slightly downward.
      // CSS rotation is clockwise and screen Y runs downward, so the sign of
      // the Y term flips relative to NDC.
      const angle = Math.atan2(-item.ndcY, item.ndcX) * (180 / Math.PI);

      if (slot.kind !== item.kind) {
        slot.kind = item.kind;
        slot.arrow.textContent = style.glyph;
        slot.arrow.style.color = style.colour;
        slot.arrow.style.fontSize = `${style.size}px`;
        slot.arrow.style.textShadow = `0 0 10px ${style.colour}, 0 1px 3px rgba(0,0,0,.95)`;
        slot.label.style.color = style.colour;
        slot.root.className = item.kind === 'cargo' ? 'gc-marker gc-marker-urgent' : 'gc-marker';
      }

      slot.root.style.display = 'flex';
      slot.root.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) translate(-50%, -50%)`;
      // The glyph points right at 0°, so rotate it to face outward; the label
      // stays in the parent's frame and therefore stays upright and readable.
      slot.arrow.style.transform = `rotate(${(angle + 90).toFixed(1)}deg)`;
      slot.label.textContent = item.label;
      slot.label.style.display = item.label ? 'block' : 'none';
      // Keep the label on the inward side of the arrow, so a marker low on the
      // ring reads upward into open screen instead of down into the HUD.
      slot.root.style.flexDirection = edgeY < RING_CY ? 'column-reverse' : 'column';
    }

    for (let i = this.pending.length; i < this.slots.length; i++) {
      this.slots[i].root.style.display = 'none';
    }
  }

  dispose(): void {
    this.root.remove();
  }

  /** Pooled — markers churn every frame and must never allocate DOM in the loop. */
  private slotAt(index: number): Slot {
    let slot = this.slots[index];
    if (slot) return slot;

    const root = document.createElement('div');
    root.className = 'gc-marker';
    root.style.cssText =
      `position:absolute; left:0; top:0; display:none; flex-direction:column;
       align-items:center; text-align:center; will-change:transform;`;

    const arrow = document.createElement('div');
    arrow.style.cssText = 'line-height:1; font-family:var(--font-mono);';

    const label = document.createElement('div');
    label.style.cssText = `margin:2px 0; font:600 12px/1.2 var(--font-mono); letter-spacing:.08em;
       text-shadow:0 1px 3px rgba(0,0,0,.95); white-space:nowrap;`;

    root.append(arrow, label);
    this.root.appendChild(root);
    slot = { root, arrow, label, kind: null };
    this.slots[index] = slot;
    return slot;
  }
}

let stylesInjected = false;

/**
 * The urgent pulse lives in CSS so the browser animates it off the main thread
 * — a per-frame opacity write from the render loop would be four DOM mutations
 * a frame for no benefit.
 */
function ensureStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .gc-marker { opacity: .92; }
    .gc-marker-urgent { animation: gc-marker-pulse .85s ease-in-out infinite; }
    @keyframes gc-marker-pulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: .42; }
    }
    /* Flashing UI is a migraine and a seizure risk; respect the OS setting. */
    @media (prefers-reduced-motion: reduce) {
      .gc-marker-urgent { animation: none; opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}
