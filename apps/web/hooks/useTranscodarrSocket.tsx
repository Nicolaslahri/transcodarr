'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
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

  const apiUrl = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_MAIN_URL || `http://${window.location.hostname}:${window.location.port || 3001}`)
    : '';

  // ─── Accept / Reject actions ─────────────────────────────────────────────
  const acceptWorker = useCallback(async (id: string) => {
    const res = await fetch(`${apiUrl}/api/workers/${id}/accept`, { method: 'POST' });
    const updated = await res.json();
    setWorkers(prev => prev.map(w => w.id === id ? { ...w, ...updated } : w));
  }, [apiUrl]);

  const rejectWorker = useCallback(async (id: string) => {
    await fetch(`${apiUrl}/api/workers/${id}/reject`, { method: 'POST' });
    setWorkers(prev => prev.filter(w => w.id !== id));
  }, [apiUrl]);

  useEffect(() => {
    if (!apiUrl) return;

    // Fetch identity
    fetch(`${apiUrl}/api/meta`)
      .then(r => r.json())
      .then(data => setMeta(data))
      .catch(() => setMeta({ mode: 'main', name: 'Transcodarr', version: '1.0.0' }));

    // WebSocket
    const wsUrl = apiUrl.replace('http', 'ws') + '/ws';
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);

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
                // 🔔 Toast notification — the Fleet Commander moment
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
            setWorkers(prev => prev.map(w => w.id === data.id ? data : w));
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

    // Initial data fetch
    Promise.all([
      fetch(`${apiUrl}/api/workers`).then(r => r.json()),
      fetch(`${apiUrl}/api/jobs?limit=20`).then(r => r.json()),
      fetch(`${apiUrl}/api/jobs/stats`).then(r => r.json()),
    ]).then(([w, j, s]) => {
      setWorkers(w);
      setJobs(j);
      setStats(s);
    }).catch(() => {});

    return () => ws.close();
  }, [apiUrl]);

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
