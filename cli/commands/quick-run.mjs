import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { unstageFiles } from '../git-ops.mjs';
import { launchGame } from '../server.mjs';

export const description = 'Stage fake files and play a test round, then clean up';
export const usage = 'gcmds quick-run [--count=N] [--duration=1-10] [--extreme]';

const FAKE_DIR = '.quick-run-files';
const FAKE_NAMES = ['auth.ts', 'api.ts', 'router.ts', 'utils.ts', 'config.ts', 'schema.ts', 'worker.ts', 'logger.ts'];

export async function run(args, flags) {
  const countArg = args.find((a) => a.startsWith('--count='));
  const count = Math.min(Math.max(countArg ? parseInt(countArg.split('=')[1], 10) : 4, 1), FAKE_NAMES.length);
  const durationArg = args.find((a) => a.startsWith('--duration='));
  const duration = durationArg ? Math.min(10, Math.max(1, parseInt(durationArg.split('=')[1], 10))) : null;
  // duration 1 → ~200 rows (~3 min), duration 10 → ~1280 rows (~18 min)
  const gameRows = duration !== null ? duration * 120 + 80 : null;
  const difficulty = flags.extreme ? 'extreme' : 'basic';

  // Create and stage fake files
  if (existsSync(FAKE_DIR)) rmSync(FAKE_DIR, { recursive: true, force: true });
  mkdirSync(FAKE_DIR, { recursive: true });

  const files = FAKE_NAMES.slice(0, count);
  let totalLines = 0;
  for (const name of files) {
    const lines = Math.floor(Math.random() * 20) + 5;
    totalLines += lines;
    const content = [`// quick-run: ${name}`, ...Array.from({ length: lines }, (_, i) => `export const line${i + 1} = ${i + 1};`)].join('\n') + '\n';
    writeFileSync(join(FAKE_DIR, name), content);
  }
  execSync(`git add ${FAKE_DIR}`, { stdio: 'pipe' });

  const stagedFiles = files.map((f) => `${FAKE_DIR}/${f}`);

  console.log(`  Quick run: ${count} fake file(s), difficulty: ${difficulty}${gameRows ? `, duration: ${duration}/10` : ''}`);
  console.log(`  Opening game...`);

  const config = {
    command: 'commit',
    difficulty,
    music: !flags.noMusic,
    payload: {
      files: stagedFiles.map((name) => ({ name, added: 20, removed: 0 })),
      commitMessage: 'chore: quick-run test',
      linesAdded: totalLines,
      branch: 'quick-run',
      repo: 'sandbox',
      ...(gameRows !== null && { gameRows }),
    },
  };

  let result;
  try {
    result = await launchGame(config);
  } finally {
    // Always clean up — unstage and remove regardless of outcome
    try { unstageFiles(stagedFiles); } catch {}
    try { rmSync(FAKE_DIR, { recursive: true, force: true }); } catch {}
  }

  const { outcome, payload } = result;
  console.log('');

  if (outcome === 'win') {
    const surviving = payload?.survivingFiles?.length ?? stagedFiles.length;
    const lost = payload?.lostFiles?.length ?? 0;
    console.log(`  ✅ Win — ${surviving} survived, ${lost} lost`);
  } else if (outcome === 'abort') {
    console.log('  Game closed.');
  } else {
    console.log('  💀 Game over.');
  }

  console.log('  Cleaned up test files.');
}
