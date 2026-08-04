/**
 * The footer stamped onto a commit that was fought for.
 *
 * A commit made through Git Commandos cost something — a route across a city,
 * a number of hits, some files that did not make it. None of that survives in
 * `git log` unless it is written down, so this writes it down.
 *
 * Two rules, because this touches the user's commit message:
 *
 * 1. It only ever *appends*. The message the user typed comes out byte for
 *    byte at the top, and nothing here can fail in a way that loses it.
 * 2. Stats are optional. A game build older than the `stats` field sends none,
 *    and the footer degrades to the headline rather than printing zeroes —
 *    "0 hostiles down" is a lie about the run, not a missing field.
 *
 * Pure and side-effect free on purpose: it is the one part of the commit path
 * worth asserting on, and asserting on a string is cheap.
 */

const MARK = 'Committed with Git Commandos';

/** `92` → `1m 32s`. Seconds alone stop reading as a duration past a minute. */
function duration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Wrap prose to git's conventional 72 columns.
 *
 * Only the commendation goes through this. The stat lines are deliberately
 * left long: they are columns, and rewrapping a column turns it into rubble.
 */
function wrap(text, width = 72) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const LOSS_RULE = { unstage: 'lost files unstaged', delete: 'lost files deleted' };
const DEATH_RULE = {
  cargo: 'cargo only',
  health: 'health pool',
  fragile: 'fragile — a hit empty-handed ends it',
};
const STASH_RULE = {
  run: 'stash holds for the run',
  persist: 'stash persists between runs',
  off: 'no stash',
};

/**
 * The commendation. Earned from the run rather than picked at random, so it
 * means something — a spotless extraction and a one-HP crawl must not read the
 * same, or the praise is noise and the next one gets skipped.
 *
 * Ordered most specific first; the first true clause wins.
 */
function commendation(stats, lost, rules) {
  const brave =
    rules?.loss === 'delete'
      ? 'You did it in extreme mode, where the files that fall stay fallen.'
      : 'Braver than `git commit`, which has never once asked anyone to dodge.';

  if (!stats) return brave;

  if (lost.length > 0) {
    return `You lost ${plural(lost.length, 'file', 'files')} getting here and shipped the rest anyway. ${brave}`;
  }
  if (stats.hitsTaken === 0) {
    return `Not a scratch on you, and nothing left behind. ${brave}`;
  }
  if (rules?.death === 'health' && stats.hpRemaining === 1) {
    return `One hit point left. That was closer than it needed to be. ${brave}`;
  }
  if (stats.recovered > 0) {
    return `You went back for ${plural(stats.recovered, 'crate', 'crates')} that had already been knocked loose. ${brave}`;
  }
  return `Every file on your back, all the way to the pad. ${brave}`;
}

/**
 * Build the footer. Returns `''` when there is nothing worth saying, so the
 * caller can append unconditionally.
 *
 * @param {object} run
 * @param {string[]} run.surviving  files this commit ships
 * @param {string[]} run.lost       files that did not make it
 * @param {string[]} [run.stashed]  held back, still staged for next time
 * @param {object}   [run.rules]    the mission rules in force
 * @param {object}   [run.stats]    run tally; absent on an older game build
 */
export function buildTrailer(run) {
  const surviving = run.surviving ?? [];
  const lost = run.lost ?? [];
  const stashed = run.stashed ?? [];
  const { stats, rules } = run;

  const lines = [
    ...wrap(
      `${MARK} 🎖 — ${plural(surviving.length, 'file', 'files')} carried to the ` +
        'extraction pad under fire.',
    ),
    '',
  ];

  if (stats) {
    const run_ = [
      duration(stats.seconds),
      `${plural(stats.kills, 'hostile', 'hostiles')} down`,
      `${plural(stats.hitsTaken, 'hit', 'hits')} taken`,
    ];
    if (rules?.death === 'health') run_.push(`${stats.hpRemaining}/${stats.hpMax} HP`);
    if (stats.recovered > 0) run_.push(`${plural(stats.recovered, 'crate', 'crates')} recovered`);
    lines.push(`Run    ${run_.join(' · ')}`);
  }

  const cargo = [`${surviving.length} extracted`, `${lost.length} lost`];
  if (stashed.length > 0) cargo.push(`${stashed.length} stashed`);
  lines.push(`Cargo  ${cargo.join(' · ')}`);

  if (rules) {
    lines.push(
      `Rules  ${[LOSS_RULE[rules.loss], DEATH_RULE[rules.death], STASH_RULE[rules.stash]]
        .filter(Boolean)
        .join(' · ')}`,
    );
  }

  lines.push('', ...wrap(commendation(stats, lost, rules)));
  return lines.join('\n');
}

/**
 * Append the footer to what the user typed.
 *
 * Idempotent: a message that already carries the mark comes back untouched, so
 * an amend or a retried run can never stack two footers.
 */
export function stampCommitMessage(message, run) {
  if (message.includes(MARK)) return message;
  const trailer = buildTrailer(run);
  if (!trailer) return message;
  return `${message.replace(/\s+$/, '')}\n\n${trailer}\n`;
}
