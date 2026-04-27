import chokidar from 'chokidar';
import path from 'path';
import { getDb } from './db.js';
import { enqueueFile } from './queue.js';
import { broadcast } from './server.js';
import { dispatchNext } from './dispatcher.js';
import * as fs from 'fs';

// Periodic scan poller — checks every hour if any watched_path is due for a re-scan
export function startPeriodicScanPoller(): void {
  setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    const paths = getDb().prepare(
      'SELECT id, path, recipe, scan_interval_hours, last_scan_at, exclude_patterns FROM watched_paths WHERE enabled = 1 AND scan_interval_hours > 0'
    ).all() as any[];
    for (const wp of paths) {
      const intervalSecs = wp.scan_interval_hours * 3600;
      const lastScan = wp.last_scan_at ?? 0;
      if (now - lastScan >= intervalSecs) {
        console.log(`🔄 Periodic scan triggered for: ${wp.path} (every ${wp.scan_interval_hours}h)`);
        const excludePatterns = wp.exclude_patterns ? (wp.exclude_patterns as string).split(',').map((s: string) => s.trim()).filter(Boolean) : [];
        manualScanDirectory(wp.path, wp.recipe, excludePatterns);
        getDb().prepare('UPDATE watched_paths SET last_scan_at = ? WHERE id = ?').run(now, wp.id);
      }
    }
  }, 60 * 60 * 1000); // check every hour
  console.log('  Periodic scan poller started (checks every hour)');
}

const SUPPORTED_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.ts', '.m2ts', '.wmv'];

// Debounce map: wait for file to finish being written before analyzing
const pendingFiles = new Map<string, ReturnType<typeof setTimeout>>();

let sharedWatcher: chokidar.FSWatcher | null = null;
const activePaths: string[] = [];
const pathToRecipe = new Map<string, string>();
const pathToExcludePatterns = new Map<string, string[]>();

/** Returns true if any exclude pattern (case-insensitive) matches the file path */
function isExcluded(filePath: string, patterns: string[]): boolean {
  const lower = filePath.toLowerCase();
  return patterns.some(p => p && lower.includes(p.toLowerCase()));
}

export function startWatcher(): void {
  const db = getDb();
  const watched = db.prepare("SELECT path, recipe, exclude_patterns FROM watched_paths WHERE enabled = 1").all() as { path: string; recipe: string; exclude_patterns?: string }[];

  if (watched.length === 0) {
    console.log('  No watched paths configured yet. Add one in Settings.');
    return;
  }

  for (const w of watched) {
    const excludePatterns = w.exclude_patterns ? w.exclude_patterns.split(',').map(s => s.trim()).filter(Boolean) : [];
    addWatchedPath(w.path, w.recipe, false, excludePatterns); // false = don't trigger deep scan on startup (initial: false covers it)
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

    // Check exclude patterns
    const excludePatterns = pathToExcludePatterns.get(watchedRoot) ?? [];
    if (excludePatterns.length > 0 && isExcluded(filePath, excludePatterns)) return;

    // Debounce — wait 3s of inactivity before enqueueing
    const existing = pendingFiles.get(filePath);
    if (existing) clearTimeout(existing);

    pendingFiles.set(filePath, setTimeout(() => {
      pendingFiles.delete(filePath);
      const job = enqueueFile(filePath, recipe);
      if (job) {
        console.log(`📥 Queued: ${path.basename(filePath)}`);
        broadcast('job:queued', job);
        dispatchNext().catch(() => {});
      }
    }, 3000));
  });

  // Clear the pending debounce timer if the file is deleted/moved before its
  // 3 s debounce fires. Without this, the timer still runs ffprobe against a
  // path that no longer exists, logs a noisy error, and the Map entry leaks.
  const cancelPending = (filePath: string) => {
    const t = pendingFiles.get(filePath);
    if (t) {
      clearTimeout(t);
      pendingFiles.delete(filePath);
    }
  };
  sharedWatcher.on('unlink', cancelPending);
  // Also clear on rename within a watched root — chokidar emits a unlink for the
  // old path which we already handle, but be defensive in case of pathological
  // file managers that emit 'change' on rename instead of unlink.
  sharedWatcher.on('change', () => { /* keep timers — change fires during write */ });

  sharedWatcher.on('error', (err) => console.error('Watcher error:', err));
}

// Called from settings API when a new path is added — hot-reload watcher
export function addWatchedPath(watchPath: string, recipe: string, triggerScan = true, excludePatterns?: string[]): void {
  if (!activePaths.includes(watchPath)) {
    activePaths.push(watchPath);
  }
  pathToRecipe.set(watchPath, recipe);
  if (excludePatterns) pathToExcludePatterns.set(watchPath, excludePatterns);

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

// Yield the Node.js event loop so other I/O (WebSocket pings, progress callbacks)
// can be processed between file analyses. Without this, synchronous ffprobe calls
// (~200ms each) block the entire server for multi-hundred-file scans.
const yieldToEventLoop = () => new Promise<void>(r => setImmediate(r));

// Active scan controllers keyed by directory — allows cancellation via cancelScan()
const activeScanControllers = new Map<string, AbortController>();

/** Cancel an in-progress scan for the given directory, if one is running. */
export function cancelScan(dir: string): boolean {
  const ctrl = activeScanControllers.get(dir);
  if (!ctrl) return false;
  ctrl.abort();
  return true;
}

// Helper to manually scan a directory recursively, broadcasting a summary when done.
// Runs asynchronously and yields between files so the server stays responsive.
// Symlink cycle detection prevents infinite recursion on looped symlinks.
export async function manualScanDirectory(dir: string, recipe: string, excludePatterns: string[] = []): Promise<void> {
  if (!fs.existsSync(dir)) {
    broadcast('scan:summary', { dir, recipe, enqueued: 0, skipped: 0, alreadyActive: 0, error: 'Directory not found' });
    return;
  }

  // Register an AbortController so callers can cancel this scan mid-flight
  const ctrl = new AbortController();
  activeScanControllers.set(dir, ctrl);
  const signal = ctrl.signal;

  const stats = { enqueued: 0, skipped: 0, alreadyActive: 0, total: 0 };
  const sessionId = Math.random().toString(36).slice(2, 10);
  // Track resolved real paths to break symlink cycles
  const visitedRealPaths = new Set<string>();

  const scan = async (current: string) => {
    if (signal.aborted) return; // bail out if scan was cancelled
    // Resolve the real path to detect symlink loops
    let realCurrent: string;
    try { realCurrent = fs.realpathSync(current); } catch { return; }
    if (visitedRealPaths.has(realCurrent)) return;
    visitedRealPaths.add(realCurrent);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      console.error(`Failed to read ${current}:`, err);
      return;
    }

    // Recurse into subdirectories first
    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const fullPath = path.join(current, entry.name);
        // Only recurse into symlinks that point to directories
        try {
          const stat = fs.statSync(fullPath); // follows symlinks
          if (stat.isDirectory()) await scan(fullPath);
        } catch { /* broken symlink — skip */ }
      }
    }

    // Process files — yield the event loop between each ffprobe so the
    // server can handle WebSocket messages / progress callbacks mid-scan.
    for (const entry of entries) {
      if (signal.aborted) return; // check before each file so cancellation is responsive
      if (entry.isFile()) {
        const fullPath = path.join(current, entry.name);
        const ext = path.extname(fullPath).toLowerCase();
        if (SUPPORTED_EXTENSIONS.includes(ext) && !isExcluded(fullPath, excludePatterns)) {
          // Yield before each ffprobe so the event loop can breathe
          await yieldToEventLoop();

          stats.total++;
          try {
            const job = enqueueFile(fullPath, recipe);
            if (job) {
              stats.enqueued++;
              console.log(`📥 Queued: ${path.basename(fullPath)}`);
              broadcast('job:queued', job);
            } else {
              const existing = getDb().prepare(
                'SELECT status FROM jobs WHERE file_path = ?'
              ).get(fullPath) as any;
              if (existing && ['transcoding', 'dispatched', 'swapping'].includes(existing.status)) {
                stats.alreadyActive++;
              } else {
                stats.skipped++;
              }
            }
          } catch (err) {
            console.error(`Failed to analyse ${fullPath}:`, err);
          }

          // Emit progress every 10 files
          if (stats.total % 10 === 0) {
            broadcast('scan:progress', { sessionId, dir, checked: stats.total, queued: stats.enqueued, skipped: stats.skipped });
          }
        }
      }
    }
  };

  await scan(dir);
  activeScanControllers.delete(dir); // always clean up

  if (signal.aborted) {
    const msg = `Scan cancelled for "${path.basename(dir)}" (${stats.total} files processed before cancellation)`;
    console.log(`  ⛔ ${msg}`);
    broadcast('scan:summary', { sessionId, dir, recipe, ...stats, cancelled: true, message: msg });
    return;
  }

  const msg = `Scan complete for "${path.basename(dir)}": ${stats.enqueued} queued, ${stats.skipped} already optimized, ${stats.alreadyActive} in progress (${stats.total} total files found)`;
  console.log(`  📊 ${msg}`);
  // Update last_scan_at for the matching watched_path
  try {
    getDb().prepare('UPDATE watched_paths SET last_scan_at = ? WHERE path = ?').run(Math.floor(Date.now() / 1000), dir);
  } catch { /* non-critical */ }
  broadcast('scan:summary', { sessionId, dir, recipe, ...stats, message: msg });
}
