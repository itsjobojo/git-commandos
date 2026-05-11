import { getStagedFiles, getStagedDiffStats, commitFiles, unstageFiles, deleteFiles } from '../git-ops.mjs';
import { launchGame } from '../server.mjs';

export const description = 'Commit staged files — but you must survive to ship them';
export const usage = 'gcmds commit -m "message" [--extreme]';

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

  const difficulty = flags.extreme ? 'extreme' : 'basic';

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
  console.log(`  Difficulty: ${difficulty}`);
  console.log(`  Opening game...`);

  const config = {
    command: 'commit',
    difficulty,
    payload: {
      files,
      commitMessage,
      linesAdded: stats.totalAdded,
    },
  };

  const result = await launchGame(config);
  const { outcome, payload } = result;
  const surviving = payload?.survivingFiles || [];
  const lost = payload?.lostFiles || [];

  console.log('');

  if (outcome === 'abort') {
    console.log('  Aborted. No changes made.');
    process.exit(0);
  }

  if (outcome === 'win') {
    if (lost.length > 0) {
      // Partial win — handle lost files before committing
      if (difficulty === 'extreme') {
        console.log('  💀 Deleting lost files:');
        for (const f of lost) console.log(`    rm ${f}`);
        deleteFiles(lost);
      } else {
        console.log('  📦 Unstaging lost files:');
        for (const f of lost) console.log(`    git reset HEAD -- ${f}`);
        unstageFiles(lost);
      }
    }

    try {
      commitFiles(commitMessage);
      console.log(`  ✅ Committed ${surviving.length} file(s): "${commitMessage}"`);
    } catch (err) {
      console.error(`  ❌ Commit failed: ${err.message}`);
      process.exit(1);
    }
  } else {
    // Loss
    if (difficulty === 'extreme') {
      console.log('  💀 GAME OVER — Deleting all staged files:');
      for (const f of lost) console.log(`    rm ${f}`);
      deleteFiles(lost);
      unstageFiles(lost);
    } else {
      console.log('  💀 GAME OVER — Unstaging all files:');
      for (const f of lost) console.log(`    git reset HEAD -- ${f}`);
      unstageFiles(lost);
    }
    console.log('  No commit made.');
    process.exit(1);
  }
}
