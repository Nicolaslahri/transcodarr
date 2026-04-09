import chokidar from 'chokidar';
import path from 'path';
import { getDb } from './db.js';
import { enqueueFile } from './queue.js';
import { broadcast } from './server.js';

const SUPPORTED_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.ts', '.m2ts', '.wmv'];

// Debounce map: wait for file to finish being written before analyzing
const pendingFiles = new Map<string, ReturnType<typeof setTimeout>>();

let sharedWatcher: chokidar.FSWatcher | null = null;
const pathToRecipe = new Map<string, string>();

export function startWatcher(): void {
  const db = getDb();
  const watched = db.prepare("SELECT path, recipe FROM watched_paths WHERE enabled = 1").all() as { path: string; recipe: string }[];

  if (watched.length === 0) {
    console.log('  No watched paths configured yet. Add one in Settings.');
    return;
  }

  const paths = watched.map(w => w.path);
  for (const w of watched) {
    pathToRecipe.set(w.path, w.recipe);
  }

  sharedWatcher = chokidar.watch(paths, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 500 },
    ignored: /(^|[/\\])\..|(\.bak$)|(\.transcodarr_tmp)/,
  });

  sharedWatcher.on('add', (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) return;

    // Find which watched path this file belongs to
    const watchedRoot = paths.find(p => filePath.startsWith(p));
    if (!watchedRoot) return;
    const recipe = pathToRecipe.get(watchedRoot) ?? 'space-saver';

    // Debounce — wait 3s of inactivity before enqueueing
    const existing = pendingFiles.get(filePath);
    if (existing) clearTimeout(existing);

    pendingFiles.set(filePath, setTimeout(() => {
      pendingFiles.delete(filePath);
      const job = enqueueFile(filePath, recipe);
      if (job) {
        console.log(`📥 Queued: ${path.basename(filePath)}`);
        broadcast('job:queued', job);
      }
    }, 3000));
  });

  sharedWatcher.on('error', (err) => console.error('Watcher error:', err));
  console.log(`  Watching ${paths.length} path(s): ${paths.join(', ')}`);
}

// Called from settings API when a new path is added — hot-reload watcher
export function addWatchedPath(watchPath: string, recipe: string): void {
  pathToRecipe.set(watchPath, recipe);
  if (sharedWatcher) {
    sharedWatcher.add(watchPath);
    console.log(`  👁️ Watcher hot-reloaded: added ${watchPath}`);
  }
}

// Helper to manually scan a directory recursively
import * as fs from 'fs';
export function manualScanDirectory(dir: string, recipe: string) {
  if (!fs.existsSync(dir)) return;
  const scan = (current: string) => {
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
        } else {
          const ext = path.extname(fullPath).toLowerCase();
          if (SUPPORTED_EXTENSIONS.includes(ext)) {
            // Queue immediately (bypassing the 3s debounce for manual scans)
            const job = enqueueFile(fullPath, recipe);
            if (job) {
              console.log(`📥 Manual Scan Queued: ${path.basename(fullPath)}`);
              broadcast('job:queued', job);
            }
          }
        }
      }
    } catch (err) {
      console.error(`Failed to scan ${current}:`, err);
    }
  };
  scan(dir);
}
