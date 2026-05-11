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
