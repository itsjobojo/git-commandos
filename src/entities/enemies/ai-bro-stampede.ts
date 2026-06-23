import { Enemy } from './enemy';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../../constants';
import { enemySprites } from '../../core/assets';

const AI_BRO_QUOTES = [
  // Hype/worship
  'AGI is basically here',
  'GPT-7 is insane',
  'Claude is my cofounder',
  'Gemini Pro solves everything',
  'Fable 5 centers my divs',
  'Kimi 2.7 destroys benchmarks',
  'we are so back',
  'the singularity is next quarter',
  'this changes everything',
  // Tools/workflow
  'I switched to Cursor',
  'just use an agent for that',
  "you're still coding manually?",
  'I automated my entire job',
  'just prompt engineer it',
  'have you tried vibe coding?',
  'I replaced my whole team',
  'Copilot writes all my code',
  // Hot takes
  'software engineers are done',
  'why would you learn to code?',
  'GPT 5.6 passed the bar exam',
  'hallucinations are a feature',
  'context window is all you need',
  'open weights won',
  'college is obsolete',
  'art was never real anyway',
  // Startup energy
  'AI wrapper, $50M ARR',
  "we're building AGI",
  'my AI girlfriend is sentient',
  'pivoting to AI',
  "it's an AI-first company",
  'sniff my RAG pipeline',
];

interface BroUnit {
  x: number;
  y: number;
  sprite: HTMLImageElement;
  wobbleOffset: number;
  wobbleSpeed: number;
  quote: string;
  bubbleTimer: number;
  bubbleInterval: number;
  bubbleAlpha: number;
}

export class AiBroStampede extends Enemy {
  private bros: BroUnit[] = [];
  private stampedeCenterX: number;
  private stampedeSpeed = 55;
  private stampedeWidth = 70;
  private shakeAmount = 0;

  constructor(y: number) {
    super();
    // The stampede is a narrow column of overlapping dudes
    this.stampedeCenterX = 40 + Math.random() * (CANVAS_WIDTH - 80);
    this.x = this.stampedeCenterX - this.stampedeWidth / 2;
    this.y = y;
    this.width = this.stampedeWidth;
    this.height = 20;
    this.hp = 18;
    this.maxHp = 18;
    this.scoreValue = 500;
    this.tier = 'heavy';

    // Spawn a cluster of bros
    const count = 10 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      this.bros.push({
        x: this.stampedeCenterX + (Math.random() - 0.5) * this.stampedeWidth,
        y: y - i * 18 - Math.random() * 10,
        sprite: enemySprites[Math.floor(Math.random() * enemySprites.length)],
        wobbleOffset: Math.random() * Math.PI * 2,
        wobbleSpeed: 4 + Math.random() * 4,
        quote: AI_BRO_QUOTES[Math.floor(Math.random() * AI_BRO_QUOTES.length)],
        bubbleTimer: i * 0.5 + Math.random() * 2,
        bubbleInterval: 4 + Math.random() * 3,
        bubbleAlpha: 0,
      });
    }
  }

  getShake(): number {
    return this.shakeAmount;
  }

  ai(dt: number, _playerX: number, _playerY: number): void {
    this.shakeAmount = 2.5;

    for (const bro of this.bros) {
      bro.wobbleOffset += dt * bro.wobbleSpeed;
      bro.x += Math.sin(bro.wobbleOffset) * 40 * dt;
      bro.y += this.stampedeSpeed * dt;

      // Bubble cycling
      bro.bubbleTimer -= dt;
      if (bro.bubbleTimer <= 0) {
        bro.bubbleTimer = bro.bubbleInterval;
        bro.quote = AI_BRO_QUOTES[Math.floor(Math.random() * AI_BRO_QUOTES.length)];
        bro.bubbleAlpha = 1;
      }
      if (bro.bubbleAlpha > 0) {
        bro.bubbleAlpha -= dt * 0.18;
      }
    }

    // Update hitbox to cover the swarm
    const minX = Math.min(...this.bros.map(b => b.x));
    const maxX = Math.max(...this.bros.map(b => b.x)) + 16;
    const minY = Math.min(...this.bros.map(b => b.y));
    const maxY = Math.max(...this.bros.map(b => b.y)) + 16;
    this.x = minX;
    this.y = minY;
    this.width = maxX - minX;
    this.height = maxY - minY;

    if (minY > CANVAS_HEIGHT + 60) {
      this.active = false;
    }
  }

  update(dt: number): void {
    void dt;
  }

  render(ctx: CanvasRenderingContext2D): void {
    // Draw bros back-to-front (highest Y first so overlapping looks right)
    const sorted = [...this.bros].sort((a, b) => a.y - b.y);

    for (const bro of sorted) {
      const rx = Math.round(bro.x);
      const ry = Math.round(bro.y);

      if (ry < -40 || ry > CANVAS_HEIGHT + 40) continue;

      // Draw the bro sprite
      if (this.flashTimer > 0) {
        ctx.save();
        ctx.drawImage(bro.sprite, rx, ry, 16, 16);
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(rx, ry, 16, 16);
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
      } else {
        ctx.drawImage(bro.sprite, rx, ry, 16, 16);
      }

      // Thought bubble
      if (bro.bubbleAlpha > 0.05) {
        ctx.save();
        ctx.globalAlpha = Math.min(bro.bubbleAlpha, 0.95);

        const text = bro.quote;
        ctx.font = 'bold 11px "Pixelify Sans", sans-serif';
        const tw = ctx.measureText(text).width;
        const pad = 5;
        const bw = tw + pad * 2;
        const bh = 18;
        const bx = rx + 8 - bw / 2;
        const by = ry - 28;
        const radius = 4;

        // Bubble background with border
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx + radius, by);
        ctx.lineTo(bx + bw - radius, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + radius);
        ctx.lineTo(bx + bw, by + bh - radius);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - radius, by + bh);
        ctx.lineTo(bx + radius, by + bh);
        ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - radius);
        ctx.lineTo(bx, by + radius);
        ctx.quadraticCurveTo(bx, by, bx + radius, by);
        ctx.fill();
        ctx.stroke();

        // Little tail
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(rx + 5, by + bh);
        ctx.lineTo(rx + 8, by + bh + 4);
        ctx.lineTo(rx + 11, by + bh);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(rx + 5, by + bh);
        ctx.lineTo(rx + 8, by + bh + 4);
        ctx.lineTo(rx + 11, by + bh);
        ctx.stroke();

        // Text
        ctx.fillStyle = '#1a1a2e';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, rx + 8, by + bh / 2 + 1);

        ctx.restore();
      }
    }
  }
}
