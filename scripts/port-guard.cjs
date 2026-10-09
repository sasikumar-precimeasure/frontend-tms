// Finds (and optionally stops) anything still holding the TMS ports, plus
// leftover gateway watchers from earlier runs, cross-platform (Mac, Linux,
// Windows). Used by dev-setup.cjs before starting and by `npm run dev:stop`.
//
// Leftovers happen when a terminal running dev:setup is closed instead of
// stopped with Ctrl+C: the gateway keeps running in the background, keeps
// port 4000, and a newly started gateway can't take over - or worse, several
// `tsx watch` copies race for the port every time a file changes.
const net = require('node:net');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const isWindows = process.platform === 'win32';
const projectDir = path.join(__dirname, '..');

const PORTS = [
  { port: 4000, label: 'Modbus gateway' },
  { port: 5173, label: 'TMS website (Vite)' },
];

function sh(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  } catch (error) {
    // grep-style tools exit non-zero when nothing matches - still use stdout.
    return error.stdout ? String(error.stdout) : '';
  }
}

// True if something accepts connections on the port (IPv4 or IPv6 loopback).
function isPortInUse(port) {
  const tryHost = (host) =>
    new Promise((resolve) => {
      const socket = net.connect({ host, port });
      const done = (inUse) => {
        socket.destroy();
        resolve(inUse);
      };
      socket.setTimeout(500, () => done(false));
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
    });
  return Promise.all([tryHost('127.0.0.1'), tryHost('::1')]).then((results) => results.some(Boolean));
}

function listeningPids(port) {
  if (isWindows) {
    const pids = new Set();
    for (const line of sh('netstat', ['-ano', '-p', 'tcp']).split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      // Proto  Local Address  Foreign Address  State  PID
      if (cols.length >= 5 && cols[3] === 'LISTENING' && cols[1].endsWith(`:${port}`)) pids.add(Number(cols[4]));
    }
    for (const line of sh('netstat', ['-ano', '-p', 'tcpv6']).split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length >= 5 && cols[3] === 'LISTENING' && cols[1].endsWith(`:${port}`)) pids.add(Number(cols[4]));
    }
    return [...pids].filter((pid) => pid > 0);
  }
  return sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
    .split(/\s+/)
    .filter(Boolean)
    .map(Number);
}

// Every process with its parent and command line.
function processTable() {
  if (isWindows) {
    const out = sh('powershell', [
      '-NoProfile',
      '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)`t$($_.ParentProcessId)`t$($_.CommandLine)" }',
    ]);
    return out
      .split(/\r?\n/)
      .map((line) => line.split('\t'))
      .filter((cols) => cols.length >= 3 && cols[0])
      .map(([pid, ppid, ...cmd]) => ({ pid: Number(pid), ppid: Number(ppid), command: cmd.join('\t') }));
  }
  return sh('ps', ['-axo', 'pid=,ppid=,command='])
    .split('\n')
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map(([, pid, ppid, command]) => ({ pid: Number(pid), ppid: Number(ppid), command }));
}

// Launchers that only exist to run a TMS server - safe to stop together with
// the server itself so they don't respawn it (tsx watch) or linger.
function isTmsLauncher(command) {
  return (
    command.includes(projectDir) ||
    /tsx(\.cmd)?["']?\s+watch/.test(command) ||
    /npm(-cli\.js)?["']?\s+run\s+(dev|dev:all|dev:gateway|dev:setup|start)\b/.test(command) ||
    /concurrently/.test(command)
  );
}

// A TMS server itself: anything run from this project's folder, or the
// production gateway (`node dist/server/src/server.js`, started from tms/server).
function isTmsProcess(command) {
  return command.includes(projectDir) || /dist[\\/](server[\\/]src[\\/])?server\.js/.test(command);
}

// Returns { ports: [{port,label,inUse,processes:[{pid,command}]}], strayWatchers: [{pid,command}] }.
async function findConflicts() {
  const table = processTable();
  const byPid = new Map(table.map((p) => [p.pid, p]));

  const ports = [];
  for (const { port, label } of PORTS) {
    const inUse = await isPortInUse(port);
    const processes = inUse
      ? listeningPids(port).map((pid) => ({ pid, command: byPid.get(pid)?.command ?? '(unknown)' }))
      : [];
    ports.push({ port, label, inUse, processes });
  }

  // `tsx watch` gateway watchers for THIS project with no running server
  // child - orphans from closed terminals. They hold no port, but restart a
  // gateway on every file change and race for port 4000.
  const strayWatchers = table
    .filter((p) => /tsx/.test(p.command) && /\bwatch\b/.test(p.command) && /server\.ts/.test(p.command))
    .filter((p) => p.command.includes(projectDir) || p.command.includes('server' + path.sep + 'node_modules'))
    .filter((p) => !table.some((child) => child.ppid === p.pid))
    .map((p) => ({ pid: p.pid, command: p.command }));

  return { ports, strayWatchers, byPid };
}

function hasConflicts(conflicts) {
  return conflicts.ports.some((p) => p.inUse) || conflicts.strayWatchers.length > 0;
}

function shorten(command) {
  return command.length > 110 ? command.slice(0, 107) + '...' : command;
}

function describe(conflicts) {
  const lines = [];
  for (const p of conflicts.ports.filter((p) => p.inUse)) {
    lines.push(`  Port ${p.port} (${p.label}) is already in use by:`);
    if (p.processes.length === 0) lines.push('    (process could not be identified - try running as administrator)');
    for (const proc of p.processes) lines.push(`    PID ${proc.pid}  ${shorten(proc.command)}`);
  }
  if (conflicts.strayWatchers.length) {
    lines.push('  Leftover gateway watchers from earlier runs (closed terminals):');
    for (const proc of conflicts.strayWatchers) lines.push(`    PID ${proc.pid}  ${shorten(proc.command)}`);
  }
  return lines.join('\n');
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopPid(pid) {
  if (isWindows) {
    // /T also stops the process tree (e.g. npm -> node), /F forces it.
    sh('taskkill', ['/PID', String(pid), '/T', '/F']);
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

// Stops every conflicting process, plus its TMS launcher parents (tsx watch /
// npm run dev / concurrently) so nothing respawns it. Never touches unrelated
// software: a non-TMS process on the port is reported, not killed.
async function stopConflicts(conflicts) {
  const targets = new Set();
  const skipped = [];
  const addWithLaunchers = (pid) => {
    targets.add(pid);
    let parent = conflicts.byPid.get(pid)?.ppid;
    while (parent && parent !== process.pid && conflicts.byPid.has(parent) && isTmsLauncher(conflicts.byPid.get(parent).command)) {
      targets.add(parent);
      parent = conflicts.byPid.get(parent).ppid;
    }
  };

  for (const p of conflicts.ports) {
    for (const proc of p.processes) {
      if (isTmsProcess(proc.command)) addWithLaunchers(proc.pid);
      else skipped.push({ ...proc, port: p.port });
    }
  }
  for (const proc of conflicts.strayWatchers) addWithLaunchers(proc.pid);
  targets.delete(process.pid);

  for (const pid of targets) stopPid(pid);
  // Give them a moment to exit cleanly, then force any that ignored SIGTERM
  // (idle tsx watchers do).
  await new Promise((resolve) => setTimeout(resolve, 1500));
  if (!isWindows) {
    for (const pid of targets) {
      if (isAlive(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // gone
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { stopped: [...targets], skipped };
}

module.exports = { findConflicts, hasConflicts, describe, stopConflicts, isPortInUse, PORTS };

// `npm run dev:stop`
if (require.main === module) {
  (async () => {
    const conflicts = await findConflicts();
    if (!hasConflicts(conflicts)) {
      console.log('Nothing to stop - no TMS website/gateway is running.');
      return;
    }
    console.log('Stopping:\n' + describe(conflicts));
    const { stopped, skipped } = await stopConflicts(conflicts);
    for (const s of skipped) {
      console.log(`  Not stopping PID ${s.pid} on port ${s.port} - it is not a TMS process: ${shorten(s.command)}`);
    }
    const after = await findConflicts();
    if (hasConflicts(after)) {
      console.log('\nStill running after stop attempt:\n' + describe(after));
      process.exitCode = 1;
    } else {
      console.log(`Stopped ${stopped.length} process(es). Ports 4000 and 5173 are free.`);
    }
  })();
}
