import { CanvasTexture, Group, LinearFilter, Sprite, SpriteMaterial } from 'three';
import { PALETTE } from './palette';
import type { Sense } from '../systems/awareness';

/**
 * The `?` and `!` that pop over an enemy the moment it changes its mind.
 *
 * The cone already carries the enemy's *state*; what it carries badly is the
 * *transition*, because a colour change on a translucent wedge at the edge of
 * the screen is easy to miss and it is the one frame that should make you move.
 * So the mark is an event, not a status: it appears on the change and fades.
 *
 * Deliberately not a `SpeechBubble` — that draws a rounded frame sized for a
 * sentence, and the Recruiter, Intern and AI-bro each already own one above
 * their head, so a second sprite there would collide with dialogue.
 */
const MAX_MARKS = 6;
/** How long the pop stays up. Matched by the `inState` gate in `add`. */
const SHOW_SECONDS = 1.2;
const RISE = 0.7;

export class AlertMarks {
  readonly group = new Group();
  private readonly sprites: Sprite[] = [];
  private readonly materials: SpriteMaterial[] = [];
  private count = 0;

  constructor() {
    this.group.name = 'alert-marks';
    for (let i = 0; i < MAX_MARKS; i++) {
      const material = new SpriteMaterial({
        transparent: true,
        depthTest: false,
        // Textures are shared from the module cache; disposing one here would
        // pull it out from under every other mark using the same glyph.
        map: null,
      });
      const sprite = new Sprite(material);
      sprite.visible = false;
      sprite.scale.set(1.1, 1.1, 1);
      // Under the reticle at 999, over the speech bubbles at 900.
      sprite.renderOrder = 950;
      this.sprites.push(sprite);
      this.materials.push(material);
      this.group.add(sprite);
    }
  }

  begin(): void {
    this.count = 0;
  }

  /** @param y where the enemy's head is, so the mark sits just above it. */
  add(x: number, y: number, z: number, sense: Sense): void {
    if (this.count >= MAX_MARKS) return;
    if (sense.state === 'unaware') return;
    // Only during the pop. A permanent `!` over eight enemies is noise, and the
    // persistent version of this information is already the cone's colour.
    if (sense.inState >= SHOW_SECONDS) return;

    const progress = sense.inState / SHOW_SECONDS;
    const sprite = this.sprites[this.count];
    const material = this.materials[this.count];
    const alerted = sense.state === 'alerted';

    material.map = glyphTexture(alerted ? '!' : '?', alerted);
    material.color.setHex(0xffffff);
    // Snap in, drift up, fade out — so it reads even at the edge of vision.
    material.opacity = progress < 0.12 ? progress / 0.12 : 1 - (progress - 0.12) / 0.88;
    sprite.position.set(x, y + 0.5 + progress * RISE, z);
    const pop = progress < 0.18 ? 0.7 + (progress / 0.18) * 0.5 : 1.1;
    sprite.scale.set(pop, pop, 1);
    sprite.visible = true;
    this.count++;
  }

  end(): void {
    for (let i = this.count; i < MAX_MARKS; i++) this.sprites[i].visible = false;
  }

  dispose(): void {
    for (const material of this.materials) material.dispose();
  }
}

/** One texture per glyph, forever — two in total. */
const cache = new Map<string, CanvasTexture>();

function glyphTexture(glyph: string, alerted: boolean): CanvasTexture {
  const cached = cache.get(glyph);
  if (cached) return cached;

  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const tint = alerted ? PALETTE.hostile : PALETTE.meeting;
  const hex = `#${tint.toString(16).padStart(6, '0')}`;

  ctx.font = '700 92px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // A dark outline first: these land on a bright floor as often as a dark one,
  // and an unoutlined glyph disappears against the wrong half of the palette.
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(5, 7, 10, 0.85)';
  ctx.strokeText(glyph, size / 2, size / 2 + 4);
  ctx.fillStyle = hex;
  ctx.fillText(glyph, size / 2, size / 2 + 4);

  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  cache.set(glyph, texture);
  return texture;
}
