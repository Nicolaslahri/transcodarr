'use client';

import { useAppState } from '@/hooks/useTranscodarrSocket';
import {
  CheckCircle2, Cpu, Server, ShieldAlert, X, Plus, MapPin, Trash2,
  FolderOpen, ChevronRight, ChevronUp, Info, Wifi, HardDrive,
  Download, Zap, Upload,
} from 'lucide-react';
import type { WorkerInfo, SmbMapping, ConnectionMode, TransferPhase } from '@transcodarr/shared';
import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Filesystem browser ───────────────────────────────────────────────────────

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
  open, onClose, loading, result, onNavigate, onSelect, title, hint
}: {
  open: boolean; onClose: () => void; loading: boolean;
  result: FsResult | null; onNavigate: (p: string) => void;
  onSelect: (p: string) => void; title: string; hint: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-border w-full max-w-lg rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <FolderOpen className="w-4 h-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-white font-semibold text-sm">{title}</p>
            <p className="text-textMuted text-xs truncate">{result?.current || '/'}</p>
          </div>
          <button onClick={onClose} className="text-textMuted hover:text-white transition-colors">
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

// ─── 3-phase progress stepper ─────────────────────────────────────────────────

const PHASES: { key: TransferPhase; label: string; icon: React.ElementType }[] = [
  { key: 'receiving',   label: 'Receiving',   icon: Download },
  { key: 'transcoding', label: 'Transcoding', icon: Zap      },
  { key: 'sending',     label: 'Sending',     icon: Upload   },
];

function PhaseProgressBar({
  phase, progress, isWireless,
}: {
  phase?: string | null;
  progress: number;
  isWireless: boolean;
}) {
  if (!isWireless) {
    // Simple single-phase bar for SMB
    return (
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-primary font-medium flex items-center gap-1">
            <Zap className="w-3 h-3" /> Transcoding
          </span>
          <span className="text-xs text-textMuted">{progress}%</span>
        </div>
        <div className="h-1.5 bg-background rounded-full overflow-hidden">
          <div className="h-full bg-primary transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  }

  // Wireless: 3-phase stepper
  const current = PHASES.findIndex(p => p.key === phase);

  return (
    <div className="mt-3 space-y-1.5">
      {PHASES.map((p, idx) => {
        const Icon     = p.icon;
        const isDone   = idx < current;
        const isActive = idx === current;
        return (
          <div key={p.key} className="flex items-center gap-2">
            <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-all
              ${isDone   ? 'bg-green-500/20 text-green-400'
              : isActive ? 'bg-primary/20 text-primary ring-1 ring-primary/40'
              :             'bg-background text-textMuted/40'}`}
            >
              {isDone ? <CheckCircle2 className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-0.5">
                <span className={`text-[10px] font-bold uppercase tracking-wide
                  ${isDone ? 'text-green-400' : isActive ? 'text-primary' : 'text-textMuted/40'}`}>
                  {p.label}
                </span>
                {isActive && <span className="text-[10px] text-textMuted">{progress}%</span>}
              </div>
              <div className="h-1 bg-background rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ease-out
                    ${isDone ? 'bg-green-500 w-full' : isActive ? 'bg-primary' : 'w-0'}`}
                  style={isActive ? { width: `${progress}%` } : {}}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorkersPage() {
  const { workers, acceptWorker, rejectWorker, apiUrl } = useAppState();
  const [addModalOpen, setAddModalOpen] = useState(false);

  const pendingWorkers = workers.filter(w => w.status === 'pending');
  const activeWorkers  = workers.filter(w => w.status !== 'pending');

  return (
    <div className="p-10 max-w-7xl mx-auto space-y-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white mb-1">Fleet</h1>
          <p className="text-textMuted">Manage transcoding nodes and their connection to your media.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={async () => { await fetch(`${apiUrl}/api/workers/scan`, { method: 'POST' }); }}
            className="px-4 py-2 bg-surface border border-border rounded-xl text-sm font-medium text-textMuted hover:text-white transition-colors"
          >
            Refresh Fleet
          </button>
          <button
            onClick={() => setAddModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-background rounded-xl text-sm font-bold hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Worker…
          </button>
        </div>
      </header>

      {/* Pending approval */}
      {pendingWorkers.length > 0 && (
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-yellow-500 mb-4 flex items-center gap-2">
            <ShieldAlert className="w-3.5 h-3.5" /> Awaiting Approval ({pendingWorkers.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {pendingWorkers.map(w => (
              <WorkerCard key={w.id} worker={w} apiUrl={apiUrl} onAccept={acceptWorker} onReject={rejectWorker} />
            ))}
          </div>
        </section>
      )}

      {/* Active workers */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest text-textMuted mb-4">
          Fleet ({activeWorkers.length})
        </h2>
        {activeWorkers.length === 0 && pendingWorkers.length === 0 ? (
          <div className="bg-surface border border-border rounded-2xl p-12 flex flex-col items-center text-center">
            <Server className="w-10 h-10 text-textMuted mb-3" />
            <h3 className="text-lg font-medium text-white mb-2">No Workers Discovered</h3>
            <p className="text-textMuted text-sm max-w-sm">
              Start the Transcodarr Worker on any machine on your network. It&apos;ll appear here automatically.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {activeWorkers.map(w => (
              <WorkerCard key={w.id} worker={w} apiUrl={apiUrl} onAccept={acceptWorker} onReject={rejectWorker} />
            ))}
          </div>
        )}
      </section>

      {/* Add Worker Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface border border-border w-full max-w-md rounded-2xl p-6 shadow-2xl relative">
            <button onClick={() => setAddModalOpen(false)} className="absolute top-4 right-4 text-textMuted hover:text-white">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-bold text-white mb-2">Add Worker Node</h3>
            <p className="text-sm text-textMuted mb-6">If automatic discovery failed, enter the IP and port of the worker machine on your network.</p>
            <form onSubmit={async e => {
              e.preventDefault();
              const fd   = new FormData(e.currentTarget);
              const ip   = fd.get('ip') as string;
              const port = fd.get('port') as string || '3002';
              if (!ip) return;
              const res = await fetch(`${apiUrl}/api/workers/add-manual`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ip, port: Number(port) }),
              });
              if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Unknown error' }));
                alert(`Failed to connect: ${err.error}`);
              } else {
                setAddModalOpen(false);
              }
            }}>
              <label className="text-xs font-bold uppercase tracking-wider text-textMuted mb-2 block">Worker IP Address</label>
              <input name="ip" required autoFocus placeholder="192.168.1.50"
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-white mb-4 focus:outline-none focus:border-primary/50 font-mono" />
              <label className="text-xs font-bold uppercase tracking-wider text-textMuted mb-2 block">
                Port <span className="font-normal text-textMuted/60">(default: 3002)</span>
              </label>
              <input name="port" placeholder="3002" defaultValue="3002"
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-white mb-6 focus:outline-none focus:border-primary/50 font-mono" />
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setAddModalOpen(false)} className="px-5 py-2.5 rounded-xl font-medium text-textMuted hover:bg-background transition-colors">
                  Cancel
                </button>
                <button type="submit" className="px-5 py-2.5 rounded-xl font-bold bg-primary text-background hover:bg-primary/90 transition-colors">
                  Connect Node
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── WorkerCard ───────────────────────────────────────────────────────────────

function WorkerCard({ worker, apiUrl, onAccept, onReject }: {
  worker: WorkerInfo;
  apiUrl: string;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [showConnection, setShowConnection] = useState(false);
  const [mode, setMode]     = useState<ConnectionMode>(worker.connectionMode ?? 'smb');
  const [mappings, setMappings] = useState<SmbMapping[]>(worker.smbMappings ?? []);
  const [saving, setSaving]     = useState(false);
  const [saveOk, setSaveOk]     = useState(false);

  // Sync from websocket updates
  const modeStr = worker.connectionMode ?? 'smb';
  const smbStr  = JSON.stringify(worker.smbMappings ?? []);
  useEffect(() => { setMode(modeStr as ConnectionMode); }, [modeStr]);
  useEffect(() => { setMappings(JSON.parse(smbStr)); }, [smbStr]);

  const isPending = worker.status === 'pending';
  const isActive  = worker.status === 'active';
  const isOffline = worker.status === 'offline';
  const isWireless = mode === 'wireless';

  // ─── Filesystem fetchers ─────────────────────────────────────────────────
  const fetchMainFs = useCallback(async (p?: string): Promise<FsResult> => {
    const url = `${apiUrl}/api/settings/fs${p ? `?path=${encodeURIComponent(p)}` : ''}`;
    const r = await fetch(url);
    return r.json();
  }, [apiUrl]);

  const fetchWorkerFs = useCallback(async (p?: string): Promise<FsResult> => {
    const proxyUrl = `${apiUrl}/api/workers/${worker.id}/fs${p ? `?path=${encodeURIComponent(p)}` : ''}`;
    try {
      const r = await fetch(proxyUrl);
      if (r.ok) return r.json();
    } catch { /**/ }
    const workerBase = `http://${worker.host}:${worker.port}`;
    const r = await fetch(`${workerBase}/fs${p ? `?path=${encodeURIComponent(p)}` : ''}`);
    return r.json();
  }, [apiUrl, worker.host, worker.port, worker.id]);

  const mainBrowser   = useFsBrowser(fetchMainFs);
  const workerBrowser = useFsBrowser(fetchWorkerFs);
  const activeMappingIdx = useRef<number>(-1);
  const activeField      = useRef<'networkBasePath' | 'localBasePath'>('networkBasePath');

  const openBrowser = (idx: number, field: 'networkBasePath' | 'localBasePath') => {
    activeMappingIdx.current = idx;
    activeField.current      = field;
    if (field === 'networkBasePath') {
      mainBrowser.browse(mappings[idx]?.networkBasePath || undefined);
    } else {
      workerBrowser.browse(mappings[idx]?.localBasePath || undefined);
    }
  };

  const handleSelect = (path: string) => {
    const idx   = activeMappingIdx.current;
    const field = activeField.current;
    setMappings(m => m.map((mp, i) => i === idx ? { ...mp, [field]: path } : mp));
  };

  const saveConnection = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/workers/${worker.id}/connection`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ connectionMode: mode, mappings }),
      });
      if (res.ok) {
        setSaveOk(true);
        setTimeout(() => setSaveOk(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  };

  const addMapping    = () => setMappings(m => [...m, { networkBasePath: '', localBasePath: '' }]);
  const removeMapping = (i: number) => setMappings(m => m.filter((_, idx) => idx !== i));
  const updateMapping = (i: number, field: keyof SmbMapping, val: string) =>
    setMappings(m => m.map((mp, idx) => idx === i ? { ...mp, [field]: val } : mp));

  return (
    <>
      {/* File browsers */}
      <FsBrowser
        open={mainBrowser.open} onClose={() => mainBrowser.setOpen(false)}
        loading={mainBrowser.loading} result={mainBrowser.result}
        onNavigate={mainBrowser.browse} onSelect={handleSelect}
        title="Main Node — Select Folder"
        hint="This is the path as seen by the Main node (e.g. /media/movies). It is the path Transcodarr stores in the database."
      />
      <FsBrowser
        open={workerBrowser.open} onClose={() => workerBrowser.setOpen(false)}
        loading={workerBrowser.loading} result={workerBrowser.result}
        onNavigate={workerBrowser.browse} onSelect={handleSelect}
        title="Worker Node — Select Folder"
        hint="This is where the Worker sees the same files via an SMB/NFS share (e.g. Z:\ on Windows, /mnt/media on Linux)."
      />

      {/* Card */}
      <div className={`relative overflow-hidden bg-surface border rounded-2xl transition-all duration-300
        ${isPending ? 'border-yellow-500/50 shadow-[0_0_30px_rgba(234,179,8,0.07)]' : 'border-border'}`}
      >
        {/* Active job progress — top stripe */}
        {isActive && (
          <div className="absolute top-0 left-0 w-full h-0.5 bg-border overflow-hidden">
            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${worker.currentProgress ?? 0}%` }} />
          </div>
        )}

        <div className="p-5">
          {/* Header */}
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-background rounded-xl border border-border/50">
                <Cpu className={`w-5 h-5 ${isOffline ? 'text-textMuted' : isPending ? 'text-yellow-400' : 'text-primary'}`} />
              </div>
              <div>
                <h3 className="font-bold text-white">{worker.name}</h3>
                <p className="text-xs text-textMuted font-mono">{worker.host}:{worker.port}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!isPending && <ConnectionBadge mode={worker.connectionMode ?? 'smb'} />}
              <StatusBadge status={worker.status} />
            </div>
          </div>

          {/* Hardware tags */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-1 bg-background text-white text-xs rounded-lg border border-border/50">
              {worker.hardware?.gpuName ?? 'Unknown GPU'}
            </span>
            {worker.hardware?.encoders?.some((e: string) => e.includes('nvenc')) && (
              <span className="px-2 py-1 bg-green-900/30 text-green-400 text-xs font-bold rounded-lg border border-green-500/30">NVENC</span>
            )}
            {worker.hardware?.encoders?.some((e: string) => e.includes('amf')) && (
              <span className="px-2 py-1 bg-red-900/30 text-red-400 text-xs font-bold rounded-lg border border-red-500/30">AMF</span>
            )}
            {worker.hardware?.encoders?.some((e: string) => e.includes('qsv')) && (
              <span className="px-2 py-1 bg-blue-900/30 text-blue-400 text-xs font-bold rounded-lg border border-blue-500/30">QSV</span>
            )}
          </div>

          {/* Active job phase progress */}
          {isActive && (
            <PhaseProgressBar
              phase={worker.currentPhase}
              progress={worker.currentProgress ?? 0}
              isWireless={worker.connectionMode === 'wireless'}
            />
          )}

          {/* Pending approval actions */}
          {isPending && (
            <div className="flex gap-2 mt-4">
              <button onClick={() => onAccept(worker.id)}
                className="flex-1 py-2.5 bg-yellow-500 hover:bg-yellow-400 text-black text-sm font-bold rounded-xl transition-colors">
                Accept
              </button>
              <button onClick={() => onReject(worker.id)}
                className="py-2.5 px-4 bg-background hover:bg-border text-textMuted text-sm rounded-xl border border-border transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Active worker actions */}
          {!isPending && (
            <div className="flex gap-2 mt-4 pt-4 border-t border-border items-center justify-between">
              <button onClick={() => setShowConnection(!showConnection)}
                className="flex items-center gap-2 text-xs text-textMuted hover:text-white transition-colors">
                <MapPin className="w-3.5 h-3.5" />
                Connection Setup
                <span>{showConnection ? '▲' : '▼'}</span>
              </button>
              <button
                onClick={() => { if (confirm('Remove this Worker from the fleet?')) onReject(worker.id); }}
                title="Remove Worker"
                className="text-textMuted hover:text-red-400 transition-colors p-1"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* ─── Connection Setup Panel ───────────────────────────────────── */}
          {!isPending && showConnection && (
            <div className="mt-4 space-y-4">

              {/* Mode toggle */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-textMuted mb-2">
                  How does this worker access media files?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMode('smb')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-sm font-medium transition-all
                      ${mode === 'smb'
                        ? 'bg-primary/10 border-primary/40 text-primary'
                        : 'bg-background border-border text-textMuted hover:text-white hover:border-border/60'}`}
                  >
                    <HardDrive className="w-4 h-4" /> SMB / Network Share
                  </button>
                  <button
                    onClick={() => setMode('wireless')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-sm font-medium transition-all
                      ${mode === 'wireless'
                        ? 'bg-blue-500/10 border-blue-500/40 text-blue-400'
                        : 'bg-background border-border text-textMuted hover:text-white hover:border-border/60'}`}
                  >
                    <Wifi className="w-4 h-4" /> Wireless Transfer
                  </button>
                </div>
              </div>

              {/* SMB path mappings */}
              {mode === 'smb' && (
                <div className="space-y-3">
                  <div className="flex items-start gap-2 p-3 bg-primary/5 border border-primary/10 rounded-xl">
                    <Info className="w-3.5 h-3.5 text-primary/70 mt-0.5 shrink-0" />
                    <p className="text-xs text-primary/80">
                      Map the Main node&apos;s file path to the equivalent path on this Worker via an SMB/NFS share.
                      <br />
                      <span className="text-textMuted">Example: <code className="text-primary/70">/media</code> → <code className="text-primary/70">Z:\</code></span>
                    </p>
                  </div>

                  {mappings.length === 0 && (
                    <p className="text-center text-xs text-textMuted py-3">No mappings yet. Add one below.</p>
                  )}

                  {mappings.map((m, i) => (
                    <div key={i} className="space-y-2">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-textMuted mb-1 flex items-center gap-1">
                          <Server className="w-3 h-3" /> Main Path
                          <span className="font-normal text-textMuted/60 ml-1">— as seen on the Main node</span>
                        </label>
                        <div className="flex gap-1.5">
                          <input
                            value={m.networkBasePath}
                            onChange={e => updateMapping(i, 'networkBasePath', e.target.value)}
                            placeholder="/media or /mnt/data"
                            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50 font-mono"
                          />
                          <button
                            onClick={() => openBrowser(i, 'networkBasePath')}
                            className="px-2.5 py-2 bg-background border border-border rounded-lg text-textMuted hover:text-primary hover:border-primary/30 transition-colors"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-textMuted mb-1 flex items-center gap-1">
                          <Cpu className="w-3 h-3" /> Worker Path
                          <span className="font-normal text-textMuted/60 ml-1">— same folder, as this Worker sees it</span>
                        </label>
                        <div className="flex gap-1.5 items-center">
                          <input
                            value={m.localBasePath}
                            onChange={e => updateMapping(i, 'localBasePath', e.target.value)}
                            placeholder="Z:\ or /mnt/pi-media"
                            className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50 font-mono"
                          />
                          <button
                            onClick={() => openBrowser(i, 'localBasePath')}
                            className="px-2.5 py-2 bg-background border border-border rounded-lg text-textMuted hover:text-primary hover:border-primary/30 transition-colors"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => removeMapping(i)} className="px-2.5 py-2 text-textMuted hover:text-red-400 transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {i < mappings.length - 1 && <div className="border-t border-border/50 pt-2" />}
                    </div>
                  ))}

                  <button onClick={addMapping} className="flex items-center gap-1 text-xs text-textMuted hover:text-white transition-colors">
                    <Plus className="w-3.5 h-3.5" /> Add path mapping
                  </button>
                </div>
              )}

              {/* Wireless info */}
              {mode === 'wireless' && (
                <div className="flex items-start gap-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
                  <Wifi className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                  <div className="space-y-1.5">
                    <p className="text-sm text-white font-medium">No configuration needed</p>
                    <p className="text-xs text-textMuted leading-relaxed">
                      Transcodarr will automatically transfer files to this worker before transcoding and send them
                      back when done. The pipeline runs in three stages:
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      {[{ icon: Download, label: 'Receiving' }, { icon: Zap, label: 'Transcoding' }, { icon: Upload, label: 'Sending' }].map((s, i) => (
                        <span key={i} className="flex items-center gap-1 text-[10px] text-blue-400 font-medium">
                          {i > 0 && <span className="text-textMuted/50">→</span>}
                          <s.icon className="w-3 h-3" />
                          {s.label}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Save button */}
              <div className="flex justify-end pt-1">
                <button
                  onClick={saveConnection}
                  disabled={saving}
                  className={`px-5 py-2 text-sm font-bold rounded-xl transition-colors disabled:opacity-50 flex items-center gap-1.5
                    ${saveOk ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-primary text-background hover:bg-primary/90'}`}
                >
                  {saving ? 'Saving…' : saveOk ? <><CheckCircle2 className="w-3.5 h-3.5" /> Saved!</> : 'Save Connection'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Connection Badge ─────────────────────────────────────────────────────────

function ConnectionBadge({ mode }: { mode: ConnectionMode }) {
  if (mode === 'wireless') {
    return (
      <span className="px-2 py-1 text-xs font-medium rounded-lg border bg-blue-500/10 text-blue-400 border-blue-500/20 flex items-center gap-1">
        <Wifi className="w-3 h-3" /> Wireless
      </span>
    );
  }
  return (
    <span className="px-2 py-1 text-xs font-medium rounded-lg border bg-green-500/10 text-green-400 border-green-500/20 flex items-center gap-1">
      <HardDrive className="w-3 h-3" /> SMB
    </span>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { cls: string; dot?: string; label: string }> = {
    pending:  { cls: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20', label: 'PENDING' },
    idle:     { cls: 'bg-green-500/10 text-green-400 border-green-500/20',    dot: 'bg-green-400',              label: 'IDLE' },
    online:   { cls: 'bg-green-500/10 text-green-400 border-green-500/20',    dot: 'bg-green-400 animate-pulse', label: 'ONLINE' },
    active:   { cls: 'bg-primary/10 text-primary border-primary/20',          dot: 'bg-primary animate-pulse',   label: 'ACTIVE' },
    offline:  { cls: 'bg-red-500/10 text-red-400 border-red-500/20',          label: 'OFFLINE' },
  };
  const c = configs[status] ?? { cls: 'bg-border/10 text-textMuted border-border/20', label: status.toUpperCase() };
  return (
    <span className={`px-2.5 py-1 text-xs font-bold rounded-full border flex items-center gap-1.5 ${c.cls}`}>
      {c.dot && <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />}
      {c.label}
    </span>
  );
}
