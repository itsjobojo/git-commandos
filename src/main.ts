import { Game } from './game/game';
import { buildMission } from './game/mission';
import { connectGitContext } from './net/protocol';

const canvas = document.getElementById('game') as HTMLCanvasElement | null;
const uiRoot = document.getElementById('ui') as HTMLElement | null;

if (!canvas || !uiRoot) {
  throw new Error('index.html is missing #game or #ui');
}

// Null in `pnpm dev` — no CLI server, so the game runs as a sandbox with fake
// files and no git side effects.
const git = await connectGitContext();
const mission = buildMission(git);

const game = new Game(canvas, uiRoot, mission, git);
void game.run();

// Handy while iterating; harmless in production.
(window as unknown as Record<string, unknown>).__game = game;
