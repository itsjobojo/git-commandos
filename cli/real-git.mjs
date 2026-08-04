/**
 * Finding the real git — the one piece of plumbing that must never be wrong.
 *
 * Once `gcmds shim install` puts a `git` in front of the real one on PATH,
 * every `git` we run ourselves is a chance to call the shim instead and recurse
 * until the machine gives up. So nothing in this tool may ever spawn a bare
 * `git`: it asks here for an absolute path, and this file goes out of its way
 * to refuse to hand back anything that could be us.
 */

import { accessSync, closeSync, constants, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { delimiter, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every shim we write carries this marker so we can recognise our own work. */
export const SHIM_MARKER = 'gcmds-shim';

const OWN_DIR = safeRealpath(fileURLToPath(new URL('.', import.meta.url)));

/** Where git usually lives when PATH has been stripped (launchd, cron, hooks). */
const FALLBACKS = [
  '/usr/bin/git',
  '/opt/homebrew/bin/git',
  '/usr/local/bin/git',
  '/usr/local/git/bin/git',
  'C:\\Program Files\\Git\\cmd\\git.exe',
];

let cached = null;

/**
 * Absolute path to the real git binary.
 * @throws if the only git on this machine is one of ours.
 */
export function realGit() {
  if (!cached) cached = resolve();
  return cached;
}

function resolve() {
  // The shim bakes in the git it shadowed, so a shimmed session never has to
  // guess — and stays correct even if PATH is reordered afterwards.
  const override = process.env.GCMDS_GIT;
  if (override && isExecutable(override)) return override;

  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const name of candidateNames()) {
      const candidate = join(dir, name);
      if (!isExecutable(candidate)) continue;
      if (isOurs(candidate)) continue;
      return candidate;
    }
  }

  for (const fallback of FALLBACKS) {
    if (isExecutable(fallback) && !isOurs(fallback)) return fallback;
  }

  throw new Error(
    'Could not find a real git on PATH.\n' +
      '  Git Commandos needs the actual git binary to do anything.\n' +
      '  Point it at one with GCMDS_GIT=/path/to/git, or install git.',
  );
}

function candidateNames() {
  return process.platform === 'win32' ? ['git.exe', 'git.cmd', 'git.bat', 'git'] : ['git'];
}

function isExecutable(path) {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Is this candidate us wearing a git costume? Two ways it can be: an npm bin
 * symlink pointing back into this package, or a shim script we wrote.
 * Anything we cannot read, we assume is ours — recursing is far worse than
 * skipping a git we could have used.
 */
function isOurs(path) {
  try {
    const real = safeRealpath(path);
    if (real === OWN_DIR || real.startsWith(OWN_DIR + sep)) return true;
    return head(path).includes(SHIM_MARKER);
  } catch {
    return true;
  }
}

/** First 1KB of a file, without pulling a multi-megabyte binary into memory. */
function head(path) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(1024);
    const read = readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, read).toString('latin1');
  } finally {
    closeSync(fd);
  }
}

function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
