'use client';

import { createContext, useContext, useEffect, useRef, useState, ReactNode, useCallback } from 'react';
import type { WsEvent, DashboardStats, WorkerInfo, Job } from '@transcodarr/shared';
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
  acceptWorker: (id: string) => Promise<void>;
  rejectWorker: (id: string) => Promise<void>;
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

  // The URL we actually talk to (may switch from worker port → main port)
  const localUrl = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_MAIN_URL || `http://${window.location.hostname}:${window.location.port || 3001}`)
    : '';
  const [apiUrl, setApiUrl] = useState(localUrl);
  const wsRef = useRef<WebSocket | null>(null);

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

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 5s
      setTimeout(() => {
        if (wsRef.current === ws) connectTo(targetUrl);
      }, 5000);
    };

    ws.onmessage = (msg) => {
      try {
        const { event, data } = JSON.parse(msg.data) as WsEvent<any>;
        switch (event) {
          case 'stats:update':
            setStats(data);
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
          case 'worker:offline':
            setWorkers(prev => prev.filter(w => w.id !== data.id));
            break;
          case 'job:queued':
            setJobs(prev => [data, ...prev]);
            break;
          case 'job:progress':
          case 'job:complete':
          case 'job:failed':
            setJobs(prev => {
              const idx = prev.findIndex(j => j.id === data.jobId);
              if (idx === -1) return prev;
              const next = [...prev];
              next[idx] = { ...next[idx], ...data };
              return next;
            });
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
  useEffect(() => {
    if (!localUrl) return;

    fetch(`${localUrl}/api/meta`)
      .then(r => r.json())
      .then((data: AppMeta) => {
        setMeta(data);
        // If this port is a Worker, transparently redirect all API/WS calls to Main
        if (data.mode === 'worker' && data.mainUrl) {
          const mainTarget = data.mainUrl.replace(/\/$/, '');
          setApiUrl(mainTarget);
          connectTo(mainTarget);
        } else {
          setApiUrl(localUrl);
          connectTo(localUrl);
        }
      })
      .catch(() => {
        setMeta({ mode: 'main', name: 'Transcodarr', version: '1.0.0' });
        setApiUrl(localUrl);
        connectTo(localUrl);
      });

    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localUrl]);

  return (
    <SocketContext.Provider value={{ meta, connected, stats, workers, jobs, apiUrl, acceptWorker, rejectWorker }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(SocketContext);
  if (!ctx) throw new Error('useAppState must be used within SocketProvider');
  return ctx;
}
