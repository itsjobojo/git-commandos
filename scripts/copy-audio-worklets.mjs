/**
 * chiptune3 ships its audio worklets as files that must be fetched at runtime,
 * not imported — a bundler cannot reach them. Copy them into public/ so Vite
 * carries them into dist/, where the published package serves them from.
 *
 * Build-time only. Nothing here may run on `npm install -g`: the published
 * tarball has no public/ and no devDependencies, and a failing install script
 * is a failing install.
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'node_modules', 'chiptune3');
const TARGET = join(ROOT, 'public', 'audio');
const WORKLETS = ['chiptune3.worklet.js', 'libopenmpt.worklet.js'];

if (!existsSync(SOURCE)) {
  console.error('  chiptune3 is not installed — run `pnpm install` first.');
  process.exit(1);
}

mkdirSync(TARGET, { recursive: true });
for (const file of WORKLETS) {
  copyFileSync(join(SOURCE, file), join(TARGET, file));
}
console.log(`  Copied ${WORKLETS.length} audio worklet(s) into public/audio/`);
