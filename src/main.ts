import { GameLoop } from './core/loop';
import { Game } from './game';
import { waitForAssets } from './core/assets';
import { connectGitContext } from './git-context';
import { initMusicPlayer } from './core/music';
import { CANVAS_WIDTH, CANVAS_HEIGHT, SCALE } from './constants';

const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.width = CANVAS_WIDTH * SCALE;
canvas.height = CANVAS_HEIGHT * SCALE;
canvas.style.width = '100vmin';
canvas.style.height = '100vmin';

const ctx = canvas.getContext('2d')!;
ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
ctx.fillStyle = '#0f0f23';
ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
ctx.fillStyle = '#2ecc71';
ctx.font = '14px monospace';
ctx.textAlign = 'center';
ctx.fillText('Loading...', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);

Promise.all([waitForAssets(), connectGitContext(), initMusicPlayer()]).then(([_, gitContext]) => {
  const game = new Game(canvas, gitContext);
  const loop = new GameLoop(
    (dt) => game.update(dt),
    (alpha) => game.render(alpha)
  );
  // TEMP DEBUG HOOK — remove before commit
  (window as unknown as Record<string, unknown>).__gc = { game, loop };
  loop.start();
});
