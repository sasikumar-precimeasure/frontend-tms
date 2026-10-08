#!/usr/bin/env node
// One-command local setup + run for TMS, cross-platform (Mac/Windows/Linux).
// Installs dependencies for the website (tms/) and the Modbus gateway
// (tms/server/) if missing, then starts both together.
// Usage: npm run dev:setup            (asks before stopping old copies)
//        npm run dev:setup -- --force (stops old copies without asking)

const { spawnSync, spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');
const portGuard = require('./port-guard.cjs');

const rootDir = path.join(__dirname, '..');
const serverDir = path.join(rootDir, 'server');
const isWindows = process.platform === 'win32';
const npmCmd = isWindows ? 'npm.cmd' : 'npm';

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: isWindows, ...options });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function hasNodeModules(dir) {
  return fs.existsSync(path.join(dir, 'node_modules'));
}

if (!hasNodeModules(rootDir)) {
  console.log('Installing website dependencies...');
  run(npmCmd, ['install'], { cwd: rootDir });
}

if (!hasNodeModules(serverDir)) {
  console.log('Installing Modbus gateway dependencies...');
  run(npmCmd, ['install'], { cwd: serverDir });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim().toLowerCase());
  }));
}

// Only one website + gateway may run at a time: a second gateway can't bind
// port 4000, and leftover `tsx watch` copies race for it on every file
// change - both show up as TRs randomly flipping to "not connected".
async function ensureNothingAlreadyRunning() {
  const conflicts = await portGuard.findConflicts();
  if (!portGuard.hasConflicts(conflicts)) return;

  console.log('\nTMS is already (partly) running:\n' + portGuard.describe(conflicts) + '\n');
  const force = process.argv.includes('--force');
  if (!force) {
    if (!process.stdin.isTTY) {
      console.log('Stop them first with "npm run dev:stop", or run "npm run dev:setup -- --force".');
      process.exit(1);
    }
    const answer = await ask('Stop them and start fresh? [y/N] ');
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Not starting a second copy. Stop the old one with "npm run dev:stop" when ready.');
      process.exit(1);
    }
  }

  const { skipped } = await portGuard.stopConflicts(conflicts);
  for (const s of skipped) {
    console.log(`Port ${s.port} is used by a non-TMS program (PID ${s.pid}) - not stopping it. Free that port and retry.`);
  }
  const after = await portGuard.findConflicts();
  if (portGuard.hasConflicts(after)) {
    console.log('\nCould not free everything:\n' + portGuard.describe(after));
    process.exit(1);
  }
  console.log('Old copies stopped.\n');
}

(async () => {
  await ensureNothingAlreadyRunning();

  console.log('Starting website + Modbus gateway...');
  const child = spawn(npmCmd, ['run', 'dev:all'], { cwd: rootDir, stdio: 'inherit', shell: isWindows });

  child.on('exit', (code) => process.exit(code ?? 0));
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  // Closing the terminal window sends SIGHUP - pass it on so the gateway
  // doesn't keep running in the background (the usual source of leftovers).
  process.on('SIGHUP', () => child.kill('SIGTERM'));
})();
