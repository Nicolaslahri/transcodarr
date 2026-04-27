'use client';

import { useAppState } from '@/hooks/useTranscodarrSocket';
import Link from 'next/link';
import { Film, Search, ArrowRight, CheckCircle2, HardDrive, Zap, TrendingDown, BookOpen, RefreshCw, FolderPlus } from 'lucide-react';
import type { Job } from '@transcodarr/shared';
import { useState, useMemo, useEffect, useCallback } from 'react';
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

function recipeName(recipeId: string): string {
  const r = BUILT_IN_RECIPES.find(x => x.id === recipeId);
  return r?.name ?? recipeId;
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
    <span className={`inline-flex items-center text-xxs font-bold px-1.5 py-0.5 rounded border ${color}`}>
      {label}
    </span>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ jobs }: { jobs: Job[] }) {
  const totalSavedBytes = jobs.reduce((acc, j) => acc + ((j.sizeBefore ?? 0) - (j.sizeAfter ?? 0)), 0);
  const totalSavedGb    = (totalSavedBytes / 1e9).toFixed(2);
  const sizedJobs       = jobs.filter(j => j.sizeBefore && j.sizeAfter);
  const avgReduction    = sizedJobs.length > 0
    ? Math.round(sizedJobs.reduce((acc, j) => acc + (1 - (j.sizeAfter! / j.sizeBefore!)) * 100, 0) / sizedJobs.length)
    : 0;
  const fpsJobs = jobs.filter(j => j.avgFps && j.avgFps > 0);
  const avgFps  = fpsJobs.length > 0
    ? Math.round(fpsJobs.reduce((a, j) => a + (j.avgFps ?? 0), 0) / fpsJobs.length)
    : null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StatCard icon={<CheckCircle2 className="w-5 h-5 text-green-400" />}   label="Files Processed"  value={String(jobs.length)}         sub="completed transcodes"       />
      <StatCard icon={<HardDrive className="w-5 h-5 text-primary" />}        label="Space Saved"      value={`${totalSavedGb} GB`}        sub="total storage reclaimed"    highlight />
      <StatCard icon={<TrendingDown className="w-5 h-5 text-sky-400" />}     label="Avg Reduction"    value={avgReduction ? `${avgReduction}%` : '—'} sub="average file size reduction" />
      <StatCard icon={<Zap className="w-5 h-5 text-yellow-400" />}           label="Avg Speed"        value={avgFps != null ? `${avgFps} fps` : '—'} sub="average transcode speed"    />
    </div>
  );
}

function StatCard({ icon, label, value, sub, highlight }: {
  icon: React.ReactNode; label: string; value: string; sub: string; highlight?: boolean;
}) {
  return (
    <div className={`card-hover p-4 rounded-xl border ${highlight ? 'bg-primary/5 border-primary/20' : 'bg-surface border-border'}`}>
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-xs text-textMuted">{label}</span></div>
      <p className={`text-2xl font-bold ${highlight ? 'text-primary' : 'text-white'}`}>{value}</p>
      <p className="text-xs text-textMuted mt-0.5">{sub}</p>
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
    <div className="card-hover flex items-center gap-3 p-3 bg-surface border border-border rounded-xl">
      <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/20 shrink-0">
        <Film className="w-4 h-4 text-green-400" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-medium truncate">{job.fileName}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {job.resolution && <ResolutionBadge resolution={job.resolution} />}
          {!same && (
            <div className="flex items-center gap-1 text-xxs font-mono">
              <span className="px-1.5 py-0.5 rounded border bg-background border-border text-textMuted">{from}</span>
              <ArrowRight className="w-3 h-3 text-textMuted" />
              <span className="px-1.5 py-0.5 rounded border bg-primary/10 border-primary/20 text-primary">{to}</span>
            </div>
          )}
          {savedPct != null && savedPct > 0 && (
            <span className="text-xxs px-1.5 py-0.5 rounded border bg-green-500/10 border-green-500/20 text-green-400 font-semibold">
              −{savedPct}%
            </span>
          )}
          {savedPct != null && savedPct < 0 && (
            <span className="text-xxs px-1.5 py-0.5 rounded border bg-amber-500/10 border-amber-500/20 text-amber-400 font-semibold">
              +{Math.abs(savedPct)}% larger
            </span>
          )}
          <span className="text-xxs text-textMuted">{recipeName(job.recipe)}</span>
        </div>
      </div>

      <div className="text-right shrink-0 hidden sm:block">
        {job.sizeBefore != null && job.sizeAfter != null && (
          <p className="text-xs text-textMuted">
            {formatBytes(job.sizeBefore)}{' '}
            <span className={job.sizeAfter <= job.sizeBefore ? 'text-green-400' : 'text-amber-400'}>→</span>{' '}
            {formatBytes(job.sizeAfter)}
          </p>
        )}
        {savedBytes > 0 && (
          <p className="text-xs text-green-400 font-medium">{formatBytes(savedBytes)} saved</p>
        )}
        {savedBytes < 0 && (
          <p className="text-xs text-amber-400 font-medium">{formatBytes(Math.abs(savedBytes))} larger</p>
        )}
      </div>

      {job.completedAt != null && (
        <p className="text-xs text-textMuted shrink-0 hidden md:block w-24 text-right">
          {formatDate(job.completedAt)}
        </p>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100;

export default function LibraryPage() {
  const { apiUrl, jobs: wsJobs } = useAppState();
  const [history, setHistory]   = useState<Job[]>([]);
  const [loading, setLoading]   = useState(true);
  const [hasMore, setHasMore]   = useState(false);
  const [offset, setOffset]     = useState(0);
  const [search, setSearch]     = useState('');
  const [recipeFilter, setRecipeFilter] = useState('');

  const fetchPage = useCallback(async (off: number, replace: boolean) => {
    setLoading(true);
    try {
      const res  = await fetch(`${apiUrl}/api/jobs?status=complete&limit=${PAGE_SIZE}&offset=${off}`);
      const data: Job[] = await res.json();
      setHistory(prev => replace ? data : [...prev, ...data]);
      setHasMore(data.length === PAGE_SIZE);
      setOffset(off + data.length);
    } finally {
      setLoading(false);
    }
  }, [apiUrl]);

  // Initial load
  useEffect(() => { fetchPage(0, true); }, [fetchPage]);

  // Merge newly completed WS jobs in real-time (deduplicate by id)
  useEffect(() => {
    const newlyDone = wsJobs.filter(j => j.status === 'complete');
    if (!newlyDone.length) return;
    setHistory(prev => {
      const existingIds = new Set(prev.map(j => j.id));
      const fresh = newlyDone.filter(j => !existingIds.has(j.id));
      return fresh.length ? [...fresh, ...prev] : prev;
    });
  }, [wsJobs]);

  // Unique recipe IDs across loaded history for the filter dropdown
  const recipeIds = useMemo(() => {
    const ids = [...new Set(history.map(j => j.recipe))].sort();
    return ids;
  }, [history]);

  const filtered = useMemo(() => {
    let list = history;
    if (recipeFilter) list = list.filter(j => j.recipe === recipeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(j => j.fileName.toLowerCase().includes(q));
    }
    return list;
  }, [history, search, recipeFilter]);

  return (
    <div className="p-4 md:p-6 lg:p-10 max-w-7xl mx-auto space-y-5 md:space-y-6">
      <header className="animate-section flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-white mb-1 md:mb-2">Library</h1>
          <p className="text-textMuted text-sm md:text-base">History of all completed transcodes and space savings.</p>
        </div>
        <button
          onClick={() => fetchPage(0, true)}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 bg-surface border border-border rounded-xl text-sm text-textMuted hover:text-white transition-colors disabled:opacity-40 self-start sm:self-auto shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </header>

      {history.length > 0 ? (
        <>
          <StatsBar jobs={history} />

          {/* Filters row */}
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 min-w-0 sm:min-w-48">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-textMuted pointer-events-none" />
              <input
                type="text"
                placeholder="Search by filename…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-white placeholder:text-textMuted focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>
            {recipeIds.length > 1 && (
              <div className="relative">
                <BookOpen className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-textMuted pointer-events-none" />
                <select
                  value={recipeFilter}
                  onChange={e => setRecipeFilter(e.target.value)}
                  className="pl-9 pr-8 py-2.5 bg-surface border border-border rounded-xl text-sm text-white focus:outline-none appearance-none"
                >
                  <option value="">All recipes</option>
                  {recipeIds.map(id => (
                    <option key={id} value={id}>{recipeName(id)}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold uppercase tracking-widest text-textMuted">
                {search || recipeFilter
                  ? `Results (${filtered.length})`
                  : `All Files (${history.length}${hasMore ? '+' : ''})`}
              </h2>
            </div>
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-textMuted text-sm bg-surface border border-border border-dashed rounded-xl">
                No files match your filters
              </div>
            ) : (
              <div className="space-y-1.5 stagger-list">
                {filtered.map(job => <LibraryRow key={job.id} job={job} />)}
              </div>
            )}
          </section>

          {hasMore && !search && !recipeFilter && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() => fetchPage(offset, false)}
                disabled={loading}
                className="px-6 py-2.5 bg-surface border border-border rounded-xl text-sm text-textMuted hover:text-white transition-colors disabled:opacity-40"
              >
                {loading ? 'Loading…' : `Load more`}
              </button>
            </div>
          )}
        </>
      ) : loading ? (
        <div className="p-12 bg-surface border border-border rounded-2xl text-center">
          <RefreshCw className="w-8 h-8 text-textMuted mx-auto mb-3 animate-spin opacity-40" />
          <p className="text-textMuted text-sm">Loading history…</p>
        </div>
      ) : (
        <div className="p-12 bg-surface border border-dashed border-border rounded-2xl flex flex-col items-center text-center gap-4">
          <Film className="w-12 h-12 text-textMuted/50" aria-hidden />
          <div className="space-y-1">
            <p className="text-base font-semibold text-white">No completed jobs yet</p>
            <p className="text-textMuted text-sm max-w-sm">
              Once Transcodarr finishes processing files, they&apos;ll appear here with size savings and per-recipe performance stats.
            </p>
          </div>
          {/* CTA — give the user an obvious next step instead of a dead end. */}
          <Link
            href="/settings?tab=folders"
            className="inline-flex items-center gap-2 mt-2 px-4 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary text-sm font-semibold transition-colors"
          >
            <FolderPlus className="w-4 h-4" aria-hidden />
            Add a watched folder
          </Link>
        </div>
      )}
    </div>
  );
}
