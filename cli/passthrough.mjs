/**
 * Everything Git Commandos does not gate is still git's job.
 *
 * This is what makes `gcmds` usable anywhere you would type `git`: an argv we
 * do not fully understand is handed to git exactly as typed, with its output
 * and exit code passed straight back. `gcmds` never installs itself as `git`
 * or stands in front of it — you opt in one command at a time, by typing
 * `gcmds`.
 */

import { spawnSync } from 'node:child_process';

/**
 * Run git with these arguments and exit with its status. Does not return.
 * @param {string[]} argv arguments exactly as we received them
 */
export function passThrough(argv) {
  process.exit(runGit(argv));
}

/**
 * Run git, inheriting stdio, and return its exit code.
 * @param {string[]} argv
 * @returns {number}
 */
export function runGit(argv) {
  const result = spawnSync('git', argv, { stdio: 'inherit' });

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
