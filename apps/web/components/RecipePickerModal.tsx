'use client';

import { useEffect, useState } from 'react';
import { X, ChevronRight, ExternalLink, Check, Download, Trash2, Loader2 } from 'lucide-react';
import type { Recipe } from '@transcodarr/shared';
import { useEscapeKey } from '@/hooks/useEscapeKey';

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (recipe: Recipe) => void;
  selectedId?: string;
  apiUrl?: string;
}

// Rough estimated reduction displayed in the picker
function ReductionBadge({ pct }: { pct?: number }) {
  if (pct === undefined || pct === null) return null;
  if (pct === 0) return (
    <span className="px-2 py-0.5 rounded text-xxs font-bold bg-background border border-border text-textMuted">
      No re-encode
    </span>
  );
  return (
    <span className="px-2 py-0.5 rounded text-xxs font-bold bg-green-900/30 border border-green-500/20 text-green-400">
      ~{pct}% smaller
    </span>
  );
}

export function RecipePickerModal({ open, onClose, onSelect, selectedId, apiUrl = '' }: Props) {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [hovered, setHovered] = useState<Recipe | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [showImport, setShowImport] = useState(false);

  const load = () => {
    fetch(`${apiUrl}/api/settings/recipes`)
      .then(r => r.json())
      .then(setRecipes)
      .catch(() => {});
  };

  useEffect(() => { if (open) { load(); setHovered(null); setImportError(''); setShowImport(false); } }, [open]);
  // Keyboard users expect Esc to close any modal — without this they'd have
  // to Tab through the entire recipe grid to reach the close button.
  useEscapeKey(open, onClose);

  const handleImport = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    setImportError('');
    try {
      const res = await fetch(`${apiUrl}/api/settings/recipes/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: importUrl }),
      });
      const data = await res.json();
      if (!res.ok) { setImportError(data.error ?? 'Import failed'); return; }
      setImportUrl('');
      setShowImport(false);
      load();
    } finally {
      setImporting(false);
    }
  };

  const handleRemoveCustom = async (id: string) => {
    await fetch(`${apiUrl}/api/settings/recipes/custom/${id}`, { method: 'DELETE' });
    load();
    if (hovered?.id === id) setHovered(null);
  };

  if (!open) return null;

  const detail = hovered ?? recipes.find(r => r.id === selectedId) ?? recipes[0];
  const builtIn   = recipes.filter(r => !r.sourceUrl);
  const community = recipes.filter(r =>  r.sourceUrl);

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a recipe"
        onClick={e => e.stopPropagation()}
        className="bg-surface border border-border w-full max-w-4xl rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: 'min(85vh, 720px)', minHeight: '400px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-bold text-white">Choose a Recipe</h2>
          <button onClick={onClose} aria-label="Close" className="text-textMuted hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left: recipe list */}
          <div className="w-72 shrink-0 border-r border-border overflow-y-auto flex flex-col">
            {/* Built-in */}
            <div className="px-3 pt-4 pb-1">
              <p className="text-xxs font-bold uppercase tracking-widest text-textMuted px-2 mb-2">Built-in</p>
              {builtIn.map(r => (
                <RecipeListItem
                  key={r.id}
                  recipe={r}
                  selected={selectedId === r.id}
                  hovered={hovered?.id === r.id}
                  onHover={() => setHovered(r)}
                  onClick={() => { onSelect(r); onClose(); }}
                />
              ))}
            </div>

            {/* Community */}
            {community.length > 0 && (
              <div className="px-3 pt-3 pb-1">
                <p className="text-xxs font-bold uppercase tracking-widest text-textMuted px-2 mb-2">Community</p>
                {community.map(r => (
                  <RecipeListItem
                    key={r.id}
                    recipe={r}
                    selected={selectedId === r.id}
                    hovered={hovered?.id === r.id}
                    onHover={() => setHovered(r)}
                    onClick={() => { onSelect(r); onClose(); }}
                    onRemove={() => handleRemoveCustom(r.id)}
                  />
                ))}
              </div>
            )}

            {/* Import */}
            <div className="mt-auto px-3 py-4 border-t border-border">
              {!showImport ? (
                <button
                  onClick={() => setShowImport(true)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs text-textMuted hover:text-white hover:bg-white/5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  Import from URL…
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-textMuted px-1">Paste a URL returning a JSON array of recipes:</p>
                  <input
                    value={importUrl}
                    onChange={e => setImportUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleImport()}
                    placeholder="https://raw.githubusercontent.com/…/recipes.json"
                    autoFocus
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-primary/50"
                  />
                  {importError && <p className="text-red-400 text-xs px-1">{importError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={handleImport}
                      disabled={importing || !importUrl.trim()}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-primary text-background text-xs font-bold rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
                    >
                      {importing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                      {importing ? 'Importing…' : 'Import'}
                    </button>
                    <button onClick={() => { setShowImport(false); setImportError(''); }} className="px-3 py-2 text-xs text-textMuted hover:text-white transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: detail view */}
          <div className="flex-1 overflow-y-auto p-8 flex flex-col">
            {detail ? (
              <>
                {/* Icon + name */}
                <div className="flex items-start gap-5 mb-6">
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shrink-0 border"
                    style={{ background: detail.color + '18', borderColor: detail.color + '30' }}
                  >
                    {detail.icon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-3 flex-wrap mb-1">
                      <h3 className="text-2xl font-black text-white">{detail.name}</h3>
                      {detail.sourceUrl && (
                        <span className="px-2 py-0.5 rounded text-xxs font-bold bg-purple-900/30 text-purple-400 border border-purple-500/20">
                          Community
                        </span>
                      )}
                    </div>
                    <p className="text-textMuted text-sm leading-relaxed">{detail.description}</p>
                  </div>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-4 mb-8">
                  <StatCard label="Output Codec" value={detail.targetCodec.toUpperCase()} />
                  <StatCard label="Container" value={`.${detail.targetContainer}`} />
                  <StatCard label="Est. Reduction" value={
                    detail.estimatedReduction !== undefined
                      ? detail.estimatedReduction === 0 ? 'None (copy)' : `~${detail.estimatedReduction}%`
                      : 'Varies'
                  } />
                </div>

                {/* Community source */}
                {detail.sourceUrl && (
                  <div className="flex items-center gap-2 mb-6 p-3 bg-purple-500/5 border border-purple-500/15 rounded-xl text-xs text-textMuted">
                    <ExternalLink className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <span className="truncate">{detail.sourceUrl}</span>
                  </div>
                )}

                {/* Custom ffmpeg args */}
                {detail.ffmpegArgs && detail.ffmpegArgs.length > 0 && (
                  <div className="mb-6">
                    <p className="text-xs font-bold uppercase tracking-widest text-textMuted mb-2">FFmpeg Args</p>
                    <div className="bg-background border border-border rounded-xl p-4 font-mono text-xs text-green-400 break-all">
                      {detail.ffmpegArgs.join(' ')}
                    </div>
                  </div>
                )}

                <div className="mt-auto flex gap-3">
                  <button
                    onClick={() => { onSelect(detail); onClose(); }}
                    className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-colors"
                    style={{ background: detail.color, color: '#000' }}
                  >
                    <Check className="w-4 h-4" />
                    Use this recipe
                  </button>
                  {detail.sourceUrl && (
                    <button
                      onClick={() => handleRemoveCustom(detail.id)}
                      className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Remove
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-textMuted text-sm">Hover a recipe to see details</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecipeListItem({ recipe, selected, hovered, onHover, onClick, onRemove }: {
  recipe: Recipe;
  selected: boolean;
  hovered: boolean;
  onHover: () => void;
  onClick: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-100 mb-0.5
        ${hovered || selected ? 'bg-white/5' : 'hover:bg-white/5'}`}
      onMouseEnter={onHover}
      onClick={onClick}
    >
      <span className="text-lg shrink-0">{recipe.icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${selected ? 'text-white' : 'text-white/80'}`}>{recipe.name}</p>
        {recipe.estimatedReduction !== undefined && recipe.estimatedReduction > 0 && (
          <p className="text-xxs text-textMuted">{recipe.estimatedReduction}% smaller</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {selected && <Check className="w-3.5 h-3.5 text-primary" />}
        {onRemove && (
          <button
            onClick={e => { e.stopPropagation(); onRemove(); }}
            className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 text-textMuted transition-all"
            aria-label="Remove recipe"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
        {!selected && <ChevronRight className="w-3.5 h-3.5 text-textMuted" />}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background border border-border rounded-xl p-4">
      <p className="text-xxs font-bold uppercase tracking-widest text-textMuted mb-1">{label}</p>
      <p className="text-white font-bold text-sm">{value}</p>
    </div>
  );
}
