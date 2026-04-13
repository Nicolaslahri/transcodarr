'use client';

import { useAppState, type ScanSummary } from '@/hooks/useTranscodarrSocket';
import { Film, CheckCircle2, XCircle, AlertTriangle, Trash2, ArrowRight, Clock } from 'lucide-react';
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
  const normalized = raw.toLowerCase();
  return CODEC_LABELS[normalized] ?? raw.toUpperCase();
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
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ─── Scan Summary Banner ───────────────────────────────────────────────────────

function ScanBanner({ summary, onDismiss }: { summary: ScanSummary; onDismiss: () => void }) {
  const isError = !!summary.error;

  return (
    <div className={`flex items-start gap-4 p-4 rounded-xl border ${
      isError ? 'bg-red-500/10 border-red-500/30' : 'bg-primary/10 border-primary/30'
    }`}>
      <div className={`p-2 rounded-lg shrink-0 ${isError ? 'bg-red-500/20' : 'bg-primary/20'}`}>
        {isError
          ? <AlertTriangle className="w-5 h-5 text-red-400" />
          : <Film className="w-5 h-5 text-primary" />
        }
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QueuePage() {
  const { jobs, scanSummary, apiUrl } = useAppState();
  const [localScan, setLocalScan] = useState<ScanSummary | null>(null);

  useEffect(() => {
    if (scanSummary) setLocalScan(scanSummary);
  }, [scanSummary]);

  const activeJobs    = jobs.filter(j => ['queued', 'dispatched', 'receiving', 'transcoding', 'sending', 'swapping'].includes(j.status));
  const completedJobs = jobs.filter(j => j.status === 'complete');
  const failedJobs    = jobs.filter(j => j.status === 'failed');

  const clearAll = async () => {
    await fetch(`${apiUrl}/api/jobs`, { method: 'DELETE' });
  };

  const removeJob = async (id: string) => {
    await fetch(`${apiUrl}/api/jobs/${id}`, { method: 'DELETE' });
  };

  return (
    <div className="p-10 max-w-7xl mx-auto space-y-8">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white mb-2">Queue</h1>
          <p className="text-textMuted">Active transcodes and processing history.</p>
        </div>
        {(completedJobs.length > 0 || failedJobs.length > 0 || activeJobs.filter(j => j.status === 'queued').length > 0) && (
          <button
            onClick={clearAll}
            className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-xl text-textMuted hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5 transition-all text-sm font-medium"
          >
            <Trash2 className="w-4 h-4" />
            Clear All
          </button>
        )}
      </header>

      {localScan && (
        <ScanBanner summary={localScan} onDismiss={() => setLocalScan(null)} />
      )}

      {/* Active & Queued Jobs */}
      <section>
        <h2 className="text-sm font-bold uppercase tracking-widest text-textMuted mb-4">
          Active Processing ({activeJobs.length})
        </h2>
        <div className="space-y-3">
          {activeJobs.length === 0 ? (
            <div className="p-6 bg-surface border border-border border-dashed rounded-xl text-center text-textMuted text-sm">
              No active jobs. Add a folder in Settings to get started.
            </div>
          ) : (
            activeJobs.map(job => (
              <JobRow key={job.id} job={job} onRemove={() => removeJob(job.id)} />
            ))
          )}
        </div>
      </section>

      {failedJobs.length > 0 && (
        <section>
          <h2 className="text-sm font-bold uppercase tracking-widest text-red-400/70 mb-4">
            Failed ({failedJobs.length})
          </h2>
          <div className="space-y-2">
            {failedJobs.map(job => (
              <FailedJobRow key={job.id} job={job} onRemove={() => removeJob(job.id)} />
            ))}
          </div>
        </section>
      )}

      {completedJobs.length > 0 && (
        <section>
          <h2 className="text-sm font-bold uppercase tracking-widest text-textMuted mb-4">
            Completed ({completedJobs.length})
          </h2>
          <div className="space-y-2">
            {completedJobs.slice(0, 10).map(job => (
              <CompletedJobRow key={job.id} job={job} onRemove={() => removeJob(job.id)} />
            ))}
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

  return (
    <div className="flex items-center gap-1 text-[10px] font-mono shrink-0">
      <span className={`px-1.5 py-0.5 rounded border ${
        same ? 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' : 'bg-background border-border text-textMuted'
      }`}>
        {from}
      </span>
      <ArrowRight className="w-3 h-3 text-textMuted" />
      <span className="px-1.5 py-0.5 rounded border bg-primary/10 border-primary/20 text-primary">
        {to}
      </span>
    </div>
  );
}

// Phase → display config
const PHASE_CONFIG: Record<string, { label: string; color: string; barColor: string }> = {
  queued:      { label: 'Queued',                  color: 'text-blue-400 border-blue-400/30 bg-blue-400/10',      barColor: 'bg-blue-400' },
  dispatched:  { label: 'Waiting for Worker',       color: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10', barColor: 'bg-yellow-400' },
  receiving:   { label: '📡 Downloading to Worker', color: 'text-sky-400 border-sky-400/30 bg-sky-400/10',         barColor: 'bg-sky-400' },
  transcoding: { label: '🎬 Transcoding',           color: 'text-primary border-primary/30 bg-primary/10',         barColor: 'bg-primary' },
  sending:     { label: '📤 Uploading Result',      color: 'text-violet-400 border-violet-400/30 bg-violet-400/10', barColor: 'bg-violet-400' },
  swapping:    { label: '🔄 Finishing Up',          color: 'text-orange-400 border-orange-400/30 bg-orange-400/10', barColor: 'bg-orange-400' },
};

function JobRow({ job, onRemove }: { job: Job; onRemove: () => void }) {
  // Use phase for display detail; fall back to status
  const phaseKey = job.phase ?? job.status;
  const cfg = PHASE_CONFIG[phaseKey] ?? PHASE_CONFIG[job.status] ?? { label: job.status.toUpperCase(), color: 'text-textMuted border-border bg-background', barColor: 'bg-primary' };

  // Animate wave for any processing phase (not just transcoding, and not queued/dispatched)
  const isAnimating = ['receiving', 'transcoding', 'sending', 'swapping'].includes(phaseKey);
  const waveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isAnimating && waveRef.current) {
      const bars = waveRef.current.children;
      const ctx  = gsap.context(() => {
        gsap.to(bars, {
          scaleY: 1, duration: 0.4,
          stagger: { each: 0.1, repeat: -1, yoyo: true },
          ease: 'sine.inOut',
        });
      }, waveRef);
      return () => ctx.revert();
    }
  }, [isAnimating]);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!job.eta) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [job.eta]);

  const canRemove = !['transcoding', 'dispatched', 'receiving', 'sending', 'swapping'].includes(job.status);

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="p-4 flex items-center gap-4">
        <div className="p-3 bg-background rounded-xl shrink-0">
          <Film className="w-5 h-5 text-textMuted" />
        </div>

        <div className="flex-1 min-w-0">
          <h3 className="text-white font-medium truncate text-sm mb-1.5">{job.fileName}</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded border ${cfg.color}`}>
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

        <div className="flex items-center gap-4 shrink-0">
          {isAnimating && (
            <div ref={waveRef} className="flex items-end gap-[2px] h-6 w-8">
              <div className="w-1.5 h-2 bg-primary rounded-sm transform scale-y-50 origin-bottom" />
              <div className="w-1.5 h-4 bg-primary rounded-sm transform scale-y-50 origin-bottom" />
              <div className="w-1.5 h-6 bg-primary rounded-sm transform scale-y-50 origin-bottom" />
              <div className="w-1.5 h-3 bg-primary rounded-sm transform scale-y-50 origin-bottom" />
            </div>
          )}

          <div className="w-28 text-right">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-textMuted">{job.progress}%</span>
              {job.eta && job.eta > Date.now() && (
                <span className="text-[10px] text-textMuted flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" />
                  {formatEta(job.eta)}
                </span>
              )}
            </div>
            <div className="h-1.5 bg-background rounded-full overflow-hidden border border-border">
              <div
                className={`h-full transition-all duration-500 ease-out ${cfg.barColor}`}
                style={{ width: `${job.progress}%` }}
              />
            </div>
          </div>

          <button
            onClick={onRemove}
            disabled={!canRemove}
            className="p-2 hover:bg-background rounded-lg text-textMuted hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Failed Job Row ───────────────────────────────────────────────────────────

function FailedJobRow({ job, onRemove }: { job: Job; onRemove: () => void }) {
  return (
    <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 flex items-center gap-3">
      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium truncate">{job.fileName}</p>
        {job.error && <p className="text-red-400/70 text-xs truncate mt-0.5">{job.error}</p>}
      </div>
      <ConversionBadge job={job} />
      <button
        onClick={onRemove}
        className="p-1.5 hover:bg-background rounded-lg text-textMuted hover:text-red-400 transition-colors shrink-0"
      >
        <XCircle className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─── Completed Job Row ────────────────────────────────────────────────────────

function CompletedJobRow({ job, onRemove }: { job: Job; onRemove: () => void }) {
  const savedBytes = (job.sizeBefore || 0) - (job.sizeAfter || 0);
  const savedMb    = Math.round(savedBytes / 1024 / 1024);
  const savedPct   = job.sizeBefore ? Math.round((savedBytes / job.sizeBefore) * 100) : 0;

  return (
    <div className="bg-background border border-border/50 rounded-xl p-3 flex items-center gap-3 opacity-70 hover:opacity-100 transition-opacity">
      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium truncate">{job.fileName}</p>
      </div>
      <ConversionBadge job={job} />
      {savedMb > 0 && (
        <span className="text-green-400 text-xs font-medium whitespace-nowrap">
          -{savedPct}% <span className="text-textMuted">({savedMb} MB)</span>
        </span>
      )}
      <button
        onClick={onRemove}
        className="p-1.5 hover:bg-surface rounded-lg text-textMuted hover:text-red-400 transition-colors shrink-0"
      >
        <XCircle className="w-4 h-4" />
      </button>
    </div>
  );
}
