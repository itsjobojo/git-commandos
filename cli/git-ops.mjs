import { execSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';

const run = (cmd) =>
  execSync(cmd, { cwd: process.cwd(), encoding: 'utf-8' }).trim();

export function isInsideGitRepo() {
  try {
    run('git rev-parse --is-inside-work-tree');
    return true;
  } catch {
    return false;
  }
}

export function getStagedFiles() {
  const out = run('git diff --cached --name-only');
  return out ? out.split('\n') : [];
}

export function getStagedDiffStats() {
  const out = run('git diff --cached --numstat');
  if (!out) return { files: [], totalAdded: 0, totalRemoved: 0 };
  const files = [];
  let totalAdded = 0;
  let totalRemoved = 0;
  for (const line of out.split('\n')) {
    const [a, r, name] = line.split('\t');
    const added = a === '-' ? 0 : parseInt(a, 10);
    const removed = r === '-' ? 0 : parseInt(r, 10);
    files.push({ name, added, removed });
    totalAdded += added;
    totalRemoved += removed;
  }
  return { files, totalAdded, totalRemoved };
}

export function getBranch() {
  return run('git branch --show-current') || 'HEAD';
}

export function getRemotes() {
  const out = run('git remote');
  return out ? out.split('\n') : [];
}

export function commitFiles(message) {
  run(`git commit -m ${JSON.stringify(message)}`);
}

export function unstageFiles(files) {
  for (const f of files) {
    try {
      run(`git reset HEAD -- ${JSON.stringify(f)}`);
    } catch {
      // file may already be unstaged
    }
  }
}

export function deleteFiles(files) {
  for (const f of files) {
    try {
      unlinkSync(f);
    } catch {
      // file may not exist on disk
    }
  }
}

export function getCurrentBranch() {
  return run('git branch --show-current') || 'HEAD';
}

export function getUpstream() {
  try {
    return run('git rev-parse --abbrev-ref @{u}');
  } catch {
    return null;
  }
}

export function getAheadCommits(upstream) {
  const out = run(`git log ${upstream}..HEAD --format=%s`);
  return out ? out.split('\n').filter(Boolean) : [];
}

export function getAheadDiffStats(upstream) {
  const out = run(`git diff ${upstream}..HEAD --numstat`);
  if (!out) return { files: [], totalAdded: 0 };
  const files = [];
  let totalAdded = 0;
  for (const line of out.split('\n')) {
    const [a, , name] = line.split('\t');
    const added = a === '-' ? 0 : parseInt(a, 10);
    files.push({ name, added });
    totalAdded += added;
  }
  return { files, totalAdded };
}

export function pushBranch(remote, branch, force = false) {
  const forceFlag = force ? ' --force-with-lease' : '';
  run(`git push ${remote} ${branch}${forceFlag}`);
}

export function getMergeDiffStats(branch) {
  const out = run(`git diff HEAD...${branch} --numstat`);
  if (!out) return { files: [], totalAdded: 0 };
  const files = [];
  let totalAdded = 0;
  for (const line of out.split('\n')) {
    const [a, , name] = line.split('\t');
    const added = a === '-' ? 0 : parseInt(a, 10);
    files.push({ name, added });
    totalAdded += added;
  }
  return { files, totalAdded };
}

export function mergeBranch(branch, message) {
  const msgFlag = message ? ` -m ${JSON.stringify(message)}` : '';
  run(`git merge --no-ff ${branch}${msgFlag}`);
}

export function abortMerge() {
  try { run('git merge --abort'); } catch {}
}

export function hardReset(ref) {
  run(`git reset --hard ${ref}`);
}
