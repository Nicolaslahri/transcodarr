'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  FolderOpen, Plus, Trash2, ToggleLeft, ToggleRight,
  Filter, Settings2, BookOpen, Info, ArrowLeftRight,
  Wifi, HardDrive, X, ChevronUp, ChevronRight, Bell, Pencil, Clock, ArrowRightCircle,
  Eye, EyeOff, Shield, ChevronDown, Loader2, CheckCircle2, Scan, AlertTriangle,
  Code2, Copy, Zap, FlaskConical, Gauge, FilePlus2,
} from 'lucide-react';
import type { Recipe } from '@transcodarr/shared';
import type { WorkerInfo, SmbMapping, ConnectionMode } from '@transcodarr/shared';
import { useAppState } from '@/hooks/useTranscodarrSocket';
import { FileExplorerModal } from '@/components/FileExplorerModal';
import { RecipePickerModal } from '@/components/RecipePickerModal';

type Tab = 'folders' | 'filters' | 'recipes' | 'transfer' | 'notifications' | 'general';

export default function SettingsPage() {
  const { meta, apiUrl } = useAppState();
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('tab') as Tab | null;
      if (p) return p;
    }
    return meta.mode === 'worker' ? 'general' : 'folders';
  });

  // Respond to client-side navigation (?tab=transfer from Fleet page)
  useEffect(() => {
    const p = searchParams.get('tab') as Tab | null;
    if (p) setTab(p);
  }, [searchParams]);

  const effectiveTab = meta.mode === 'worker' && tab !== 'general' ? 'general' : tab;

  const mainTabs: { id: Tab; icon: React.ElementType; label: string }[] = [
    { id: 'folders',       icon: FolderOpen,     label: 'Watched Folders' },
    { id: 'filters',       icon: Filter,         label: 'Smart Filters'   },
    { id: 'recipes',       icon: BookOpen,       label: 'Recipes'         },
    { id: 'transfer',      icon: ArrowLeftRight, label: 'Transfer'        },
    { id: 'notifications', icon: Bell,           label: 'Notifications'   },
    { id: 'general',       icon: Settings2,      label: 'General'         },
  ];

  const tabs = meta.mode === 'worker'
    ? [{ id: 'general' as const, icon: Settings2, label: 'General' }]
    : mainTabs;

  return (
    <div className="p-4 md:p-6 lg:p-10 max-w-5xl mx-auto space-y-5 md:space-y-8">
      <header className="animate-section">
        <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-white mb-1">Settings</h1>
        <p className="text-textMuted text-sm">
          {meta.mode === 'worker' ? 'Configure worker preferences' : 'Configure scanning, filters, and preferences.'}
        </p>
      </header>

      {/* Tab bar — scrollable on mobile */}
      <div className="flex gap-1 bg-surface p-1 rounded-xl border border-border overflow-x-auto scrollbar-none">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 rounded-lg text-xs md:text-sm font-medium transition-all duration-150 whitespace-nowrap shrink-0
              ${tab === id ? 'bg-background text-white shadow-sm' : 'text-textMuted hover:text-white'}`}
          >
            <Icon className="w-3.5 h-3.5 md:w-4 md:h-4 shrink-0" />
            {label}
          </button>
        ))}
      </div>

      {/* Panels */}
      {effectiveTab === 'folders'  && meta.mode !== 'worker' && <WatchedFoldersPanel apiUrl={apiUrl} />}
      {effectiveTab === 'filters'  && meta.mode !== 'worker' && <SmartFiltersPanel />}
      {effectiveTab === 'recipes'  && meta.mode !== 'worker' && <RecipesPanel apiUrl={apiUrl} />}
      {effectiveTab === 'transfer'      && meta.mode !== 'worker' && <TransferPanel apiUrl={apiUrl} />}
      {effectiveTab === 'notifications' && meta.mode !== 'worker' && <NotificationsPanel apiUrl={apiUrl} />}
      {effectiveTab === 'general'       && <GeneralPanel />}
    </div>
  );
}

// ─── Filesystem browser (shared) ──────────────────────────────────────────────

interface FsEntry { name: string; path: string; }
interface FsResult { current: string; parent: string; dirs: FsEntry[]; }

function useFsBrowser(fetchFs: (p?: string) => Promise<FsResult>) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<FsResult | null>(null);

  const browse = useCallback(async (p?: string) => {
    setLoading(true);
    try {
      const r = await fetchFs(p);
      setResult(r);
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }, [fetchFs]);

  return { open, setOpen, loading, result, browse };
}

function FsBrowser({
  open, onClose, loading, result, onNavigate, onSelect, title, hint,
}: {
  open: boolean; onClose: () => void; loading: boolean;
  result: FsResult | null; onNavigate: (p: string) => void;
  onSelect: (p: string) => void; title: string; hint: string;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label={title} className="modal-content bg-surface border border-border w-full max-w-lg rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <FolderOpen className="w-4 h-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm">{title}</p>
            <p className="text-textMuted text-xs truncate">{result?.current || '/'}</p>
          </div>
          <button onClick={onClose} aria-label="Close dialog" className="text-textMuted hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex items-start gap-2 px-5 py-3 bg-primary/5 border-b border-primary/10">
          <Info className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-primary/80">{hint}</p>
        </div>
        <div className="overflow-y-auto max-h-72 p-2">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-textMuted text-sm">Loading…</div>
          ) : (
            <>
              {result?.current && result.current !== result.parent && (
                <button
                  onClick={() => onNavigate(result.parent)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-textMuted hover:text-white transition-colors text-sm"
                >
                  <ChevronUp className="w-4 h-4" /><span className="font-mono text-xs">.. (up)</span>
                </button>
              )}
              {result?.dirs.length === 0 && (
                <p className="text-center py-6 text-textMuted text-sm">No subdirectories</p>
              )}
              {result?.dirs.map(d => (
                <button
                  key={d.path}
                  onClick={() => onNavigate(d.path)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 text-white transition-colors text-sm group"
                >
                  <FolderOpen className="w-4 h-4 text-yellow-400/70 shrink-0" />
                  <span className="flex-1 text-left font-mono text-xs truncate">{d.name}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-textMuted opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </>
          )}
        </div>
        <div className="flex items-center justify-between px-5 py-4 border-t border-border">
          <p className="text-xs text-textMuted font-mono truncate max-w-[60%]">{result?.current || '—'}</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-textMuted hover:text-white transition-colors">Cancel</button>
            <button
              onClick={() => { if (result?.current) { onSelect(result.current); onClose(); } }}
              disabled={!result?.current}
              className="px-4 py-2 text-sm font-bold bg-primary text-background rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-40"
            >
              Select This Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Watched Folders ─────────────────────────────────────────────────────────

function lastScannedLabel(unixSec: number): string {
  const secs = Math.floor(Date.now() / 1000) - unixSec;
  if (secs < 60)   return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

interface WatchedPath {
  id: string; path: string; recipe: string;
  enabled: boolean; recurse: boolean;
  extensions: string; priority: string; min_size_mb: number;
  preferred_audio_lang?: string; preferred_subtitle_lang?: string;
  scan_interval_hours?: number; last_scan_at?: number; move_to?: string;
}

const LANG_OPTIONS = [
  { value: '', label: 'Any (keep all tracks)' },
  { value: 'eng', label: 'English (eng)' },
  { value: 'jpn', label: 'Japanese (jpn)' },
  { value: 'spa', label: 'Spanish (spa)' },
  { value: 'fra', label: 'French (fra)' },
  { value: 'deu', label: 'German (deu)' },
  { value: 'ita', label: 'Italian (ita)' },
  { value: 'por', label: 'Portuguese (por)' },
  { value: 'zho', label: 'Chinese (zho)' },
  { value: 'kor', label: 'Korean (kor)' },
  { value: 'ara', label: 'Arabic (ara)' },
];

const BLANK_FORM = { path: '', recipe: 'space-saver', recurse: true, extensions: '.mkv,.mp4,.avi,.ts', priority: 'normal', minSizeMb: 100, preferredAudioLang: '', preferredSubtitleLang: '', scanIntervalHours: 0, moveTo: '' };

interface FolderStats { total: number; complete: number; queued: number; active: number; failed: number; gbSaved: number; }

function WatchedFoldersPanel({ apiUrl }: { apiUrl: string }) {
  const { scanSummary } = useAppState();
  const [paths, setPaths]     = useState<WatchedPath[]>([]);
  const [adding, setAdding]   = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [moveToExplorerOpen, setMoveToExplorerOpen] = useState(false);
  const [recipePickerOpen, setRecipePickerOpen] = useState(false);
  const [form, setForm]       = useState({ ...BLANK_FORM });
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [allRecipes, setAllRecipes] = useState<Recipe[]>([]);
  const [postAddId, setPostAddId] = useState<string | null>(null);
  const [scanningIds, setScanningIds] = useState<Set<string>>(new Set());
  const [folderStats, setFolderStats] = useState<Record<string, FolderStats>>({});
  const [dryRunResult, setDryRunResult] = useState<{ id: string; total: number; wouldQueue: number; alreadyProcessed: number; alreadyActive: number } | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const load = () => fetch('/api/settings/paths').then(r => r.json()).then(setPaths).catch(() => {});
  useEffect(() => { load(); }, []);

  // When a scan completes (WS event via useAppState), clear the scanning spinner
  useEffect(() => {
    if (!scanSummary) return;
    setPaths(prev => prev.map(p => p.path === scanSummary.dir ? { ...p, last_scan_at: Math.floor(Date.now() / 1000) } : p));
    setScanningIds(prev => {
      const s = new Set(prev);
      // Find the path whose dir matches
      const match = [...prev].find(id => {
        const found = paths.find(p => p.id === id);
        return found && found.path === scanSummary.dir;
      });
      if (match) s.delete(match);
      return s;
    });
  }, [scanSummary]);

  // Load folder stats whenever paths change
  useEffect(() => {
    if (!paths.length) return;
    paths.forEach(p => {
      fetch(`${apiUrl}/api/settings/paths/${p.id}/stats`)
        .then(r => r.json())
        .then(s => setFolderStats(prev => ({ ...prev, [p.id]: s })))
        .catch(() => {});
    });
  }, [paths.map(p => p.id).join(',')]);

  // Load recipes for display
  useEffect(() => {
    fetch(`${apiUrl}/api/settings/recipes`)
      .then(r => r.json())
      .then((rs: Recipe[]) => {
        setAllRecipes(rs);
        const found = rs.find(r => r.id === BLANK_FORM.recipe);
        if (found) setSelectedRecipe(found);
      })
      .catch(() => {});
  }, []);

  // Smart recipe suggestion based on folder path keywords
  const suggestRecipe = (folderPath: string): Recipe | null => {
    const lower = folderPath.toLowerCase();
    const candidates: Array<[string, string]> = [
      ['anime',    'anime-cleaner'],
      ['4k',       'quality-archive'],
      ['uhd',      'quality-archive'],
      ['bluray',   'quality-archive'],
      ['blu-ray',  'quality-archive'],
      ['blu_ray',  'quality-archive'],
      ['movies',   'space-saver'],
      ['movie',    'space-saver'],
      ['tv',       'space-saver'],
      ['series',   'space-saver'],
      ['show',     'space-saver'],
    ];
    for (const [keyword, recipeId] of candidates) {
      if (lower.includes(keyword)) {
        const found = allRecipes.find(r => r.id === recipeId);
        if (found) return found;
      }
    }
    // If existing folders mostly use the same recipe, suggest that
    if (paths.length > 0) {
      const recipeCounts: Record<string, number> = {};
      paths.forEach(p => { recipeCounts[p.recipe] = (recipeCounts[p.recipe] ?? 0) + 1; });
      const mostUsed = Object.entries(recipeCounts).sort((a, b) => b[1] - a[1])[0];
      if (mostUsed && mostUsed[1] >= 2) {
        const found = allRecipes.find(r => r.id === mostUsed[0]);
        if (found) return found;
      }
    }
    return null;
  };

  const dryRun = async (p: WatchedPath) => {
    setDryRunLoading(p.id);
    setDryRunResult(null);
    try {
      const res = await fetch(`/api/settings/paths/${p.id}/scan/dry`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setDryRunResult({ id: p.id, ...data });
      }
    } catch { /* ignore */ }
    setDryRunLoading(null);
  };

  const openEdit = (p: WatchedPath) => {
    setForm({ path: p.path, recipe: p.recipe, recurse: p.recurse, extensions: p.extensions, priority: p.priority, minSizeMb: p.min_size_mb, preferredAudioLang: p.preferred_audio_lang ?? '', preferredSubtitleLang: p.preferred_subtitle_lang ?? '', scanIntervalHours: p.scan_interval_hours ?? 0, moveTo: p.move_to ?? '' });
    const found = allRecipes.find(r => r.id === p.recipe);
    setSelectedRecipe(found ?? null);
    setEditingId(p.id);
    setAdding(true);
  };

  const closeForm = () => {
    setAdding(false);
    setEditingId(null);
    setForm({ ...BLANK_FORM });
    const found = allRecipes.find(r => r.id === BLANK_FORM.recipe);
    setSelectedRecipe(found ?? null);
  };

  const save = async () => {
    const { preferredAudioLang, preferredSubtitleLang, scanIntervalHours, moveTo, ...rest } = form;
    const payload = {
      ...rest,
      preferred_audio_lang:    preferredAudioLang || null,
      preferred_subtitle_lang: preferredSubtitleLang || null,
      scan_interval_hours:     scanIntervalHours,
      move_to:                 moveTo || null,
    };
    setSaving(true);
    setSaveError('');
    try {
      if (editingId) {
        const res = await fetch(`/api/settings/paths/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setSaveError(d.error ?? 'Save failed — please try again');
          return;
        }
        closeForm();
        load();
      } else {
        const res = await fetch('/api/settings/paths', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          setSaveError(d.error ?? 'Save failed — please try again');
          return;
        }
        const newPath = await res.json();
        closeForm();
        load();
        if (newPath?.id) setPostAddId(newPath.id);
      }
    } catch {
      setSaveError('Network error — check your connection');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (p: WatchedPath) => {
    await fetch(`/api/settings/paths/${p.id}/toggle`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !p.enabled }),
    });
    load();
  };

  const del = async (id: string) => {
    await fetch(`/api/settings/paths/${id}`, { method: 'DELETE' });
    load();
  };

  const scanNow = async (p: WatchedPath) => {
    setScanningIds(prev => new Set(prev).add(p.id));
    try {
      await fetch(`/api/settings/paths/${p.id}/scan`, { method: 'POST' });
    } catch { /* ignore */ }
    // Clear after 60s max if WS event doesn't come (it goes to the Queue page)
    setTimeout(() => setScanningIds(prev => { const s = new Set(prev); s.delete(p.id); return s; }), 60_000);
  };

  return (
    <div className="animate-section space-y-4">
      {paths.length === 0 && !adding && (
        <div className="bg-surface border border-dashed border-border rounded-2xl p-10 text-center">
          <FolderOpen className="w-8 h-8 text-textMuted mx-auto mb-3" />
          <p className="text-white font-medium mb-1">No folders configured</p>
          <p className="text-textMuted text-sm">Add a folder to start scanning for media files.</p>
        </div>
      )}

      {paths.map(p => {
        const stats = folderStats[p.id];
        const isScanning = scanningIds.has(p.id);
        return (
        <div key={p.id} className={`card-hover bg-surface border border-border rounded-2xl p-5 transition-opacity ${!p.enabled ? 'opacity-50' : ''}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-white font-mono text-sm font-medium truncate">{p.path}</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Badge label={p.recipe} color="primary" />
                <Badge label={p.priority.toUpperCase()} color="neutral" />
                <Badge label={p.recurse ? 'Recursive' : 'Top-level only'} color="neutral" />
                <Badge label={`≥ ${p.min_size_mb} MB`} color="neutral" />
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-2">
                <p className="text-textMuted text-xs font-mono">{p.extensions}</p>
                {(p.scan_interval_hours ?? 0) > 0 && (
                  <span className="flex items-center gap-1 text-xs text-sky-400">
                    <Clock className="w-3 h-3" />
                    {p.scan_interval_hours === 6 ? 'Every 6h'
                      : p.scan_interval_hours === 12 ? 'Every 12h'
                      : p.scan_interval_hours === 24 ? 'Daily'
                      : p.scan_interval_hours === 48 ? 'Every 2 days'
                      : p.scan_interval_hours === 168 ? 'Weekly'
                      : `Every ${p.scan_interval_hours}h`}
                  </span>
                )}
                {p.last_scan_at != null && p.last_scan_at > 0 && (
                  <span className="text-xs text-textMuted/60">Last scanned {lastScannedLabel(p.last_scan_at)}</span>
                )}
                {p.move_to && (
                  <span className="flex items-center gap-1 text-xs text-textMuted/60">
                    <ArrowRightCircle className="w-3 h-3" /> moves to {p.move_to}
                  </span>
                )}
              </div>
              {/* Per-folder live stats */}
              {stats && stats.complete > 0 && (
                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border/50">
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                    <span className="text-white font-medium">{stats.complete}</span>
                    <span className="text-textMuted">done</span>
                  </span>
                  {stats.queued > 0 && (
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                      <span className="text-white font-medium">{stats.queued}</span>
                      <span className="text-textMuted">queued</span>
                    </span>
                  )}
                  {stats.active > 0 && (
                    <span className="flex items-center gap-1.5 text-xs">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                      <span className="text-white font-medium">{stats.active}</span>
                      <span className="text-textMuted">active</span>
                    </span>
                  )}
                  {stats.gbSaved > 0.01 && (
                    <span className="text-xs text-green-400 font-semibold ml-auto">{stats.gbSaved.toFixed(2)} GB saved</span>
                  )}
                </div>
              )}
              {/* Dry-run result */}
              {dryRunResult?.id === p.id && (
                <div className="flex items-center gap-4 mt-2 px-3 py-2 bg-primary/5 border border-primary/15 rounded-lg text-xs">
                  <span className="text-primary font-semibold">{dryRunResult.wouldQueue} would queue</span>
                  <span className="text-textMuted">{dryRunResult.alreadyProcessed} already done</span>
                  {dryRunResult.alreadyActive > 0 && <span className="text-textMuted">{dryRunResult.alreadyActive} in progress</span>}
                  <button onClick={() => setDryRunResult(null)} className="ml-auto text-textMuted hover:text-white transition-colors"><X className="w-3 h-3" /></button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              <button
                onClick={() => dryRun(p)}
                disabled={dryRunLoading === p.id}
                title="Preview what would be queued without actually queuing"
                className="text-xs text-textMuted hover:text-sky-400 transition-colors px-2.5 py-1.5 border border-border rounded-lg disabled:opacity-40 flex items-center gap-1"
              >
                {dryRunLoading === p.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Filter className="w-3 h-3" />}
                Dry Run
              </button>
              <button
                onClick={() => scanNow(p)}
                disabled={isScanning}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 border rounded-lg transition-all ${
                  isScanning
                    ? 'border-primary/30 text-primary bg-primary/5 cursor-not-allowed'
                    : 'border-border text-textMuted hover:text-primary hover:border-primary/30'
                }`}
              >
                {isScanning
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Scanning…</>
                  : <><Scan className="w-3 h-3" /> Scan Now</>
                }
              </button>
              <button onClick={() => openEdit(p)} title="Edit folder" className="text-textMuted hover:text-white transition-colors">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => toggle(p)} className="text-textMuted hover:text-white transition-colors">
                {p.enabled ? <ToggleRight className="w-5 h-5 text-primary" /> : <ToggleLeft className="w-5 h-5" />}
              </button>
              <button onClick={() => del(p.id)} className="text-textMuted hover:text-red-400 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        );
      })}

      {/* Add / Edit modal */}
      {adding && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 pt-20 lg:pt-4 animate-in fade-in duration-200">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-xl max-h-[85vh] flex flex-col shadow-2xl animate-in zoom-in-95 duration-200">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
              <h3 className="text-white font-bold">{editingId ? 'Edit Watched Folder' : 'Add Watched Folder'}</h3>
              <button onClick={closeForm} className="text-textMuted hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable form body */}
            <div className="overflow-y-auto flex-1 p-6 space-y-4">
              <div>
                <label className="text-xs text-textMuted font-medium mb-1.5 block">Folder Path</label>
                <div className="flex gap-2">
                  <input
                    value={form.path}
                    onChange={e => setForm(f => ({ ...f, path: e.target.value }))}
                    placeholder="/data/media/movies"
                    disabled={!!editingId}
                    className="flex-1 bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50 font-mono disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {!editingId && (
                    <button
                      title="Browse Folders"
                      onClick={() => setExplorerOpen(true)}
                      className="px-4 py-2 bg-background border border-border rounded-xl hover:bg-white/5 transition-colors text-textMuted hover:text-white flex items-center justify-center shrink-0"
                    >
                      <FolderOpen className="w-5 h-5 text-primary" />
                    </button>
                  )}
                </div>
                {editingId && <p className="text-xs text-textMuted/50 mt-1">Path cannot be changed — delete and re-add to use a different path.</p>}
              </div>

              {/* Recipe picker */}
              <div>
                <label className="text-xs text-textMuted font-medium mb-1.5 block">Recipe</label>
                <button
                  onClick={() => setRecipePickerOpen(true)}
                  className="w-full flex items-center justify-between bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white hover:border-primary/40 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    {selectedRecipe ? (
                      <>
                        <span>{selectedRecipe.icon}</span>
                        <span className="font-medium">{selectedRecipe.name}</span>
                        {selectedRecipe.estimatedReduction !== undefined && selectedRecipe.estimatedReduction > 0 && (
                          <span className="text-xs text-textMuted">~{selectedRecipe.estimatedReduction}% smaller</span>
                        )}
                      </>
                    ) : (
                      <span className="text-textMuted">Choose a recipe…</span>
                    )}
                  </span>
                  <ChevronRight className="w-4 h-4 text-textMuted" />
                </button>
                {/* Smart suggestion — only for new folders with a path typed */}
                {!editingId && form.path && (() => {
                  const suggestion = suggestRecipe(form.path);
                  if (!suggestion || suggestion.id === form.recipe) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => { setSelectedRecipe(suggestion); setForm(f => ({ ...f, recipe: suggestion.id })); }}
                      className="mt-1.5 flex items-center gap-1.5 text-xs text-primary/70 hover:text-primary transition-colors"
                    >
                      <span className="text-[10px]">{suggestion.icon}</span>
                      Suggested: {suggestion.name}
                      <span className="text-textMuted/60">— tap to apply</span>
                    </button>
                  );
                })()}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-textMuted font-medium mb-1.5 block">Priority</label>
                  <select
                    value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                    className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none appearance-none"
                  >
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-textMuted font-medium mb-1.5 block">Min File Size (MB)</label>
                  <input
                    type="number"
                    value={form.minSizeMb}
                    onChange={e => setForm(f => ({ ...f, minSizeMb: parseInt(e.target.value) }))}
                    className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-textMuted font-medium mb-1.5 block">Audio Language</label>
                  <select
                    value={form.preferredAudioLang}
                    onChange={e => setForm(f => ({ ...f, preferredAudioLang: e.target.value }))}
                    className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none appearance-none"
                  >
                    {LANG_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-textMuted font-medium mb-1.5 block">Subtitle Language</label>
                  <select
                    value={form.preferredSubtitleLang}
                    onChange={e => setForm(f => ({ ...f, preferredSubtitleLang: e.target.value }))}
                    className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none appearance-none"
                  >
                    {LANG_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-textMuted font-medium mb-1.5 block">Extensions</label>
                <input
                  value={form.extensions}
                  onChange={e => setForm(f => ({ ...f, extensions: e.target.value }))}
                  className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none font-mono"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.recurse}
                    onChange={e => setForm(f => ({ ...f, recurse: e.target.checked }))}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="text-sm text-white">Scan subdirectories</span>
                </label>

                <div className="flex items-center gap-2">
                  <label className="text-xs text-textMuted font-medium whitespace-nowrap">Periodic re-scan</label>
                  <select
                    value={form.scanIntervalHours}
                    onChange={e => setForm(f => ({ ...f, scanIntervalHours: parseInt(e.target.value) }))}
                    className="bg-background border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none appearance-none"
                  >
                    <option value={0}>Off</option>
                    <option value={6}>Every 6h</option>
                    <option value={12}>Every 12h</option>
                    <option value={24}>Daily</option>
                    <option value={48}>Every 2 days</option>
                    <option value={168}>Weekly</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-textMuted font-medium block mb-1.5">
                  Move completed files to <span className="text-textMuted/60">(optional)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.moveTo}
                    onChange={e => setForm(f => ({ ...f, moveTo: e.target.value }))}
                    placeholder="Leave empty to keep files in place"
                    className="flex-1 bg-background border border-border rounded-xl px-3 py-2 text-sm text-white placeholder:text-textMuted/50 focus:outline-none focus:border-primary/50 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setMoveToExplorerOpen(true)}
                    className="px-3 py-2 bg-background border border-border rounded-xl text-textMuted hover:text-white hover:border-primary/40 transition-colors text-xs"
                  >
                    Browse
                  </button>
                </div>
                <p className="text-xs text-amber-400/70 mt-1.5 flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                  After transcoding, the new file is moved here and the <strong>original is deleted</strong>. Leave empty to replace the original in place.
                </p>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex gap-2 px-6 py-4 border-t border-border shrink-0">
              <button
                onClick={save}
                disabled={saving || !form.path || !form.recipe}
                className="flex items-center gap-2 px-5 py-2 bg-primary text-background text-sm font-bold rounded-xl hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {saving ? 'Saving…' : (editingId ? 'Save Changes' : 'Add Folder')}
              </button>
              <button onClick={closeForm} className="px-5 py-2 text-textMuted text-sm rounded-xl hover:text-white transition-colors">
                Cancel
              </button>
            </div>
            {saveError && (
              <p className="text-red-400 text-xs flex items-center gap-1.5 px-6 pb-3">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{saveError}
              </p>
            )}
          </div>
        </div>
      )}

      {!adding && !editingId && (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 text-sm text-textMuted hover:text-white transition-colors px-4 py-2.5 border border-dashed border-border rounded-xl w-full justify-center"
        >
          <Plus className="w-4 h-4" /> Add Watched Folder
        </button>
      )}

      {postAddId && (
        <div className="flex items-start gap-4 p-4 bg-green-900/10 border border-green-500/20 rounded-2xl animate-in fade-in slide-in-from-bottom-2 duration-300">
          <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-white font-medium text-sm mb-1">Folder added successfully</p>
            <p className="text-textMuted text-xs">Scan now to queue existing files for transcoding?</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={async () => {
                const id = postAddId;
                setPostAddId(null);
                setScanningIds(prev => new Set(prev).add(id));
                try { await fetch(`/api/settings/paths/${id}/scan`, { method: 'POST' }); }
                finally { setScanningIds(prev => { const s = new Set(prev); s.delete(id); return s; }); }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-500/20 border border-green-500/30 text-green-400 text-xs font-bold rounded-lg hover:bg-green-500/30 transition-colors"
            >
              <Scan className="w-3.5 h-3.5" /> Scan Now
            </button>
            <button onClick={() => setPostAddId(null)} className="px-3 py-1.5 text-textMuted text-xs hover:text-white transition-colors">
              Later
            </button>
          </div>
        </div>
      )}

      <FileExplorerModal
        open={explorerOpen}
        onClose={() => setExplorerOpen(false)}
        initialPath={form.path}
        onSelect={(p) => { setForm(f => ({ ...f, path: p })); setExplorerOpen(false); }}
        allowMkdir
        mkdirUrl={`${apiUrl}/api/settings/fs/mkdir`}
      />

      <FileExplorerModal
        open={moveToExplorerOpen}
        onClose={() => setMoveToExplorerOpen(false)}
        initialPath={form.moveTo || form.path}
        onSelect={(p) => { setForm(f => ({ ...f, moveTo: p })); setMoveToExplorerOpen(false); }}
        allowMkdir
        mkdirUrl={`${apiUrl}/api/settings/fs/mkdir`}
      />

      <RecipePickerModal
        open={recipePickerOpen}
        onClose={() => setRecipePickerOpen(false)}
        selectedId={form.recipe}
        apiUrl={apiUrl}
        onSelect={(r) => { setSelectedRecipe(r); setForm(f => ({ ...f, recipe: r.id })); }}
      />
    </div>
  );
}

// ─── Smart Filters ────────────────────────────────────────────────────────────

interface SmartFilters {
  skipAlreadyTargetCodec: boolean;
  skipBelowBitrateKbps: number | null;
  skipBelowHeightPx: number | null;
  skipBelowSizeMb: number | null;
  skipKeywords: string[];
  skipDolbyAtmos: boolean;
}

function SmartFiltersPanel() {
  const [filters, setFilters] = useState<SmartFilters>({
    skipAlreadyTargetCodec: true,
    skipBelowBitrateKbps: 500,
    skipBelowHeightPx: 480,
    skipBelowSizeMb: 50,
    skipKeywords: ['REMUX', 'BDREMUX'],
    skipDolbyAtmos: true,
  });
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMount = useRef(true);

  useEffect(() => {
    fetch('/api/settings/filters').then(r => r.json()).then(setFilters).catch(() => {});
  }, []);

  useEffect(() => {
    if (isInitialMount.current) { isInitialMount.current = false; return; }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setAutoSaveStatus('saving');
    saveTimerRef.current = setTimeout(async () => {
      await fetch('/api/settings/filters', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(filters),
      });
      setAutoSaveStatus('saved');
      setTimeout(() => setAutoSaveStatus('idle'), 2000);
    }, 800);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [filters]);

  const set = (key: keyof SmartFilters, val: any) => setFilters(f => ({ ...f, [key]: val }));

  return (
    <div className="animate-section space-y-4">
      <p className="text-textMuted text-sm">These rules are evaluated <strong className="text-white">before</strong> any job is created. Files that match are skipped and marked in the Library.</p>

      <div className="card-hover bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden">
        <FilterRow title="Skip already in target codec" description="If the file is already in the recipe's target codec, skip it entirely." enabled={filters.skipAlreadyTargetCodec} onToggle={v => set('skipAlreadyTargetCodec', v)} />
        <FilterRow title="Skip low-bitrate files" description="Files already heavily compressed at this bitrate probably won't benefit from re-encoding." enabled={filters.skipBelowBitrateKbps !== null} onToggle={v => set('skipBelowBitrateKbps', v ? 500 : null)}>
          {filters.skipBelowBitrateKbps !== null && (
            <>
              <NumberInput label="Below (kbps)" value={filters.skipBelowBitrateKbps} onChange={v => set('skipBelowBitrateKbps', v)} />
              <p className="text-xs text-textMuted/50 mt-1.5">Typical reference: 1080p H.264 ≈ 4,000 kbps · 1080p H.265 ≈ 2,000 kbps · 4K H.265 ≈ 8,000 kbps</p>
            </>
          )}
        </FilterRow>
        <FilterRow title="Skip low-resolution files" description="Don't waste GPU time on content below a certain height." enabled={filters.skipBelowHeightPx !== null} onToggle={v => set('skipBelowHeightPx', v ? 480 : null)}>
          {filters.skipBelowHeightPx !== null && <NumberInput label="Below (px height)" value={filters.skipBelowHeightPx} onChange={v => set('skipBelowHeightPx', v)} />}
        </FilterRow>
        <FilterRow title="Skip small files" description="Skip files under a minimum size — likely already compact." enabled={filters.skipBelowSizeMb !== null} onToggle={v => set('skipBelowSizeMb', v ? 50 : null)}>
          {filters.skipBelowSizeMb !== null && <NumberInput label="Below (MB)" value={filters.skipBelowSizeMb} onChange={v => set('skipBelowSizeMb', v)} />}
        </FilterRow>
        <FilterRow title="Preserve lossless audio (Dolby Atmos / TrueHD / DTS-HD MA)" description="Skip files with Dolby Atmos or lossless audio tracks. Re-encoding always degrades lossless audio quality — enable this to protect high-fidelity content." enabled={filters.skipDolbyAtmos} onToggle={v => set('skipDolbyAtmos', v)} />
        <FilterRow title="Skip by filename keywords" description="Skip files whose name contains any of these words (comma-separated)." enabled={filters.skipKeywords.length > 0} onToggle={v => set('skipKeywords', v ? ['REMUX'] : [])}>
          {filters.skipKeywords.length > 0 && (
            <>
              <input
                className="mt-3 w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-primary/50"
                value={filters.skipKeywords.join(', ')}
                onChange={e => set('skipKeywords', e.target.value.split(',').map(k => k.trim()).filter(Boolean))}
                placeholder="REMUX, BDREMUX, BLURAY"
              />
              <p className="text-xs text-textMuted/50 mt-1">Case-insensitive — REMUX and remux both match.</p>
            </>
          )}
        </FilterRow>
      </div>

      <div className="flex items-center gap-2 text-xs text-textMuted">
        {autoSaveStatus === 'saving' && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Auto-saving…</>}
        {autoSaveStatus === 'saved' && <><CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> <span className="text-green-400">Saved</span></>}
        {autoSaveStatus === 'idle' && <span className="text-textMuted/40">Changes save automatically</span>}
      </div>
    </div>
  );
}

function FilterRow({ title, description, enabled, onToggle, children }: {
  title: string; description: string; enabled: boolean; onToggle: (v: boolean) => void; children?: React.ReactNode;
}) {
  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="text-white font-medium text-sm">{title}</p>
          <p className="text-textMuted text-xs mt-0.5">{description}</p>
          {enabled && children && <div>{children}</div>}
        </div>
        <button
          onClick={() => onToggle(!enabled)}
          className={`shrink-0 w-10 h-6 rounded-full transition-colors relative ${enabled ? 'bg-primary' : 'bg-border'}`}
        >
          <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-200 ${enabled ? 'left-5' : 'left-1'}`} />
        </button>
      </div>
    </div>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3 mt-3">
      <span className="text-xs text-textMuted">{label}</span>
      <input
        type="number"
        value={value}
        onChange={e => onChange(parseInt(e.target.value) || 0)}
        className="w-28 bg-background border border-border rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none"
      />
    </div>
  );
}

// ─── Recipes ──────────────────────────────────────────────────────────────────

function RecipesPanel({ apiUrl }: { apiUrl: string }) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [customBuilderOpen, setCustomBuilderOpen] = useState(false);
  const [forkRecipe, setForkRecipe] = useState<Recipe | null>(null);
  const [recipeStats, setRecipeStats] = useState<Record<string, { avgFps: number; jobCount: number }>>({});
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const load = () => fetch(`${apiUrl}/api/settings/recipes`).then(r => r.json()).then(setRecipes).catch(() => {});

  useEffect(() => {
    load();
    fetch(`${apiUrl}/api/settings/recipes/stats`)
      .then(r => r.json())
      .then(setRecipeStats)
      .catch(() => {});
  }, []);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const builtIn   = recipes.filter(r => !r.sourceUrl);
  const community = recipes.filter(r =>  r.sourceUrl);

  return (
    <div className="animate-section space-y-6 relative">
      {/* Toast */}
      {toastMsg && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 bg-green-900/90 border border-green-500/30 rounded-xl text-green-400 text-sm shadow-xl animate-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {toastMsg}
        </div>
      )}

      {/* Built-in */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-textMuted mb-4">Built-in Recipes ({builtIn.length})</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {builtIn.map(r => (
            <RecipeCard
              key={r.id} recipe={r}
              stats={recipeStats[r.id]}
              onFork={() => { setForkRecipe(r); setCustomBuilderOpen(true); }}
            />
          ))}
        </div>
      </div>

      {/* Community */}
      {community.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-widest text-textMuted mb-4">Community Recipes ({community.length})</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {community.map(r => (
              <RecipeCard key={r.id} recipe={r} community
                stats={recipeStats[r.id]}
                onDelete={async () => {
                  await fetch(`${apiUrl}/api/settings/recipes/custom/${r.id}`, { method: 'DELETE' });
                  load();
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setImportOpen(true)}
          className="flex items-center gap-2 text-sm text-textMuted hover:text-white transition-colors px-4 py-2.5 border border-dashed border-border rounded-xl"
        >
          <Plus className="w-4 h-4" /> Import Community Recipe…
        </button>
        <button
          onClick={() => { setForkRecipe(null); setCustomBuilderOpen(true); }}
          className="flex items-center gap-2 text-sm text-textMuted hover:text-white transition-colors px-4 py-2.5 border border-dashed border-border rounded-xl"
        >
          <Code2 className="w-4 h-4" /> Create Custom Recipe…
        </button>
      </div>

      <ImportRecipeModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => { load(); showToast('Recipe imported successfully!'); }}
        apiUrl={apiUrl}
      />

      <CustomRecipeModal
        open={customBuilderOpen}
        onClose={() => { setCustomBuilderOpen(false); setForkRecipe(null); }}
        onSuccess={() => { load(); showToast(forkRecipe ? `Forked "${forkRecipe.name}" as a custom recipe!` : 'Custom recipe created!'); setCustomBuilderOpen(false); setForkRecipe(null); }}
        apiUrl={apiUrl}
        initial={forkRecipe}
      />
    </div>
  );
}

function ImportRecipeModal({ open, onClose, onSuccess, apiUrl }: { open: boolean; onClose: () => void; onSuccess?: () => void; apiUrl: string }) {
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => { if (!open) { setUrl(''); setError(''); setSuccess(''); } }, [open]);

  const handleImport = async () => {
    if (!url.trim()) return;
    setImporting(true); setError(''); setSuccess('');
    try {
      const res = await fetch(`${apiUrl}/api/settings/recipes/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Import failed'); return; }
      setSuccess(`Imported ${data.imported ?? 'recipe(s)'} successfully!`);
      setTimeout(() => { onClose(); onSuccess?.(); }, 1200);
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 pt-20 lg:pt-4 animate-in fade-in duration-200">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-white font-bold">Import Community Recipe</h2>
          <button onClick={onClose} className="text-textMuted hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-textMuted text-sm">
            Paste a URL that returns a JSON array of recipe objects. Works with GitHub raw URLs.
          </p>
          <div>
            <label className="text-xs text-textMuted font-medium mb-1.5 block">Recipe URL</label>
            <input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleImport()}
              placeholder="https://raw.githubusercontent.com/…/recipes.json"
              autoFocus
              className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white font-mono placeholder:text-textMuted/50 focus:outline-none focus:border-primary/50"
            />
          </div>
          {error && (
            <p className="text-red-400 text-sm flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />{error}
            </p>
          )}
          {success && (
            <p className="text-green-400 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />{success}
            </p>
          )}
        </div>
        <div className="flex gap-2 px-6 py-4 border-t border-border">
          <button
            onClick={handleImport}
            disabled={importing || !url.trim()}
            className="flex items-center gap-2 px-5 py-2 bg-primary text-background text-sm font-bold rounded-xl hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {importing ? 'Importing…' : 'Import'}
          </button>
          <button onClick={onClose} className="px-5 py-2 text-textMuted text-sm rounded-xl hover:text-white transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function RecipeCard({ recipe, community, onDelete, stats, onFork }: {
  recipe: Recipe; community?: boolean; onDelete?: () => void;
  stats?: { avgFps: number; jobCount: number };
  onFork?: () => void;
}) {
  const [showArgs, setShowArgs] = useState(false);
  const hasArgs = community && (recipe.ffmpegArgs?.length ?? 0) > 0;

  return (
    <div className="card-hover bg-surface border border-border rounded-2xl p-5">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-2xl">{recipe.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-white font-bold text-sm">{recipe.name}</h3>
            {community && <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-purple-900/30 text-purple-400 border border-purple-500/20">Community</span>}
          </div>
          <p className="text-textMuted text-xs mt-0.5">{recipe.description}</p>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Badge label={recipe.targetCodec.toUpperCase()} color="primary" />
        <Badge label={`.${recipe.targetContainer}`} color="neutral" />
        {recipe.estimatedReduction !== undefined && recipe.estimatedReduction > 0 && (
          <Badge label={`~${recipe.estimatedReduction}% smaller`} color="green" />
        )}
        {stats && stats.jobCount > 0 && (
          <span className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-lg border bg-background text-textMuted border-border/50">
            <Zap className="w-3 h-3 text-primary/60" /> {stats.avgFps.toFixed(1)} fps avg
          </span>
        )}
      </div>
      {hasArgs && (
        <>
          <button
            onClick={() => setShowArgs(s => !s)}
            className="mt-3 flex items-center gap-1.5 text-xs text-textMuted/60 hover:text-textMuted transition-colors"
          >
            <Code2 className="w-3 h-3" />
            {showArgs ? 'Hide' : 'Show'} ffmpeg args ({recipe.ffmpegArgs!.length})
          </button>
          {showArgs && (
            <div className="mt-2 p-3 bg-background rounded-lg font-mono text-[10px] text-textMuted/80 leading-relaxed break-all">
              {recipe.ffmpegArgs!.join(' ')}
            </div>
          )}
        </>
      )}
      {(onFork || (community && onDelete)) && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
          {onFork && (
            <button
              onClick={onFork}
              className="flex items-center gap-1.5 text-xs text-textMuted hover:text-primary transition-colors"
            >
              <Copy className="w-3.5 h-3.5" /> Fork recipe
            </button>
          )}
          {community && onDelete && (
            <button
              onClick={onDelete}
              className="flex items-center gap-1.5 text-xs text-textMuted hover:text-red-400 transition-colors ml-auto"
            >
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CustomRecipeModal({ open, onClose, onSuccess, apiUrl, initial }: {
  open: boolean; onClose: () => void; onSuccess: () => void; apiUrl: string; initial?: Recipe | null;
}) {
  const [form, setForm] = useState({ name: '', description: '', icon: '⚙️', targetCodec: 'hevc', targetContainer: 'mkv', ffmpegArgs: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) { setError(''); return; }
    if (initial) {
      setForm({
        name:            `${initial.name} (copy)`,
        description:     initial.description,
        icon:            initial.icon,
        targetCodec:     initial.targetCodec,
        targetContainer: initial.targetContainer,
        ffmpegArgs:      initial.ffmpegArgs?.join(' ') ?? '',
      });
    } else {
      setForm({ name: '', description: '', icon: '⚙️', targetCodec: 'hevc', targetContainer: 'mkv', ffmpegArgs: '' });
    }
  }, [open, initial]);

  const save = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        name: form.name.trim(), description: form.description.trim(),
        icon: form.icon || '⚙️', targetCodec: form.targetCodec, targetContainer: form.targetContainer,
        ffmpegArgs: form.ffmpegArgs.trim() ? form.ffmpegArgs.trim().split(/\s+/) : undefined,
      };
      const res = await fetch(`${apiUrl}/api/settings/recipes/custom`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? 'Save failed'); return; }
      onSuccess();
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 pt-20 lg:pt-4 animate-in fade-in duration-200">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-white font-bold flex items-center gap-2">
            <Code2 className="w-4 h-4 text-primary" />
            {initial ? `Fork: ${initial.name}` : 'Create Custom Recipe'}
          </h2>
          <button onClick={onClose} className="text-textMuted hover:text-white transition-colors"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-xs text-textMuted">
            Custom recipes let you define arbitrary ffmpeg arguments. Leave ffmpeg args empty to use the built-in encoder logic for the selected codec.
          </p>
          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <div>
              <label className="text-xs text-textMuted font-medium mb-1.5 block">Recipe Name</label>
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                placeholder="My Custom Recipe" autoFocus
                className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50" />
            </div>
            <div>
              <label className="text-xs text-textMuted font-medium mb-1.5 block">Icon</label>
              <input value={form.icon} onChange={e => setForm(f => ({...f, icon: e.target.value}))}
                placeholder="⚙️" maxLength={4}
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none text-center text-xl" />
            </div>
          </div>
          <div>
            <label className="text-xs text-textMuted font-medium mb-1.5 block">Description</label>
            <input value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))}
              placeholder="Brief description of what this recipe does"
              className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-textMuted font-medium mb-1.5 block">Target Codec</label>
              <select value={form.targetCodec} onChange={e => setForm(f => ({...f, targetCodec: e.target.value}))}
                className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none appearance-none">
                <option value="hevc">H.265 (HEVC)</option>
                <option value="h264">H.264 (AVC)</option>
                <option value="av1">AV1</option>
                <option value="copy">Copy (Remux)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-textMuted font-medium mb-1.5 block">Container</label>
              <select value={form.targetContainer} onChange={e => setForm(f => ({...f, targetContainer: e.target.value}))}
                className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none appearance-none">
                <option value="mkv">MKV</option>
                <option value="mp4">MP4</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-textMuted font-medium mb-1.5 block">
              ffmpeg Args <span className="text-textMuted/50">(optional — overrides built-in encoder logic)</span>
            </label>
            <textarea
              value={form.ffmpegArgs}
              onChange={e => setForm(f => ({...f, ffmpegArgs: e.target.value}))}
              placeholder="-vf scale=1280:720 -crf 23 -preset slow"
              rows={3}
              className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white font-mono focus:outline-none focus:border-primary/50 resize-none"
            />
            <p className="text-xs text-textMuted/50 mt-1">Space-separated arguments. Input/output paths are added automatically.</p>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
        </div>
        <div className="flex gap-2 px-6 py-4 border-t border-border">
          <button onClick={save} disabled={saving || !form.name.trim()}
            className="flex items-center gap-2 px-5 py-2 bg-primary text-background text-sm font-bold rounded-xl hover:bg-primary/90 disabled:opacity-40 transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {initial ? 'Save Fork' : 'Create Recipe'}
          </button>
          <button onClick={onClose} className="px-5 py-2 text-textMuted text-sm rounded-xl hover:text-white transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Transfer ─────────────────────────────────────────────────────────────────

function TransferPanel({ apiUrl }: { apiUrl: string }) {
  const [workers, setWorkers] = useState<WorkerInfo[]>([]);
  const [speedLimit, setSpeedLimit] = useState('');
  const [speedSaved, setSpeedSaved] = useState(false);

  useEffect(() => {
    fetch(`${apiUrl}/api/workers`)
      .then(r => r.json())
      .then((ws: WorkerInfo[]) => setWorkers(ws.filter(w => w.status !== 'pending')))
      .catch(() => {});
    fetch(`${apiUrl}/api/settings/general`)
      .then(r => r.json())
      .then(data => setSpeedLimit(data.transfer_speed_limit_mbps ?? ''))
      .catch(() => {});
  }, [apiUrl]);

  const saveSpeedLimit = async () => {
    await fetch(`${apiUrl}/api/settings/general`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transfer_speed_limit_mbps: speedLimit }),
    });
    setSpeedSaved(true);
    setTimeout(() => setSpeedSaved(false), 2000);
  };

  return (
    <div className="animate-section space-y-5">
      <div className="flex items-start gap-3 p-4 bg-primary/5 border border-primary/15 rounded-xl">
        <Info className="w-4 h-4 text-primary/70 mt-0.5 shrink-0" />
        <p className="text-xs text-primary/80 leading-relaxed">
          <strong className="text-white">Shared Drive</strong> — the worker reads and writes your media files directly via a mapped network drive. Faster; requires a NAS or shared folder mounted on the worker.
          <br />
          <strong className="text-white">Direct Transfer</strong> — no network drive needed. The app sends the file to the worker over Wi-Fi/LAN, transcodes it, then sends the result back. Works anywhere.
        </p>
      </div>

      {/* Bandwidth throttle — applies to all wireless transfers */}
      <div className="card-hover bg-surface border border-border rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-1">
          <Gauge className="w-4 h-4 text-textMuted shrink-0" />
          <h3 className="text-white font-semibold text-sm">Transfer Speed Limit</h3>
        </div>
        <p className="text-xs text-textMuted mb-4 ml-7">Throttle wireless file transfers (download to worker + upload from worker). Set to 0 or leave empty for unlimited.</p>
        <div className="flex items-center gap-3">
          <input
            type="number" min={0} step={1}
            value={speedLimit}
            onChange={e => { setSpeedLimit(e.target.value); setSpeedSaved(false); }}
            placeholder="0 (unlimited)"
            className="w-36 bg-background border border-border rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-primary/40"
          />
          <span className="text-textMuted text-sm">Mbps</span>
          <button
            onClick={saveSpeedLimit}
            className={`ml-auto px-4 py-2 text-sm font-bold rounded-xl transition-colors ${speedSaved ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-primary text-background hover:bg-primary/90'}`}
          >
            {speedSaved ? '✓ Saved' : 'Save'}
          </button>
        </div>
      </div>

      {workers.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-2xl p-10 text-center">
          <p className="text-white font-medium mb-1">No accepted workers</p>
          <p className="text-textMuted text-sm">Accept a worker in the Fleet tab first, then configure its transfer mode here.</p>
        </div>
      ) : (
        workers.map(w => (
          <WorkerTransferCard key={w.id} worker={w} apiUrl={apiUrl} />
        ))
      )}
    </div>
  );
}

function WorkerTransferCard({ worker, apiUrl }: { worker: WorkerInfo; apiUrl: string }) {
  const [mode, setMode]         = useState<ConnectionMode>(worker.connectionMode ?? 'smb');
  const [mappings, setMappings] = useState<SmbMapping[]>(worker.smbMappings ?? []);
  const [saving, setSaving]     = useState(false);
  const [saveOk, setSaveOk]     = useState(false);
  const [dirty, setDirty]       = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [connResult, setConnResult]   = useState<'ok' | 'fail' | null>(null);
  const initializedRef          = useRef(false);

  // Mark dirty when user changes mode or mappings (skip on initial mount)
  useEffect(() => {
    if (!initializedRef.current) { initializedRef.current = true; return; }
    setDirty(true);
    setSaveOk(false);
  }, [mode, JSON.stringify(mappings)]);

  const fetchMainFs = useCallback(async (p?: string): Promise<FsResult> => {
    const url = `${apiUrl}/api/settings/fs${p ? `?path=${encodeURIComponent(p)}` : ''}`;
    return fetch(url).then(r => r.json());
  }, [apiUrl]);

  const fetchWorkerFs = useCallback(async (p?: string): Promise<FsResult> => {
    const proxyUrl = `${apiUrl}/api/workers/${worker.id}/fs${p ? `?path=${encodeURIComponent(p)}` : ''}`;
    try {
      const r = await fetch(proxyUrl);
      if (r.ok) return r.json();
    } catch { /**/ }
    return fetch(`http://${worker.host}:${worker.port}/fs${p ? `?path=${encodeURIComponent(p)}` : ''}`).then(r => r.json());
  }, [apiUrl, worker.host, worker.port, worker.id]);

  const mainBrowser   = useFsBrowser(fetchMainFs);
  const workerBrowser = useFsBrowser(fetchWorkerFs);
  const activeIdx   = useRef(-1);
  const activeField = useRef<'networkBasePath' | 'localBasePath'>('networkBasePath');

  const openBrowser = (idx: number, field: 'networkBasePath' | 'localBasePath') => {
    activeIdx.current   = idx;
    activeField.current = field;
    const val = field === 'networkBasePath' ? mappings[idx]?.networkBasePath : mappings[idx]?.localBasePath;
    if (field === 'networkBasePath') mainBrowser.browse(val || undefined);
    else workerBrowser.browse(val || undefined);
  };

  const handleSelect = (p: string) => {
    const i = activeIdx.current;
    const f = activeField.current;
    setMappings(m => m.map((mp, idx) => idx === i ? { ...mp, [f]: p } : mp));
  };

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`${apiUrl}/api/workers/${worker.id}/connection`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionMode: mode, mappings }),
      });
      setSaveOk(true);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTestingConn(true);
    setConnResult(null);
    try {
      const r = await fetch(`${apiUrl}/api/workers/${worker.id}/fs`, { signal: AbortSignal.timeout(5000) });
      setConnResult(r.ok ? 'ok' : 'fail');
    } catch {
      setConnResult('fail');
    }
    setTestingConn(false);
    setTimeout(() => setConnResult(null), 5000);
  };

  return (
    <>
      <FsBrowser
        open={mainBrowser.open} onClose={() => mainBrowser.setOpen(false)}
        loading={mainBrowser.loading} result={mainBrowser.result}
        onNavigate={mainBrowser.browse} onSelect={handleSelect}
        title="Main Node — Select Base Folder"
        hint="Select the root path on the Main node (e.g. /media or /mnt/data). All subfolders will be resolved automatically."
      />
      <FsBrowser
        open={workerBrowser.open} onClose={() => workerBrowser.setOpen(false)}
        loading={workerBrowser.loading} result={workerBrowser.result}
        onNavigate={workerBrowser.browse} onSelect={handleSelect}
        title="Worker Node — Select Base Folder"
        hint="Select the same folder as seen by this Worker via the network share (e.g. Z:\ on Windows, /mnt/media on Linux)."
      />

      <div className="card-hover bg-surface border border-border rounded-2xl p-6 space-y-5">
        {/* Worker header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-white font-bold">{worker.name}</h3>
            <p className="text-xs text-textMuted font-mono">{worker.host}:{worker.port}</p>
          </div>
          {mode === 'wireless' ? (
            <span className="px-2 py-1 text-xs font-medium rounded-lg border bg-blue-500/10 text-blue-400 border-blue-500/20 flex items-center gap-1">
              <Wifi className="w-3 h-3" /> Direct Transfer
            </span>
          ) : (
            <span className="px-2 py-1 text-xs font-medium rounded-lg border bg-green-500/10 text-green-400 border-green-500/20 flex items-center gap-1">
              <HardDrive className="w-3 h-3" /> Shared Drive
            </span>
          )}
        </div>

        {/* Mode toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setMode('smb')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-sm font-medium transition-all
              ${mode === 'smb' ? 'bg-primary/10 border-primary/40 text-primary' : 'bg-background border-border text-textMuted hover:text-white'}`}
          >
            <HardDrive className="w-4 h-4" /> Shared Drive
          </button>
          <button
            onClick={() => setMode('wireless')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-sm font-medium transition-all
              ${mode === 'wireless' ? 'bg-blue-500/10 border-blue-500/40 text-blue-400' : 'bg-background border-border text-textMuted hover:text-white'}`}
          >
            <Wifi className="w-4 h-4" /> Direct Transfer
          </button>
        </div>

        {/* SMB path mappings — base-path model */}
        {mode === 'smb' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 p-3 bg-primary/5 border border-primary/10 rounded-xl">
              <Info className="w-3.5 h-3.5 text-primary/70 mt-0.5 shrink-0" />
              <p className="text-xs text-primary/80 leading-relaxed">
                Add one mapping per network share root. All subfolders are resolved automatically — you only need to set this up once.
                <br />
                <span className="text-textMuted">Example: Main <code className="text-primary/70">/mnt/nas</code> → Worker <code className="text-primary/70">Z:\</code></span>
              </p>
            </div>

            {mappings.length === 0 && (
              <p className="text-xs text-yellow-400/70 px-1">No path mappings yet. Add at least one so this worker can find your media files.</p>
            )}

            {mappings.map((m, i) => (
              <div key={i} className="bg-background border border-border rounded-xl p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-textMuted mb-1.5 block">
                      Main Node root path
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        value={m.networkBasePath}
                        onChange={e => setMappings(ms => ms.map((mp, idx) => idx === i ? { ...mp, networkBasePath: e.target.value } : mp))}
                        placeholder="/mnt/nas or /media"
                        className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50 font-mono"
                      />
                      <button
                        onClick={() => openBrowser(i, 'networkBasePath')}
                        className="px-2.5 py-2 bg-surface border border-border rounded-lg text-textMuted hover:text-primary hover:border-primary/30 transition-colors"
                        title="Browse Main filesystem"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-textMuted mb-1.5 block">
                      Worker sees it as
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        value={m.localBasePath}
                        onChange={e => setMappings(ms => ms.map((mp, idx) => idx === i ? { ...mp, localBasePath: e.target.value } : mp))}
                        placeholder="Z:\ or /mnt/pi-media"
                        className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50 font-mono"
                      />
                      <button
                        onClick={() => openBrowser(i, 'localBasePath')}
                        className="px-2.5 py-2 bg-surface border border-border rounded-lg text-textMuted hover:text-primary hover:border-primary/30 transition-colors"
                        title="Browse Worker filesystem"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setMappings(ms => ms.filter((_, idx) => idx !== i))}
                        className="px-2.5 py-2 text-textMuted hover:text-red-400 transition-colors"
                        title="Remove mapping"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <button
              onClick={() => setMappings(m => [...m, { networkBasePath: '', localBasePath: '' }])}
              className="flex items-center gap-1.5 text-xs text-textMuted hover:text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add share root mapping
            </button>
          </div>
        )}

        {/* Wireless callout */}
        {mode === 'wireless' && (
          <div className="flex items-start gap-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
            <Wifi className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-white font-medium mb-1">No path configuration needed</p>
              <p className="text-xs text-textMuted leading-relaxed">
                Files are transferred automatically over your local network — no shared filesystem required.
                The pipeline runs in three stages: <span className="text-blue-400">Receive → Transcode → Send back</span>.
              </p>
            </div>
          </div>
        )}

        {/* Save + Test */}
        <div className="flex items-center justify-between pt-1 border-t border-border gap-3 flex-wrap">
          {mode === 'smb' && (
            <button
              onClick={testConnection}
              disabled={testingConn}
              className={`mt-4 flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl border transition-colors disabled:opacity-50
                ${connResult === 'ok'   ? 'border-green-500/40 text-green-400 bg-green-500/10'
                : connResult === 'fail' ? 'border-red-500/40 text-red-400 bg-red-500/10'
                : 'border-border text-textMuted hover:text-white hover:border-primary/40'}`}
            >
              {testingConn
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing…</>
                : connResult === 'ok'   ? '✓ Connected'
                : connResult === 'fail' ? '✗ Unreachable'
                : <><FlaskConical className="w-3.5 h-3.5" /> Test Connection</>}
            </button>
          )}
          <button
            onClick={save}
            disabled={saving || (!dirty && saveOk)}
            className={`mt-4 ml-auto px-5 py-2.5 text-sm font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center gap-1.5
              ${saveOk && !dirty ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-primary text-background hover:bg-primary/90'}`}
          >
            {saving ? 'Saving…' : saveOk && !dirty ? '✓ Saved' : 'Save Transfer Config'}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── General ─────────────────────────────────────────────────────────────────

function GeneralPanel() {
  const { apiUrl, meta } = useAppState();
  const [settings, setSettings] = useState({ nodeName: '', port: '', maxConcurrentJobs: '2', queueStrategy: 'fifo', autoAcceptWorkers: 'false', mainUrl: '', preferred_audio_lang: '', preferred_subtitle_lang: '', diskSafeguardGb: '', activeHoursEnabled: false, activeHoursStart: '22', activeHoursEnd: '6' });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [pingState, setPingState] = useState<'idle' | 'pinging' | 'ok' | 'fail'>('idle');

  useEffect(() => {
    fetch(`${apiUrl}/api/settings/general`).then(r => r.json()).then(data => {
      setSettings(s => ({
        nodeName:               data.nodeName               ?? s.nodeName,
        port:                   data.port                   ?? s.port,
        maxConcurrentJobs:      data.max_concurrent_jobs    ?? data.maxConcurrentJobs ?? s.maxConcurrentJobs,
        queueStrategy:          data.queueStrategy          ?? s.queueStrategy,
        autoAcceptWorkers:      data.autoAcceptWorkers      ?? s.autoAcceptWorkers,
        mainUrl:                data.mainUrl                ?? s.mainUrl,
        preferred_audio_lang:   data.preferred_audio_lang   ?? '',
        preferred_subtitle_lang: data.preferred_subtitle_lang ?? '',
        diskSafeguardGb:        data.disk_safeguard_gb      ?? '',
        activeHoursEnabled:     !!data.active_hours,
        activeHoursStart:       data.active_hours ? (() => { try { return String(JSON.parse(data.active_hours).start ?? 22); } catch { return '22'; } })() : '22',
        activeHoursEnd:         data.active_hours ? (() => { try { return String(JSON.parse(data.active_hours).end   ?? 6);  } catch { return '6';  } })() : '6',
      }));
    }).catch(() => {});
  }, [apiUrl]);

  const save = async () => {
    setSaving(true);
    try {
      const { diskSafeguardGb, activeHoursEnabled, activeHoursStart, activeHoursEnd, ...rest } = settings;
      const payload: Record<string, string> = { ...rest, max_concurrent_jobs: settings.maxConcurrentJobs, port: settings.port };
      payload.disk_safeguard_gb = diskSafeguardGb;
      payload.active_hours = activeHoursEnabled
        ? JSON.stringify({ start: parseInt(activeHoursStart) || 22, end: parseInt(activeHoursEnd) || 6 })
        : '';
      await fetch(`${apiUrl}/api/settings/general`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const resetSetup = async () => {
    if (!confirm('Are you sure you want to completely reset Transcodarr? This will wipe your node role and restart the setup wizard.')) return;
    try {
      await fetch(`${window.location.origin}/api/settings/reset`, { method: 'POST' });
    } catch { /* server exits — expected */ }
    setTimeout(() => window.location.reload(), 1500);
  };

  return (
    <div className="animate-section space-y-6">
      <div className="card-hover bg-surface border border-border rounded-2xl p-6 space-y-5">
        <Field label="Node Display Name">
          <input
            value={settings.nodeName}
            onChange={e => setSettings(s => ({ ...s, nodeName: e.target.value }))}
            placeholder="Transcodarr Main"
            className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50"
          />
        </Field>

        <Field label="Port" hint="The port this node listens on. A restart is required after changing.">
          <input
            type="number"
            min={1}
            max={65535}
            value={settings.port}
            onChange={e => setSettings(s => ({ ...s, port: e.target.value }))}
            placeholder={meta.mode === 'worker' ? '3002' : '3001'}
            className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50"
          />
        </Field>

        <Field label="Max Simultaneous Jobs">
          <input
            type="number"
            min={1}
            max={32}
            value={settings.maxConcurrentJobs}
            onChange={e => setSettings(s => ({ ...s, maxConcurrentJobs: e.target.value }))}
            className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/40"
          />
        </Field>

        <Field label="Queue Strategy" hint={
          settings.queueStrategy === 'fifo'     ? 'Files are processed in the order they were discovered — first in, first out.'
        : settings.queueStrategy === 'largest'  ? 'Prioritise large files first — maximises space savings per batch.'
        : settings.queueStrategy === 'oldest'   ? 'Oldest files in your library get transcoded first.'
        : settings.queueStrategy === 'smallest' ? 'Small files first — see completed jobs sooner while large ones process overnight.'
        : undefined
        }>
          <select
            value={settings.queueStrategy}
            onChange={e => setSettings(s => ({ ...s, queueStrategy: e.target.value }))}
            className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none appearance-none"
          >
            <option value="fifo">FIFO (First In, First Out)</option>
            <option value="largest">Largest Files First</option>
            <option value="oldest">Oldest Files First</option>
            <option value="smallest">Smallest Files First</option>
          </select>
        </Field>

        <Field label="Auto-Accept Workers">
          <div className="flex items-center justify-between bg-background border border-border rounded-xl px-4 py-3">
            <span className="text-sm text-textMuted">Automatically trust new workers on your network</span>
            <button
              onClick={() => setSettings(s => ({ ...s, autoAcceptWorkers: s.autoAcceptWorkers === 'true' ? 'false' : 'true' }))}
              className={`shrink-0 w-10 h-6 rounded-full transition-colors relative ${settings.autoAcceptWorkers === 'true' ? 'bg-primary' : 'bg-border'}`}
            >
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${settings.autoAcceptWorkers === 'true' ? 'left-5' : 'left-1'}`} />
            </button>
          </div>
        </Field>

        {settings.autoAcceptWorkers === 'true' && (
          <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
            <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-400/80 leading-relaxed">
              <strong className="text-amber-400">Security notice:</strong> Any device on your local network can join as a worker without approval. Only enable this on trusted networks.
            </p>
          </div>
        )}

        {meta.mode !== 'worker' && (
          <>
            <Field label="Default Audio Language">
              <select
                value={settings.preferred_audio_lang}
                onChange={e => setSettings(s => ({ ...s, preferred_audio_lang: e.target.value }))}
                className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none appearance-none"
              >
                {LANG_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
              <p className="text-xs text-textMuted mt-1.5 ml-1">Global default — overridden per folder if set.</p>
            </Field>
            <Field label="Default Subtitle Language">
              <select
                value={settings.preferred_subtitle_lang}
                onChange={e => setSettings(s => ({ ...s, preferred_subtitle_lang: e.target.value }))}
                className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none appearance-none"
              >
                {LANG_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
              </select>
            </Field>

            <Field label="Disk Space Safeguard">
              <div className="flex items-center gap-3">
                <input
                  type="number" min={0} step={0.5}
                  value={settings.diskSafeguardGb}
                  onChange={e => setSettings(s => ({ ...s, diskSafeguardGb: e.target.value }))}
                  placeholder="0"
                  className="w-28 bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/40"
                />
                <span className="text-textMuted text-sm">GB minimum free space</span>
              </div>
              <p className="text-xs text-textMuted/60 mt-1.5 ml-1">Transcoding pauses if free disk space drops below this. Set to 0 to disable.</p>
            </Field>

            <Field label="Active Hours (Transcoding Window)">
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.activeHoursEnabled}
                    onChange={e => setSettings(s => ({ ...s, activeHoursEnabled: e.target.checked }))}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="text-sm text-white">Schedule enabled</span>
                </label>
                {settings.activeHoursEnabled && (
                  <>
                    <span className="text-textMuted text-sm">from</span>
                    <input
                      type="number" min={0} max={23}
                      value={settings.activeHoursStart}
                      onChange={e => setSettings(s => ({ ...s, activeHoursStart: e.target.value }))}
                      className="w-16 bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none text-center"
                    />
                    <span className="text-textMuted text-sm">:00 to</span>
                    <input
                      type="number" min={0} max={23}
                      value={settings.activeHoursEnd}
                      onChange={e => setSettings(s => ({ ...s, activeHoursEnd: e.target.value }))}
                      className="w-16 bg-background border border-border rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none text-center"
                    />
                    <span className="text-textMuted text-sm">:00</span>
                  </>
                )}
              </div>
              {settings.activeHoursEnabled && (
                <p className="text-xs text-textMuted/60 mt-1.5 ml-1">
                  Dispatch only runs in this window. Wraps midnight — e.g. <strong className="text-white">22 → 6</strong> means 10 PM to 6 AM.
                </p>
              )}
            </Field>
          </>
        )}

        {meta.mode === 'worker' && (
          <Field label="Main Node URL">
            <div className="flex gap-2">
              <input
                value={settings.mainUrl}
                onChange={e => { setSettings(s => ({ ...s, mainUrl: e.target.value })); setPingState('idle'); }}
                placeholder="http://192.168.0.63:3001"
                className="flex-1 bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50 font-mono"
              />
              <button
                onClick={async () => {
                  if (!settings.mainUrl) return;
                  setPingState('pinging');
                  try {
                    const res = await fetch(`${settings.mainUrl}/api/health`, { signal: AbortSignal.timeout(4000) });
                    setPingState(res.ok ? 'ok' : 'fail');
                  } catch { setPingState('fail'); }
                }}
                disabled={pingState === 'pinging' || !settings.mainUrl}
                className="shrink-0 px-3 py-2.5 rounded-xl border border-border text-xs font-medium text-textMuted hover:text-white hover:border-textMuted/50 transition-colors disabled:opacity-40 flex items-center gap-1.5"
              >
                {pingState === 'pinging' ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking…</> : 'Test'}
              </button>
            </div>
            {pingState === 'ok'   && <p className="mt-1.5 text-xs text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Main Node reachable</p>}
            {pingState === 'fail' && <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Cannot reach Main Node — check IP, port, and firewall</p>}
            <div className="flex items-start gap-2 mt-2 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-400/80">Requires a restart to apply. Save, then stop and relaunch the worker process.</p>
            </div>
          </Field>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2.5 bg-primary text-background text-sm font-bold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center gap-2"
        >
          {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : saved ? '✓ Saved!' : 'Save Settings'}
        </button>
      </div>

      <div className="space-y-3">
        <button
          onClick={() => setShowDangerZone(s => !s)}
          className="flex items-center gap-2 text-sm text-textMuted hover:text-white transition-colors"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${showDangerZone ? 'rotate-180' : ''}`} />
          {showDangerZone ? 'Hide danger zone' : 'Show danger zone'}
        </button>
        {showDangerZone && (
          <div className="card-hover bg-surface border border-red-500/20 rounded-2xl p-6">
            <h3 className="text-red-400 font-bold text-sm mb-1">Reset Setup</h3>
            <p className="text-textMuted text-xs mb-4">Wipe this node's role configuration and restart the onboarding wizard. The server will restart automatically.</p>
            <button
              onClick={resetSetup}
              className="px-5 py-2.5 bg-red-500/10 text-red-400 text-sm font-bold rounded-xl border border-red-500/30 hover:bg-red-500/20 transition-colors"
            >
              Reset Setup…
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Notifications Panel ─────────────────────────────────────────────────────

const WEBHOOK_EVENTS = [
  { id: 'job:complete', label: 'Job Complete' },
  { id: 'job:failed',   label: 'Job Failed'   },
  { id: 'job:queued',   label: 'Job Queued'   },
];

interface Webhook {
  id: string;
  url: string;
  events: string;
  secret?: string;
  enabled: number;
  last_fired?: number;
  last_delivery_ok?: number;
}

function relativeTime(unixSec: number): string {
  const secs = Math.floor(Date.now() / 1000) - unixSec;
  if (secs < 60)    return 'just now';
  if (secs < 3600)  return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function NotificationsPanel({ apiUrl }: { apiUrl: string }) {
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [newUrl, setNewUrl] = useState('');
  const [newEvents, setNewEvents] = useState<string[]>(['job:complete', 'job:failed']);
  const [newSecret, setNewSecret] = useState('');
  const [adding, setAdding] = useState(false);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [showSecret, setShowSecret] = useState(false);
  const [editShowSecret, setEditShowSecret] = useState(false);
  const [editingHookId, setEditingHookId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ url: '', events: [] as string[], secret: '' });

  const load = useCallback(async () => {
    const r = await fetch(`${apiUrl}/api/settings/webhooks`);
    const data = await r.json();
    setHooks(Array.isArray(data) ? data : []);
  }, [apiUrl]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!newUrl.trim()) return;
    await fetch(`${apiUrl}/api/settings/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: newUrl.trim(), events: newEvents, secret: newSecret || undefined }),
    });
    setNewUrl(''); setNewSecret(''); setAdding(false);
    load();
  };

  const remove = async (id: string) => {
    await fetch(`${apiUrl}/api/settings/webhooks/${id}`, { method: 'DELETE' });
    setHooks(prev => prev.filter(h => h.id !== id));
  };

  const toggle = async (hook: Webhook) => {
    await fetch(`${apiUrl}/api/settings/webhooks/${hook.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !hook.enabled }),
    });
    setHooks(prev => prev.map(h => h.id === hook.id ? { ...h, enabled: hook.enabled ? 0 : 1 } : h));
  };

  const test = async (id: string) => {
    setTestResult(r => ({ ...r, [id]: 'sending…' }));
    try {
      const res = await fetch(`${apiUrl}/api/settings/webhooks/${id}/test`, { method: 'POST' });
      if (res.ok) {
        setTestResult(r => ({ ...r, [id]: '✓ Delivered' }));
        setHooks(prev => prev.map(h => h.id === id ? { ...h, last_fired: Math.floor(Date.now() / 1000), last_delivery_ok: 1 } : h));
      } else {
        const data = await res.json().catch(() => ({}));
        const errMsg = (data.error ?? 'Failed').slice(0, 40);
        setTestResult(r => ({ ...r, [id]: `✗ ${errMsg}` }));
        setHooks(prev => prev.map(h => h.id === id ? { ...h, last_fired: Math.floor(Date.now() / 1000), last_delivery_ok: 0 } : h));
      }
    } catch {
      setTestResult(r => ({ ...r, [id]: '✗ Network error' }));
    }
    setTimeout(() => setTestResult(r => { const n = { ...r }; delete n[id]; return n; }), 4000);
  };

  return (
    <div className="animate-section space-y-6">
      <div className="card-hover bg-surface border border-border rounded-2xl p-6">
        <div className="flex items-start justify-between mb-1">
          <h3 className="text-white font-bold text-sm">Webhooks</h3>
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-background border border-border rounded-lg text-xs text-textMuted hover:text-white hover:border-primary/40 transition-all"
            >
              <Plus className="w-3.5 h-3.5" /> Add Webhook
            </button>
          )}
        </div>
        <p className="text-textMuted text-xs mb-5">
          Paste any URL — Discord, Slack, or custom endpoint. Transcodarr will POST a JSON payload when events fire.
        </p>

        {hooks.length === 0 && !adding && (
          <p className="text-textMuted text-sm py-6 text-center border border-dashed border-border rounded-xl">
            No webhooks configured yet.
          </p>
        )}

        <div className="space-y-2 mb-4">
          {hooks.map(hook => {
            let eventsArr: string[] = [];
            try { eventsArr = JSON.parse(hook.events); } catch {}
            return (
              <div key={hook.id} className={`bg-background border rounded-xl overflow-hidden ${hook.enabled ? 'border-border' : 'border-border/40 opacity-60'}`}>
                <div className="flex items-start gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate font-mono">{hook.url}</p>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {eventsArr.map(e => {
                        const tagStyle = e === 'job:complete' ? 'bg-green-900/20 border-green-500/25 text-green-400'
                                       : e === 'job:failed'   ? 'bg-red-900/20 border-red-500/25 text-red-400'
                                       : e === 'job:queued'   ? 'bg-sky-900/20 border-sky-500/25 text-sky-400'
                                       : 'bg-surface border-border text-textMuted';
                        return <span key={e} className={`px-1.5 py-0.5 text-[10px] rounded border ${tagStyle}`}>{e}</span>;
                      })}
                    </div>
                    {(hook.last_fired ?? 0) > 0 && (
                      <p className="text-[10px] text-textMuted/50 mt-1.5 flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${hook.last_delivery_ok === 1 ? 'bg-green-400' : 'bg-red-400'}`} />
                        {hook.last_delivery_ok === 1 ? 'Delivered' : 'Failed'} · {relativeTime(hook.last_fired!)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => test(hook.id)}
                      className="px-2.5 py-1 text-xs border border-border text-textMuted hover:text-white hover:border-primary/40 rounded-lg transition-colors"
                    >
                      {testResult[hook.id] ?? 'Test'}
                    </button>
                    <button
                      onClick={() => {
                        if (editingHookId === hook.id) { setEditingHookId(null); return; }
                        let evArr: string[] = [];
                        try { evArr = JSON.parse(hook.events); } catch {}
                        setEditForm({ url: hook.url, events: evArr, secret: '' });
                        setEditingHookId(hook.id);
                      }}
                      className="p-1.5 text-textMuted hover:text-white transition-colors"
                      title="Edit webhook"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => toggle(hook)} className="p-1.5 text-textMuted hover:text-white transition-colors">
                      {hook.enabled
                        ? <ToggleRight className="w-4 h-4 text-primary" />
                        : <ToggleLeft className="w-4 h-4" />}
                    </button>
                    <button onClick={() => remove(hook.id)} className="p-1.5 text-textMuted hover:text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {editingHookId === hook.id && (
                  <div className="border-t border-border bg-surface/50 p-3 space-y-3">
                    <div>
                      <label className="text-xs text-textMuted font-medium mb-1 block">URL</label>
                      <input value={editForm.url} onChange={e => setEditForm(f => ({...f, url: e.target.value}))}
                        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/40" />
                    </div>
                    <div className="flex gap-3 flex-wrap">
                      {WEBHOOK_EVENTS.map(ev => (
                        <label key={ev.id} className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={editForm.events.includes(ev.id)}
                            onChange={e => setEditForm(f => ({...f, events: e.target.checked ? [...f.events, ev.id] : f.events.filter(x => x !== ev.id)}))}
                            className="accent-primary" />
                          <span className="text-xs text-textMuted">{ev.label}</span>
                        </label>
                      ))}
                    </div>
                    <div>
                      <label className="text-xs text-textMuted font-medium mb-1 block">
                        HMAC Secret <span className="text-textMuted/40">(leave empty to keep current)</span>
                      </label>
                      <div className="relative">
                        <input
                          type={editShowSecret ? 'text' : 'password'}
                          value={editForm.secret}
                          onChange={e => setEditForm(f => ({...f, secret: e.target.value}))}
                          placeholder="Leave empty to keep current"
                          className="w-full bg-background border border-border rounded-lg px-3 py-2 pr-10 text-sm text-white placeholder:text-textMuted/40 focus:outline-none focus:border-primary/40"
                        />
                        <button
                          type="button"
                          onClick={() => setEditShowSecret(s => !s)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-textMuted hover:text-white transition-colors"
                        >
                          {editShowSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async () => {
                        await fetch(`${apiUrl}/api/settings/webhooks/${hook.id}`, {
                          method: 'PUT', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ url: editForm.url, events: editForm.events, secret: editForm.secret || undefined }),
                        });
                        setEditingHookId(null);
                        setEditShowSecret(false);
                        load();
                      }} className="px-3 py-1.5 bg-primary text-background text-xs font-bold rounded-lg hover:bg-primary/90 transition-colors">
                        Save
                      </button>
                      <button onClick={() => { setEditingHookId(null); setEditShowSecret(false); }} className="px-3 py-1.5 text-textMuted text-xs hover:text-white transition-colors">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {adding && (
          <div className="bg-background border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-white text-sm font-semibold">New Webhook</p>
              <button onClick={() => setAdding(false)} className="text-textMuted hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="text-xs text-textMuted font-medium mb-1.5 block">URL</label>
              <input
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/..."
                autoFocus
                className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-white placeholder:text-textMuted/50 focus:outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="text-xs text-textMuted font-medium mb-1.5 block">Fire on</label>
              <div className="flex gap-3 flex-wrap">
                {WEBHOOK_EVENTS.map(ev => (
                  <label key={ev.id} className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newEvents.includes(ev.id)}
                      onChange={e => setNewEvents(prev =>
                        e.target.checked ? [...prev, ev.id] : prev.filter(x => x !== ev.id)
                      )}
                      className="accent-primary"
                    />
                    <span className="text-xs text-textMuted">{ev.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-textMuted font-medium mb-1.5 block">
                HMAC Secret <span className="text-textMuted/50">(optional)</span>
              </label>
              <div className="relative">
                <input
                  value={newSecret}
                  onChange={e => setNewSecret(e.target.value)}
                  type={showSecret ? 'text' : 'password'}
                  placeholder="my-secret-key"
                  className="w-full bg-surface border border-border rounded-lg px-3 py-2 pr-10 text-sm text-white placeholder:text-textMuted/50 focus:outline-none focus:border-primary/40"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(s => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-textMuted hover:text-white transition-colors"
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={add}
                disabled={!newUrl.trim()}
                className="px-4 py-2 bg-primary text-background text-sm font-bold rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
              >
                Add Webhook
              </button>
              <button onClick={() => setAdding(false)} className="px-4 py-2 text-textMuted text-sm hover:text-white transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="text-xs text-textMuted font-medium mb-1.5 block">{label}</label>
      {children}
      {hint && <p className="text-xs text-textMuted/60 mt-1.5 ml-1">{hint}</p>}
    </div>
  );
}

function Badge({ label, color }: { label: string; color: 'primary' | 'neutral' | 'green' }) {
  const styles = {
    primary: 'bg-primary/10 text-primary border-primary/20',
    neutral: 'bg-background text-textMuted border-border/50',
    green:   'bg-green-900/30 text-green-400 border-green-500/20',
  };
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-lg border ${styles[color]}`}>
      {label}
    </span>
  );
}
