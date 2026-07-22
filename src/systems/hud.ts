import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../constants';
import { Player } from '../entities/player';
import { WEAPONS } from '../weapons';
import { GitFile } from '../git-context';

export function renderHud(ctx: CanvasRenderingContext2D, player: Player, gitFiles: GitFile[] | null = null): void {
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

  // Git file strip — below top bar
  if (gitFiles && gitFiles.length > 0) {
    const stripY = 15;
    const stripH = 10;
    ctx.fillStyle = 'rgba(10, 5, 20, 0.6)';
    ctx.fillRect(0, stripY, CANVAS_WIDTH, stripH);

    ctx.font = '5px monospace';
    ctx.textAlign = 'left';
    const maxShow = Math.min(gitFiles.length, 8);
    const slotW = CANVAS_WIDTH / maxShow;

    for (let i = 0; i < maxShow; i++) {
      const f = gitFiles[i];
      const x = i * slotW + 2;
      const label = f.name.split('/').pop() || f.name;
      const truncated = label.length > 10 ? label.slice(0, 9) + '\u2026' : label;

      if (f.alive) {
        // Green dot + name
        ctx.fillStyle = '#2ecc71';
        ctx.fillRect(x, stripY + 3, 3, 3);
        ctx.fillStyle = '#ccddcc';
        ctx.fillText(truncated, x + 5, stripY + 7);
      } else {
        // Red dot + strikethrough name
        ctx.fillStyle = '#e94560';
        ctx.fillRect(x, stripY + 3, 3, 3);
        ctx.fillStyle = '#886666';
        ctx.fillText(truncated, x + 5, stripY + 7);
        // Strikethrough line
        const textW = ctx.measureText(truncated).width;
        ctx.strokeStyle = '#e94560';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(x + 5, stripY + 5.5);
        ctx.lineTo(x + 5 + textW, stripY + 5.5);
        ctx.stroke();
      }
    }

    if (gitFiles.length > maxShow) {
      ctx.fillStyle = '#7f8c8d';
      ctx.textAlign = 'right';
      ctx.fillText(`+${gitFiles.length - maxShow}`, CANVAS_WIDTH - 2, stripY + 7);
    }
  }

  // Bottom bar background
  ctx.fillStyle = 'rgba(10, 5, 20, 0.7)';
  ctx.fillRect(0, CANVAS_HEIGHT - 22, CANVAS_WIDTH, 22);

  // Weapon + ammo counter
  ctx.textAlign = 'left';
  ctx.font = 'bold 8px monospace';
  if (player.weapon === 'pistol') {
    // Pistol is the infinite fallback weapon
    ctx.fillStyle = '#2ecc71';
    ctx.fillText('PISTOL: ∞', 4, CANVAS_HEIGHT - 12);
  } else {
    const wName = WEAPONS[player.weapon].name;
    ctx.fillStyle = '#2ecc71';
    ctx.fillText(`${wName}: ${player.ammo}`, 4, CANVAS_HEIGHT - 12);
  }

  // Controls
  const cmdY = CANVAS_HEIGHT - 3;
  ctx.font = 'bold 7px monospace';

  ctx.fillStyle = '#aabbcc';
  ctx.fillText('Z:shoot X:stab', 4, cmdY);

  ctx.fillStyle = player.gitRevertCharges > 0 ? '#e94560' : '#555555';
  ctx.fillText(`C:revert(${player.gitRevertCharges})`, 70, cmdY);

  ctx.restore();
}
