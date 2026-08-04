/**
 * Everything Git Commandos does not gate is still git's job.
 *
 * The rule that makes this safe to put in front of `git`: if we do not fully
 * understand an invocation, we do not touch it — we hand the exact argv we were
 * given to the real binary and exit with its status.
 */

import { spawnSync } from 'node:child_process';
import { realGit } from './real-git.mjs';

/**
 * Run the real git with these arguments and exit with its status. Does not
 * return.
 * @param {string[]} argv arguments exactly as we received them
 */
export function passThrough(argv) {
  process.exit(runGit(argv));
}

/**
 * Run the real git, inheriting stdio, and return its exit code.
 * @param {string[]} argv
 * @returns {number}
 */
export function runGit(argv) {
  let git;
  try {
    git = realGit();
  } catch (err) {
    console.error(`  ${err.message}`);
    return 1;
  }

  const result = spawnSync(git, argv, {
    stdio: 'inherit',
    // Hooks and subprocesses started by git will find the shim on PATH again.
    // Handing down the resolved binary keeps their `git` calls cheap and keeps
    // them out of the resolution logic entirely.
    env: { ...process.env, GCMDS_GIT: git },
  });

  if (result.error) {
    console.error(`  Failed to run git: ${result.error.message}`);
    return 1;
  }
  // Killed by a signal (Ctrl-C in a pager, say) — report it the way a shell
  // would rather than pretending the command succeeded.
  if (result.signal) return 128 + (SIGNALS[result.signal] ?? 0);
  return result.status ?? 1;
}

const SIGNALS = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15, SIGPIPE: 13 };
