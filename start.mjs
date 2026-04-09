#!/usr/bin/env node
// Transcodarr Unified Launcher — npm start

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
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

function saveConfig(config) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function launchRole(role) {
  const filter = role === 'main' ? '@transcodarr/main' : '@transcodarr/worker';
  const label = role === 'main' ? '🧠 Main Node' : '⚡ Worker Node';

  console.log(`\n  Starting ${label}...\n`);

  const child = spawn(
    'npx',
    ['turbo', 'dev', `--filter=${filter}`],
    { stdio: 'inherit', shell: true, cwd: path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')) }
  );

  child.on('error', (err) => {
    console.error('\n  ❌ Failed to launch:', err.message);
    process.exit(1);
  });

  child.on('exit', (code) => process.exit(code ?? 0));
}

async function main() {
  const config = loadConfig();

  // If role already saved, use it
  if (config?.role) {
    console.log(`\n  Transcodarr — resuming as ${config.role === 'main' ? '🧠 Main Node' : '⚡ Worker Node'}`);
    console.log(`  ${'\x1b[2m'}(To change role: Settings → General → Switch Role)\x1b[0m\n`);
    launchRole(config.role);
    return;
  }

  // First boot: launch Setup mode via Main node
  console.log('\n  🚀 First boot detected! Launching Setup UI on http://localhost:3001 ...\n');
  const child = spawn(
    'npx',
    ['turbo', 'dev', '--filter=@transcodarr/main'],
    { 
      stdio: 'inherit', 
      shell: true, 
      cwd: path.dirname(new URL(import.meta.url).pathname.replace(/^\/[a-zA-Z]:/, (m) => m.slice(1))),
      env: { ...process.env, SETUP_MODE: '1' } 
    }
  );

  child.on('error', (err) => {
    console.error('\n  ❌ Failed to launch setup:', err.message);
    process.exit(1);
  });

  child.on('exit', (code) => {
    const newConfig = loadConfig();
    if (newConfig?.role) {
      console.log('\n  ✅ Setup complete! Restarting to apply role...\n');
      launchRole(newConfig.role);
    } else {
      process.exit(code ?? 0);
    }
  });
}

main().catch(console.error);
