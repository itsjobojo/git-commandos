/**
 * Getting a commit message the way git gets one.
 *
 * As a drop-in, `git commit` with no `-m` has to keep working, and it has to
 * feel like git: the user's editor, a template they can read, comment lines
 * stripped, an empty message aborting the whole thing. Anything less and the
 * shim quietly costs people the habit they came with.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { realGit } from './real-git.mjs';
import { getConfig, getGitDir, getStatusForTemplate } from './git-ops.mjs';

/**
 * Remove comment lines and trailing blank lines, the way git does before it
 * decides whether a message is empty.
 * @param {string} raw
 * @param {string} commentChar
 * @returns {string}
 */
export function stripComments(raw, commentChar = '#') {
  return raw
    .split('\n')
    .filter((line) => !line.startsWith(commentChar))
    .join('\n')
    .replace(/^\s*\n+/, '')
    .replace(/\s+$/, '');
}

/**
 * The text we drop the user into. Mirrors git's own template, plus one line
 * making it clear this commit has to be earned.
 * @param {{ files: string[], commentChar: string }} ctx
 */
export function buildTemplate({ files, commentChar, status = '' }) {
  const c = commentChar;
  const lines = [
    '',
    `${c} Please enter the commit message for your changes. Lines starting`,
    `${c} with '${c}' will be ignored, and an empty message aborts the commit.`,
    `${c}`,
    `${c} Git Commandos: these ${files.length} file(s) are your cargo. You have to`,
    `${c} carry them to the extraction pad before any of this gets committed.`,
    `${c}`,
  ];
  for (const line of status.split('\n')) lines.push(line ? `${c} ${line}` : `${c}`);
  return lines.join('\n') + '\n';
}

/**
 * Open the user's editor on a commit message template and return what they
 * wrote, or `null` if they left it empty (an abort, not an error).
 * @param {{ files: string[] }} ctx
 * @returns {string|null}
 */
export function readMessageFromEditor({ files }) {
  const configured = getConfig('core.commentChar');
  // `auto` tells git to pick a character no line starts with. Matching that is
  // more cleverness than this is worth — '#' is what it picks in practice.
  const commentChar = !configured || configured === 'auto' ? '#' : configured[0];

  const path = join(getGitDir(), 'COMMIT_EDITMSG');
  writeFileSync(path, buildTemplate({ files, commentChar, status: getStatusForTemplate() }));

  // `git var GIT_EDITOR` resolves the whole precedence chain for us:
  // GIT_EDITOR, core.editor, VISUAL, EDITOR, then the build-time default.
  const editor = execFileSync(realGit(), ['var', 'GIT_EDITOR'], { encoding: 'utf-8' }).trim();
  // The editor setting is a command line, not a program name (`code --wait`),
  // so it goes through a shell — same as git.
  const result = spawnSync(`${editor} "${path}"`, { shell: true, stdio: 'inherit' });
  if (result.error) throw new Error(`could not launch editor (${editor}): ${result.error.message}`);
  if (result.status !== 0) throw new Error(`editor exited with status ${result.status}`);

  const message = stripComments(readFileSync(path, 'utf-8'), commentChar);
  return message === '' ? null : message;
}
