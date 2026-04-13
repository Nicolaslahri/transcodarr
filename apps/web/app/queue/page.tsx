'use client';

import { useAppState, type ScanSummary } from '@/hooks/useTranscodarrSocket';
import { Film, CheckCircle2, XCircle, AlertTriangle, Trash2, ArrowRight, Clock, Zap, ArrowDownToLine, Upload, RefreshCw, Timer } from 'lucide-react';
import type { Job } from '@transcodarr/shared';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { BUILT_IN_RECIPES } from '@transcodarr/shared';

// ─── Codec helper ─────────────────────────────────────────────────────────────

const CODEC_LABELS: Record<string, string> = {
  hevc: 'H.265', h264: 'H.264', h265: 'H.265', avc: 'H.264',
  vp9: 'VP9', av1: 'AV1', mpeg4: 'MPEG-4', mpeg2video: 'MPEG-2',
};

function codecLabel(raw?: string): string {
  if (!raw) return '?';
  return CODEC_LABELS[raw.toLowerCase()] ?? raw.toUpperCase();
}

function targetCodecLabel(recipe: string): string {
  const r = BUILT_IN_RECIPES.find(x => x.id === recipe);
  if (!r) return '?';
  return CODEC_LABELS[r.targetCodec] ?? r.targetCodec.toUpperCase();
}

function formatEta(etaMs: number): string {
  const secs = Math.max(0, Math.round((etaMs - Date.now()) / 1000));
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ─── Phase config ─────────────────────────────────────────────────────────────

const PHASE_CONFIG: Record<string, {
  label: string;
  Icon: React.FC<{ className?: string }>;
  accent: string;
  border: string;
  barBg: string;
  chip: string;
  sortPriority: number; // lower = shown first
}> = {
  transcoding: { label: 'Transcoding',       Icon: Zap,             accent: 'text-primary',     border: 'border-l-primary/70',        barBg: 'bg-primary',    chip: 'bg-primary/10 border-primary/30 text-primary',          sortPriority: 0 },
  receiving:   { label: 'Downloading File',  Icon: ArrowDownToLine, accent: 'text-sky-400',     border: 'border-l-sky-500/60',        barBg: 'bg-sky-400',    chip: 'bg-sky-500/10 border-sky-500/30 text-sky-400',          sortPriority: 1 },
  sending:     { label: 'Uploading Result',  Icon: Upload,          accent: 'text-violet-400',  border: 'border-l-violet-500/60',     barBg: 'bg-violet-400', chip: 'bg-violet-500/10 border-violet-500/30 text-violet-400', sortPriority: 2 },
  swapping:    { label: 'Finishing Up',      Icon: RefreshCw,       accent: 'text-orange-400',  border: 'border-l-orange-500/60',     barBg: 'bg-orange-400', chip: 'bg-orange-500/10 border-orange-500/30 text-orange-400', sortPriority: 3 },
  dispatched:  { label: 'Ready to Dispatch', Icon: Timer,           accent: 'text-yellow-400',  border: 'border-l-yellow-500/40',     barBg: 'bg-yellow-500', chip: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400', sortPriority: 4 },
  queued:      { label: 'Queued',            Icon: Clock,           accent: 'text-blue-400',    border: 'border-l-blue-500/40',       barBg: 'bg-blue-500',   chip: 'bg-blue-500/10 border-blue-500/30 text-blue-400',       sortPriority: 5 },
};

// ─── Scan Summary Banner ───────────────────────────────────────────────────────

function ScanBanner({ summary, onDismiss }: { summary: ScanSummary; onDismiss: () => void }) {
  const isError = !!summary.error;
  return (
    <div className={`flex items-start gap-4 p-4 rounded-xl border ${
      isError ? 'bg-red-500/10 border-red-500/30' : 'bg-primary/10 border-primary/30'
    }`}>
      <div className={`p-2 rounded-lg shrink-0 ${isError ? 'bg-red-500/20' : 'bg-primary/20'}`}>
        {isError ? <AlertTriangle className="w-5 h-5 text-red-400" /> : <Film className="w-5 h-5 text-primary" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white font-semibold text-sm">
          {isError ? 'Scan Failed' : `Scan Complete — "${summary.dir.split(/[\\/]/).pop()}"`}
        </p>
        <p className="text-textMuted text-xs mt-0.5">{summary.error ?? summary.message}</p>
        {!isError && (
          <div className="flex items-center gap-4 mt-2">
            <span className="text-xs flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-primary inline-block" />
              <span className="text-white font-medium">{summary.enqueued}</span>
              <span className="text-textMuted">queued</span>
            </span>
            <span className="text-xs flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              <span className="text-white font-medium">{summary.skipped}</span>
              <span className="text-textMuted">already optimized</span>
            </span>
            {summary.alreadyActive > 0 && (
              <span className="text-xs flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
                <span className="text-white font-medium">{summary.alreadyActive}</span>
                <span className="text-textMuted">in progress</span>
              </span>
            )}
          </div>
        )}
      </div>
      <button onClick={onDismiss} className="p-1.5 hover:bg-white/10 rounded-lg text-textMuted hover:text-white transition-colors shrink-0">
        <XCircle className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Live Summary Strip ───────────────────────────────────────────────────────

function LiveStrip({ jobs }: { jobs: Job[] }) {
  const active    = jobs.filter(j => ['receiving', 'transcoding', 'sending', 'swapping'].includes(j.phase ?? j.status));
  const queued    = jobs.filter(j => j.status === 'queued' || j.status === 'dispatched');
  const completed = jobs.filter(j => j.status === 'complete');
  const savedBytes = completed.reduce((acc, j) => acc + ((j.sizeBefore ?? 0) - (j.sizeAfter ?? 0)), 0);
  const savedGb = (savedBytes / 1e9).toFixed(2);

  if (jobs.length === 0) return null;

  return (
    <div className="flex items-center gap-6 px-5 py-3 bg-surface border border-border rounded-xl text-xs">
      <span className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full ${active.length > 0 ? 'bg-primary animate-pulse' : 'bg-border'}`} />
        <span className={active.length > 0 ? 'text-primary font-semibold' : 'text-textMuted'}>{active.length} active</span>
      </span>
      <span className="flex items-center gap-1.5 text-textMuted">
        <span className="w-2 h-2 rounded-full bg-yellow-400/60" />
        {queued.length} queued
      </span>
      <span className="flex items-center gap-1.5 text-textMuted">
        <span className="w-2 h-2 rounded-full bg-green-500/60" />
        {completed.length} done
      </span>
      {parseFloat(savedGb) > 0 && (
        <span className="ml-auto text-green-400 font-semibold">{savedGb} GB saved</span>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QueuePage() {
  const { jobs, scanSummary, apiUrl } = useAppState();
  const [localScan, setLocalScan] = useState<ScanSummary | null>(null);

  useEffect(() => { if (scanSummary) setLocalScan(scanSummary); }, [scanSummary]);

  const activeJobs = jobs
    .filter(j => ['queued', 'dispatched', 'receiving', 'transcoding', 'sending', 'swapping'].includes(j.status))
    .sort((a, b) => {
      const pa = PHASE_CONFIG[a.phase ?? a.status]?.sortPriority ?? 99;
      const pb = PHASE_CONFIG[b.phase ?? b.status]?.sortPriority ?? 99;
      return pa - pb;
    });
  const completedJobs = jobs.filter(j => j.status === 'complete');
  const failedJobs    = jobs.filter(j => j.status === 'failed');

  const clearHistory = () => fetch(`${apiUrl}/api/jobs`, { method: 'DELETE' });
  const retryAll     = () => fetch(`${apiUrl}/api/jobs/retry-all`, { method: 'POST' });
  const removeJob    = (id: string) => fetch(`${apiUrl}/api/jobs/${id}`, { method: 'DELETE' });

  const canClear = completedJobs.length > 0 || failedJobs.length > 0;

  return (
    <div className="p-10 max-w-7xl mx-auto space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white mb-2">Queue</h1>
          <p className="text-textMuted">Active transcodes and processing history.</p>
        </div>
        {canClear && (
          <button
            onClick={clearHistory}
            className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-xl text-textMuted hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5 transition-all text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" />
            Clear History
          </button>
        )}
      </header>

      <LiveStrip jobs={jobs} />

      {localScan && <ScanBanner summary={localScan} onDismiss={() => setLocalScan(null)} />}

      {/* Active & Queued */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-textMuted mb-3">
          Active Processing ({activeJobs.length})
        </h2>
        <div className="space-y-2">
          {activeJobs.length === 0 ? (
            <div className="p-6 bg-surface border border-border border-dashed rounded-xl text-center text-textMuted text-sm">
              No active jobs. Add a folder in Settings to get started.
            </div>
          ) : (
            activeJobs.map(job => <JobRow key={job.id} job={job} onRemove={() => removeJob(job.id)} />)
          )}
        </div>
      </section>

      {failedJobs.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold uppercase tracking-widest text-red-400/70">
              Failed ({failedJobs.length})
            </h2>
            <button
              onClick={retryAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 hover:text-white border border-red-500/20 hover:border-red-500/40 hover:bg-red-500/10 rounded-lg transition-all"
            >
              <RefreshCw className="w-3 h-3" />
              Retry All
            </button>
          </div>
          <div className="space-y-2">
            {failedJobs.map(job => <FailedJobRow key={job.id} job={job} onRemove={() => removeJob(job.id)} onRetry={() => fetch(`${apiUrl}/api/jobs/${job.id}/retry`, { method: 'POST' })} />)}
          </div>
        </section>
      )}

      {completedJobs.length > 0 && (
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-textMuted mb-3">
            Completed ({completedJobs.length})
          </h2>
          <div className="space-y-1.5">
            {completedJobs.slice(0, 10).map(job => <CompletedJobRow key={job.id} job={job} onRemove={() => removeJob(job.id)} />)}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Job Row ──────────────────────────────────────────────────────────────────

function ConversionBadge({ job }: { job: Job }) {
  const from = codecLabel(job.codecIn);
  const to   = targetCodecLabel(job.recipe);
  const same = from.toLowerCase() === to.toLowerCase();
  if (same) return null; // suppress confusing same-codec badge on active jobs
  return (
    <div className="flex items-center gap-1 text-[10px] font-mono shrink-0">
      <span className="px-1.5 py-0.5 rounded border bg-background border-border text-textMuted">{from}</span>
      <ArrowRight className="w-3 h-3 text-textMuted" />
      <span className="px-1.5 py-0.5 rounded border bg-primary/10 border-primary/20 text-primary">{to}</span>
    </div>
  );
}

function JobRow({ job, onRemove }: { job: Job; onRemove: () => void }) {
  const phaseKey = job.phase ?? job.status;
  const cfg = PHASE_CONFIG[phaseKey] ?? PHASE_CONFIG['dispatched'];
  const { Icon } = cfg;

  const isProcessing = ['receiving', 'transcoding', 'sending', 'swapping'].includes(phaseKey);
  const waveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isProcessing || !waveRef.current) return;
    const bars = waveRef.current.children;
    const ctx  = gsap.context(() => {
      gsap.to(bars, { scaleY: 1, duration: 0.4, stagger: { each: 0.1, repeat: -1, yoyo: true }, ease: 'sine.inOut' });
    }, waveRef);
    return () => ctx.revert();
  }, [isProcessing]);

  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!job.eta) return;
    const id = setInterval(() => forceUpdate(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [job.eta]);

  const canRemove = !['transcoding', 'dispatched', 'receiving', 'sending', 'swapping'].includes(job.status);

  return (
    <div className={`bg-surface border border-border border-l-2 ${cfg.border} rounded-xl overflow-hidden transition-all duration-300 ${isProcessing ? 'shadow-lg' : ''}`}
      style={isProcessing ? { boxShadow: undefined } : undefined}
    >
      {/* Progress bar — full width, top of card when active */}
      {isProcessing && job.progress > 0 && (
        <div className="h-0.5 w-full bg-background relative overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 ${cfg.barBg} transition-all duration-700 ease-out`}
            style={{ width: `${job.progress}%` }}
          />
          {/* Shimmer sweep */}
          <div
            className="absolute inset-y-0 w-24 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"
            style={{ left: `calc(${job.progress}% - 48px)` }}
          />
        </div>
      )}

      <div className="p-4 flex items-center gap-4">
        {/* Icon */}
        <div className={`p-2.5 rounded-xl shrink-0 ${isProcessing ? cfg.chip : 'bg-background border border-border'}`}>
          {isProcessing
            ? <Icon className={`w-4 h-4 ${cfg.accent}`} />
            : <Film className="w-4 h-4 text-textMuted" />
          }
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-semibold truncate text-sm leading-tight mb-1.5">{job.fileName}</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.chip}`}>
              <Icon className="w-2.5 h-2.5" />
              {cfg.label}
            </span>
            <ConversionBadge job={job} />
            {job.fps != null && job.fps > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-background border-border text-textMuted">
                {job.fps.toFixed(1)} fps
              </span>
            )}
          </div>
        </div>

        {/* Progress + controls */}
        <div className="flex items-center gap-3 shrink-0">
          {isProcessing && (
            <div ref={waveRef} className={`flex items-end gap-[2px] h-5 w-6 ${cfg.accent}`}>
              <div className="w-1 h-1.5 rounded-sm bg-current transform scale-y-50 origin-bottom opacity-70" />
              <div className="w-1 h-3 rounded-sm bg-current transform scale-y-50 origin-bottom" />
              <div className="w-1 h-5 rounded-sm bg-current transform scale-y-50 origin-bottom" />
              <div className="w-1 h-2 rounded-sm bg-current transform scale-y-50 origin-bottom opacity-70" />
            </div>
          )}

          <div className="w-32 text-right">
            <div className="flex items-center justify-between mb-1.5">
              <span className={`text-xs font-semibold ${isProcessing ? cfg.accent : 'text-textMuted'}`}>
                {job.progress}%
              </span>
              {job.eta && job.eta > Date.now() && (
                <span className="text-[10px] text-textMuted flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" />
                  {formatEta(job.eta)}
                </span>
              )}
            </div>
            <div className="h-1.5 bg-background rounded-full overflow-hidden border border-border/60">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${cfg.barBg}`}
                style={{ width: `${job.progress}%` }}
              />
            </div>
          </div>

          <button
            onClick={onRemove}
            disabled={!canRemove}
            className="p-2 hover:bg-background rounded-lg text-textMuted hover:text-red-400 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Failed Job Row ───────────────────────────────────────────────────────────

function FailedJobRow({ job, onRemove, onRetry }: { job: Job; onRemove: () => void; onRetry: () => void }) {
  const from = codecLabel(job.codecIn);
  const to   = targetCodecLabel(job.recipe);
  return (
    <div className="bg-red-500/5 border border-red-500/20 border-l-2 border-l-red-500/50 rounded-xl p-3 flex items-center gap-3">
      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium truncate">{job.fileName}</p>
        {job.error && <p className="text-red-400/70 text-xs truncate mt-0.5">{job.error}</p>}
      </div>
      <div className="flex items-center gap-1 text-[10px] font-mono shrink-0">
        <span className="px-1.5 py-0.5 rounded border bg-background border-border text-textMuted">{from}</span>
        <ArrowRight className="w-3 h-3 text-textMuted" />
        <span className="px-1.5 py-0.5 rounded border bg-primary/10 border-primary/20 text-primary">{to}</span>
      </div>
      <button onClick={onRetry} className="p-1.5 hover:bg-background rounded-lg text-textMuted hover:text-yellow-400 transition-colors shrink-0" title="Retry">
        <RefreshCw className="w-4 h-4" />
      </button>
      <button onClick={onRemove} className="p-1.5 hover:bg-background rounded-lg text-textMuted hover:text-red-400 transition-colors shrink-0" title="Remove">
        <XCircle className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Completed Job Row ────────────────────────────────────────────────────────

function CompletedJobRow({ job, onRemove }: { job: Job; onRemove: () => void }) {
  const savedBytes = (job.sizeBefore ?? 0) - (job.sizeAfter ?? 0);
  const savedMb    = Math.round(savedBytes / 1024 / 1024);
  const savedPct   = job.sizeBefore ? Math.round((savedBytes / job.sizeBefore) * 100) : 0;
  const from = codecLabel(job.codecIn);
  const to   = targetCodecLabel(job.recipe);

  return (
    <div className="bg-background border border-border/50 border-l-2 border-l-green-500/30 rounded-xl p-3 flex items-center gap-3 opacity-60 hover:opacity-100 transition-opacity">
      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium truncate">{job.fileName}</p>
      </div>
      <div className="flex items-center gap-1 text-[10px] font-mono shrink-0">
        <span className="px-1.5 py-0.5 rounded border bg-background border-border text-textMuted">{from}</span>
        <ArrowRight className="w-3 h-3 text-textMuted" />
        <span className="px-1.5 py-0.5 rounded border bg-green-500/10 border-green-500/20 text-green-400">{to}</span>
      </div>
      {savedMb > 0 && (
        <span className="text-green-400 text-xs font-semibold whitespace-nowrap">
          -{savedPct}% <span className="text-textMuted font-normal">({savedMb} MB)</span>
        </span>
      )}
      <button onClick={onRemove} className="p-1.5 hover:bg-surface rounded-lg text-textMuted hover:text-red-400 transition-colors shrink-0">
        <XCircle className="w-4 h-4" />
      </button>
    </div>
  );
}
