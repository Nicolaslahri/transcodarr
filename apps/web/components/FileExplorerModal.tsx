'use client';

import { useState, useEffect } from 'react';
import { X, Folder, ChevronRight, CornerLeftUp, HardDrive, FolderPlus, Check, AlertTriangle } from 'lucide-react';
import { useAppState } from '@/hooks/useTranscodarrSocket';

interface FSDirectory {
  name: string;
  path: string;
}

interface FSResponse {
  current: string;
  parent: string;
  dirs: FSDirectory[];
}

export function FileExplorerModal({
  open,
  onClose,
  onSelect,
  initialPath,
  allowMkdir,
  mkdirUrl,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  allowMkdir?: boolean;
  mkdirUrl?: string;
}) {
  const { apiUrl } = useAppState();
  const [data, setData] = useState<FSResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [manualPath, setManualPath] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [mkdirLoading, setMkdirLoading] = useState(false);
  const [mkdirError, setMkdirError] = useState('');

  const loadPath = async (path: string) => {
    setManualPath(''); // clear any typed path when navigating
    setLoading(true);
    setError('');
    setMkdirError('');
    try {
      const res = await fetch(`${apiUrl}/api/settings/fs?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error('Failed to load directory');
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const createFolder = async () => {
    if (!newFolderName.trim() || !data?.current) return;
    const sep = data.current.includes('\\') ? '\\' : '/';
    const newPath = data.current.endsWith(sep)
      ? data.current + newFolderName.trim()
      : data.current + sep + newFolderName.trim();
    setMkdirLoading(true);
    setMkdirError('');
    try {
      const url = mkdirUrl ?? `${apiUrl}/api/settings/fs/mkdir`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath }),
      });
      if (res.ok) {
        setNewFolderName('');
        setShowNewFolder(false);
        await loadPath(newPath); // navigate into the new folder
      } else {
        const d = await res.json().catch(() => ({}));
        setMkdirError(d.error ?? 'Could not create folder');
      }
    } catch {
      setMkdirError('Network error — could not create folder');
    }
    setMkdirLoading(false);
  };

  useEffect(() => {
    if (open) {
      loadPath(initialPath ?? '');
      setShowNewFolder(false);
      setNewFolderName('');
      setMkdirError('');
    } else {
      setData(null);
    }
  }, [open, initialPath, apiUrl]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-20 lg:pt-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-surface border border-border w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col max-h-[75vh] lg:max-h-[600px] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-surface/50 shrink-0">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-primary" />
            Select Folder
          </h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 text-textMuted transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Path bar */}
        <div className="bg-background/50 px-4 py-3 flex items-center gap-2 border-b border-border shrink-0">
          <span className="text-textMuted text-xs shrink-0 font-mono">PATH</span>
          <input
            value={manualPath || data?.current || ''}
            onChange={e => setManualPath(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const target = manualPath || data?.current || '';
                if (target) { loadPath(target); }
              }
            }}
            placeholder="Type a path and press Enter…"
            className="flex-1 bg-transparent text-white text-xs font-mono focus:outline-none placeholder:text-textMuted/50"
          />
          {manualPath && (
            <button
              onClick={() => { loadPath(manualPath); }}
              className="text-xs font-bold text-primary px-2 py-1 rounded-lg hover:bg-primary/10 transition-colors shrink-0"
            >
              Go
            </button>
          )}
        </div>

        {/* Browser */}
        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {loading && !data && (
            <div className="h-full flex items-center justify-center text-textMuted py-10">Loading...</div>
          )}

          {error && (
            <div className="p-4 text-red-400 bg-red-400/10 rounded-xl m-2 border border-red-400/20 text-sm">
              {error}
            </div>
          )}

          {data && (
            <div className="space-y-1">
              {/* Up button */}
              {data.current && data.current !== data.parent && (
                <button
                  onClick={() => loadPath(data.parent)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 text-left transition-colors group"
                >
                  <CornerLeftUp className="w-5 h-5 text-textMuted group-hover:text-white transition-colors" />
                  <span className="text-textMuted font-medium group-hover:text-white transition-colors">.. (Up a level)</span>
                </button>
              )}
              {data.current && data.current === data.parent && (
                <button
                  onClick={() => loadPath('')}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 text-left transition-colors group"
                >
                  <HardDrive className="w-5 h-5 text-textMuted group-hover:text-white transition-colors" />
                  <span className="text-textMuted font-medium group-hover:text-white transition-colors">← Root / Drives</span>
                </button>
              )}

              {data.dirs.length === 0 && !showNewFolder && (
                <div className="p-8 text-center text-textMuted text-sm">
                  No subdirectories found.
                </div>
              )}

              {data.dirs.map((dir) => (
                <button
                  key={dir.path}
                  onClick={() => loadPath(dir.path)}
                  className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white/5 text-left transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <Folder className="w-5 h-5 text-primary/70 group-hover:text-primary transition-colors fill-primary/20" />
                    <span className="text-white font-medium">{dir.name}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-textMuted opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}

              {/* Inline new folder input */}
              {showNewFolder && (
                <div className="flex flex-col gap-2 p-2">
                  <div className="flex items-center gap-2">
                    <Folder className="w-5 h-5 text-primary/40 shrink-0" />
                    <input
                      autoFocus
                      value={newFolderName}
                      onChange={e => { setNewFolderName(e.target.value); setMkdirError(''); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') createFolder();
                        if (e.key === 'Escape') { setShowNewFolder(false); setNewFolderName(''); setMkdirError(''); }
                      }}
                      placeholder="New folder name…"
                      className="flex-1 bg-background border border-primary/30 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/60"
                    />
                    <button
                      onClick={createFolder}
                      disabled={mkdirLoading || !newFolderName.trim()}
                      className="p-2 bg-primary/10 border border-primary/30 rounded-lg text-primary hover:bg-primary/20 transition-colors disabled:opacity-40"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { setShowNewFolder(false); setNewFolderName(''); setMkdirError(''); }}
                      className="p-2 text-textMuted hover:text-white transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {mkdirError && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      {mkdirError}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-surface/50 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            {allowMkdir && data?.current && !showNewFolder && (
              <button
                onClick={() => { setShowNewFolder(true); setMkdirError(''); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-textMuted hover:text-white border border-border hover:border-primary/30 hover:bg-primary/5 transition-colors text-sm"
              >
                <FolderPlus className="w-4 h-4" />
                New Folder
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-textMuted hover:text-white transition-colors font-medium text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => data?.current && onSelect(data.current)}
              disabled={!data?.current}
              className="px-6 py-2 rounded-xl bg-primary text-black font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              Select Current Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
