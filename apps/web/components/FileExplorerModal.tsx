'use client';

import { useState, useEffect } from 'react';
import { X, Folder, ChevronRight, CornerLeftUp, HardDrive } from 'lucide-react';
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
  initialPath
}: { 
  open: boolean; 
  onClose: () => void; 
  onSelect: (path: string) => void;
  initialPath?: string;
}) {
  const { apiUrl } = useAppState();
  const [data, setData] = useState<FSResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadPath = async (path: string) => {
    setLoading(true);
    setError('');
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

  useEffect(() => {
    if (open) {
      loadPath(initialPath || '');
    } else {
      setData(null);
    }
  }, [open, initialPath, apiUrl]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-surface border border-border w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col h-[70vh] max-h-[600px] overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-surface/50">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-primary" />
            Select Folder
          </h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 text-textMuted transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Path bar */}
        <div className="bg-background/50 px-4 py-3 flex items-center gap-2 border-b border-border overflow-x-auto whitespace-nowrap scrollbar-hide">
          <span className="text-textMuted text-sm font-mono truncate">
            {data?.current || 'Loading...'}
          </span>
        </div>

        {/* Browser */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading && !data && (
            <div className="h-full flex items-center justify-center text-textMuted">Loading...</div>
          )}
          
          {error && (
            <div className="p-4 text-red-400 bg-red-400/10 rounded-xl m-2 border border-red-400/20 text-sm">
              {error}
            </div>
          )}

          {data && (
            <div className="space-y-1">
              {data.current !== data.parent && (
                <button
                  onClick={() => loadPath(data.parent)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 text-left transition-colors group"
                >
                  <CornerLeftUp className="w-5 h-5 text-textMuted group-hover:text-white transition-colors" />
                  <span className="text-textMuted font-medium group-hover:text-white transition-colors">.. (Up a level)</span>
                </button>
              )}
              
              {data.dirs.length === 0 && (
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
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-surface/50 flex justify-end gap-3">
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
  );
}
