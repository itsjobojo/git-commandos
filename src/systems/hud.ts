import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../constants';
import { Player } from '../entities/player';
import { WEAPONS } from '../weapons';

export function renderHud(ctx: CanvasRenderingContext2D, player: Player): void {
  ctx.save();

  // Top bar background
  ctx.fillStyle = 'rgba(10, 5, 20, 0.7)';
  ctx.fillRect(0, 0, CANVAS_WIDTH, 14);

  // Score
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 8px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE: ${player.score}`, 4, 10);

  // Streak
  if (player.streak > 1) {
    ctx.fillStyle = '#f7dc6f';
    ctx.fillText(`x${player.streak}`, 80, 10);
  }

  // Health bar
  const barWidth = 50;
  const barHeight = 6;
  const barX = CANVAS_WIDTH - barWidth - 4;
  const barY = 4;

  ctx.fillStyle = '#2c1810';
  ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(barX, barY, barWidth, barHeight);

  const hpRatio = player.hp / player.maxHp;
  ctx.fillStyle = hpRatio > 0.5 ? '#e94560' : hpRatio > 0.25 ? '#f5a623' : '#e94560';
  ctx.fillRect(barX, barY, Math.ceil(barWidth * hpRatio), barHeight);

  for (let i = 1; i < player.maxHp; i++) {
    const pipX = barX + (barWidth / player.maxHp) * i;
    ctx.fillStyle = '#2c1810';
    ctx.fillRect(pipX, barY, 1, barHeight);
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 6px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('HP', barX - 2, barY + 5);

  // Bottom bar background
  ctx.fillStyle = 'rgba(10, 5, 20, 0.7)';
  ctx.fillRect(0, CANVAS_HEIGHT - 22, CANVAS_WIDTH, 22);

  // Weapon + ammo counter
  ctx.textAlign = 'left';
  ctx.font = 'bold 8px monospace';
  if (player.ammo > 0) {
    const wName = WEAPONS[player.weapon].name;
    ctx.fillStyle = '#2ecc71';
    ctx.fillText(`${wName}: ${player.ammo}`, 4, CANVAS_HEIGHT - 12);
  } else {
    ctx.fillStyle = '#f5a623';
    ctx.fillText('KNIFE', 4, CANVAS_HEIGHT - 12);
  }

  // Controls
  const cmdY = CANVAS_HEIGHT - 3;
  ctx.font = 'bold 7px monospace';

  ctx.fillStyle = '#aabbcc';
  ctx.fillText(player.ammo > 0 ? 'Z:shoot' : 'Z:stab', 4, cmdY);

  ctx.fillStyle = player.gitRevertCharges > 0 ? '#e94560' : '#555555';
  ctx.fillText(`C:revert(${player.gitRevertCharges})`, 70, cmdY);

  ctx.restore();
}
