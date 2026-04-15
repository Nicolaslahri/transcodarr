'use client';

import { useAppState, type ScanSummary, type ScanProgress } from '@/hooks/useTranscodarrSocket';
import { Film, CheckCircle2, XCircle, AlertTriangle, Trash2, ArrowRight, Clock, Zap, ArrowDownToLine, Upload, RefreshCw, Timer, GripVertical, User, PauseCircle, PlayCircle, History, ChevronDown } from 'lucide-react';
import type { Job, WorkerInfo } from '@transcodarr/shared';
import { useEffect, useState, useCallback } from 'react';
import { BUILT_IN_RECIPES } from '@transcodarr/shared';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ─── Codec helper ─────────────────────────────────────────────────────────────

const CODEC_LABELS: Record<string, string> = {
  hevc: 'H.265', h264: 'H.264', h265: 'H.265', avc: 'H.264',
  vp9: 'VP9', av1: 'AV1', mpeg4: 'MPEG-4', mpeg2video: 'MPEG-2',
};

function codecLabel(raw?: string): string {
  if (!raw) return '?';
  return CODEC_LABELS[raw.toLowerCase()] ?? raw.toUpperCase();
}

function targetCodecLabel(recipeId: string): string {
  const r = BUILT_IN_RECIPES.find(x => x.id === recipeId);
  if (!r) return '?';
  return CODEC_LABELS[r.targetCodec] ?? r.targetCodec.toUpperCase();
}

function targetContainer(recipeId: string): string {
  return BUILT_IN_RECIPES.find(x => x.id === recipeId)?.targetContainer ?? 'mkv';
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
  sortPriority: number;
}> = {
  transcoding: { label: 'Transcoding',       Icon: Zap,             accent: 'text-primary',     border: 'border-l-primary/70',        barBg: 'bg-primary',    chip: 'bg-primary/10 border-primary/30 text-primary',          sortPriority: 0 },
  receiving:   { label: 'Downloading File',  Icon: ArrowDownToLine, accent: 'text-sky-400',     border: 'border-l-sky-500/60',        barBg: 'bg-sky-400',    chip: 'bg-sky-500/10 border-sky-500/30 text-sky-400',          sortPriority: 1 },
  sending:     { label: 'Uploading Result',  Icon: Upload,          accent: 'text-violet-400',  border: 'border-l-violet-500/60',     barBg: 'bg-violet-400', chip: 'bg-violet-500/10 border-violet-500/30 text-violet-400', sortPriority: 2 },
  swapping:    { label: 'Finishing Up',      Icon: RefreshCw,       accent: 'text-orange-400',  border: 'border-l-orange-500/60',     barBg: 'bg-orange-400', chip: 'bg-orange-500/10 border-orange-500/30 text-orange-400', sortPriority: 3 },
  dispatched:  { label: 'Ready to Dispatch', Icon: Timer,           accent: 'text-yellow-400',  border: 'border-l-yellow-500/40',     barBg: 'bg-yellow-500', chip: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400', sortPriority: 4 },
  queued:      { label: 'Queued',            Icon: Clock,           accent: 'text-blue-400',    border: 'border-l-blue-500/40',       barBg: 'bg-blue-500',   chip: 'bg-blue-500/10 border-blue-500/30 text-blue-400',       sortPriority: 5 },
  paused:      { label: 'Paused',            Icon: PauseCircle,     accent: 'text-textMuted',   border: 'border-l-white/10',          barBg: 'bg-white/20',   chip: 'bg-white/5 border-white/10 text-textMuted',             sortPriority: 6 },
};

// Derive the effective display phase from a job (status alone on initial load, phase when available)
function effectivePhase(j: Job): string {
  if (j.phase) return j.phase;
  if (j.status === 'transcoding') return 'transcoding';
  if (j.status === 'swapping')    return 'swapping';
  if (j.status === 'dispatched')  return 'dispatched';
  return j.status;
}

// ─── Scan Progress Banner (live) ─────────────────────────────────────────────

function ScanProgressBanner({ progress }: { progress: ScanProgress }) {
  return (
    <div className="toast-enter flex items-center gap-4 p-4 rounded-xl border bg-surface border-border">
      <div className="p-2 rounded-lg shrink-0 bg-primary/10">
        <Film className="w-5 h-5 text-primary animate-pulse" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-white font-semibold text-sm">
          Scanning <span className="font-mono text-xs text-textMuted">{progress.dir.split(/[\\/]/).pop()}</span>
        </p>
        <p className="text-textMuted text-xs mt-0.5">
          {progress.checked} files checked — <span className="text-primary">{progress.queued} queued</span>, {progress.skipped} skipped
        </p>
      </div>
      <div className="text-textMuted text-xs flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
        Scanning…
      </div>
    </div>
  );
}

// ─── Scan Summary Banner ──────────────────────────────────────────────────────

function ScanBanner({ summary, onDismiss }: { summary: ScanSummary; onDismiss: () => void }) {
  const isError = !!summary.error;
  return (
    <div className={`toast-enter flex items-start gap-4 p-4 rounded-xl border ${
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

  // Avg fps from jobs that have it
  const fpsJobs = jobs.filter(j => j.fps && j.fps > 0);
  const avgFps = fpsJobs.length > 0
    ? Math.round(fpsJobs.reduce((a, j) => a + (j.fps ?? 0), 0) / fpsJobs.length)
    : null;

  if (jobs.length === 0) return null;

  return (
    <div className="flex items-center flex-wrap gap-3 md:gap-6 px-4 py-3 bg-surface border border-border rounded-xl text-xs">
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
      {avgFps != null && (
        <span className="flex items-center gap-1 text-textMuted">
          <Zap className="w-3 h-3 text-primary" />
          {avgFps} fps avg
        </span>
      )}
      {parseFloat(savedGb) > 0 && (
        <span className="ml-auto text-green-400 font-semibold">{savedGb} GB saved</span>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function QueuePage() {
  const { jobs, workers, scanSummary, scanProgress, apiUrl } = useAppState();
  const [localScan, setLocalScan] = useState<ScanSummary | null>(null);
  const [orderedActiveIds, setOrderedActiveIds] = useState<string[]>([]);

  useEffect(() => { if (scanSummary) setLocalScan(scanSummary); }, [scanSummary]);

  // Phase-aware sort for active jobs
  const rawActiveJobs = jobs
    .filter(j => ['queued', 'dispatched', 'receiving', 'transcoding', 'sending', 'swapping'].includes(j.status));

  const pausedJobs = jobs.filter(j => j.status === 'paused');

  // Maintain drag order: use orderedActiveIds if they match current set, otherwise reset
  const activeJobIds = rawActiveJobs.map(j => j.id).sort().join(',');
  const orderedIds   = orderedActiveIds.filter(id => rawActiveJobs.some(j => j.id === id));
  const missingIds   = rawActiveJobs.filter(j => !orderedIds.includes(j.id)).map(j => j.id);
  const mergedIds    = [...orderedIds, ...missingIds];

  const activeJobs = mergedIds
    .map(id => rawActiveJobs.find(j => j.id === id)!)
    .filter(Boolean)
    .sort((a, b) => {
      const pa = PHASE_CONFIG[effectivePhase(a)]?.sortPriority ?? 99;
      const pb = PHASE_CONFIG[effectivePhase(b)]?.sortPriority ?? 99;
      if (pa !== pb) return pa - pb; // active (transcoding etc) always top
      // Same phase: preserve drag order
      return mergedIds.indexOf(a.id) - mergedIds.indexOf(b.id);
    });

  // Keep orderedActiveIds in sync when jobs change (avoids stale IDs)
  useEffect(() => {
    setOrderedActiveIds(prev => {
      const current = rawActiveJobs.map(j => j.id);
      const kept = prev.filter(id => current.includes(id));
      const added = current.filter(id => !kept.includes(id));
      return [...kept, ...added];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobIds]);

  const completedJobs = jobs.filter(j => j.status === 'complete');
  const failedJobs    = jobs.filter(j => j.status === 'failed');

  const clearHistory = () => fetch(`${apiUrl}/api/jobs`, { method: 'DELETE' });
  const retryAll     = () => fetch(`${apiUrl}/api/jobs/retry-all`, { method: 'POST' });
  const removeJob    = (id: string) => fetch(`${apiUrl}/api/jobs/${id}`, { method: 'DELETE' });
  const cancelJob    = (id: string) => fetch(`${apiUrl}/api/jobs/${id}/cancel`, { method: 'POST' });
  const resumeJob    = (id: string) => fetch(`${apiUrl}/api/jobs/${id}/resume`, { method: 'POST' });

  const canClear = completedJobs.length > 0 || failedJobs.length > 0;

  // dnd-kit sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setOrderedActiveIds(prev => {
      const oldIndex = prev.indexOf(active.id as string);
      const newIndex = prev.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = [...prev];
      next.splice(oldIndex, 1);
      next.splice(newIndex, 0, active.id as string);
      // Persist new order
      fetch(`${apiUrl}/api/jobs/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: next }),
      }).catch(() => {});
      return next;
    });
  }, [apiUrl]);

  // Queued jobs that can be dragged = queued or dispatched only
  const draggableIds = activeJobs.filter(j => ['queued', 'dispatched'].includes(j.status)).map(j => j.id);

  const idleWorkers = workers.filter(w => ['idle', 'active'].includes(w.status));

  return (
    <div className="p-4 md:p-6 lg:p-10 max-w-7xl mx-auto space-y-4 md:space-y-6">
      <header className="animate-section flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-white mb-1 md:mb-2">Queue</h1>
          <p className="text-textMuted text-sm">Active transcodes and processing history.</p>
        </div>
        <button
          onClick={clearHistory}
          disabled={!canClear}
          className="flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 bg-surface border border-border rounded-xl text-textMuted hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5 transition-all text-xs md:text-sm font-medium disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-textMuted disabled:hover:border-border disabled:hover:bg-transparent shrink-0"
        >
          <Trash2 className="w-4 h-4" />
          <span className="hidden sm:inline">Clear History</span>
          <span className="sm:hidden">Clear</span>
        </button>
      </header>

      <LiveStrip jobs={jobs} />

      {scanProgress && <ScanProgressBanner progress={scanProgress} />}
      {localScan && !scanProgress && <ScanBanner summary={localScan} onDismiss={() => setLocalScan(null)} />}

      {/* Active & Queued */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-textMuted mb-3">
          Active Processing ({activeJobs.length})
        </h2>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={draggableIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-2 stagger-list">
              {activeJobs.length === 0 ? (
                <div className="p-10 bg-surface border border-dashed border-border rounded-xl flex flex-col items-center text-center gap-3">
                  <Film className="w-8 h-8 text-textMuted/40" />
                  <div>
                    <p className="text-sm font-medium text-white mb-1">Nothing queued</p>
                    <p className="text-xs text-textMuted">Add a watched folder in <a href="/settings" className="text-primary hover:underline">Settings</a> to start transcoding automatically.</p>
                  </div>
                </div>
              ) : (
                activeJobs.map(job => (
                  <JobRow
                    key={job.id}
                    job={job}
                    onResume={() => resumeJob(job.id)}
                    onRemove={() => removeJob(job.id)}
                    onCancel={() => cancelJob(job.id)}
                    idleWorkers={idleWorkers}
                    apiUrl={apiUrl}
                    draggable={draggableIds.includes(job.id)}
                  />
                ))
              )}
            </div>
          </SortableContext>
        </DndContext>
      </section>

      {pausedJobs.length > 0 && (
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-textMuted mb-3">
            Paused ({pausedJobs.length})
          </h2>
          <div className="space-y-2 stagger-list">
            {pausedJobs.map(job => (
              <JobRow
                key={job.id}
                job={job}
                onResume={() => resumeJob(job.id)}
                onRemove={() => removeJob(job.id)}
                onCancel={() => cancelJob(job.id)}
                idleWorkers={idleWorkers}
                apiUrl={apiUrl}
                draggable={false}
              />
            ))}
          </div>
        </section>
      )}

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
          <div className="space-y-2 stagger-list">
            {failedJobs.map(job => (
              <FailedJobRow
                key={job.id}
                job={job}
                onRemove={() => removeJob(job.id)}
                onRetry={() => fetch(`${apiUrl}/api/jobs/${job.id}/retry`, { method: 'POST' })}
              />
            ))}
          </div>
        </section>
      )}

      {completedJobs.length > 0 && (
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-textMuted mb-3">
            Completed ({completedJobs.length})
          </h2>
          <div className="space-y-1.5 stagger-list">
            {completedJobs.slice(0, 10).map(job => (
              <CompletedJobRow key={job.id} job={job} onRemove={() => removeJob(job.id)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Conversion Badge ─────────────────────────────────────────────────────────

function ConversionBadge({ job }: { job: Job }) {
  const from = codecLabel(job.codecIn);
  const to   = targetCodecLabel(job.recipe);
  const same = from.toLowerCase() === to.toLowerCase();
  if (same) return null;
  return (
    <div className="flex items-center gap-1 text-[10px] font-mono shrink-0">
      <span className="px-1.5 py-0.5 rounded border bg-background border-border text-textMuted">{from}</span>
      <ArrowRight className="w-3 h-3 text-textMuted" />
      <span className="px-1.5 py-0.5 rounded border bg-primary/10 border-primary/20 text-primary">{to}</span>
    </div>
  );
}

// ─── Resolution Badge ─────────────────────────────────────────────────────────

function ResolutionBadge({ resolution }: { resolution: string }) {
  const [w] = resolution.toLowerCase().split('x').map(Number);
  let label: string;
  let color: string;
  if (w >= 3840)      { label = '4K';    color = 'bg-amber-500/10 border-amber-500/30 text-amber-400'; }
  else if (w >= 2560) { label = '1440p'; color = 'bg-sky-500/10 border-sky-500/30 text-sky-400'; }
  else if (w >= 1920) { label = '1080p'; color = 'bg-sky-500/10 border-sky-500/30 text-sky-400'; }
  else if (w >= 1280) { label = '720p';  color = 'bg-white/5 border-white/10 text-textMuted'; }
  else                { label = 'SD';    color = 'bg-white/5 border-white/10 text-textMuted'; }
  return (
    <span className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded border ${color}`}>
      {label}
    </span>
  );
}

// ─── File Size Badge ──────────────────────────────────────────────────────────

function FileSizeBadge({ bytes }: { bytes: number }) {
  let label: string;
  if (bytes >= 1e9) label = `${(bytes / 1e9).toFixed(1)} GB`;
  else              label = `${Math.round(bytes / 1e6)} MB`;
  return (
    <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border bg-white/5 border-white/10 text-textMuted font-mono">
      {label}
    </span>
  );
}

// ─── Subtitle Warning Badge ───────────────────────────────────────────────────

function SubtitleWarning({ job }: { job: Job }) {
  if (!job.hasSubtitles) return null;
  const container = targetContainer(job.recipe);
  if (container !== 'mp4') return null; // MKV preserves subs fine
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border bg-amber-500/10 border-amber-500/30 text-amber-400"
      title="MP4 only supports text subtitles (mov_text). Image-based subtitles (PGS, VOBSUB) will be dropped. Use a MKV recipe to keep all subtitle types."
    >
      <AlertTriangle className="w-2.5 h-2.5" />
      Image subs may be dropped
    </span>
  );
}

// ─── Worker Picker ────────────────────────────────────────────────────────────

function WorkerPicker({ job, workers, apiUrl }: { job: Job; workers: WorkerInfo[]; apiUrl: string }) {
  const [value, setValue] = useState(job.pinnedWorkerId ?? '');

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const pinnedWorkerId = e.target.value || null;
    setValue(e.target.value);
    fetch(`${apiUrl}/api/jobs/${job.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinnedWorkerId }),
    }).catch(() => {});
  };

  if (workers.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 text-[10px]">
      <User className="w-3 h-3 text-textMuted" />
      <select
        value={value}
        onChange={handleChange}
        className="bg-background border border-border text-textMuted rounded px-1.5 py-0.5 text-[10px] cursor-pointer hover:border-primary/40 focus:outline-none focus:border-primary/60 transition-colors"
      >
        <option value="">Any Worker</option>
        {workers.map(w => (
          <option key={w.id} value={w.id}>{w.name}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Job Row ──────────────────────────────────────────────────────────────────

function JobRow({
  job, onRemove, onCancel, onResume, idleWorkers, apiUrl, draggable,
}: {
  job: Job;
  onRemove: () => void;
  onCancel: () => void;
  onResume: () => void;
  idleWorkers: WorkerInfo[];
  apiUrl: string;
  draggable: boolean;
}) {
  // Optimistic override — show pause/play state immediately on button click,
  // without waiting for the WS event to arrive (fixes race condition).
  const [overrideStatus, setOverrideStatus] = useState<string | null>(null);
  useEffect(() => { setOverrideStatus(null); }, [job.status]);
  const displayStatus = overrideStatus ?? job.status;

  // job.phase may still be 'transcoding' from the WS event if it wasn't cleared yet —
  // when status is 'paused', always treat it as 'paused' regardless of phase.
  const phaseKey = overrideStatus ?? (job.status === 'paused' ? 'paused' : effectivePhase(job));
  const cfg = PHASE_CONFIG[phaseKey] ?? PHASE_CONFIG['queued'];
  const { Icon } = cfg;

  const isProcessing = ['dispatched', 'receiving', 'transcoding', 'sending', 'swapping'].includes(phaseKey);
  const isPaused = displayStatus === 'paused';

  // dnd-kit sortable hook — only active for draggable rows
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: job.id,
    disabled: !draggable,
  });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!job.eta) return;
    const id = setInterval(() => forceUpdate(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [job.eta]);

  const canRemove = !['transcoding', 'dispatched', 'receiving', 'sending', 'swapping'].includes(displayStatus);
  const showWorkerPicker = ['queued', 'dispatched'].includes(displayStatus) && idleWorkers.length > 0;

  // Timeline state
  const [showTimeline, setShowTimeline] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState<Array<{ id: string; event: string; workerName?: string; detail?: any; createdAt: number }>>([]);

  const toggleTimeline = async () => {
    if (!showTimeline) {
      try {
        const res = await fetch(`${apiUrl}/api/jobs/${job.id}/events`);
        if (res.ok) setTimelineEvents(await res.json());
      } catch { /* ignore */ }
    }
    setShowTimeline(s => !s);
  };

  const EVENT_LABEL: Record<string, string> = {
    queued: 'Added to queue', dispatched: 'Dispatched', paused: 'Paused', resumed: 'Resumed',
    complete: 'Completed', failed: 'Failed',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card-hover bg-surface border border-l-2 ${cfg.border} ${isProcessing ? 'border-border/80 shadow-lg' : 'border-border'} rounded-xl overflow-hidden ${isDragging ? 'z-50 !transform-none' : ''}`}
    >
      {/* Thin accent line at top — shows progress subtly */}
      {isProcessing && (
        <div className="h-[2px] w-full bg-background overflow-hidden">
          <div
            className={`h-full ${cfg.barBg} transition-all duration-700 ease-out ${job.phase === 'swapping' ? 'w-full animate-pulse opacity-60' : ''}`}
            style={job.phase !== 'swapping' ? { width: `${job.progress}%` } : undefined}
          />
        </div>
      )}

      <div className="p-3.5 md:p-4 flex gap-2.5 md:gap-3">
        {/* Drag handle — desktop only */}
        {draggable && (
          <div
            {...attributes}
            {...listeners}
            className="hidden md:flex items-center p-1 text-textMuted/25 hover:text-textMuted/60 cursor-grab active:cursor-grabbing shrink-0 touch-none"
          >
            <GripVertical className="w-4 h-4" />
          </div>
        )}

        {/* Phase icon */}
        <div className={`p-2 rounded-lg shrink-0 self-start mt-0.5 ${isProcessing ? cfg.chip : 'bg-background border border-border'}`}>
          <Icon className={`w-4 h-4 ${isProcessing ? cfg.accent : 'text-textMuted'}`} />
        </div>

        {/* Info column — takes all remaining space */}
        <div className="flex-1 min-w-0">

          {/* Row 1: filename + action buttons inline */}
          <div className="flex items-start gap-2 mb-2">
            <h3 className="text-white font-semibold text-sm leading-snug flex-1 min-w-0 truncate">{job.fileName}</h3>
            <div className="flex items-center gap-0.5 shrink-0 -mt-0.5 -mr-1">
              {isProcessing ? (
                <button
                  onClick={() => { setOverrideStatus('paused'); onCancel(); }}
                  title="Pause — keeps job in queue"
                  className="p-1.5 rounded-lg text-textMuted/50 hover:text-amber-400 hover:bg-background transition-colors"
                >
                  <PauseCircle className="w-4 h-4" />
                </button>
              ) : isPaused ? (
                <>
                  <button onClick={() => { setOverrideStatus(null); onResume(); }} title="Resume"
                    className="p-1.5 rounded-lg text-textMuted/50 hover:text-green-400 hover:bg-background transition-colors">
                    <PlayCircle className="w-4 h-4" />
                  </button>
                  <button onClick={onRemove} title="Remove"
                    className="p-1.5 rounded-lg text-textMuted/50 hover:text-red-400 hover:bg-background transition-colors">
                    <XCircle className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <button onClick={onRemove} disabled={!canRemove} title="Remove"
                  className="p-1.5 rounded-lg text-textMuted/50 hover:text-red-400 hover:bg-background transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
                  <XCircle className="w-4 h-4" />
                </button>
              )}
              <button onClick={toggleTimeline} title="Job timeline"
                className={`p-1.5 rounded-lg transition-colors ${showTimeline ? 'text-primary' : 'text-textMuted/25 hover:text-textMuted/60'}`}>
                <History className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Row 2: status chip + metadata badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.chip}`}>
              <Icon className="w-2.5 h-2.5" />
              {job.phase === 'swapping' ? 'Finalizing' : cfg.label}
            </span>
            {job.resolution && <ResolutionBadge resolution={job.resolution} />}
            {(job.fileSize ?? job.sizeBefore) != null && <FileSizeBadge bytes={(job.fileSize ?? job.sizeBefore)!} />}
            <ConversionBadge job={job} />
            {job.fps != null && job.fps > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-background border-border text-textMuted">
                {job.fps.toFixed(1)} fps
              </span>
            )}
            <SubtitleWarning job={job} />
          </div>

          {/* Row 3: full-width progress bar (active jobs only) */}
          {isProcessing && (
            <div className="mt-3">
              {job.phase === 'swapping' ? (
                /* Finalizing — indeterminate pulsing bar, no percentage */
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-textMuted/60 flex items-center gap-1">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary/60 animate-pulse" />
                      Finalizing — moving file to destination…
                    </span>
                  </div>
                  <div className="h-1 bg-background rounded-full overflow-hidden">
                    <div className={`h-full w-full ${cfg.barBg} opacity-40 rounded-full animate-pulse`} />
                  </div>
                </div>
              ) : (
                /* Normal progress */
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-textMuted/60 tabular-nums">
                      {job.eta && job.eta > Date.now()
                        ? <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatEta(job.eta)} remaining</span>
                        : <span className="opacity-0">–</span>
                      }
                    </span>
                    <span className={`text-xs font-bold tabular-nums ${cfg.accent}`}>{job.progress}%</span>
                  </div>
                  <div className="h-1 bg-background rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ease-out ${cfg.barBg}`}
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Row 4: worker picker (queued/dispatched only) */}
          {showWorkerPicker && (
            <div className="mt-2">
              <WorkerPicker job={job} workers={idleWorkers} apiUrl={apiUrl} />
            </div>
          )}
        </div>
      </div>

      {/* Timeline drawer */}
      {showTimeline && (
        <div className="border-t border-border/50 px-4 py-3 space-y-1.5 bg-background/40">
          {timelineEvents.length === 0 ? (
            <p className="text-xs text-textMuted/50 italic">No events recorded yet.</p>
          ) : (
            timelineEvents.map(e => (
              <div key={e.id} className="flex items-center gap-2 text-xs">
                <span className="text-textMuted/50 tabular-nums w-20 shrink-0 font-mono">
                  {new Date(e.createdAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  e.event === 'complete' ? 'bg-green-400' :
                  e.event === 'failed'   ? 'bg-red-400' :
                  e.event === 'paused'   ? 'bg-amber-400' :
                  'bg-primary/60'
                }`} />
                <span className="text-textMuted">{EVENT_LABEL[e.event] ?? e.event}</span>
                {e.workerName && <span className="text-textMuted/50">via {e.workerName}</span>}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Failed Job Row ───────────────────────────────────────────────────────────

function FailedJobRow({ job, onRemove, onRetry }: { job: Job; onRemove: () => void; onRetry: () => void }) {
  const from = codecLabel(job.codecIn);
  const to   = targetCodecLabel(job.recipe);
  return (
    <div className="card-hover bg-red-500/5 border border-red-500/20 border-l-2 border-l-red-500/50 rounded-xl p-3 flex items-center gap-3">
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
        {job.avgFps && job.avgFps > 0 && (
          <p className="text-textMuted text-xs mt-0.5">{Math.round(job.avgFps)} fps avg{job.elapsedSeconds ? ` · ${Math.round(job.elapsedSeconds / 60)}m` : ''}</p>
        )}
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
