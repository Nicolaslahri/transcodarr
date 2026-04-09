'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { WsEvent, DashboardStats, WorkerInfo, Job } from '@transcodarr/shared';

interface AppState {
  stats: DashboardStats;
  workers: WorkerInfo[];
  jobs: Job[];
  connected: boolean;
}

const SocketContext = createContext<AppState | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [stats, setStats] = useState<DashboardStats>({ jobsToday: 0, jobsTotal: 0, gbSaved: 0, workersOnline: 0, queueDepth: 0, activeJobs: 0 });
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    // We expect the Next config or env to provide the main server URL, default 3001 in dev
    const wsUrl = process.env.NEXT_PUBLIC_MAIN_URL 
      ? process.env.NEXT_PUBLIC_MAIN_URL.replace('http', 'ws') + '/ws'
      : `ws://${window.location.hostname}:3001/ws`;

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
            case 'worker:accepted':
                setWorkers(prev => {
                    const idx = prev.findIndex(w => w.id === data.id);
                    if (idx === -1) return [...prev, data];
                    const next = [...prev];
                    next[idx] = data;
                    return next;
                });
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
                    if (idx === -1) {
                        return prev; // We'd ideally fetch if not in state
                    }
                    const next = [...prev];
                    // Merge update (in full app, handle complete/failed state logic here)
                    next[idx] = { ...next[idx], ...data };
                    return next;
                });
                break;
        }
      } catch { /* ignore */ }
    };

    // Initial fetch
    const apiUrl = process.env.NEXT_PUBLIC_MAIN_URL || `http://${window.location.hostname}:3001`;
    Promise.all([
      fetch(`${apiUrl}/api/workers`).then(r => r.json()),
      fetch(`${apiUrl}/api/jobs?limit=20`).then(r => r.json()),
      fetch(`${apiUrl}/api/jobs/stats`).then(r => r.json()),
    ]).then(([w, j, s]) => {
      setWorkers(w);
      setJobs(j);
      setStats(s);
    }).catch(() => { /* handled gracefully */ });

    return () => ws.close();
  }, []);

  return (
    <SocketContext.Provider value={{ connected, stats, workers, jobs }}>
      {children}
    </SocketContext.Provider>
  );
}

export function useAppState() {
    const ctx = useContext(SocketContext);
    if (!ctx) throw new Error('useAppState must be used within SocketProvider');
    return ctx;
}
