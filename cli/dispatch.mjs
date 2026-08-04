/**
 * Which invocations are ours, and which are git's.
 *
 * This is the whole contract of the drop-in: an argv we do not recognise, in
 * full, belongs to git. Getting that wrong in the permissive direction means
 * swallowing someone's `git rebase --continue`, so the default here is always
 * "hand it back".
 */

/** Commands that open the game and then touch real git state. */
export const GATED_COMMANDS = ['commit', 'push', 'merge'];

/**
 * @typedef {{ kind: 'help' }
 *   | { kind: 'version' }
 *   | { kind: 'passthrough' }
 *   | { kind: 'run', command: string, args: string[] }} Dispatch
 */

/**
 * @param {string[]} argv arguments after the executable name
 * @param {{ commands: string[], gitMode: boolean }} opts
 *   `gitMode` is true when we were invoked through the `git` shim, where even
 *   bare `git` and `git --help` belong to git.
 * @returns {Dispatch}
 */
export function classify(argv, { commands, gitMode }) {
  const [first, ...rest] = argv;

  if (first === undefined) return gitMode ? { kind: 'passthrough' } : { kind: 'help' };

  if (commands.includes(first)) return { kind: 'run', command: first, args: rest };

  // Anything else starting with `-` is a git global option (`-C`, `-c`,
  // `--git-dir=`, `--no-pager`, …). We deliberately do not try to parse them:
  // `gcmds -C some/repo commit` is git's, not ours.
  if (first.startsWith('-')) {
    if (gitMode) return { kind: 'passthrough' };
    if (first === '--help' || first === '-h') return { kind: 'help' };
    if (first === '--version' || first === '-v') return { kind: 'version' };
    return { kind: 'passthrough' };
  }

  return { kind: 'passthrough' };
}

/**
 * Split raw argv into gcmds flags and everything else.
 *
 * Only flags this tool actually owns are consumed; the rest stay in `args` so a
 * command can forward them to git untouched (`--no-verify`, `--signoff`, …).
 * `--flag=value` and bare `--flag` both work, and the key is camelCased so
 * `--no-music` reads as `flags.noMusic`.
 *
 * @param {string[]} argv
 * @param {string[]} owned kebab-case flag names this command consumes
 * @returns {{ flags: Record<string, string|boolean>, args: string[] }}
 */
export function parseFlags(argv, owned) {
  const flags = {};
  const args = [];
  for (const arg of argv) {
    if (!arg.startsWith('--') || arg === '--') {
      args.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const rawKey = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!owned.includes(rawKey)) {
      args.push(arg);
      continue;
    }
    const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    flags[key] = eq === -1 ? true : arg.slice(eq + 1);
  }
  return { flags, args };
}

/** Positional arguments — no flags, and nothing after a `--` separator. */
export function positionals(args) {
  const end = args.indexOf('--');
  const scope = end === -1 ? args : args.slice(0, end);
  return scope.filter((a) => !a.startsWith('-'));
}
