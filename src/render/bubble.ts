import { CanvasTexture, LinearFilter, SRGBColorSpace, Sprite, SpriteMaterial } from 'three';

/**
 * A billboarded speech bubble.
 *
 * Rendered to a canvas at runtime rather than baked into art, so the dialogue
 * tables stay plain string arrays that anyone can extend in a diff — adding a
 * joke should never mean opening an image editor.
 */
export class SpeechBubble {
  readonly sprite: Sprite;
  private life = 0;
  private duration = 0;
  private readonly material: SpriteMaterial;

  constructor() {
    this.material = new SpriteMaterial({
      transparent: true,
      depthTest: false,
      opacity: 0,
    });
    this.sprite = new Sprite(this.material);
    this.sprite.visible = false;
    this.sprite.renderOrder = 900;
    this.sprite.center.set(0.5, 0);
  }

  say(text: string, seconds = 3.4): void {
    const texture = renderBubble(text);
    this.material.map?.dispose();
    this.material.map = texture;
    this.material.needsUpdate = true;

    const aspect = texture.image.width / texture.image.height;
    const height = 1.15;
    this.sprite.scale.set(height * aspect, height, 1);
    this.sprite.visible = true;
    this.duration = seconds;
    this.life = seconds;
  }

  get speaking(): boolean {
    return this.life > 0;
  }

  update(dt: number): void {
    if (this.life <= 0) return;
    this.life -= dt;
    if (this.life <= 0) {
      this.sprite.visible = false;
      this.material.opacity = 0;
      return;
    }
    // Quick pop in, slow fade out.
    const t = this.life / this.duration;
    this.material.opacity = t > 0.9 ? (1 - t) * 10 : Math.min(1, t * 3.2);
  }

  dispose(): void {
    this.material.map?.dispose();
    this.material.dispose();
  }
}

const MAX_WIDTH = 460;
const FONT = '22px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const PADDING = 16;
const LINE_HEIGHT = 28;

function renderBubble(text: string): CanvasTexture {
  const measure = document.createElement('canvas').getContext('2d')!;
  measure.font = FONT;
  const lines = wrap(measure, text, MAX_WIDTH - PADDING * 2);
  const width = Math.max(...lines.map((l) => measure.measureText(l).width)) + PADDING * 2;
  const height = lines.length * LINE_HEIGHT + PADDING * 2 + 12;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const ctx = canvas.getContext('2d')!;
  ctx.font = FONT;
  ctx.textBaseline = 'top';

  const bodyHeight = height - 12;
  roundedRect(ctx, 0.5, 0.5, canvas.width - 1, bodyHeight - 1, 8);
  ctx.fillStyle = 'rgba(12, 18, 24, 0.94)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(251, 146, 60, 0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Tail, pointing down at whoever is talking.
  ctx.beginPath();
  ctx.moveTo(canvas.width / 2 - 9, bodyHeight - 1);
  ctx.lineTo(canvas.width / 2, height);
  ctx.lineTo(canvas.width / 2 + 9, bodyHeight - 1);
  ctx.closePath();
  ctx.fillStyle = 'rgba(12, 18, 24, 0.94)';
  ctx.fill();

  ctx.fillStyle = '#f4e4d4';
  lines.forEach((line, i) => {
    ctx.fillText(line, PADDING, PADDING + i * LINE_HEIGHT);
  });

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  return texture;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
