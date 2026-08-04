import { launchGame } from '../server.mjs';

export const description = 'Launch the game in sandbox/dev mode';
export const usage = 'gcmds play [--extreme]';

// Sandbox mode invents its own files — it never reads or writes git state.
export const requiresRepo = false;

const SANDBOX_FILES = ['src/auth.ts', 'src/api.ts', 'src/router.ts', 'src/utils.ts', 'src/config.ts'];

export async function run(args, flags) {
  const difficulty = flags.extreme ? 'extreme' : 'basic';

  console.log(`  Launching sandbox game (${difficulty} mode)...`);

  const config = {
    command: 'commit',
    difficulty,
    music: !flags.noMusic,
    payload: {
      files: SANDBOX_FILES.map((name) => ({ name, added: 24, removed: 2 })),
      commitMessage: 'sandbox: dev test run',
      linesAdded: 42,
      branch: 'sandbox',
      repo: 'sandbox',
    },
  };

  const result = await launchGame(config);
  const { outcome, payload } = result;

  console.log('');
  if (outcome === 'win') {
    const surviving = payload?.survivingFiles || [];
    const lost = payload?.lostFiles || [];
    console.log(`  You won! Survived: ${surviving.length}, Lost: ${lost.length}`);
  } else if (outcome === 'abort') {
    console.log('  Game closed.');
  } else {
    console.log('  Game over.');
  }
}
