'use client';

import { useEffect, useState } from 'react';
import { FolderOpen, Plus, Trash2, ToggleLeft, ToggleRight, ChevronDown, Filter, Settings2, BookOpen } from 'lucide-react';
import { BUILT_IN_RECIPES } from '@transcodarr/shared';
import { useAppState } from '@/hooks/useTranscodarrSocket';

type Tab = 'folders' | 'filters' | 'recipes' | 'general';

export default function SettingsPage() {
  const { meta } = useAppState();
  const [tab, setTab] = useState<Tab>(meta.mode === 'worker' ? 'general' : 'folders');

  // Ensure tab is valid for current mode
  const effectiveTab = meta.mode === 'worker' && tab !== 'general' ? 'general' : tab;

  const mainTabs: { id: Tab; icon: React.ElementType; label: string }[] = [
    { id: 'folders',  icon: FolderOpen, label: 'Watched Folders' },
    { id: 'filters',  icon: Filter,     label: 'Smart Filters'   },
    { id: 'recipes',  icon: BookOpen,   label: 'Recipes'          },
    { id: 'general',  icon: Settings2,  label: 'General'          },
  ];

  const tabs = meta.mode === 'worker' 
    ? [{ id: 'general', icon: Settings2, label: 'General' } as const]
    : mainTabs;

  return (
    <div className="p-10 max-w-5xl mx-auto space-y-8">
      <header>
        <h1 className="text-4xl font-bold tracking-tight text-white mb-1">Settings</h1>
        <p className="text-textMuted">
          {meta.mode === 'worker' ? 'Configure worker preferences' : 'Configure scanning, filters, and preferences.'}
        </p>
      </header>

      {/* Tab bar */}
      <div className="flex gap-1 bg-surface p-1 rounded-xl border border-border w-fit">
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150
              ${tab === id ? 'bg-background text-white shadow-sm' : 'text-textMuted hover:text-white'}`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Panels */}
      {effectiveTab === 'folders' && meta.mode !== 'worker' && <WatchedFoldersPanel />}
      {effectiveTab === 'filters' && meta.mode !== 'worker' && <SmartFiltersPanel />}
      {effectiveTab === 'recipes' && meta.mode !== 'worker' && <RecipesPanel />}
      {effectiveTab === 'general' && <GeneralPanel />}
    </div>
  );
}

import { FileExplorerModal } from '@/components/FileExplorerModal';

// ─── Watched Folders ─────────────────────────────────────────────────────────

interface WatchedPath {
  id: string; path: string; recipe: string;
  enabled: boolean; recurse: boolean;
  extensions: string; priority: string; min_size_mb: number;
}

function WatchedFoldersPanel() {
  const [paths, setPaths] = useState<WatchedPath[]>([]);
  const [adding, setAdding] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [form, setForm] = useState({ path: '', recipe: 'hevc-1080p', recurse: true, extensions: '.mkv,.mp4,.avi,.ts', priority: 'normal', minSizeMb: 100 });

  const load = () => fetch('/api/settings/paths').then(r => r.json()).then(setPaths).catch(() => {});
  useEffect(() => { load(); }, []);

  const save = async () => {
    await fetch('/api/settings/paths', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form }),
    });
    setAdding(false);
    setForm({ path: '', recipe: 'hevc-1080p', recurse: true, extensions: '.mkv,.mp4,.avi,.ts', priority: 'normal', minSizeMb: 100 });
    load();
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
    // trigger a manual scan (future API hook)
    alert(`Manual scan triggered for: ${p.path}`);
  };

  return (
    <div className="space-y-4">
      {paths.length === 0 && !adding && (
        <div className="bg-surface border border-dashed border-border rounded-2xl p-10 text-center">
          <FolderOpen className="w-8 h-8 text-textMuted mx-auto mb-3" />
          <p className="text-white font-medium mb-1">No folders configured</p>
          <p className="text-textMuted text-sm">Add a folder to start scanning for media files.</p>
        </div>
      )}

      {paths.map(p => (
        <div key={p.id} className={`bg-surface border rounded-2xl p-5 transition-opacity ${!p.enabled ? 'opacity-50' : ''}`}
          style={{ borderColor: p.enabled ? 'var(--color-border)' : undefined }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-white font-mono text-sm font-medium truncate">{p.path}</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <Badge label={p.recipe} color="primary" />
                <Badge label={p.priority.toUpperCase()} color="neutral" />
                <Badge label={p.recurse ? 'Recursive' : 'Top-level only'} color="neutral" />
                <Badge label={`≥ ${p.min_size_mb} MB`} color="neutral" />
              </div>
              <p className="text-textMuted text-xs mt-2 font-mono">{p.extensions}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => scanNow(p)} className="text-xs text-textMuted hover:text-primary transition-colors px-3 py-1.5 border border-border rounded-lg">
                Scan Now
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
      ))}

      {/* Add form */}
      {adding && (
        <div className="bg-surface border border-primary/30 rounded-2xl p-6 space-y-4">
          <h3 className="text-white font-bold text-sm">Add Watched Folder</h3>

          <div>
            <label className="text-xs text-textMuted font-medium mb-1.5 block">Folder Path</label>
            <div className="flex gap-2">
              <input
                value={form.path}
                onChange={e => setForm(f => ({ ...f, path: e.target.value }))}
                placeholder="/data/media/movies"
                className="flex-1 bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50 font-mono"
              />
              <button
                title="Browse Folders"
                onClick={() => setExplorerOpen(true)}
                className="px-4 py-2 bg-surface border border-border rounded-xl hover:bg-white/5 transition-colors text-textMuted hover:text-white flex items-center justify-center shrink-0"
              >
                <FolderOpen className="w-5 h-5 text-primary" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-textMuted font-medium mb-1.5 block">Recipe</label>
              <select
                value={form.recipe}
                onChange={e => setForm(f => ({ ...f, recipe: e.target.value }))}
                className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none appearance-none"
              >
                {BUILT_IN_RECIPES.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-textMuted font-medium mb-1.5 block">Extensions</label>
              <input
                value={form.extensions}
                onChange={e => setForm(f => ({ ...f, extensions: e.target.value }))}
                className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none font-mono"
              />
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

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.recurse}
                onChange={e => setForm(f => ({ ...f, recurse: e.target.checked }))}
                className="w-4 h-4 accent-primary"
              />
              <span className="text-sm text-white">Scan subdirectories</span>
            </label>
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={save} className="px-5 py-2 bg-primary text-background text-sm font-bold rounded-xl hover:bg-primary/90 transition-colors">
              Add Folder
            </button>
            <button onClick={() => setAdding(false)} className="px-5 py-2 text-textMuted text-sm rounded-xl hover:text-white transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 text-sm text-textMuted hover:text-white transition-colors px-4 py-2.5 border border-dashed border-border rounded-xl w-full justify-center"
        >
          <Plus className="w-4 h-4" /> Add Watched Folder
        </button>
      )}

      {/* File Explorer Modal */}
      <FileExplorerModal
        open={explorerOpen}
        onClose={() => setExplorerOpen(false)}
        initialPath={form.path}
        onSelect={(path) => {
          setForm(f => ({ ...f, path }));
          setExplorerOpen(false);
        }}
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
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings/filters').then(r => r.json()).then(setFilters).catch(() => {});
  }, []);

  const save = async () => {
    await fetch('/api/settings/filters', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filters),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const set = (key: keyof SmartFilters, val: any) => setFilters(f => ({ ...f, [key]: val }));

  return (
    <div className="space-y-4">
      <p className="text-textMuted text-sm">These rules are evaluated <strong className="text-white">before</strong> any job is created. Files that match are skipped and marked in the Library.</p>

      <div className="bg-surface border border-border rounded-2xl divide-y divide-border overflow-hidden">
        <FilterRow
          title="Skip already in target codec"
          description="If the file is already in the recipe's target codec, skip it entirely."
          enabled={filters.skipAlreadyTargetCodec}
          onToggle={v => set('skipAlreadyTargetCodec', v)}
        />
        <FilterRow
          title="Skip low-bitrate files"
          description="Files already heavily compressed at this bitrate probably won't benefit from re-encoding."
          enabled={filters.skipBelowBitrateKbps !== null}
          onToggle={v => set('skipBelowBitrateKbps', v ? 500 : null)}
        >
          {filters.skipBelowBitrateKbps !== null && (
            <NumberInput label="Below (kbps)" value={filters.skipBelowBitrateKbps} onChange={v => set('skipBelowBitrateKbps', v)} />
          )}
        </FilterRow>
        <FilterRow
          title="Skip low-resolution files"
          description="Don't waste GPU time on content below a certain height."
          enabled={filters.skipBelowHeightPx !== null}
          onToggle={v => set('skipBelowHeightPx', v ? 480 : null)}
        >
          {filters.skipBelowHeightPx !== null && (
            <NumberInput label="Below (px height)" value={filters.skipBelowHeightPx} onChange={v => set('skipBelowHeightPx', v)} />
          )}
        </FilterRow>
        <FilterRow
          title="Skip small files"
          description="Skip files under a minimum size — likely already compact."
          enabled={filters.skipBelowSizeMb !== null}
          onToggle={v => set('skipBelowSizeMb', v ? 50 : null)}
        >
          {filters.skipBelowSizeMb !== null && (
            <NumberInput label="Below (MB)" value={filters.skipBelowSizeMb} onChange={v => set('skipBelowSizeMb', v)} />
          )}
        </FilterRow>
        <FilterRow
          title="Skip Dolby Atmos / lossless audio"
          description="Preserve lossless audio tracks by skipping files containing them."
          enabled={filters.skipDolbyAtmos}
          onToggle={v => set('skipDolbyAtmos', v)}
        />
        <FilterRow
          title="Skip by filename keywords"
          description="Skip files whose name contains any of these words (comma-separated)."
          enabled={filters.skipKeywords.length > 0}
          onToggle={v => set('skipKeywords', v ? ['REMUX'] : [])}
        >
          {filters.skipKeywords.length > 0 && (
            <input
              className="mt-3 w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-primary/50"
              value={filters.skipKeywords.join(', ')}
              onChange={e => set('skipKeywords', e.target.value.split(',').map(k => k.trim()).filter(Boolean))}
              placeholder="REMUX, BDREMUX, BLURAY"
            />
          )}
        </FilterRow>
      </div>

      <button
        onClick={save}
        className="px-5 py-2.5 bg-primary text-background text-sm font-bold rounded-xl hover:bg-primary/90 transition-colors"
      >
        {saved ? '✓ Saved!' : 'Save Filters'}
      </button>
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

function RecipesPanel() {
  const recipes = BUILT_IN_RECIPES;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {recipes.map(r => (
        <div key={r.id} className="bg-surface border border-border rounded-2xl p-5 hover:border-border/60 transition-colors">
          <div className="flex items-start gap-3 mb-3">
            <span className="text-2xl">{r.icon}</span>
            <div>
              <h3 className="text-white font-bold text-sm">{r.name}</h3>
              <p className="text-textMuted text-xs">{r.description}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge label={r.targetCodec} color="primary" />
            <Badge label={`.${r.targetContainer}`} color="neutral" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── General ─────────────────────────────────────────────────────────────────

function GeneralPanel() {
  const { apiUrl } = useAppState();
  const [settings, setSettings] = useState({ nodeName: '', maxConcurrentJobs: '2', queueStrategy: 'fifo', autoAcceptWorkers: 'false' });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${apiUrl}/api/settings/general`).then(r => r.json()).then(data => {
      setSettings(s => ({
        nodeName: data.nodeName ?? s.nodeName,
        maxConcurrentJobs: data.maxConcurrentJobs ?? s.maxConcurrentJobs,
        queueStrategy: data.queueStrategy ?? s.queueStrategy,
        autoAcceptWorkers: data.autoAcceptWorkers ?? s.autoAcceptWorkers,
      }));
    }).catch(() => {});
  }, [apiUrl]);

  const save = async () => {
    await fetch(`${apiUrl}/api/settings/general`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const resetSetup = async () => {
    if (!confirm('Are you sure you want to completely reset Transcodarr? This will wipe your node role and restart the setup wizard.')) return;
    try {
      await fetch(`${apiUrl}/api/settings/reset`, { method: 'POST' });
    } catch { /* server exits, ignore */ }
    // Wait a moment then reload — the server will be in setup mode
    setTimeout(() => window.location.reload(), 1000);
  };

  return (
    <div className="space-y-6">
      <div className="bg-surface border border-border rounded-2xl p-6 space-y-5">
        <Field label="Node Display Name">
          <input
            value={settings.nodeName}
            onChange={e => setSettings(s => ({ ...s, nodeName: e.target.value }))}
            placeholder="Transcodarr Main"
            className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary/50"
          />
        </Field>

        <Field label="Max Simultaneous Jobs">
          <select
            value={settings.maxConcurrentJobs}
            onChange={e => setSettings(s => ({ ...s, maxConcurrentJobs: e.target.value }))}
            className="w-full bg-background border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none appearance-none"
          >
            {[1,2,3,4,6,8].map(n => <option key={n} value={n}>{n} job{n > 1 ? 's' : ''}</option>)}
          </select>
        </Field>

        <Field label="Queue Strategy">
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
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} className="px-5 py-2.5 bg-primary text-background text-sm font-bold rounded-xl hover:bg-primary/90 transition-colors">
          {saved ? '✓ Saved!' : 'Save Settings'}
        </button>
      </div>

      {/* Danger zone */}
      <div className="bg-surface border border-red-500/20 rounded-2xl p-6">
        <h3 className="text-red-400 font-bold text-sm mb-1">Reset Setup</h3>
        <p className="text-textMuted text-xs mb-4">Wipe this node's role configuration and restart the onboarding wizard. The server will restart automatically.</p>
        <button
          onClick={resetSetup}
          className="px-5 py-2.5 bg-red-500/10 text-red-400 text-sm font-bold rounded-xl border border-red-500/30 hover:bg-red-500/20 transition-colors"
        >
          Reset Setup…
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-textMuted font-medium mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}

function Badge({ label, color }: { label: string; color: 'primary' | 'neutral' }) {
  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-lg border ${
      color === 'primary' ? 'bg-primary/10 text-primary border-primary/20' : 'bg-background text-textMuted border-border/50'
    }`}>
      {label}
    </span>
  );
}
