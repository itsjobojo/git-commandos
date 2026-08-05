#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInsideGitRepo } from './git-ops.mjs';
import { RULE_OPTIONS } from './rules.mjs';
import { classify, parseFlags } from './dispatch.mjs';
import { passThrough } from './passthrough.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const COMMANDS_DIR = join(__dirname, 'commands');

/**
 * Flags this tool consumes. Everything else on the command line is left in
 * place so a gated command can forward it to git (`--no-verify`, `--signoff`).
 */
const GCMDS_FLAGS = [
  'extreme', 'no-music', 'no-trailer', 'help',
  ...Object.keys(RULE_OPTIONS),
  'count', 'duration', 'clean', 'dir',
];

const argv = process.argv.slice(2);

function commandNames() {
  return readdirSync(COMMANDS_DIR)
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('_') && !f.endsWith('.test.mjs'))
    .map((f) => f.replace('.mjs', ''));
}

function version() {
  try {
    return JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')).version;
  } catch {
    return 'unknown';
  }
}

async function listCommands() {
  console.log('\n  Git Commandos — a game interface of your git commands.\n');
  console.log('  Usage: gcmds <command> [options]\n');
  console.log('  Any command not listed below is handed to git untouched, so gcmds');
  console.log('  does everything git does — you just type gcmds instead.\n');
  console.log('  Commands:');
  for (const name of commandNames()) {
    try {
      const mod = await import(join(COMMANDS_DIR, `${name}.mjs`));
      console.log(`    ${name.padEnd(12)} ${mod.description || ''}`);
    } catch {
      console.log(`    ${name}`);
    }
  }
  console.log('\n  Flags:');
  console.log('    --extreme          Lost files are DELETED from disk (not just unstaged)');
  console.log('    --no-music         Disable in-game music');
  console.log('    --no-trailer       Do not stamp the run report into the commit message');
  console.log('    --help             Show this help');
  console.log('\n  Mission rules:');
  for (const [axis, spec] of Object.entries(RULE_OPTIONS)) {
    console.log(`    --${axis}=<${spec.values.join('|')}>`.padEnd(38) + `(default: ${spec.default})`);
    for (const value of spec.values) {
      console.log(`        ${value.padEnd(10)} ${spec.describe[value]}`);
    }
  }
  console.log('');
}

/**
 * Hand the invocation to git, saying so first when someone is watching. The
 * note matters: typing `gcmds commit --amend` and getting a plain amend should
 * not look like the game silently declined to run.
 */
function decline(reason) {
  if (process.stderr.isTTY) console.error(`  ${reason} — running git.`);
  passThrough(argv);
}

async function main() {
  const dispatch = classify(argv, { commands: commandNames() });

  if (dispatch.kind === 'help') {
    await listCommands();
    process.exit(0);
  }
  if (dispatch.kind === 'version') {
    console.log(`git-commandos ${version()}`);
    process.exit(0);
  }
  if (dispatch.kind === 'passthrough') passThrough(argv);

  const command = await import(join(COMMANDS_DIR, `${dispatch.command}.mjs`));
  const { flags, args } = parseFlags(dispatch.args, GCMDS_FLAGS);

  if (flags.help || args.includes('-h')) {
    console.log(`\n  ${command.description || dispatch.command}`);
    console.log(`  Usage: ${command.usage || `gcmds ${dispatch.command}`}\n`);
    process.exit(0);
  }

  // A gated command only claims the shapes it fully understands. `git commit
  // --amend`, `git merge --abort`, `git push --delete` and friends are git's.
  if (command.supports && !command.supports(args)) {
    decline(`"${[dispatch.command, ...args].join(' ')}" is not something the game gates`);
  }

  if (command.requiresRepo !== false && !isInsideGitRepo()) {
    console.error('  Error: not inside a git repository.');
    process.exit(1);
  }

  await command.run(args, flags);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
