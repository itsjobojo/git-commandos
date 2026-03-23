import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../constants';
import { playSound } from '../core/sound';

export const MEETING_NAMES = [
  'WEEKLY PLANNING', 'SPRINT RETRO', 'ALL-HANDS SYNC', 'ROADMAP ALIGNMENT',
  'BACKLOG GROOMING', '1:1 WITH MANAGER', 'QUARTERLY OKR REVIEW',
  'INCIDENT POST-MORTEM', 'DESIGN CRITIQUE', 'STAKEHOLDER UPDATE',
  'BUDGET REVIEW', 'TEAM BUILDING', 'CROSS-FUNC SYNC',
  'MANDATORY FUN', 'COMPLIANCE TRAINING', 'PERF CALIBRATION',
];

const SUBTITLES = [
  'has been scheduled', 'starts NOW', 'you cannot decline',
  'is mandatory', 'was moved to NOW', 'DO NOT BE LATE',
  'no agenda attached',
];

// Shape templates: [widthMin, widthMax, heightMin, heightMax]
const SHAPES = [
  [160, 240, 80, 120],   // wide banner
  [80, 120, 160, 240],   // tall column
  [140, 200, 140, 200],  // large square-ish
  [180, 280, 70, 100],   // very wide strip
  [70, 110, 180, 260],   // very tall strip
  [140, 180, 110, 160],  // medium rectangle
];

export interface MeetingZone {
  x: number;         // world X position
  worldY: number;    // world Y position (scrolls with map)
  w: number;
  h: number;
  name: string;
  subtitle: string;
  type: 'avoid' | 'rush';
  timer: number;
  maxTimer: number;
  flashTimer: number;
  claimed: boolean;
}

export class AnnouncementSystem {
  zones: MeetingZone[] = [];
  private nextTrigger = 12;
  private announcementText = '';
  private announcementTimer = 0;
  private announcementStyle = 0;
  update(dt: number, gameTime: number, _cameraY: number): void {
    if (gameTime < 5) return;

    // Update active zones
    for (const z of this.zones) {
      z.timer -= dt;
      if (z.flashTimer > 0) z.flashTimer -= dt;
    }
    this.zones = this.zones.filter(z => z.timer > 0);

    // Announcement text fade
    if (this.announcementTimer > 0) this.announcementTimer -= dt;

    // Spawn new zones
    this.nextTrigger -= dt;
    if (this.nextTrigger <= 0 && this.zones.length === 0) {
      this.spawnZone();
      this.nextTrigger = 15 + Math.random() * 15;
    }
  }

  private spawnZone(): void {
    const isAvoid = Math.random() < 0.6;
    const name = MEETING_NAMES[Math.floor(Math.random() * MEETING_NAMES.length)];
    const subtitle = SUBTITLES[Math.floor(Math.random() * SUBTITLES.length)];

    // Pick a random shape
    const shape = SHAPES[Math.floor(Math.random() * SHAPES.length)];
    const w = shape[0] + Math.random() * (shape[1] - shape[0]);
    const h = shape[2] + Math.random() * (shape[3] - shape[2]);

    // Position in screen coordinates — zone appears directly on the visible area
    const x = 10 + Math.random() * (CANVAS_WIDTH - w - 20);
    const worldY = 30 + Math.random() * (CANVAS_HEIGHT - h - 60);

    const duration = isAvoid ? (8 + Math.random() * 5) : (6 + Math.random() * 3);

    this.zones.push({
      x, worldY: worldY, w, h, name, subtitle,
      type: isAvoid ? 'avoid' : 'rush',
      timer: duration,
      maxTimer: duration,
      flashTimer: 0.5,
      claimed: false,
    });

    this.announcementText = name;
    this.announcementTimer = 1.5;
    this.announcementStyle = Math.floor(Math.random() * 5);

    playSound('explosion', 0.4);
  }

  /** Zone Y is already in screen coordinates */
  private screenY(z: MeetingZone): number {
    return z.worldY;
  }

  /** Check if player (in screen coords) is inside any avoid zone */
  isPlayerSlowed(px: number, py: number, pw: number, ph: number): boolean {
    for (const z of this.zones) {
      if (z.type !== 'avoid') continue;
      const sy = this.screenY(z);
      if (px + pw > z.x && px < z.x + z.w && py + ph > sy && py < sy + z.h) {
        return true;
      }
    }
    return false;
  }

  /** Check if player reached a rush zone */
  checkRushClaim(px: number, py: number, pw: number, ph: number): MeetingZone | null {
    for (const z of this.zones) {
      if (z.type !== 'rush' || z.claimed) continue;
      const sy = this.screenY(z);
      if (px + pw > z.x && px < z.x + z.w && py + ph > sy && py < sy + z.h) {
        z.claimed = true;
        return z;
      }
    }
    return null;
  }

  /** Check if player is inside any rush (green) zone */
  isPlayerInRush(px: number, py: number, pw: number, ph: number): boolean {
    for (const z of this.zones) {
      if (z.type !== 'rush') continue;
      const sy = this.screenY(z);
      if (px + pw > z.x && px < z.x + z.w && py + ph > sy && py < sy + z.h) {
        return true;
      }
    }
    return false;
  }

  getIntroShake(): number {
    for (const z of this.zones) {
      if (z.flashTimer > 0) return 8;
    }
    return 0;
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const z of this.zones) {
      const sy = this.screenY(z);
      // Only render if on screen
      if (sy + z.h < -20 || sy > CANVAS_HEIGHT + 20) continue;
      this.renderZone(ctx, z, sy);
    }

    if (this.announcementTimer > 0) {
      this.renderAnnouncement(ctx);
    }
  }

  private renderZone(ctx: CanvasRenderingContext2D, z: MeetingZone, screenY: number): void {
    ctx.save();

    const fadeIn = Math.min(1, (z.maxTimer - z.timer) * 3);
    const fadeOut = Math.min(1, z.timer * 2);
    const alpha = fadeIn * fadeOut;
    const isAvoid = z.type === 'avoid';
    const baseColor = isAvoid ? '#e94560' : '#2ecc71';

    ctx.globalAlpha = alpha;

    // Background fill
    ctx.fillStyle = isAvoid ? 'rgba(233, 69, 96, 0.12)' : 'rgba(46, 204, 113, 0.12)';
    ctx.fillRect(z.x, screenY, z.w, z.h);

    // Animated dashed border
    ctx.strokeStyle = isAvoid ? 'rgba(233, 69, 96, 0.6)' : 'rgba(46, 204, 113, 0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -Date.now() * 0.02 * (isAvoid ? 1 : -1);
    ctx.strokeRect(z.x, screenY, z.w, z.h);
    ctx.setLineDash([]);

    // Corner brackets
    const cs = 8;
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = 2;
    ctx.globalAlpha = alpha * (0.6 + Math.sin(Date.now() * 0.005) * 0.3);
    // TL
    ctx.beginPath(); ctx.moveTo(z.x, screenY + cs); ctx.lineTo(z.x, screenY); ctx.lineTo(z.x + cs, screenY); ctx.stroke();
    // TR
    ctx.beginPath(); ctx.moveTo(z.x + z.w - cs, screenY); ctx.lineTo(z.x + z.w, screenY); ctx.lineTo(z.x + z.w, screenY + cs); ctx.stroke();
    // BL
    ctx.beginPath(); ctx.moveTo(z.x, screenY + z.h - cs); ctx.lineTo(z.x, screenY + z.h); ctx.lineTo(z.x + cs, screenY + z.h); ctx.stroke();
    // BR
    ctx.beginPath(); ctx.moveTo(z.x + z.w - cs, screenY + z.h); ctx.lineTo(z.x + z.w, screenY + z.h); ctx.lineTo(z.x + z.w, screenY + z.h - cs); ctx.stroke();

    ctx.globalAlpha = alpha;

    const zcx = z.x + z.w / 2;

    // Type label centered above zone
    ctx.font = 'bold 10px "Pixelify Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isAvoid ? '#ff6b81' : '#7dffb3';
    ctx.fillText(isAvoid ? '!! AVOID !!' : '>> RUSH TO <<', zcx, screenY - 8);

    // Text content — clipped to zone
    ctx.save();
    ctx.beginPath();
    ctx.rect(z.x, screenY, z.w, z.h);
    ctx.clip();

    if (z.claimed) {
      // Claimed — show OK! only
      ctx.globalAlpha = alpha * 0.9;
      ctx.font = 'bold 24px "Pixelify Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2ecc71';
      ctx.fillText('OK!', zcx, screenY + z.h / 2);
    } else {
      // Dark backing for readability
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      const bgY = screenY + z.h / 2 - 14;
      ctx.fillRect(z.x + 4, bgY, z.w - 8, 30);

      // Meeting name
      ctx.font = 'bold 11px "Pixelify Sans", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(z.name, zcx, screenY + z.h / 2 - 4);

      // Subtitle
      ctx.font = '8px "Pixelify Sans", sans-serif';
      ctx.fillStyle = isAvoid ? '#ff9bac' : '#a8ffcf';
      ctx.fillText(z.subtitle, zcx, screenY + z.h / 2 + 10);
    }

    ctx.restore();
    ctx.globalAlpha = alpha;

    // Timer bar
    const timerRatio = z.timer / z.maxTimer;
    const barW = Math.min(z.w - 12, 100);
    const barX = z.x + (z.w - barW) / 2;
    const barY = screenY + z.h - 10;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(barX, barY, barW, 4);
    ctx.fillStyle = baseColor;
    ctx.fillRect(barX, barY, barW * timerRatio, 4);

    // Flash on spawn
    if (z.flashTimer > 0) {
      ctx.fillStyle = `rgba(255,255,255,${z.flashTimer * 0.5})`;
      ctx.fillRect(z.x, screenY, z.w, z.h);
    }

    ctx.restore();
  }

  private renderAnnouncement(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    const fade = Math.min(1, this.announcementTimer * 2);
    const progress = 1 - (this.announcementTimer / 1.5);

    ctx.textAlign = 'center';
    ctx.globalAlpha = fade;

    const cx = CANVAS_WIDTH / 2;
    const cy = 30;

    ctx.fillStyle = `rgba(10, 5, 20, ${0.8 * fade})`;
    ctx.fillRect(0, cy - 18, CANVAS_WIDTH, 28);

    ctx.font = 'bold 16px "Pixelify Sans", sans-serif';
    ctx.fillStyle = '#e94560';

    if (this.announcementStyle < 2) {
      const scale = progress < 0.2 ? 1.5 - progress * 2.5 : 1;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.fillText(this.announcementText, 0, 0);
      ctx.restore();
    } else if (this.announcementStyle < 4) {
      if (progress < 0.15) {
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = ['#e94560', '#2ecc71', '#3498db'][i];
          ctx.globalAlpha = 0.5;
          ctx.fillText(this.announcementText, cx + (Math.random() - 0.5) * 10, cy + (Math.random() - 0.5) * 4);
        }
      } else {
        ctx.fillText(this.announcementText, cx, cy);
      }
    } else {
      const slideX = progress < 0.2 ? (1 - progress * 5) * CANVAS_WIDTH * 0.5 : 0;
      ctx.fillText(this.announcementText, cx + slideX, cy);
    }

    ctx.restore();
  }
}
