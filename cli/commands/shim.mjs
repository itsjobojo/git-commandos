import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { realGit, SHIM_MARKER } from '../real-git.mjs';

export const description = 'Install/remove the `git` shim so plain `git` runs through the game';
export const usage = 'gcmds shim <install|uninstall|status> [--dir=<path>]';

// The shim only needs a git repo when it eventually runs one; installing it
// does not.
export const requiresRepo = false;

const DEFAULT_DIR = join(homedir(), '.gcmds', 'bin');
const ENTRY = join(fileURLToPath(new URL('..', import.meta.url)), 'index.mjs');

export async function run(args, flags) {
  const dir = flags.dir ? String(flags.dir) : DEFAULT_DIR;
  const action = args.find((a) => !a.startsWith('-')) || 'status';

  if (action === 'install') return install(dir);
  if (action === 'uninstall') return uninstall(dir);
  if (action === 'status') return status(dir);

  console.error(`  Unknown shim action "${action}".`);
  console.error(`  Usage: ${usage}`);
  process.exit(1);
}

function install(dir) {
  // Resolved now, and written into the script: whatever happens to PATH later,
  // the shim always knows which git it is standing in front of.
  const git = realGit();
  const path = join(dir, 'git');

  mkdirSync(dir, { recursive: true });
  writeFileSync(path, script(git), { mode: 0o755 });
  chmodSync(path, 0o755);

  console.log(`\n  Installed ${SHIM_MARKER} at ${path}`);
  console.log(`  It stands in front of ${git}\n`);

  if (onPath(dir)) {
    console.log('  It is already on your PATH. `git commit -m "…"` now opens the game.\n');
  } else {
    console.log('  Add it to your PATH, ahead of everything else:\n');
    console.log(`    export PATH="${dir}:$PATH"\n`);
    console.log('  Put that in ~/.zshrc (or ~/.bashrc), then open a new shell.\n');
  }

  console.log('  Gated: commit, push, merge. Everything else goes straight to git,');
  console.log('  as does any form of those three the game does not understand');
  console.log('  (--amend, --abort, refspecs, pathspecs).\n');
  console.log(`  To skip the game once, call git by its full path:\n    ${git} commit -m "…"\n`);
  console.log('  Remove the shim with: gcmds shim uninstall\n');
}

function uninstall(dir) {
  const path = join(dir, 'git');
  if (!existsSync(path)) {
    console.log(`  No shim at ${path} — nothing to remove.`);
    return;
  }
  // Never delete something that is not ours, however unlikely: this path can
  // be pointed anywhere with --dir, and one of the candidates is a real git.
  if (!readFileSync(path, 'utf-8').includes(SHIM_MARKER)) {
    console.error(`  ${path} is not a Git Commandos shim. Leaving it alone.`);
    process.exit(1);
  }
  rmSync(path);
  console.log(`  Removed ${path}`);
  if (onPath(dir)) console.log(`  You can drop ${dir} from your PATH now.`);
}

function status(dir) {
  const path = join(dir, 'git');
  const installed = existsSync(path) && readFileSync(path, 'utf-8').includes(SHIM_MARKER);

  console.log(`\n  shim:      ${installed ? path : 'not installed'}`);
  console.log(`  on PATH:   ${installed ? (onPath(dir) ? 'yes' : `no — add ${dir} to PATH`) : 'n/a'}`);
  console.log(`  real git:  ${realGit()}`);
  console.log(`  git mode:  ${process.env.GCMDS_GIT_MODE === '1' ? 'active (running as git)' : 'off'}\n`);
  if (!installed) console.log('  Install it with: gcmds shim install\n');
}

function onPath(dir) {
  return (process.env.PATH || '').split(delimiter).includes(dir);
}

/**
 * A shell script rather than a symlink: it carries the marker that stops us
 * resolving ourselves as the real git, and the env that tells the CLI it is
 * wearing git's name.
 */
function script(git) {
  return [
    '#!/bin/sh',
    `# ${SHIM_MARKER} — routes git through Git Commandos.`,
    '# Gated commands open the game; everything else is handed to the real git.',
    '# Remove with: gcmds shim uninstall',
    `GCMDS_GIT_MODE=1 GCMDS_GIT=${quote(git)} exec ${quote(process.execPath)} ${quote(ENTRY)} "$@"`,
    '',
  ].join('\n');
}

/** Single-quote for /bin/sh, so a path with spaces survives. */
function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
