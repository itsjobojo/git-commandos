import { Game } from './game/game';

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui') as HTMLElement | null;

if (!canvas || !uiRoot) {
  throw new Error('index.html is missing #game or #ui');
}

// M2 slots the git handshake in here: connect to the CLI over WebSocket, and
// seed the mission from the commit message. Until then, sandbox.
const game = new Game(canvas, uiRoot, { seed: 'sandbox' });
game.start();

// Handy while iterating; harmless in production.
(window as unknown as Record<string, unknown>).__game = game;
