/**
 * Mission rules — the knobs that change what a run can cost you.
 *
 * Each axis has a safe default and CLI overrides. Parsing and validation live
 * here so every command agrees on what a flag means, and so a typo fails loudly
 * before the game opens rather than silently falling back to a default the
 * player did not ask for.
 */

export const RULE_OPTIONS = {
  death: {
    values: ['cargo', 'health', 'fragile'],
    default: 'cargo',
    describe: {
      cargo: 'hits only knock cargo loose — you cannot be killed',
      health: 'separate health pool; running out loses everything',
      fragile: 'hits knock cargo loose, but a hit while empty-handed kills you',
    },
  },
  stash: {
    values: ['run', 'persist', 'off'],
    default: 'run',
    describe: {
      run: 'a safe deposit — stashed cargo ships with the commit if you make it out',
      persist: 'stashed cargo is held out of this commit and stays staged for next run',
      off: 'no stash cache',
    },
  },
};

/**
 * @param {Record<string, string|boolean>} flags parsed CLI flags
 * @returns {{ loss: 'unstage'|'delete', death: string, stash: string }}
 */
export function resolveRules(flags) {
  return {
    loss: flags.extreme ? 'delete' : 'unstage',
    death: pick('death', flags.death),
    stash: pick('stash', flags.stash),
  };
}

function pick(axis, value) {
  const spec = RULE_OPTIONS[axis];
  if (value === undefined || value === true) return spec.default;
  const normalised = String(value).toLowerCase();
  if (!spec.values.includes(normalised)) {
    console.error(
      `  Error: --${axis}=${value} is not valid.\n` +
        `  Valid values: ${spec.values.join(', ')} (default: ${spec.default})`,
    );
    process.exit(1);
  }
  return normalised;
}

/** One line per rule, for the pre-launch summary. */
export function describeRules(rules) {
  const lines = [
    rules.loss === 'delete'
      ? 'loss     files you fail to extract are DELETED from disk'
      : 'loss     files you fail to extract are unstaged',
    `death    ${RULE_OPTIONS.death.describe[rules.death]}`,
    `stash    ${RULE_OPTIONS.stash.describe[rules.stash]}`,
  ];
  return lines.map((l) => `    ${l}`).join('\n');
}
