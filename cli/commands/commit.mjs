import { basename } from 'node:path';
import { getStagedDiffStats, getBranch, commitFiles, unstageFiles, stageFiles, deleteFiles } from '../git-ops.mjs';
import { launchGame } from '../server.mjs';
import { resolveRules, describeRules } from '../rules.mjs';

export const description = 'Commit staged files — but you must survive to ship them';
export const usage = 'gcmds commit -m "message" [--extreme] [--death=…] [--stash=…]';

export async function run(args, flags) {
  // Parse commit message from -m flag
  const mIdx = args.indexOf('-m');
  if (mIdx === -1 || mIdx + 1 >= args.length) {
    console.error('  Error: commit requires -m "message"');
    process.exit(1);
  }
  const commitMessage = args[mIdx + 1];

  const stats = getStagedDiffStats();
  const files = stats.files.map((f) => f.name);
  if (files.length === 0) {
    console.error('  No staged files. Stage some files first (git add).');
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

    try {
      commitFiles(commitMessage);
      console.log(`  ✅ Committed ${surviving.length} file(s): "${commitMessage}"`);
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
