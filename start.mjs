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

async function promptRole() {
  const RESET = '\x1b[0m';
  const BOLD = '\x1b[1m';
  const DIM = '\x1b[2m';
  const CYAN = '\x1b[36m';
  const YELLOW = '\x1b[33m';
  const GREEN = '\x1b[32m';

  console.clear();
  console.log(`
${BOLD}${CYAN}  ████████╗██████╗  █████╗ ███╗  ██╗███████╗ ██████╗  █████╗ ██████╗ ██████╗${RESET}
${DIM}${CYAN}     ██║  ██╔══██╗██╔══██╗████╗ ██║██╔════╝██╔════╝██╔══██╗██╔══██╗██╔══██╗${RESET}
${BOLD}${CYAN}     ██║  ██████╔╝███████║██╔██╗██║███████╗██║     ██║  ██║██║  ██║███████╔╝${RESET}
${DIM}${CYAN}     ██║  ██╔══██╗██╔══██║██║╚████║╚════██║██║     ██║  ██║██║  ██║██╔══██╗${RESET}
${BOLD}${CYAN}     ██║  ██║  ██║██║  ██║██║ ╚███║███████║╚██████╗╚█████╔╝██████╔╝██║  ██║${RESET}
${DIM}  ─────────────────────── ${RESET}${DIM}Zero-Config Intelligent Transcoding${RESET}${DIM} ────────────────────${RESET}

  ${BOLD}Welcome! What is this machine's role?${RESET}

    ${BOLD}${GREEN}[1]  Main Node${RESET}   ${DIM}— Manages the queue, watches folders, serves the Web UI${RESET}
         ${DIM}Best for: Raspberry Pi, NAS, or always-on server${RESET}

    ${BOLD}${YELLOW}[2]  Worker Node${RESET}  ${DIM}— GPU-accelerated transcoding powerhouse${RESET}
         ${DIM}Best for: Windows PC with Nvidia / AMD GPU${RESET}

`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(`  Enter choice ${DIM}[1 or 2]${RESET}: `, (answer) => {
      rl.close();
      const role = answer.trim() === '2' ? 'worker' : 'main';
      resolve(role);
    });
  });
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

  // First boot: show role selector
  const role = await promptRole();
  saveConfig({ role, savedAt: new Date().toISOString() });
  launchRole(role);
}

main().catch(console.error);
