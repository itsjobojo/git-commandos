import { getCurrentBranch, getMergeDiffStats, mergeBranch, abortMerge, hardReset } from '../git-ops.mjs';
import { launchGame } from '../server.mjs';

export const description = 'Merge a branch — but you must survive for the merge to land';
export const usage = 'gcmds merge <branch> [-m "message"] [--extreme]';

export async function run(args, flags) {
  const branchArg = args.find((a) => !a.startsWith('-'));
  if (!branchArg) {
    console.error('  Error: merge requires a branch name.');
    console.error('  Usage: gcmds merge <branch>');
    process.exit(1);
  }

  const mIdx = args.indexOf('-m');
  const mergeMessage = mIdx !== -1 && mIdx + 1 < args.length ? args[mIdx + 1] : null;

  const currentBranch = getCurrentBranch();
  const stats = getMergeDiffStats(branchArg);
  const files = stats.files.map((f) => f.name);
  const difficulty = flags.extreme ? 'extreme' : 'basic';

  if (files.length === 0) {
    console.log(`  Nothing to merge — ${branchArg} is already up-to-date with ${currentBranch}.`);
    process.exit(0);
  }

  if (difficulty === 'extreme') {
    const { createInterface } = await import('node:readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question(
        `\n  ⚠️  EXTREME MODE: Failure will hard-reset ${currentBranch} to HEAD.\n` +
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

  console.log(`  Merging ${branchArg} → ${currentBranch}:`);
  console.log(`  ${files.length} file(s) changed`);
  if (mergeMessage) console.log(`  Merge message: "${mergeMessage}"`);
  console.log(`  Difficulty: ${difficulty}`);
  console.log(`  Opening game...`);

  const config = {
    command: 'merge',
    difficulty,
    music: !flags.noMusic,
    payload: {
      files,
      commitMessage: mergeMessage || `Merge ${branchArg} → ${currentBranch}`,
      linesAdded: stats.totalAdded,
    },
  };

  const result = await launchGame(config);
  const { outcome, payload } = result;
  const surviving = payload?.survivingFiles || [];
  const lost = payload?.lostFiles || [];

  console.log('');

  if (outcome === 'abort') {
    console.log('  Aborted. Nothing merged.');
    process.exit(0);
  }

  if (outcome === 'win') {
    try {
      mergeBranch(branchArg, mergeMessage);
      if (lost.length > 0) {
        console.log(`  ⚠️  ${lost.length} file(s) lost during combat — merged but with casualties:`);
        for (const f of lost) console.log(`    ✗ ${f}`);
      }
      console.log(`  ✅ Merged ${branchArg} into ${currentBranch}`);
    } catch (err) {
      abortMerge();
      console.error(`  ❌ Merge failed (conflicts?): ${err.message}`);
      console.error('  Run "git merge --abort" if needed.');
      process.exit(1);
    }
  } else {
    if (difficulty === 'extreme') {
      console.log('  💀 GAME OVER — Hard resetting to HEAD');
      hardReset('HEAD');
    } else {
      console.log('  💀 GAME OVER — Merge aborted.');
    }
    process.exit(1);
  }
}
