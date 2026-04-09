import chokidar from 'chokidar';
import path from 'path';
import { getDb } from './db.js';
import { enqueueFile } from './queue.js';
import { broadcast } from './server.js';
import * as fs from 'fs';

const SUPPORTED_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.ts', '.m2ts', '.wmv'];

// Debounce map: wait for file to finish being written before analyzing
const pendingFiles = new Map<string, ReturnType<typeof setTimeout>>();

let sharedWatcher: chokidar.FSWatcher | null = null;
const activePaths: string[] = [];
const pathToRecipe = new Map<string, string>();

export function startWatcher(): void {
  const db = getDb();
  const watched = db.prepare("SELECT path, recipe FROM watched_paths WHERE enabled = 1").all() as { path: string; recipe: string }[];

  if (watched.length === 0) {
    console.log('  No watched paths configured yet. Add one in Settings.');
    return;
  }

  for (const w of watched) {
    addWatchedPath(w.path, w.recipe, false); // false = don't trigger deep scan on startup (initial: false covers it)
  }
}

function initWatcher() {
  if (sharedWatcher) return;

  sharedWatcher = chokidar.watch([], {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 5000, pollInterval: 500 },
    ignored: /(^|[/\\])\..|(\.bak$)|(\.transcodarr_tmp)/,
  });

  sharedWatcher.on('add', (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) return;

    // Find which watched path this file belongs to
    // Use the live activePaths array
    const watchedRoot = activePaths.find(p => filePath.startsWith(p));
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
}

// Called from settings API when a new path is added — hot-reload watcher
export function addWatchedPath(watchPath: string, recipe: string, triggerScan = true): void {
  if (!activePaths.includes(watchPath)) {
    activePaths.push(watchPath);
  }
  pathToRecipe.set(watchPath, recipe);

  if (!sharedWatcher) {
    initWatcher();
  }

  if (sharedWatcher) {
    sharedWatcher.add(watchPath);
    console.log(`  👁️ Watcher hot-reloaded: added ${watchPath}`);
    
    if (triggerScan) {
      console.log(`  🔍 Auto-triggering deep scan for: ${watchPath}`);
      manualScanDirectory(watchPath, recipe);
    }
  }
}

// Helper to manually scan a directory recursively, broadcasting a summary when done
export function manualScanDirectory(dir: string, recipe: string) {
  if (!fs.existsSync(dir)) {
    broadcast('scan:summary', { dir, recipe, enqueued: 0, skipped: 0, alreadyActive: 0, error: 'Directory not found' });
    return;
  }

  const stats = { enqueued: 0, skipped: 0, alreadyActive: 0, total: 0 };

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
            stats.total++;
            const job = enqueueFile(fullPath, recipe);
            if (job) {
              stats.enqueued++;
              console.log(`📥 Queued: ${path.basename(fullPath)}`);
              broadcast('job:queued', job);
            } else {
              // Check if in-progress vs genuinely skipped (already optimal)
              const existing = getDb().prepare(
                "SELECT status FROM jobs WHERE file_path = ?"
              ).get(fullPath) as any;

              if (existing && ['transcoding', 'dispatched', 'swapping'].includes(existing.status)) {
                stats.alreadyActive++;
              } else {
                stats.skipped++;
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`Failed to scan ${current}:`, err);
    }
  };

  scan(dir);

  const msg = `Scan complete for "${path.basename(dir)}": ${stats.enqueued} queued, ${stats.skipped} already optimized, ${stats.alreadyActive} in progress (${stats.total} total files found)`;
  console.log(`  📊 ${msg}`);
  broadcast('scan:summary', { dir, recipe, ...stats, message: msg });
}
