import { basename } from 'node:path';
import { getStagedDiffStats, getBranch, commitFiles, unstageFiles, stageFiles, deleteFiles, stageTrackedChanges } from '../git-ops.mjs';
import { launchGame } from '../server.mjs';
import { resolveRules, describeRules } from '../rules.mjs';
import { stampCommitMessage } from '../commit-trailer.mjs';
import { readMessageFromEditor } from '../commit-message.mjs';

export const description = 'Commit staged files — but you must survive to ship them';
export const usage =
  'gcmds commit [-m "message"] [-a] [--extreme] [--death=…] [--stash=…] [--no-trailer]';

/**
 * Forms of `git commit` that rewrite history, take their message from
 * somewhere we do not read, or commit a subset of the index. The game has
 * nothing sensible to say about any of them, and guessing would cost someone a
 * commit — so they go straight to real git.
 */
const NOT_OURS = [
  '--amend', '--fixup', '--squash', '-C', '--reuse-message', '-c', '--reedit-message',
  '-F', '--file', '--interactive', '-p', '--patch', '--dry-run', '--short', '--porcelain',
  '--long', '-z', '--null', '--template', '-t',
];

/**
 * @param {string[]} args
 * @returns {boolean} true if this is a plain "commit what is staged" we can gate
 */
export function supports(args) {
  for (const arg of args) {
    const name = arg.startsWith('--') && arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
    if (NOT_OURS.includes(name)) return false;
    // A pathspec commits a subset of the working tree; the cargo hold is the
    // whole index or nothing.
    if (arg === '--') return false;
  }
  // Bare positionals are pathspecs too (`git commit file.ts`).
  return !args.some((a, i) => !a.startsWith('-') && !isFlagValue(args, i));
}

/** Is args[i] the value of a preceding flag that takes one? */
function isFlagValue(args, i) {
  return i > 0 && (args[i - 1] === '-m' || args[i - 1] === '--message');
}

/**
 * Pull the message out of the git-shaped arguments, and hand back everything
 * else so it can be forwarded to the real commit untouched.
 * @returns {{ message: string|null, all: boolean, forward: string[] }}
 */
export function parseCommitArgs(args) {
  let message = null;
  let all = false;
  const forward = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-m' || arg === '--message') {
      message = args[++i] ?? null;
    } else if (arg.startsWith('--message=')) {
      message = arg.slice('--message='.length);
    } else if (arg === '-a' || arg === '--all') {
      all = true;
    } else {
      forward.push(arg);
    }
  }
  return { message, all, forward };
}

export async function run(args, flags) {
  const { message: messageArg, all, forward } = parseCommitArgs(args);

  // `-a` stages tracked changes first, exactly as git would, so what the game
  // shows you as cargo is what would have been committed.
  if (all) stageTrackedChanges();

  const stats = getStagedDiffStats();
  const files = stats.files.map((f) => f.name);
  if (files.length === 0) {
    console.error('  No staged files. Stage some files first (git add).');
    process.exit(1);
  }

  // No -m: get the message the way git does, before anything is at stake.
  const commitMessage = messageArg ?? readMessageFromEditor({ files });
  if (commitMessage === null) {
    console.error('  Aborting commit due to empty commit message.');
    process.exit(1);
  }

  const rules = resolveRules(flags);
  const difficulty = rules.loss === 'delete' ? 'extreme' : 'basic';

  // Extreme mode confirmation
  if (difficulty === 'extreme') {
    const { createInterface } = await import('node:readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question(
        `\n  ⚠️  EXTREME MODE: Lost files will be DELETED from disk.\n` +
        `  ${files.length} file(s) at risk:\n` +
        files.map((f) => `    - ${f}`).join('\n') + '\n' +
        `  Type "yes" to continue: `,
        resolve
      );
    });
    rl.close();
    if (answer.trim().toLowerCase() !== 'yes') {
      console.log('  Aborted.');
      process.exit(0);
    }
  }

  console.log(`  Staged files (${files.length}):`);
  for (const f of files) console.log(`    ${f}`);
  console.log(`  Commit message: "${commitMessage}"`);
  console.log(`  Rules:`);
  console.log(describeRules(rules));
  console.log(`  Opening game...`);

  const config = {
    command: 'commit',
    difficulty,
    music: !flags.noMusic,
    rules,
    payload: {
      // Per-file diff stats size each crate in-game and decide how far from
      // extraction it spawns. The game also accepts a plain string[], so an
      // older build still works against this CLI.
      files: stats.files.map((f) => ({ name: f.name, added: f.added, removed: f.removed })),
      commitMessage,
      linesAdded: stats.totalAdded,
      branch: getBranch(),
      repo: basename(process.cwd()),
    },
  };

  const result = await launchGame(config);
  const { outcome, payload } = result;
  const surviving = payload?.survivingFiles || [];
  const lost = payload?.lostFiles || [];
  // Files left in the stash cache under --stash=persist. They are neither
  // committed nor unstaged — they stay staged for the next run.
  const stashed = payload?.stashedFiles || [];
  // Absent when the browser is running a build older than the stats field. The
  // trailer copes; nothing else may depend on it. Named apart from `stats`
  // above, which is the staged *diff* — two very different things.
  const runStats = payload?.stats || null;

  console.log('');

  if (outcome === 'abort') {
    console.log('  Aborted. No changes made.');
    process.exit(0);
  }

  if (lost.length > 0) {
    if (rules.loss === 'delete') {
      console.log('  💀 Deleting lost files:');
      for (const f of lost) console.log(`    rm ${f}`);
      deleteFiles(lost);
      unstageFiles(lost);
    } else {
      console.log('  📦 Unstaging lost files:');
      for (const f of lost) console.log(`    git reset HEAD -- ${f}`);
      unstageFiles(lost);
    }
  }

  if (outcome === 'win') {
    // Stashed files must not ride along in the commit, but must still be
    // staged afterwards — so drop them from the index, commit, and re-add.
    if (stashed.length > 0) {
      console.log('  🗄  Holding stashed files back from this commit:');
      for (const f of stashed) console.log(`    ${f}`);
      unstageFiles(stashed);
    }

    if (surviving.length === 0) {
      console.log('  Nothing reached the extraction point. No commit made.');
      if (stashed.length > 0) stageFiles(stashed);
      process.exit(1);
    }

    // What actually gets committed. `--no-trailer` leaves the message exactly
    // as typed — rewriting someone's commit message should always be refusable.
    const finalMessage = flags.noTrailer
      ? commitMessage
      : stampCommitMessage(commitMessage, { surviving, lost, stashed, rules, stats: runStats });

    try {
      commitFiles(finalMessage, forward);
      console.log(`  ✅ Committed ${surviving.length} file(s): "${commitMessage.split('\n')[0]}"`);
      if (finalMessage !== commitMessage) {
        console.log('');
        for (const line of finalMessage.slice(commitMessage.length).trim().split('\n')) {
          console.log(`    ${line}`);
        }
      }
    } catch (err) {
      console.error(`  ❌ Commit failed: ${err.message}`);
      if (stashed.length > 0) stageFiles(stashed);
      process.exit(1);
    }

    if (stashed.length > 0) {
      stageFiles(stashed);
      console.log(`  🗄  ${stashed.length} file(s) left staged in the stash for next run.`);
    }
  } else {
    console.log('  💀 GAME OVER — No commit made.');
    if (stashed.length > 0) {
      console.log(`  🗄  ${stashed.length} stashed file(s) survived and are still staged:`);
      for (const f of stashed) console.log(`    ${f}`);
    }
    process.exit(1);
  }
}
