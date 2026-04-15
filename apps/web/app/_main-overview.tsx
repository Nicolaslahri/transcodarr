'use client';

import { useAppState } from '@/hooks/useTranscodarrSocket';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { Activity, Cpu, HardDrive, Zap, ArrowRight, CheckCircle2, Clock, Thermometer, MemoryStick, Gauge } from 'lucide-react';
import type { GpuStats, WorkerInfo, Job } from '@transcodarr/shared';

interface SpeedStats {
  avgFpsAllTime: number;
  totalHoursTranscoded: number;
  totalGbSaved: number;
}

function lastSeenLabel(unixSec: number): string {
  const secs = Math.floor(Date.now() / 1000) - unixSec;
  if (secs < 5)   return 'just now';
  if (secs < 60)  return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

const PHASE_LABEL: Record<string, string> = {
  receiving:   'Downloading',
  transcoding: 'Transcoding',
  sending:     'Uploading',
  swapping:    'Swapping',
};

// Main node overview dashboard
export default function OverviewPage() {
  const { stats, connected, apiUrl, jobs, workers } = useAppState();
  const containerRef = useRef<HTMLDivElement>(null);
  const [speedStats, setSpeedStats] = useState<SpeedStats | null>(null);

  // Refresh speed stats whenever jobsTotal changes (a new completion) or on mount
  useEffect(() => {
    if (!apiUrl) return;
    fetch(`${apiUrl}/api/jobs/stats/speed`)
      .then(r => r.json())
      .then(setSpeedStats)
      .catch(() => {});
  }, [apiUrl, stats.jobsTotal]);

  // Tick every second so last-seen timestamps stay live
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.stat-card', { y: 20, opacity: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out' });
      gsap.utils.toArray<HTMLElement>('.stat-value').forEach((el) => {
        const end = parseFloat(el.dataset.value || '0');
        // Use a proxy object rather than setting innerText inside onUpdate to avoid hydration warnings
        const proxy = { val: 0 };
        gsap.to(proxy, {
          val: end, duration: 1.4, ease: 'power2.out',
          onUpdate() { el.innerText = end % 1 !== 0 ? proxy.val.toFixed(1) : Math.round(proxy.val).toString(); },
          onComplete() { el.innerText = end % 1 !== 0 ? end.toFixed(1) : end.toString(); }
        });
      });
    }, containerRef);
    return () => ctx.revert();
  }, [stats]);

  const recentJobs = jobs.filter(j => j.status === 'complete' || j.status === 'failed').slice(0, 5);
  const activeJobs = jobs.filter(j => ['dispatched', 'receiving', 'transcoding', 'sending', 'swapping'].includes(j.status));
  const queuedJobs = jobs.filter(j => j.status === 'queued');
  const totalQueueBar = (stats.queueDepth + stats.activeJobs) || 1;
  const acceptedWorkers = workers.filter(w => w.status !== 'pending');

  return (
    <div ref={containerRef} className="p-4 md:p-6 lg:p-10 max-w-7xl mx-auto space-y-6 lg:space-y-10">
      {/* Header */}
      <header className="flex justify-between items-start md:items-end gap-3">
        <div>
          <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-white mb-1">Overview</h1>
          <p className="text-textMuted text-sm">Monitor your fleet and transcoding queue.</p>
        </div>
        <div className="flex items-center gap-2 mt-1 md:mb-1 shrink-0">
          <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-sm text-textMuted">{connected ? 'Live' : 'Offline'}</span>
        </div>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5 stagger-list">
        <StatCard icon={<Activity className="text-primary w-5 h-5" />}    label="Jobs Today"     value={stats.jobsToday}    suffix="" />
        <StatCard icon={<HardDrive className="text-green-400 w-5 h-5" />} label="Space Saved"    value={stats.gbSaved}      suffix=" GB" />
        <StatCard icon={<Cpu className="text-purple-400 w-5 h-5" />}      label="Workers Online" value={stats.workersOnline} suffix="" />
        <StatCard icon={<Zap className="text-yellow-400 w-5 h-5" />}      label="Active Jobs"    value={stats.activeJobs}   suffix="" />
      </div>

      {/* Queue depth bar */}
      {(stats.queueDepth > 0 || stats.activeJobs > 0) && (
        <div className="card-hover bg-surface border border-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-white">Queue Status</h2>
            <span className="text-xs text-textMuted">{stats.activeJobs} active · {stats.queueDepth} waiting</span>
          </div>
          <div className="h-2 bg-background rounded-full overflow-hidden flex">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${(stats.activeJobs / totalQueueBar) * 100}%` }}
            />
            <div
              className="h-full bg-primary/20 transition-all duration-500"
              style={{ width: `${(stats.queueDepth / totalQueueBar) * 100}%` }}
            />
          </div>
          <div className="flex gap-4 mt-2 text-xs text-textMuted">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-primary inline-block" /> Active</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-primary/20 inline-block" /> Queued</span>
          </div>
        </div>
      )}

      {/* Active worker encode cards */}
      {acceptedWorkers.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-white">Fleet</h2>
            <a href="/workers" className="flex items-center gap-1 text-xs text-textMuted hover:text-primary transition-colors">
              Manage <ArrowRight className="w-3 h-3" />
            </a>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4 stagger-list">
            {acceptedWorkers.map(w => {
              const activeJob = activeJobs.find(j => j.workerId === w.id);
              return <WorkerCard key={w.id} worker={w} activeJob={activeJob ?? null} />;
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
        {/* Recent Activity */}
        <div className="card-hover bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="font-bold text-white text-sm">Recent Activity</h2>
            <a href="/queue" className="flex items-center gap-1 text-xs text-textMuted hover:text-primary transition-colors">
              View all <ArrowRight className="w-3 h-3" />
            </a>
          </div>
          <div className="divide-y divide-border stagger-list">
            {recentJobs.length === 0 && (
              <div className="px-6 py-8 text-center text-textMuted text-sm">No completed jobs yet</div>
            )}
            {recentJobs.map(job => (
              <div key={job.id} className="px-6 py-3.5 flex items-center gap-4">
                {job.status === 'complete'
                  ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  : <Clock className="w-4 h-4 text-red-400 shrink-0" />
                }
                <span className="flex-1 text-sm text-white truncate">{job.fileName}</span>
                {job.status === 'complete' && job.sizeBefore && job.sizeAfter ? (
                  <span className="text-xs text-green-400">
                    -{Math.round((1 - job.sizeAfter / job.sizeBefore) * 100)}%
                  </span>
                ) : (
                  <span className="text-xs text-red-400">{job.status}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Performance stats */}
        <div className="card-hover bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border">
            <h2 className="font-bold text-white text-sm">Performance</h2>
          </div>
          <div className="divide-y divide-border stagger-list">
            <PerfRow
              icon={<Gauge className="w-4 h-4 text-primary" />}
              label="Avg Encode Speed"
              value={speedStats?.avgFpsAllTime ? `${speedStats.avgFpsAllTime} fps` : '—'}
            />
            <PerfRow
              icon={<Clock className="w-4 h-4 text-purple-400" />}
              label="Total Hours Transcoded"
              value={speedStats?.totalHoursTranscoded != null ? `${speedStats.totalHoursTranscoded} h` : '—'}
            />
            <PerfRow
              icon={<HardDrive className="w-4 h-4 text-green-400" />}
              label="Total Space Saved"
              value={speedStats?.totalGbSaved != null ? `${speedStats.totalGbSaved} GB` : '—'}
            />
            <PerfRow
              icon={<Activity className="w-4 h-4 text-yellow-400" />}
              label="Total Jobs Completed"
              value={stats.jobsTotal > 0 ? `${stats.jobsTotal}` : '—'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Worker Card ──────────────────────────────────────────────────────────────

function WorkerCard({ worker, activeJob }: { worker: WorkerInfo; activeJob: Job | null }) {
  const isActive = worker.status === 'active' || !!activeJob;
  const phase = worker.currentPhase ?? activeJob?.phase;
  const progress = worker.currentProgress ?? activeJob?.progress ?? 0;
  const fps = worker.currentFps ?? activeJob?.fps;
  const eta = activeJob?.eta;
  const phaseLabel = phase ? (PHASE_LABEL[phase] ?? phase) : (isActive ? 'Working…' : 'Idle');
  const fileName = activeJob?.fileName;

  return (
    <div className={`card-hover bg-surface border rounded-2xl p-5 ${
      isActive ? 'border-primary/40 worker-active' : 'border-border'
    }`}>
      {/* Worker name + status */}
      <div className="flex items-center gap-3 mb-4">
        <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
          isActive ? 'bg-primary animate-pulse' :
          worker.status === 'idle' ? 'bg-green-400' :
          worker.status === 'offline' ? 'bg-red-400' : 'bg-yellow-400'
        }`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{worker.name}</p>
          <p className="text-xs text-textMuted truncate">{worker.hardware.gpuName}</p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
          isActive ? 'bg-primary/10 text-primary' :
          worker.status === 'idle' ? 'bg-green-500/10 text-green-400' :
          'bg-white/5 text-textMuted'
        }`}>{phaseLabel}</span>
      </div>

      {/* Active job progress */}
      {isActive && (
        <div className="mb-4">
          {fileName && (
            <p className="text-xs text-textMuted mb-2 truncate" title={fileName}>{fileName}</p>
          )}
          <div className="flex items-center gap-2 mb-1">
            <div className="flex-1 h-1.5 bg-background rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-white font-medium tabular-nums w-9 text-right">{progress}%</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-textMuted">
            {fps != null && <span>{fps.toFixed(1)} fps</span>}
            {eta != null && eta > 0 && <span>ETA {formatEta(eta)}</span>}
          </div>
        </div>
      )}

      {/* GPU stats (NVIDIA only) */}
      {worker.gpuStats ? (
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border">
          <GpuMetric
            icon={<Gauge className="w-3 h-3" />}
            label="GPU"
            value={`${worker.gpuStats.utilPct}%`}
          />
          <GpuMetric
            icon={<Thermometer className="w-3 h-3" />}
            label="Temp"
            value={`${worker.gpuStats.tempC}°C`}
            heat={worker.gpuStats.tempC}
          />
          <GpuMetric
            icon={<MemoryStick className="w-3 h-3" />}
            label="VRAM"
            value={`${Math.round(worker.gpuStats.vramUsedMB / 1024 * 10) / 10}/${Math.round(worker.gpuStats.vramTotalMB / 1024)} GB`}
          />
        </div>
      ) : (
        !isActive && (
          <div className="pt-3 border-t border-border text-xs text-textMuted/50 text-center">
            No GPU metrics
          </div>
        )
      )}

      {/* Last seen */}
      {worker.lastSeen > 0 && (
        <p className="text-xs text-textMuted/40 text-right mt-2">
          {lastSeenLabel(worker.lastSeen)}
        </p>
      )}
    </div>
  );
}

function GpuMetric({ icon, label, value, heat }: { icon: React.ReactNode; label: string; value: string; heat?: number }) {
  const tempColor = heat != null
    ? heat >= 90 ? 'text-red-400'
    : heat >= 80 ? 'text-amber-400'
    : 'text-textMuted'
    : 'text-textMuted';

  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`${tempColor}`}>{icon}</span>
      <span className={`text-xs font-medium ${heat != null ? tempColor : 'text-white'}`}>{value}</span>
      <span className="text-xs text-textMuted/60">{label}</span>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function PerfRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="px-6 py-3.5 flex items-center gap-3">
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-sm text-textMuted">{label}</span>
      <span className="text-sm font-semibold text-white">{value}</span>
    </div>
  );
}

function StatCard({ icon, label, value, suffix }: { icon: React.ReactNode; label: string; value: number; suffix: string }) {
  return (
    <div className="stat-card card-hover bg-surface border border-border rounded-2xl p-4 md:p-5 flex items-start gap-3 md:gap-4">
      <div className="p-2 md:p-2.5 bg-background rounded-xl border border-border/50 shrink-0">{icon}</div>
      <div>
        <p className="text-xs text-textMuted font-medium mb-1">{label}</p>
        <p className="text-2xl md:text-3xl font-bold text-white flex items-baseline gap-1">
          <span className="stat-value" data-value={value}>{value}</span>
          {suffix && <span className="text-sm md:text-base text-textMuted font-normal">{suffix}</span>}
        </p>
      </div>
    </div>
  );
}
