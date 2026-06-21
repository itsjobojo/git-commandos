#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isInsideGitRepo } from './git-ops.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const COMMANDS_DIR = join(__dirname, 'commands');

const args = process.argv.slice(2);

// Parse global flags
const flags = {
  extreme: args.includes('--extreme'),
  noMusic: args.includes('--no-music'),
  help: args.includes('--help') || args.includes('-h'),
};
const filteredArgs = args.filter((a) => !a.startsWith('--'));

const subcommand = filteredArgs[0];
const subArgs = filteredArgs.slice(1);

async function listCommands() {
  const files = readdirSync(COMMANDS_DIR).filter(
    (f) => f.endsWith('.mjs') && !f.startsWith('_')
  );
  console.log('\n  Git Commandos — git, but you have to earn it.\n');
  console.log('  Usage: gcmds <command> [options]\n');
  console.log('  Commands:');
  for (const file of files) {
    const name = file.replace('.mjs', '');
    try {
      const mod = await import(join(COMMANDS_DIR, file));
      console.log(`    ${name.padEnd(12)} ${mod.description || ''}`);
    } catch {
      console.log(`    ${name}`);
    }
  }
  console.log('\n  Flags:');
  console.log('    --extreme    Lost files are DELETED from disk (not just unstaged)');
  console.log('    --no-music   Disable in-game music');
  console.log('    --help       Show this help\n');
}

async function main() {
  if (!subcommand || flags.help) {
    await listCommands();
    process.exit(0);
  }

  if (!isInsideGitRepo()) {
    console.error('  Error: not inside a git repository.');
    process.exit(1);
  }

  let command;
  try {
    command = await import(join(COMMANDS_DIR, `${subcommand}.mjs`));
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      console.error(`  Unknown command: "${subcommand}". Run "gcmds --help" for available commands.`);
      process.exit(1);
    }
    throw err;
  }

  await command.run(subArgs, flags);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
