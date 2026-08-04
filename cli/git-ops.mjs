import { execFileSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import { realGit } from './real-git.mjs';

/**
 * Every git call goes through the resolved real binary, never the name `git`.
 * Under the shim, a bare `git` on PATH is us — calling it here would recurse.
 *
 * Arguments go as an array, so a branch called `--force` or a path with a space
 * is data rather than syntax.
 */
const git = (args, input) =>
  execFileSync(realGit(), args, {
    cwd: process.cwd(),
    encoding: 'utf-8',
    ...(input === undefined ? {} : { input }),
  }).trim();

export function isInsideGitRepo() {
  try {
    git(['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

export function getStagedFiles() {
  const out = git(['diff', '--cached', '--name-only']);
  return out ? out.split('\n') : [];
}

export function getStagedDiffStats() {
  const out = git(['diff', '--cached', '--numstat']);
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
  return git(['branch', '--show-current']) || 'HEAD';
}

export function getRemotes() {
  const out = git(['remote']);
  return out ? out.split('\n') : [];
}

/** Stage tracked files that have changed — what `git commit -a` does first. */
export function stageTrackedChanges() {
  git(['add', '-u']);
}

export function getGitDir() {
  return git(['rev-parse', '--absolute-git-dir']);
}

export function getConfig(key) {
  try {
    return git(['config', '--get', key]) || null;
  } catch {
    return null;
  }
}

/**
 * Hand git a commit message on stdin rather than through `-m`.
 *
 * A message that has grown a multi-line footer cannot go through the shell:
 * `JSON.stringify` turns its newlines into a literal backslash-n, which git
 * dutifully commits as the characters `\n`. `-F -` sidesteps quoting entirely.
 *
 * @param {string} message
 * @param {string[]} extraArgs flags the user passed that we forward verbatim
 */
export function commitFiles(message, extraArgs = []) {
  git(['commit', ...extraArgs, '-F', '-'], message);
}

export function stageFiles(files) {
  for (const f of files) {
    try {
      git(['add', '--', f]);
    } catch {
      // file may have been deleted; nothing to re-stage
    }
  }
}

export function unstageFiles(files) {
  for (const f of files) {
    try {
      git(['reset', 'HEAD', '--', f]);
    } catch {
      // file may already be unstaged
    }
  }
}

/** Drop a path from the index without touching the working tree. */
export function removeFromIndex(path) {
  try {
    git(['rm', '-r', '--cached', '--', path]);
  } catch {
    // never staged in the first place
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
  return git(['branch', '--show-current']) || 'HEAD';
}

export function getUpstream() {
  try {
    return git(['rev-parse', '--abbrev-ref', '@{u}']);
  } catch {
    return null;
  }
}

export function getAheadCommits(upstream) {
  const out = git(['log', `${upstream}..HEAD`, '--format=%s']);
  return out ? out.split('\n').filter(Boolean) : [];
}

export function getAheadDiffStats(upstream) {
  const out = git(['diff', `${upstream}..HEAD`, '--numstat']);
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

export function pushBranch(remote, branch, force = false, extraArgs = []) {
  git(['push', ...extraArgs, ...(force ? ['--force-with-lease'] : []), remote, branch]);
}

export function getMergeDiffStats(branch) {
  const out = git(['diff', `HEAD...${branch}`, '--numstat']);
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
  if (!message) {
    git(['merge', '--no-ff', branch]);
    return;
  }
  git(['merge', '--no-ff', '-F', '-', branch], message);
}

export function abortMerge() {
  try { git(['merge', '--abort']); } catch {}
}

export function hardReset(ref) {
  git(['reset', '--hard', ref]);
}

/** Staged files, in git's own words, for the commit message template. */
export function getStatusForTemplate() {
  try {
    return git(['status', '--branch', '--untracked-files=no']);
  } catch {
    return '';
  }
}
