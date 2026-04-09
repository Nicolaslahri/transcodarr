'use client';

import { useAppState } from '@/hooks/useTranscodarrSocket';
import { CheckCircle2, Cpu, Server, ShieldAlert, X, Plus, MapPin } from 'lucide-react';
import type { WorkerInfo, SmbMapping } from '@transcodarr/shared';
import { useState } from 'react';

export default function WorkersPage() {
  const { workers, acceptWorker, rejectWorker } = useAppState();
  const pendingWorkers = workers.filter(w => w.status === 'pending');
  const activeWorkers = workers.filter(w => w.status !== 'pending');

  return (
    <div className="p-10 max-w-7xl mx-auto space-y-10">
      <header>
        <h1 className="text-4xl font-bold tracking-tight text-white mb-1">Fleet</h1>
        <p className="text-textMuted">Manage transcoding nodes and path mappings.</p>
      </header>

      {/* Pending approval */}
      {pendingWorkers.length > 0 && (
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-yellow-500 mb-4 flex items-center gap-2">
            <ShieldAlert className="w-3.5 h-3.5" /> Awaiting Approval ({pendingWorkers.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {pendingWorkers.map(w => (
              <WorkerCard key={w.id} worker={w} onAccept={acceptWorker} onReject={rejectWorker} />
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
              Start the Transcodarr Worker on any machine on your network. It'll appear here automatically.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {activeWorkers.map(w => (
              <WorkerCard key={w.id} worker={w} onAccept={acceptWorker} onReject={rejectWorker} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function WorkerCard({ worker, onAccept, onReject }: {
  worker: WorkerInfo;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [showMappings, setShowMappings] = useState(false);
  const [mappings, setMappings] = useState<SmbMapping[]>(worker.smbMappings ?? []);
  const [saving, setSaving] = useState(false);
  const isPending = worker.status === 'pending';
  const isActive = worker.status === 'active';
  const isOffline = worker.status === 'offline';

  const saveMappings = async () => {
    setSaving(true);
    await fetch(`/api/workers/${worker.id}/mappings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings }),
    });
    setSaving(false);
  };

  const addMapping = () => setMappings(m => [...m, { networkBasePath: '', localBasePath: '' }]);
  const removeMapping = (i: number) => setMappings(m => m.filter((_, idx) => idx !== i));
  const updateMapping = (i: number, field: keyof SmbMapping, val: string) =>
    setMappings(m => m.map((mp, idx) => idx === i ? { ...mp, [field]: val } : mp));

  return (
    <div className={`relative overflow-hidden bg-surface border rounded-2xl transition-all duration-300
      ${isPending ? 'border-yellow-500/50 shadow-[0_0_30px_rgba(234,179,8,0.07)]' : 'border-border'}`}
    >
      {/* Active progress stripe */}
      {isActive && (
        <div className="absolute top-0 left-0 w-full h-1 bg-border overflow-hidden">
          <div className="h-full bg-primary transition-all duration-500" style={{ width: `${worker.currentProgress ?? 0}%` }} />
        </div>
      )}

      <div className="p-5">
        {/* Header */}
        <div className="flex justify-between items-start mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-background rounded-xl border border-border/50">
              <Cpu className={`w-5 h-5 ${isOffline ? 'text-textMuted' : isPending ? 'text-yellow-400' : 'text-primary'}`} />
            </div>
            <div>
              <h3 className="font-bold text-white">{worker.name}</h3>
              <p className="text-xs text-textMuted font-mono">{worker.host}:{worker.port}</p>
            </div>
          </div>

          <StatusBadge status={worker.status} />
        </div>

        {/* Hardware */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2 py-1 bg-background text-white text-xs rounded-lg border border-border/50">
            {worker.hardware.gpuName}
          </span>
          {worker.hardware.encoders?.filter((e: string) => e.includes('nvenc')).length > 0 && (
            <span className="px-2 py-1 bg-green-900/30 text-green-400 text-xs font-bold rounded-lg border border-green-500/30">NVENC</span>
          )}
          {worker.hardware.encoders?.filter((e: string) => e.includes('amf')).length > 0 && (
            <span className="px-2 py-1 bg-red-900/30 text-red-400 text-xs font-bold rounded-lg border border-red-500/30">AMF</span>
          )}
          {worker.hardware.encoders?.filter((e: string) => e.includes('qsv')).length > 0 && (
            <span className="px-2 py-1 bg-blue-900/30 text-blue-400 text-xs font-bold rounded-lg border border-blue-500/30">QSV</span>
          )}
        </div>

        {/* Pending actions */}
        {isPending && (
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => onAccept(worker.id)}
              className="flex-1 py-2.5 bg-yellow-500 hover:bg-yellow-400 text-black text-sm font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" /> Add to Fleet
            </button>
            <button
              onClick={() => onReject(worker.id)}
              className="py-2.5 px-4 bg-background hover:bg-border text-textMuted text-sm rounded-xl border border-border transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* SMB mappings (active workers) */}
        {!isPending && (
          <div className="mt-4 pt-4 border-t border-border">
            <button
              onClick={() => setShowMappings(!showMappings)}
              className="flex items-center gap-2 text-xs text-textMuted hover:text-white transition-colors w-full"
            >
              <MapPin className="w-3.5 h-3.5" />
              Path Mappings ({mappings.length})
              <span className="ml-auto">{showMappings ? '▲' : '▼'}</span>
            </button>

            {showMappings && (
              <div className="mt-3 space-y-2">
                {mappings.map((m, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      value={m.networkBasePath}
                      onChange={e => updateMapping(i, 'networkBasePath', e.target.value)}
                      placeholder="Main path (e.g. /data/media)"
                      className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50"
                    />
                    <span className="text-textMuted text-xs shrink-0">→</span>
                    <input
                      value={m.localBasePath}
                      onChange={e => updateMapping(i, 'localBasePath', e.target.value)}
                      placeholder="Worker path (e.g. N:\media)"
                      className="flex-1 bg-background border border-border rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary/50"
                    />
                    <button onClick={() => removeMapping(i)} className="text-textMuted hover:text-red-400 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={addMapping}
                    className="flex items-center gap-1 text-xs text-textMuted hover:text-white transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add mapping
                  </button>
                  <button
                    onClick={saveMappings}
                    disabled={saving}
                    className="ml-auto px-3 py-1.5 bg-primary text-background text-xs font-bold rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { cls: string; dot?: string; label: string }> = {
    pending: { cls: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20', label: 'PENDING' },
    idle:    { cls: 'bg-green-500/10 text-green-400 border-green-500/20', dot: 'bg-green-400', label: 'IDLE' },
    active:  { cls: 'bg-primary/10 text-primary border-primary/20', dot: 'bg-primary animate-pulse', label: 'ACTIVE' },
    offline: { cls: 'bg-red-500/10 text-red-400 border-red-500/20', label: 'OFFLINE' },
  };
  const c = configs[status] ?? configs.idle;
  return (
    <span className={`px-2.5 py-1 text-xs font-bold rounded-full border flex items-center gap-1.5 ${c.cls}`}>
      {c.dot && <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />}
      {c.label}
    </span>
  );
}
