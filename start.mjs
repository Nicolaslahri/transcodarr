#!/usr/bin/env node
// Transcodarr Unified Launcher — npm start

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

const CONFIG_DIR = path.join(os.homedir(), '.transcodarr');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

// Resolve the monorepo root regardless of platform
const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/[a-zA-Z]:/, (m) => m.slice(1)));

function launchRole(role) {
  const filter = role === 'main' ? '@transcodarr/main' : '@transcodarr/worker';
  const label  = role === 'main' ? '🧠 Main Node' : '⚡ Worker Node';

  console.log(`\n  Starting ${label}...\n`);

  const child = spawn(
    'npx',
    ['turbo', 'dev', `--filter=${filter}`],
    { stdio: 'inherit', shell: true, cwd: ROOT }
  );

  child.on('error', (err) => {
    console.error('\n  ❌ Failed to launch:', err.message);
    process.exit(1);
  });

  // When the child exits, check if config was wiped (reset flow)
  // If so, restart in setup mode. Otherwise propagate the exit code.
  child.on('exit', (code) => {
    const config = loadConfig();
    if (!config?.role) {
      console.log('\n  🔄 Config wiped — restarting setup wizard...\n');
      // Short delay so any port release completes
      setTimeout(() => main().catch(console.error), 1500);
    } else {
      process.exit(code ?? 0);
    }
  });
}

async function main() {
  const config = loadConfig();

  // If role already saved, launch it
  if (config?.role) {
    console.log(`\n  Transcodarr — resuming as ${config.role === 'main' ? '🧠 Main Node' : '⚡ Worker Node'}`);
    console.log(`  \x1b[2m(Reset: Settings → General → Reset Setup)\x1b[0m\n`);
    launchRole(config.role);
    return;
  }

  // No config → launch setup mode
  console.log('\n  🚀 First boot detected! Launching Setup UI on http://localhost:3001 ...\n');

  const child = spawn(
    'npx',
    ['turbo', 'dev', '--filter=@transcodarr/main'],
    {
      stdio: 'inherit',
      shell: true,
      cwd: ROOT,
      env: { ...process.env, SETUP_MODE: '1' }
    }
  );

  child.on('error', (err) => {
    console.error('\n  ❌ Failed to launch setup:', err.message);
    process.exit(1);
  });

  child.on('exit', () => {
    const newConfig = loadConfig();
    if (newConfig?.role) {
      console.log('\n  ✅ Setup complete! Restarting...\n');
      setTimeout(() => launchRole(newConfig.role), 1500);
    } else {
      // Config still not set — re-show setup
      setTimeout(() => main().catch(console.error), 1500);
    }
  });
}

main().catch(console.error);
