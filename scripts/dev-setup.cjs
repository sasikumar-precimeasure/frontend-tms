#!/usr/bin/env node
// One-command local setup + run for TMS, cross-platform (Mac/Windows/Linux).
// Installs dependencies for the website (tms/) and the Modbus gateway
// (tms/server/) if missing, then starts both together.
// Usage: npm run dev:setup

const { spawnSync, spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const rootDir = path.join(__dirname, '..');
const serverDir = path.join(rootDir, 'server');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
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

console.log('Starting website + Modbus gateway...');
const child = spawn(npmCmd, ['run', 'dev:all'], { cwd: rootDir, stdio: 'inherit' });

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
