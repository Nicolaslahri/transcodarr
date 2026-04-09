#!/usr/bin/env node
// Transcodarr Unified Launcher — npm start

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn, spawnSync } from 'child_process';

const CONFIG_DIR  = path.join(os.homedir(), '.transcodarr');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const RESET_FLAG  = path.join(CONFIG_DIR, 'reset.flag');
const IS_WIN      = process.platform === 'win32';

const ROOT = path.dirname(
  new URL(import.meta.url).pathname.replace(/^\/[a-zA-Z]:/, (m) => m.slice(1))
);

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); }
  catch { return null; }
}

// ─── Kill entire process tree (cross-platform) ────────────────────────────────
function killTree(child) {
  if (!child || child.exitCode !== null) return; // already dead
  try {
    if (IS_WIN) {
      // Windows: taskkill /F /T kills the PID and ALL its descendants
      spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { shell: false });
    } else {
      // Unix: negative PID kills the entire process group
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch { /* already gone */ }
}

// ─── Free the port (Brute-force cleanup) ──────────────────────────────────────
async function freePort(port = 3001) {
  if (!IS_WIN) return; // Unix killTree usually works perfectly
  try {
    // Force kill the process holding the port on Windows
    const cmd = `PowerShell -Command "Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue).OwningProcess -Force -ErrorAction SilentlyContinue"`;
    spawnSync(cmd, { shell: true });
  } catch {}
}

// ─── Wait until port 3001 is free (max 10 s) ─────────────────────────────────
async function waitForPortFree(port = 3001, timeoutMs = 10_000) {
  await freePort(port);
  const { createConnection } = await import('net');
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const free = await new Promise((resolve) => {
      const s = createConnection(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(false); });   // port in use
      s.on('error',   () => resolve(true));                       // port free
    });
    if (free) return;
    await new Promise(r => setTimeout(r, 500));
  }
  console.warn(`  ⚠️  Port ${port} still in use after ${timeoutMs / 1000}s — trying anyway…`);
}

// ─── Reset flag poller ────────────────────────────────────────────────────────
let currentChild = null;
let resetPoller  = null;
let isRestarting = false;

function startResetPoller() {
  isRestarting = false;
  resetPoller = setInterval(() => {
    if (!fs.existsSync(RESET_FLAG)) return;
    clearInterval(resetPoller);
    isRestarting = true;
    
    try { fs.unlinkSync(RESET_FLAG); } catch {}
    // We strictly DO NOT delete config.json here. The API endpoints handle that.
    
    console.log('\n  🔄 Restart requested — stopping current node…\n');
    killTree(currentChild);
    
    // Relaunch the entire pipeline
    waitForPortFree().then(() => main().catch(console.error));
  }, 500);
}

// ─── Find an available port (for worker auto-shifting) ────────────────────────
async function findFreePort(startPort = 3001) {
  const { createServer } = await import('net');
  let port = startPort;
  while (true) {
    const free = await new Promise((resolve) => {
      const s = createServer();
      s.once('error', () => resolve(false));
      s.once('listening', () => { s.close(); resolve(true); });
      s.listen(port, '127.0.0.1');
    });
    if (free) return port;
    port++;
  }
}

// ─── Launch a role ────────────────────────────────────────────────────────────
async function launchRole(role) {
  const isProd  = process.env.NODE_ENV === 'production';
  const filter  = role === 'main' ? '@transcodarr/main' : '@transcodarr/worker';
  const label   = role === 'main' ? '🧠 Main Node' : '⚡ Worker Node';

  // Main always owns 3001. Worker finds its own free port (3002+).
  const port = role === 'main' ? 3001 : await findFreePort(3002);
  if (role === 'main') await waitForPortFree(3001);
  console.log(`\n  Starting ${label} on port ${port}...\n`);

  const portEnvKey = role === 'main' ? 'MAIN_PORT' : 'WORKER_PORT';

  if (isProd) {
    const entrypoint = role === 'main' ? 'apps/main/dist/index.js' : 'apps/worker/dist/index.js';
    currentChild = spawn('node', [entrypoint], {
      stdio: 'inherit', cwd: ROOT, detached: !IS_WIN,
      env: { ...process.env, [portEnvKey]: String(port) }
    });
  } else {
    currentChild = spawn('npm', ['run', 'dev', '--workspace=' + filter], {
      stdio: 'inherit', shell: true, cwd: ROOT, detached: !IS_WIN,
      env: { ...process.env, [portEnvKey]: String(port) }
    });
  }

  startResetPoller();

  currentChild.on('error', (err) => {
    clearInterval(resetPoller);
    console.error('\n  ❌ Failed to launch:', err.message);
    process.exit(1);
  });

  currentChild.on('exit', (code) => {
    clearInterval(resetPoller);
    if (isRestarting) return; // Handled by poller
    
    if (fs.existsSync(RESET_FLAG)) {
      try { fs.unlinkSync(RESET_FLAG); } catch {}
      waitForPortFree().then(() => main().catch(console.error));
    } else {
      process.exit(code ?? 0);
    }
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  try { if (fs.existsSync(RESET_FLAG)) fs.unlinkSync(RESET_FLAG); } catch {}

  const config = loadConfig();

  if (config?.role) {
    console.log(`\n  Transcodarr — resuming as ${config.role === 'main' ? '🧠 Main Node' : '⚡ Worker Node'}`);
    console.log(`  \x1b[2m(Reset: Settings → General → Reset Setup)\x1b[0m\n`);
    await launchRole(config.role);
    return;
  }

  console.log('\n  🚀 First boot — opening Setup UI on http://localhost:3001 ...\n');
  await waitForPortFree();

  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    currentChild = spawn('node', ['apps/main/dist/index.js'], {
      stdio: 'inherit',
      cwd: ROOT,
      detached: !IS_WIN,
      env: { ...process.env, SETUP_MODE: '1' }
    });
  } else {
    currentChild = spawn('npm', ['run', 'dev', '--workspace=@transcodarr/main'], {
      stdio: 'inherit',
      shell: true,
      cwd: ROOT,
      detached: !IS_WIN,
      env: { ...process.env, SETUP_MODE: '1' }
    });
  }

  startResetPoller();

  currentChild.on('error', (err) => {
    clearInterval(resetPoller);
    console.error('\n  ❌ Failed to launch setup:', err.message);
    process.exit(1);
  });

  currentChild.on('exit', () => {
    clearInterval(resetPoller);
    if (isRestarting) return; // Handled by poller
    
    if (fs.existsSync(RESET_FLAG)) {
      try { fs.unlinkSync(RESET_FLAG); } catch {}
      waitForPortFree().then(() => main().catch(console.error));
      return;
    }
    
    const newConfig = loadConfig();
    if (newConfig?.role) {
      console.log('\n  ✅ Setup complete! Restarting as configured role...\n');
      waitForPortFree().then(() => launchRole(newConfig.role));
    } else {
      waitForPortFree().then(() => main().catch(console.error));
    }
  });
}

main().catch(console.error);
