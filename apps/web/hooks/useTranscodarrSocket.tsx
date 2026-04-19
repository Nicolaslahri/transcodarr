'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from 'react';
import type { WsMessage, DashboardStats, WorkerInfo, Job } from '@transcodarr/shared';
import { useToast } from './useToast';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppMode = 'main' | 'worker' | 'loading' | 'loading_setup';

export interface AppMeta {
  mode: AppMode;
  name: string;
  version: string;
  hardware?: any;
  mainUrl?: string;
}

interface AppState {
  meta: AppMeta;
  stats: DashboardStats;
  workers: WorkerInfo[];
  jobs: Job[];
  connected: boolean;
  apiUrl: string;
  scanSummary: ScanSummary | null;
  scanProgress: ScanProgress | null;
  acceptWorker: (id: string) => Promise<void>;
  rejectWorker: (id: string) => Promise<void>;
}

export interface ScanSummary {
  dir: string;
  recipe: string;
  enqueued: number;
  skipped: number;
  alreadyActive: number;
  total: number;
  message: string;
  error?: string;
}

export interface ScanProgress {
  sessionId: string;
  dir: string;
  checked: number;
  queued: number;
  skipped: number;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const SocketContext = createContext<AppState | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { addToast } = useToast();
  const [meta, setMeta] = useState<AppMeta>({ mode: 'loading', name: '', version: '' });
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({ jobsToday: 0, jobsTotal: 0, gbSaved: 0, workersOnline: 0, queueDepth: 0, activeJobs: 0 });
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [scanSummary, setScanSummary] = useState<ScanSummary | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);

  // The URL we actually talk to (may switch from worker port → main port)
  const localUrl = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_MAIN_URL || `http://${window.location.hostname}:${window.location.port || 3001}`)
    : '';
  const [apiUrl, setApiUrl] = useState(localUrl);
  const wsRef = useRef<WebSocket | null>(null);
  const metaRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Exponential backoff state for WS reconnects — resets to 1 s on each successful open.
  const wsReconnectDelayRef = useRef(1_000);

  // ─── Accept / Reject ──────────────────────────────────────────────────────
  const acceptWorker = useCallback(async (id: string) => {
    const res = await fetch(`${apiUrl}/api/workers/${id}/accept`, { method: 'POST' });
    const updated = await res.json();
    setWorkers(prev => prev.map(w => w.id === id ? { ...w, ...updated } : w));
  }, [apiUrl]);

  const rejectWorker = useCallback(async (id: string) => {
    await fetch(`${apiUrl}/api/workers/${id}/reject`, { method: 'POST' });
    setWorkers(prev => prev.filter(w => w.id !== id));
  }, [apiUrl]);

  // ─── Connect to a specific URL ────────────────────────────────────────────
  const connectTo = useCallback((targetUrl: string) => {
    // Close any existing connection
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const wsUrl = targetUrl.replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      wsReconnectDelayRef.current = 1_000; // reset backoff on successful connection
    };
    ws.onclose = () => {
      setConnected(false);
      // Exponential backoff: 1 s → 2 s → 4 s … up to 30 s, with ±20 % jitter.
      const base  = wsReconnectDelayRef.current;
      const jitter = base * 0.2 * (Math.random() * 2 - 1); // ±20 %
      const delay  = Math.round(base + jitter);
      wsReconnectDelayRef.current = Math.min(base * 2, 30_000);
      setTimeout(() => {
        if (wsRef.current === ws) connectTo(targetUrl);
      }, delay);
    };

    ws.onmessage = (msg) => {
      try {
        const { event, data } = JSON.parse(msg.data) as WsMessage;
        switch (event) {
          case 'stats:update':
            // Merge instead of replace — backend may omit fields we derive locally
            setStats(prev => ({ ...prev, ...data }));
            break;
          case 'worker:discovered':
            setWorkers(prev => {
              const exists = prev.find(w => w.id === data.id);
              if (!exists) {
                addToast({
                  type: 'worker-discovered',
                  title: 'New Hardware Detected',
                  message: `${data.name} · ${data.hardware?.gpuName ?? 'unknown GPU'}`,
                  workerId: data.id,
                  onAccept: () => acceptWorker(data.id),
                  onReject: () => rejectWorker(data.id),
                });
                return [...prev, data];
              }
              return prev.map(w => w.id === data.id ? data : w);
            });
            break;
          case 'worker:accepted':
          case 'worker:updated':
            setWorkers(prev => prev.map(w => w.id === data.id ? { ...w, ...data } : w));
            break;
          case 'worker:progress':
            setWorkers(prev => prev.map(w =>
              w.id === data.workerId
                ? { ...w, currentProgress: data.progress, currentFps: data.fps, currentPhase: data.phase as import('@transcodarr/shared').TransferPhase | undefined }
                : w,
            ));
            break;
          case 'worker:stats':
            setWorkers(prev => prev.map(w =>
              w.id === data.workerId
                ? { ...w, gpuStats: data.gpuStats }
                : w,
            ));
            break;
          case 'worker:offline':
            setWorkers(prev => prev.filter(w => w.id !== data.id));
            break;
          case 'job:queued':
            setJobs(prev => {
              const idx = prev.findIndex(j => j.id === data.id);
              if (idx !== -1) {
                // Job was re-queued (e.g. after resume) — update in-place so the
                // old card is replaced rather than duplicated.
                const next = [...prev];
                next[idx] = { ...next[idx], ...data };
                return next;
              }
              return [data, ...prev];
            });
            break;
          case 'job:paused':
            // Job was paused — update in-place (was transcoding, now paused)
            setJobs(prev => {
              const idx = prev.findIndex(j => j.id === data.id);
              if (idx === -1) return prev;
              const next = [...prev];
              next[idx] = { ...next[idx], ...data };
              return next;
            });
            break;
          case 'job:removed':
            setJobs(prev => prev.filter(j => j.id !== data.id));
            break;
          case 'job:cleared':
            setJobs(prev => prev.filter(j => ['transcoding', 'dispatched', 'receiving', 'sending', 'swapping'].includes(j.status)));
            break;
          case 'job:progress':
          case 'job:complete':
          case 'job:failed': {
            // Combined fallthrough — use `d` as any since TypeScript can't narrow across cases
            const d = data as any;
            // Browser notification when tab is not focused
            if (event === 'job:complete' || event === 'job:failed') {
              const notifEnabled = typeof localStorage !== 'undefined'
                ? localStorage.getItem('transcodarr:notifications') !== 'off'
                : true;
              if (notifEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                const title = event === 'job:complete' ? 'Transcode complete' : 'Transcode failed';
                const body  = d.fileName ?? (event === 'job:complete' ? 'Job finished successfully' : 'A job encountered an error');
                new Notification(title, { body, icon: '/favicon.ico', tag: d.jobId });
              }
            }
            // In-app toast for job completion/failure
            if (event === 'job:complete') {
              addToast({ type: 'success', title: 'Transcode complete', message: d.fileName ?? 'Job finished' });
            } else if (event === 'job:failed') {
              addToast({ type: 'error', title: 'Transcode failed', message: d.fileName ?? 'A job encountered an error' });
            }
            setJobs(prev => {
              const idx = prev.findIndex(j => j.id === (d.jobId ?? d.id));
              if (idx === -1) return prev;
              const next = [...prev];
              // Map progress-event fields → Job fields
              next[idx] = {
                ...next[idx],
                ...(d.progress   !== undefined ? { progress:   d.progress   } : {}),
                ...(d.fps        !== undefined ? { fps:        d.fps        } : {}),
                ...(d.eta        !== undefined ? { eta:        d.eta        } : {}),
                ...(d.phase      !== undefined ? { phase:      d.phase      } : {}),
                ...(d.status     !== undefined ? { status:     d.status     } : {}),
                ...(d.workerName !== undefined ? { workerName: d.workerName } : {}),
                ...(d.sizeBefore !== undefined ? { sizeBefore: d.sizeBefore } : {}),
                ...(d.sizeAfter  !== undefined ? { sizeAfter:  d.sizeAfter  } : {}),
                ...(d.error      !== undefined ? { error:      d.error      } : {}),
                // job:complete resets phase
                ...(event === 'job:complete' ? { phase: undefined, progress: 100, status: 'complete' as const } : {}),
                ...(event === 'job:failed'   ? { phase: undefined, status: 'failed' as const }                  : {}),
              };
              return next;
            });
            break;
          }
          case 'scan:progress':
            setScanProgress(data);
            break;
          case 'scan:summary':
            setScanSummary(data);
            setScanProgress(null); // clear in-progress banner on completion
            break;
          case 'system:warning':
            addToast({ type: 'warning', title: 'Warning', message: data.message });
            break;
        }
      } catch { /* ignore */ }
    };

    // Fetch initial data
    Promise.all([
      fetch(`${targetUrl}/api/workers`).then(r => r.json()),
      fetch(`${targetUrl}/api/jobs?limit=20`).then(r => r.json()),
      fetch(`${targetUrl}/api/jobs/stats`).then(r => r.json()),
    ]).then(([w, j, s]) => {
      setWorkers(w);
      setJobs(j);
      setStats(s);
    }).catch(() => {});
  }, [addToast, acceptWorker, rejectWorker]);

  // ─── Boot: detect mode, possibly redirect to main ─────────────────────────
  const fetchMeta = useCallback((url: string) => {
    fetch(`${url}/api/meta`)
      .then(r => r.json())
      .then((data: AppMeta) => {
        if (metaRetryRef.current) { clearTimeout(metaRetryRef.current); metaRetryRef.current = null; }
        setMeta(data);
        if (data.mode === 'worker' && data.mainUrl) {
          const mainTarget = data.mainUrl.replace(/\/$/, '');
          setApiUrl(mainTarget);
          connectTo(mainTarget);
        } else {
          setApiUrl(url);
          connectTo(url);
        }
      })
      .catch(() => {
        // Server not ready yet (restarting after reset/setup).
        // NEVER default to mode:'main' — that would dismiss the setup wizard.
        // Stay in 'loading' and retry every 2s until we get a real response.
        metaRetryRef.current = setTimeout(() => fetchMeta(url), 2000);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectTo]);

  useEffect(() => {
    if (!localUrl) return;
    fetchMeta(localUrl);
    return () => {
      if (metaRetryRef.current) clearTimeout(metaRetryRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localUrl]);

  return (
    <SocketContext.Provider value={{ meta, connected, stats, workers, jobs, apiUrl, scanSummary, scanProgress, acceptWorker, rejectWorker }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useAppState must be used within SocketProvider');
  return ctx;
}
