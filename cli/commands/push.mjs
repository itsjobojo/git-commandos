import { getCurrentBranch, getUpstream, getAheadCommits, getAheadDiffStats, pushBranch, hardReset } from '../git-ops.mjs';
import { launchGame } from '../server.mjs';
import { positionals } from '../dispatch.mjs';

export const description = 'Push commits to remote — but you must survive to ship them';
export const usage = 'gcmds push [remote] [branch] [--force] [--extreme]';

/** Pushes that are not "send this branch as it stands" belong to git. */
const NOT_OURS = ['--delete', '-d', '--mirror', '--prune', '--all', '--atomic', '--recurse-submodules'];

const FORCE = ['--force', '-f', '--force-with-lease'];

/** @param {string[]} args */
export function supports(args) {
  const rest = positionals(args);
  // `refs/heads/x:refs/heads/y` is a refspec, not a branch name.
  if (rest.length > 2 || rest.some((a) => a.includes(':'))) return false;
  return !args.some((a) => NOT_OURS.includes(a.split('=')[0]) || a === '--');
}

export async function run(args, flags) {
  const branch = getCurrentBranch();
  const upstream = getUpstream();
  const rest = positionals(args);
  const forward = args.filter((a) => a.startsWith('-') && !FORCE.includes(a));

  const remote = rest[0] || (upstream ? upstream.split('/')[0] : 'origin');
  const targetBranch = rest[1] || branch;

  const upstreamRef = upstream || `${remote}/${targetBranch}`;
  const commits = getAheadCommits(upstreamRef);

  if (commits.length === 0) {
    console.log(`  Nothing to push — already up-to-date with ${upstreamRef}.`);
    process.exit(0);
  }

  const stats = getAheadDiffStats(upstreamRef);
  const files = stats.files.map((f) => f.name);
  const difficulty = flags.extreme ? 'extreme' : 'basic';
  const forceFlag = args.some((a) => FORCE.includes(a));

  if (forceFlag) {
    const { createInterface } = await import('node:readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question(
        `\n  ⚠️  FORCE PUSH to ${remote}/${targetBranch}.\n` +
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

  if (difficulty === 'extreme') {
    const { createInterface } = await import('node:readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question(
        `\n  ⚠️  EXTREME MODE: Failure will reset your branch to ${upstreamRef}.\n` +
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

  console.log(`  Pushing ${commits.length} commit(s) to ${remote}/${targetBranch}:`);
  for (const c of commits) console.log(`    ${c}`);
  console.log(`  ${files.length} file(s) changed`);
  console.log(`  Difficulty: ${difficulty}`);
  console.log(`  Opening game...`);

  const config = {
    command: 'push',
    difficulty,
    payload: {
      files: files.length > 0 ? files : commits.map((_, i) => `commit-${i + 1}`),
      commitMessage: `push → ${remote}/${targetBranch} (${commits.length} commit${commits.length !== 1 ? 's' : ''})`,
      linesAdded: stats.totalAdded,
    },
  };

  const result = await launchGame(config);
  const { outcome } = result;

  console.log('');

  if (outcome === 'abort') {
    console.log('  Aborted. Nothing pushed.');
    process.exit(0);
  }

  if (outcome === 'win') {
    try {
      pushBranch(remote, targetBranch, forceFlag, forward);
      console.log(`  ✅ Pushed ${commits.length} commit(s) to ${remote}/${targetBranch}`);
    } catch (err) {
      console.error(`  ❌ Push failed: ${err.message}`);
      process.exit(1);
    }
  } else {
    if (difficulty === 'extreme') {
      console.log(`  💀 GAME OVER — Resetting branch to ${upstreamRef}`);
      try {
        hardReset(upstreamRef);
        console.log(`  Branch reset to ${upstreamRef}`);
      } catch (err) {
        console.error(`  ❌ Reset failed: ${err.message}`);
      }
    } else {
      console.log('  💀 GAME OVER — Push aborted. Your commits are safe.');
    }
    process.exit(1);
  }
}
