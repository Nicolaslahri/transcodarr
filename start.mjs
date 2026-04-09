#!/usr/bin/env node
// Transcodarr Unified Launcher — npm start

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

const CONFIG_DIR  = path.join(os.homedir(), '.transcodarr');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const RESET_FLAG  = path.join(CONFIG_DIR, 'reset.flag');

const ROOT = path.dirname(
  new URL(import.meta.url).pathname.replace(/^\/[a-zA-Z]:/, (m) => m.slice(1))
);

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); }
  catch { return null; }
}

// ─── Watch for reset flag written by the API reset endpoint ──────────────────
// This is the only reliable cross-platform way to signal start.mjs from inside
// a turbo dev child, since turbo intercepts process signals and auto-restarts.

let currentChild = null;
let resetPoller  = null;

function startResetPoller() {
  resetPoller = setInterval(() => {
    if (!fs.existsSync(RESET_FLAG)) return;

    // Flag found — wipe it and the config, then kill & restart
    try { fs.unlinkSync(RESET_FLAG); }  catch { /* ok */ }
    try { fs.unlinkSync(CONFIG_FILE); } catch { /* ok */ }

    console.log('\n  🔄 Reset triggered — restarting setup wizard...\n');
    clearInterval(resetPoller);

    if (currentChild) {
      currentChild.kill('SIGTERM');
      // Force kill after 3 s if still alive
      setTimeout(() => { try { currentChild.kill('SIGKILL'); } catch {} }, 3000);
    }

    // Relaunch in setup mode after child has had time to die
    setTimeout(() => main().catch(console.error), 2000);
  }, 1000);
}

// ─── Launch a role ────────────────────────────────────────────────────────────

function launchRole(role) {
  const filter = role === 'main' ? '@transcodarr/main' : '@transcodarr/worker';
  const label  = role === 'main' ? '🧠 Main Node' : '⚡ Worker Node';

  console.log(`\n  Starting ${label}...\n`);

  currentChild = spawn(
    'npx',
    ['turbo', 'dev', `--filter=${filter}`],
    { stdio: 'inherit', shell: true, cwd: ROOT }
  );

  startResetPoller();

  currentChild.on('error', (err) => {
    console.error('\n  ❌ Failed to launch:', err.message);
    process.exit(1);
  });

  currentChild.on('exit', (code) => {
    clearInterval(resetPoller);
    // Only exit completely if no reset is pending
    if (!fs.existsSync(RESET_FLAG)) {
      process.exit(code ?? 0);
    }
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Clean up any stale reset flag from a crashed previous session
  try { if (fs.existsSync(RESET_FLAG)) fs.unlinkSync(RESET_FLAG); } catch { /* ok */ }

  const config = loadConfig();

  if (config?.role) {
    console.log(`\n  Transcodarr — resuming as ${config.role === 'main' ? '🧠 Main Node' : '⚡ Worker Node'}`);
    console.log(`  \x1b[2m(Reset: Settings → General → Reset Setup)\x1b[0m\n`);
    launchRole(config.role);
    return;
  }

  // No config → launch setup wizard
  console.log('\n  🚀 First boot — opening Setup UI on http://localhost:3001 ...\n');

  currentChild = spawn(
    'npx',
    ['turbo', 'dev', '--filter=@transcodarr/main'],
    {
      stdio: 'inherit',
      shell: true,
      cwd: ROOT,
      env: { ...process.env, SETUP_MODE: '1' }
    }
  );

  startResetPoller();

  currentChild.on('error', (err) => {
    console.error('\n  ❌ Failed to launch setup:', err.message);
    process.exit(1);
  });

  currentChild.on('exit', () => {
    clearInterval(resetPoller);
    const newConfig = loadConfig();
    if (newConfig?.role) {
      console.log('\n  ✅ Setup complete! Restarting...\n');
      setTimeout(() => launchRole(newConfig.role), 1500);
    } else {
      // Still no config — re-show setup
      setTimeout(() => main().catch(console.error), 1500);
    }
  });
}

main().catch(console.error);
