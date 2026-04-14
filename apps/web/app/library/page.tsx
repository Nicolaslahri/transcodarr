'use client';

import { useAppState } from '@/hooks/useTranscodarrSocket';
import { Film, Search, ArrowRight, CheckCircle2, HardDrive, Zap, TrendingDown } from 'lucide-react';
import type { Job } from '@transcodarr/shared';
import { useState, useMemo } from 'react';
import { BUILT_IN_RECIPES } from '@transcodarr/shared';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

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

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ jobs }: { jobs: Job[] }) {
  const totalSavedBytes = jobs.reduce((acc, j) => acc + ((j.sizeBefore ?? 0) - (j.sizeAfter ?? 0)), 0);
  const totalSavedGb    = (totalSavedBytes / 1e9).toFixed(2);
  const avgReduction    = jobs.length > 0
    ? Math.round(jobs.filter(j => j.sizeBefore && j.sizeAfter)
        .reduce((acc, j) => acc + (1 - (j.sizeAfter! / j.sizeBefore!)) * 100, 0)
        / jobs.filter(j => j.sizeBefore && j.sizeAfter).length || 0)
    : 0;
  const fpsJobs = jobs.filter(j => j.avgFps && j.avgFps > 0);
  const avgFps  = fpsJobs.length > 0
    ? Math.round(fpsJobs.reduce((a, j) => a + (j.avgFps ?? 0), 0) / fpsJobs.length)
    : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StatCard
        icon={<CheckCircle2 className="w-5 h-5 text-green-400" />}
        label="Files Processed"
        value={String(jobs.length)}
        sub="completed transcodes"
      />
      <StatCard
        icon={<HardDrive className="w-5 h-5 text-primary" />}
        label="Space Saved"
        value={`${totalSavedGb} GB`}
        sub="total storage reclaimed"
        highlight
      />
      <StatCard
        icon={<TrendingDown className="w-5 h-5 text-sky-400" />}
        label="Avg Reduction"
        value={`${avgReduction || '—'}${avgReduction ? '%' : ''}`}
        sub="average file size reduction"
      />
      <StatCard
        icon={<Zap className="w-5 h-5 text-yellow-400" />}
        label="Avg Speed"
        value={avgFps != null ? `${avgFps} fps` : '—'}
        sub="average transcode speed"
      />
    </div>
  );
}

function StatCard({
  icon, label, value, sub, highlight,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div className={`p-4 rounded-xl border ${highlight ? 'bg-primary/5 border-primary/20' : 'bg-surface border-border'}`}>
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-textMuted">{label}</span></div>
      <p className={`text-2xl font-bold ${highlight ? 'text-primary' : 'text-white'}`}>{value}</p>
      <p className="text-[11px] text-textMuted mt-0.5">{sub}</p>
    </div>
  );
}

// ─── Job Row ─────────────────────────────────────────────────────────────────

function LibraryRow({ job }: { job: Job }) {
  const from = codecLabel(job.codecIn);
  const to   = targetCodecLabel(job.recipe);
  const same = from.toLowerCase() === to.toLowerCase();

  const savedBytes = (job.sizeBefore ?? 0) - (job.sizeAfter ?? 0);
  const savedPct   = job.sizeBefore && job.sizeAfter
    ? Math.round((1 - job.sizeAfter / job.sizeBefore) * 100)
    : null;

  return (
    <div className="flex items-center gap-3 p-3 bg-surface border border-border rounded-xl hover:border-border/80 transition-colors">
      <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/20 shrink-0">
        <Film className="w-4 h-4 text-green-400" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium truncate">{job.fileName}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {job.resolution && <ResolutionBadge resolution={job.resolution} />}
          {!same && (
            <div className="flex items-center gap-1 text-[10px] font-mono">
              <span className="px-1.5 py-0.5 rounded border bg-background border-border text-textMuted">{from}</span>
              <ArrowRight className="w-3 h-3 text-textMuted" />
              <span className="px-1.5 py-0.5 rounded border bg-primary/10 border-primary/20 text-primary">{to}</span>
            </div>
          )}
          {savedPct != null && savedPct > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-green-500/10 border-green-500/20 text-green-400 font-semibold">
              −{savedPct}%
            </span>
          )}
        </div>
      </div>

      <div className="text-right shrink-0 hidden sm:block">
        {job.sizeBefore != null && job.sizeAfter != null && (
          <p className="text-xs text-textMuted">
            {formatBytes(job.sizeBefore)} <span className="text-green-400">→</span> {formatBytes(job.sizeAfter)}
          </p>
        )}
        {savedBytes > 0 && (
          <p className="text-[11px] text-green-400 font-medium">{formatBytes(savedBytes)} saved</p>
        )}
      </div>

      {job.completedAt != null && (
        <p className="text-[11px] text-textMuted shrink-0 hidden md:block w-24 text-right">
          {formatDate(job.completedAt)}
        </p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const { jobs } = useAppState();
  const [search, setSearch] = useState('');

  const completed = useMemo(
    () => jobs
      .filter(j => j.status === 'complete')
      .sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt)),
    [jobs],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return completed;
    const q = search.toLowerCase();
    return completed.filter(j => j.fileName.toLowerCase().includes(q));
  }, [completed, search]);

  return (
    <div className="p-10 max-w-7xl mx-auto space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white mb-2">Library</h1>
          <p className="text-textMuted">History of all completed transcodes and space savings.</p>
        </div>
      </header>

      {completed.length > 0 ? (
        <>
          <StatsBar jobs={completed} />

          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted pointer-events-none" />
            <input
              type="text"
              placeholder="Search by filename…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-white placeholder:text-textMuted focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold uppercase tracking-widest text-textMuted">
                {search ? `Results (${filtered.length})` : `All Files (${completed.length})`}
              </h2>
            </div>
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-textMuted text-sm bg-surface border border-border border-dashed rounded-xl">
                No files match &ldquo;{search}&rdquo;
              </div>
            ) : (
              <div className="space-y-1.5">
                {filtered.map(job => <LibraryRow key={job.id} job={job} />)}
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="p-12 bg-surface border border-border border-dashed rounded-2xl text-center space-y-3">
          <Film className="w-10 h-10 text-textMuted mx-auto opacity-40" />
          <p className="text-white font-medium">No completed transcodes yet</p>
          <p className="text-textMuted text-sm">Finished jobs will appear here with savings stats.</p>
        </div>
      )}
    </div>
  );
}
