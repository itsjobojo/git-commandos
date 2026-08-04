import { describe, expect, it } from 'vitest';
import { classify, parseFlags, positionals } from './dispatch.mjs';
import { supports as commitSupports, parseCommitArgs } from './commands/commit.mjs';
import { supports as mergeSupports, parseMergeArgs } from './commands/merge.mjs';
import { supports as pushSupports } from './commands/push.mjs';

/**
 * Standing in front of `git` means every wrong answer here costs someone a
 * command they typed correctly. The failure that matters is the permissive
 * one — claiming an invocation we then only half-perform.
 */

const COMMANDS = ['commit', 'push', 'merge', 'play', 'quick-run', 'fake-files', 'shim'];
const asGcmds = (argv) => classify(argv, { commands: COMMANDS, gitMode: false });
const asGit = (argv) => classify(argv, { commands: COMMANDS, gitMode: true });

describe('classify', () => {
  it('claims its own commands', () => {
    expect(asGit(['commit', '-m', 'x'])).toEqual({ kind: 'run', command: 'commit', args: ['-m', 'x'] });
  });

  it('hands every other git command straight back', () => {
    for (const cmd of ['status', 'rebase', 'log', 'add', 'checkout', 'stash', 'help']) {
      expect(asGit([cmd]).kind).toBe('passthrough');
    }
  });

  it('does not try to parse git global options', () => {
    // `-C dir` means the subcommand is not argv[0]; rather than track that, we
    // decline the whole invocation.
    expect(asGit(['-C', '/tmp/repo', 'commit', '-m', 'x']).kind).toBe('passthrough');
    expect(asGit(['--git-dir=/tmp/.git', 'commit']).kind).toBe('passthrough');
    expect(asGit(['--version']).kind).toBe('passthrough');
    expect(asGit([]).kind).toBe('passthrough');
  });

  it('keeps its own help and version when invoked as gcmds', () => {
    expect(asGcmds([]).kind).toBe('help');
    expect(asGcmds(['--help']).kind).toBe('help');
    expect(asGcmds(['--version']).kind).toBe('version');
    expect(asGcmds(['status']).kind).toBe('passthrough');
  });
});

describe('parseFlags', () => {
  const owned = ['extreme', 'no-music', 'death'];

  it('takes only the flags it owns and leaves the rest for git', () => {
    const { flags, args } = parseFlags(['-m', 'msg', '--extreme', '--no-verify', '--death=fragile'], owned);
    expect(flags).toEqual({ extreme: true, death: 'fragile' });
    expect(args).toEqual(['-m', 'msg', '--no-verify']);
  });

  it('camelCases keys', () => {
    expect(parseFlags(['--no-music'], owned).flags).toEqual({ noMusic: true });
  });
});

describe('positionals', () => {
  it('ignores flags and anything past a pathspec separator', () => {
    expect(positionals(['origin', 'main', '--force'])).toEqual(['origin', 'main']);
    expect(positionals(['--', 'src/a.ts'])).toEqual([]);
  });
});

describe('commit', () => {
  it('gates a plain commit', () => {
    expect(commitSupports(['-m', 'hello'])).toBe(true);
    expect(commitSupports(['-a', '-m', 'hello'])).toBe(true);
    expect(commitSupports([])).toBe(true);
    expect(commitSupports(['-m', 'hello', '--no-verify'])).toBe(true);
  });

  it('declines anything that is not "commit what is staged"', () => {
    expect(commitSupports(['--amend'])).toBe(false);
    expect(commitSupports(['--amend', '--no-edit'])).toBe(false);
    expect(commitSupports(['-m', 'x', '--', 'src/a.ts'])).toBe(false);
    expect(commitSupports(['src/a.ts'])).toBe(false);
    expect(commitSupports(['-F', 'msg.txt'])).toBe(false);
    expect(commitSupports(['--fixup=HEAD~1'])).toBe(false);
    expect(commitSupports(['-p'])).toBe(false);
  });

  it('does not mistake a message for a pathspec', () => {
    expect(commitSupports(['-m', 'src/a.ts'])).toBe(true);
    expect(parseCommitArgs(['-m', 'hello there'])).toEqual({
      message: 'hello there', all: false, forward: [],
    });
  });

  it('separates the message from flags git should still see', () => {
    expect(parseCommitArgs(['--message=hi', '-a', '--no-verify', '--signoff'])).toEqual({
      message: 'hi', all: true, forward: ['--no-verify', '--signoff'],
    });
  });
});

describe('merge', () => {
  it('gates a single-branch merge only', () => {
    expect(mergeSupports(['feature'])).toBe(true);
    expect(mergeSupports(['feature', '-m', 'merged'])).toBe(true);
    expect(mergeSupports(['--abort'])).toBe(false);
    expect(mergeSupports(['--continue'])).toBe(false);
    expect(mergeSupports(['a', 'b'])).toBe(false);
    expect(mergeSupports([])).toBe(false);
  });

  it('does not read the merge message as a second branch', () => {
    expect(parseMergeArgs(['-m', 'merge it', 'feature'])).toEqual({
      message: 'merge it', branches: ['feature'],
    });
  });
});

describe('push', () => {
  it('gates a plain branch push', () => {
    expect(pushSupports([])).toBe(true);
    expect(pushSupports(['origin', 'main'])).toBe(true);
    expect(pushSupports(['origin', 'main', '--force'])).toBe(true);
    expect(pushSupports(['-u', 'origin', 'main'])).toBe(true);
  });

  it('declines refspecs and deletions', () => {
    expect(pushSupports(['origin', ':old-branch'])).toBe(false);
    expect(pushSupports(['origin', '--delete', 'old'])).toBe(false);
    expect(pushSupports(['--mirror'])).toBe(false);
    expect(pushSupports(['origin', 'a', 'b'])).toBe(false);
  });
});
