import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { removeFromIndex, stageFiles } from '../git-ops.mjs';

export const description = 'Create fake staged files for testing';
export const usage = 'gcmds fake-files [--count=N] [--clean]';

const FAKE_DIR = '.fake-files';

const FAKE_NAMES = [
  'auth.ts', 'api.ts', 'database.ts', 'router.ts', 'middleware.ts',
  'config.ts', 'utils.ts', 'logger.ts', 'cache.ts', 'queue.ts',
  'worker.ts', 'schema.ts', 'migrations.ts', 'seed.ts', 'types.ts',
];

export async function run(args, flags) {
  const cleanFlag = args.includes('--clean');
  const countArg = args.find((a) => a.startsWith('--count='));
  const count = countArg ? parseInt(countArg.split('=')[1], 10) : 5;

  // Clean up previously created fake files
  if (existsSync(FAKE_DIR)) {
    removeFromIndex(FAKE_DIR);
    rmSync(FAKE_DIR, { recursive: true, force: true });
    if (cleanFlag) {
      console.log(`  Cleaned up ${FAKE_DIR}`);
      return;
    }
  }

  if (cleanFlag) {
    console.log('  Nothing to clean.');
    return;
  }

  const n = Math.min(Math.max(count, 1), FAKE_NAMES.length);
  mkdirSync(FAKE_DIR, { recursive: true });

  const files = FAKE_NAMES.slice(0, n);
  for (const name of files) {
    const lines = Math.floor(Math.random() * 20) + 5;
    const content = [`// fake: ${name}`, ...Array.from({ length: lines }, (_, i) => `export const line${i + 1} = ${i + 1};`)].join('\n') + '\n';
    writeFileSync(join(FAKE_DIR, name), content);
  }

  stageFiles([FAKE_DIR]);

  console.log(`  Created and staged ${n} fake file(s) in ${FAKE_DIR}/:`);
  for (const f of files) console.log(`    ${FAKE_DIR}/${f}`);
  console.log(`\n  Run "gcmds commit -m \\"test commit\\"" to play.\n`);
}
