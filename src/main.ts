import { GameLoop } from './core/loop';
import { Game } from './game';
import { waitForAssets } from './core/assets';
import { connectGitContext } from './git-context';

const canvas = document.getElementById('game') as HTMLCanvasElement;

// Show loading text
const ctx = canvas.getContext('2d')!;
canvas.width = 256;
canvas.height = 384;
ctx.fillStyle = '#0f0f23';
ctx.fillRect(0, 0, 256, 384);
ctx.fillStyle = '#2ecc71';
ctx.font = '8px monospace';
ctx.textAlign = 'center';
ctx.fillText('Loading...', 128, 192);

Promise.all([waitForAssets(), connectGitContext()]).then(([_, gitContext]) => {
  const game = new Game(canvas, gitContext);
  const loop = new GameLoop(
    (dt) => game.update(dt),
    (alpha) => game.render(alpha)
  );
  loop.start();
});
