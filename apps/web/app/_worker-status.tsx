'use client';

import { useAppState } from '@/hooks/useTranscodarrSocket';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Cpu, Wifi, Activity, Thermometer, Zap, Film } from 'lucide-react';

interface WorkerStatus {
  workerId: string;
  hardware: any;
  currentJob: { jobId: string; fileName: string; progress: number; fps?: number } | null;
}

export default function WorkerStatusPage() {
  const { meta, connected } = useAppState();
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const apiUrl = typeof window !== 'undefined'
      ? `http://${window.location.hostname}:${window.location.port || 3001}`
      : '';

    const poll = async () => {
      try {
        const r = await fetch(`${apiUrl}/status`);
        const data = await r.json();
        setStatus(data);
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from('.worker-card', { y: 24, opacity: 0, duration: 0.6, stagger: 0.1, ease: 'power3.out' });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  const hw = status?.hardware ?? meta.hardware;
  const job = status?.currentJob;
  const isIdle = !job;

  return (
    <div ref={containerRef} className="p-10 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="worker-card flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
            <Zap className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">{meta.name || 'Worker Node'}</h1>
            <p className="text-textMuted text-sm">Transcoding Worker</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-2.5 bg-surface rounded-xl border border-border">
          <Wifi className={`w-4 h-4 ${connected ? 'text-green-400' : 'text-red-400'}`} />
          <span className="text-sm text-textMuted">
            {connected ? `Main Node · ${meta.mainUrl ?? 'connected'}` : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Current Job */}
      <div className="worker-card bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Film className="w-4 h-4 text-textMuted" />
            <h2 className="text-sm font-bold text-white">Current Job</h2>
          </div>
          <span className={`px-3 py-1 text-xs font-bold rounded-full border ${
            isIdle
              ? 'bg-background text-textMuted border-border'
              : 'bg-primary/10 text-primary border-primary/20'
          }`}>
            {isIdle ? 'IDLE' : 'TRANSCODING'}
          </span>
        </div>

        <div className="p-6">
          {isIdle ? (
            <div className="h-20 flex items-center justify-center">
              <p className="text-textMuted text-sm">Waiting for a job from Main Node…</p>
            </div>
          ) : (
            <div>
              <p className="text-white font-semibold mb-0.5 truncate text-lg">{job?.fileName}</p>
              {job?.fps && <p className="text-textMuted text-xs mb-5 font-mono">{job.fps} FPS</p>}

              {/* Animated progress bar */}
              <div className="h-2.5 bg-background rounded-full overflow-hidden border border-border mb-3">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-1000 ease-out relative overflow-hidden"
                  style={{ width: `${job?.progress ?? 0}%` }}
                >
                  {/* Shimmer */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_2s_infinite]" />
                </div>
              </div>
              <div className="flex justify-between text-xs text-textMuted">
                <span className="font-mono">{job?.progress ?? 0}%</span>
                <span>Transcoding…</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Hardware */}
      {hw && (
        <div className="worker-card bg-surface border border-border rounded-2xl p-6">
          <h2 className="text-xs font-bold uppercase tracking-widest text-textMuted mb-5">Hardware Profile</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <HardwareStat icon={<Cpu className="w-4 h-4 text-primary" />}        label="GPU"      value={hw.gpuName ?? 'Unknown'} />
            <HardwareStat icon={<Activity className="w-4 h-4 text-green-400" />} label="Encoders" value={hw.encoders?.length ? hw.encoders.slice(0, 3).join(' · ') : 'CPU only'} />
            <HardwareStat icon={<Thermometer className="w-4 h-4 text-yellow-400" />} label="Vendor" value={(hw.gpu ?? 'cpu').toUpperCase()} />
          </div>

          {/* Encoder badges */}
          <div className="flex flex-wrap gap-2 mt-5">
            {hw.encoders?.some((e: string) => e.includes('nvenc'))  && <Badge label="NVENC"      color="green"  />}
            {hw.encoders?.some((e: string) => e.includes('av1'))    && <Badge label="AV1"        color="purple" />}
            {hw.encoders?.some((e: string) => e.includes('amf'))    && <Badge label="AMD AMF"    color="red"    />}
            {hw.encoders?.some((e: string) => e.includes('qsv'))    && <Badge label="QuickSync"  color="blue"   />}
            {(!hw.encoders || hw.encoders.length === 0)             && <Badge label="CPU Only"   color="gray"   />}
          </div>
        </div>
      )}
    </div>
  );
}

function HardwareStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-background rounded-xl p-4 border border-border/50">
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-textMuted font-medium uppercase tracking-wider">{label}</span></div>
      <p className="text-white font-medium text-sm truncate" title={value}>{value}</p>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: 'green' | 'purple' | 'red' | 'blue' | 'gray' }) {
  const styles = {
    green:  'bg-green-900/30 text-green-400 border-green-500/30',
    purple: 'bg-purple-900/30 text-purple-400 border-purple-500/30',
    red:    'bg-red-900/30 text-red-400 border-red-500/30',
    blue:   'bg-blue-900/30 text-blue-400 border-blue-500/30',
    gray:   'bg-background text-textMuted border-border',
  };
  return (
    <span className={`px-3 py-1 text-xs font-bold rounded-full border ${styles[color]}`}>{label}</span>
  );
}
