'use client';

import { useAppState } from '@/hooks/useTranscodarrSocket';
import { useToast } from '@/hooks/useToast';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import {
  CheckCircle2, Cpu, Server, ShieldAlert, X, Plus, Trash2,
  Zap, Download, Upload, Settings2, Wifi, HardDrive, AlertTriangle,
  Thermometer, MemoryStick,
} from 'lucide-react';
import type { WorkerInfo, ConnectionMode, TransferPhase, GpuStats } from '@transcodarr/shared';
import { useState } from 'react';
import Link from 'next/link';

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
    return (
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-primary font-medium flex items-center gap-1">
            <Zap className="w-3 h-3" aria-hidden /> Transcoding
          </span>
          <span className="text-xs text-textMuted">{progress}%</span>
        </div>
        <div
          className="h-1.5 bg-background rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Transcoding progress`}
        >
          <div className="h-full bg-primary transition-all duration-500 ease-out" style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  }

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
                <span className={`text-xxs font-bold uppercase tracking-wide
                  ${isDone ? 'text-green-400' : isActive ? 'text-primary' : 'text-textMuted/40'}`}>
                  {p.label}
                </span>
                {isActive && <span className="text-xxs text-textMuted">{progress}%</span>}
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
  const { addToast } = useToast();
  const [addModalOpen, setAddModalOpen] = useState(false);
  // Esc closes the add-worker modal (audit fix #7).
  useEscapeKey(addModalOpen, () => setAddModalOpen(false));

  const pendingWorkers = workers.filter(w => w.status === 'pending');
  const activeWorkers  = workers.filter(w => w.status !== 'pending');

  const handleAccept = async (id: string, worker: WorkerInfo) => {
    await acceptWorker(id);
    // If the worker is in SMB mode and has no path mappings, warn the user
    const isSmbUnconfigured = (worker.connectionMode ?? 'smb') === 'smb'
      && (!worker.smbMappings || worker.smbMappings.length === 0);
    if (isSmbUnconfigured) {
      addToast({
        type: 'warning',
        title: 'SMB path mapping required',
        message: `${worker.name} is in Network Share (SMB) mode but has no path mappings. Jobs will fail until you configure a path mapping — or switch to Wireless in Connection Settings.`,
      });
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-10 max-w-7xl mx-auto space-y-6 lg:space-y-10">
      <header className="animate-section flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-4xl font-bold tracking-tight text-white mb-1">Fleet</h1>
          <p className="text-textMuted text-sm">Manage transcoding nodes and their connection to your media.</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <button
            onClick={async () => { await fetch(`${apiUrl}/api/workers/scan`, { method: 'POST' }); }}
            className="px-3 md:px-4 py-2 bg-surface border border-border rounded-xl text-xs md:text-sm font-medium text-textMuted hover:text-white transition-colors"
          >
            Refresh
          </button>
          <button
            onClick={() => setAddModalOpen(true)}
            className="flex items-center gap-1.5 md:gap-2 px-3 md:px-4 py-2 bg-primary text-background rounded-xl text-xs md:text-sm font-bold hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" /> <span>Add Worker</span>
          </button>
        </div>
      </header>

      {/* Pending approval */}
      {pendingWorkers.length > 0 && (
        <section>
          <h2 className="text-xs font-bold uppercase tracking-widest text-yellow-500 mb-4 flex items-center gap-2">
            <ShieldAlert className="w-3.5 h-3.5" /> Awaiting Approval ({pendingWorkers.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 stagger-list">
            {pendingWorkers.map(w => (
              <WorkerCard key={w.id} worker={w} apiUrl={apiUrl} onAccept={handleAccept} onReject={rejectWorker} />
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
          <div className="bg-surface border border-dashed border-border rounded-2xl p-12 flex flex-col items-center text-center gap-4">
            <Server className="w-10 h-10 text-textMuted/40" />
            <div>
              <h3 className="text-base font-semibold text-white mb-1">No workers yet</h3>
              <p className="text-textMuted text-sm max-w-sm mb-4">
                Start the Transcodarr Worker on any machine on your network — it&apos;ll appear here automatically.
              </p>
              <button
                onClick={() => setAddModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary border border-primary/20 rounded-xl text-sm font-medium hover:bg-primary/20 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add Worker Manually
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 stagger-list">
            {activeWorkers.map(w => (
              <WorkerCard key={w.id} worker={w} apiUrl={apiUrl} onAccept={handleAccept} onReject={rejectWorker} />
            ))}
          </div>
        )}
      </section>

      {/* Add Worker Modal */}
      {addModalOpen && (
        <div
          // No backdrop-click-close — IP / port form. Close via Esc / X.
          className="modal-overlay fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
          aria-hidden
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-worker-title"
            className="modal-content bg-surface border border-border w-full max-w-md rounded-2xl p-6 shadow-2xl relative"
          >
            <button onClick={() => setAddModalOpen(false)} aria-label="Close dialog" className="absolute top-4 right-4 text-textMuted hover:text-white">
              <X className="w-5 h-5" />
            </button>
            <h3 id="add-worker-title" className="text-xl font-bold text-white mb-2">Add Worker Node</h3>
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
                addToast({ type: 'error', title: 'Connection failed', message: err.error ?? 'Could not reach worker' });
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
  onAccept: (id: string, worker: WorkerInfo) => void;
  onReject: (id: string) => void;
}) {
  const isPending  = worker.status === 'pending';
  const isActive   = worker.status === 'active';
  const isOffline  = worker.status === 'offline';
  // Inline two-step confirm — replaces the native confirm() dialog which the
  // audit flagged as inconsistent with the rest of the app and inaccessible.
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  return (
    <div className={`card-hover relative overflow-hidden bg-surface border rounded-2xl
      ${isPending ? 'border-yellow-500/50 worker-pending' : isActive ? 'border-primary/40 worker-active' : 'border-border'}`}
    >
      {/* Active job progress — top stripe */}
      {isActive && (
        <div
          className="absolute top-0 left-0 w-full h-0.5 bg-border overflow-hidden"
          role="progressbar"
          aria-valuenow={worker.currentProgress ?? 0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${worker.name} active job progress`}
        >
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

        {/* GPU name + version row */}
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className="px-2.5 py-1 bg-background text-white text-xs font-medium rounded-lg border border-border/50 flex items-center gap-1.5">
            <Cpu className="w-3 h-3 text-textMuted" />
            {worker.hardware?.gpuName ?? 'Unknown GPU'}
          </span>
          {worker.version && worker.version !== 'unknown' && (
            worker.versionMismatch ? (
              <span
                title={`Worker v${worker.version} ≠ Main (version mismatch)`}
                className="px-2 py-1 bg-amber-500/10 text-amber-400 text-xs font-mono rounded-lg border border-amber-500/30 flex items-center gap-1"
              >
                <AlertTriangle className="w-3 h-3" />
                v{worker.version}
              </span>
            ) : (
              <span className="px-2 py-1 bg-background text-textMuted text-xs font-mono rounded-lg border border-border/50">
                v{worker.version}
              </span>
            )
          )}
        </div>

        {/* Encoder badges */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {worker.hardware?.encoders?.some((e: string) => e.includes('nvenc')) && (
            <EncoderBadge type="nvenc" />
          )}
          {worker.hardware?.encoders?.some((e: string) => e.includes('amf')) && (
            <EncoderBadge type="amf" />
          )}
          {worker.hardware?.encoders?.some((e: string) => e.includes('qsv')) && (
            <EncoderBadge type="qsv" />
          )}
        </div>

        {/* GPU stats — shown when available */}
        {worker.gpuStats && <GpuStatsBar stats={worker.gpuStats} />}

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
            <button onClick={() => onAccept(worker.id, worker)}
              className="flex-1 py-2.5 bg-yellow-500 hover:bg-yellow-400 text-black text-sm font-bold rounded-xl transition-colors">
              Accept
            </button>
            <button onClick={() => onReject(worker.id)}
              className="py-2.5 px-4 bg-background hover:bg-border text-textMuted text-sm rounded-xl border border-border transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Active worker footer */}
        {!isPending && !confirmingRemove && (
          <div className="flex gap-2 mt-4 pt-4 border-t border-border items-center justify-between">
            <Link
              href="/settings?tab=transfer"
              className="flex items-center gap-1.5 text-xs text-textMuted hover:text-primary transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" aria-hidden />
              Connection Settings
            </Link>
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              aria-label={`Remove worker ${worker.name}`}
              className="text-textMuted hover:text-red-400 transition-colors p-2 rounded-lg"
            >
              <Trash2 className="w-4 h-4" aria-hidden />
            </button>
          </div>
        )}
        {/* Inline confirm row — appears in place of the footer when remove
            is pending. Two visible buttons replace the modal confirm dialog. */}
        {!isPending && confirmingRemove && (
          <div className="flex gap-2 mt-4 pt-4 border-t border-red-500/30 items-center" role="alert">
            <span className="text-xs text-textMuted flex-1">Remove {worker.name} from the fleet?</span>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              className="px-3 py-1.5 text-xs text-textMuted hover:text-white rounded-lg border border-border transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { setConfirmingRemove(false); onReject(worker.id); }}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 hover:bg-red-400 rounded-lg transition-colors"
            >
              Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Encoder Badge ───────────────────────────────────────────────────────────

function NvidiaIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
      <path d="M9.5 3v2.5c1.5-.4 3.1-.3 4.5.4V3.4C12.7 3 11.1 3 9.5 3zm5 1v2.2c1.3.8 2.4 2 3 3.4h2.2C19 7.3 17.1 5 14.5 4zm3.2 4.8c.2.6.3 1.3.3 2 0 3.9-3.1 7-7 7s-7-3.1-7-7c0-3.6 2.7-6.6 6.2-6.9V5.7C6 6.1 3 9.3 3 13.2c0 4.4 3.6 8 8 8s8-3.6 8-8c0-.8-.1-1.6-.4-2.3l-1.9-.1z"/>
    </svg>
  );
}

function AmdIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
      <path d="M4 4l4 4V4h12v12h-4l-4-4v4H4V4zm4 8l4-4 4 4-4 4-4-4z"/>
    </svg>
  );
}

function IntelIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
      <path d="M6 2h12a4 4 0 014 4v12a4 4 0 01-4 4H6a4 4 0 01-4-4V6a4 4 0 014-4zm1.5 5.5v9h1.5v-9H7.5zm3 0v9H12v-3.5h2.5v-1.5H12V9h3.5V7.5H10.5zm6 0v9H18v-9h-1.5z"/>
    </svg>
  );
}

const ENCODER_CONFIG = {
  nvenc: { label: 'NVENC', desc: 'NVIDIA hardware encoder', bg: 'bg-[#76b900]/10', text: 'text-[#76b900]', border: 'border-[#76b900]/30', Icon: NvidiaIcon },
  amf:   { label: 'AMF',   desc: 'AMD hardware encoder',    bg: 'bg-[#ed1c24]/10', text: 'text-[#ed1c24]', border: 'border-[#ed1c24]/30', Icon: AmdIcon   },
  qsv:   { label: 'QSV',   desc: 'Intel hardware encoder',  bg: 'bg-[#0071c5]/10', text: 'text-[#0071c5]', border: 'border-[#0071c5]/30', Icon: IntelIcon  },
} as const;

function EncoderBadge({ type }: { type: keyof typeof ENCODER_CONFIG }) {
  const c = ENCODER_CONFIG[type];
  return (
    <span
      title={c.desc}
      className={`px-2 py-0.5 ${c.bg} ${c.text} text-xxs font-bold rounded-md border ${c.border} flex items-center gap-1`}
    >
      <c.Icon />
      {c.label}
    </span>
  );
}

// ─── GPU Stats Bar ────────────────────────────────────────────────────────────

function GpuStatsBar({ stats }: { stats: GpuStats }) {
  const tempColor = stats.tempC >= 90 ? 'text-red-400' : stats.tempC >= 75 ? 'text-amber-400' : 'text-textMuted';
  const utilColor = stats.utilPct >= 90 ? 'bg-red-400' : stats.utilPct >= 70 ? 'bg-amber-400' : 'bg-primary';
  const vramPct   = stats.vramTotalMB > 0 ? Math.round((stats.vramUsedMB / stats.vramTotalMB) * 100) : 0;

  return (
    <div className="mt-2 p-2.5 bg-background/60 rounded-lg border border-border/40 space-y-1.5">
      {/* GPU utilisation */}
      <div className="flex items-center gap-2">
        <span className="text-xxs text-textMuted w-12 shrink-0">GPU</span>
        <div
          className="flex-1 h-1 bg-border/40 rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={stats.utilPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`GPU utilisation ${stats.utilPct}%`}
        >
          <div className={`h-full rounded-full transition-all duration-500 ${utilColor}`} style={{ width: `${stats.utilPct}%` }} />
        </div>
        <span className="text-xxs text-textMuted w-8 text-right">{stats.utilPct}%</span>
      </div>
      {/* VRAM */}
      <div className="flex items-center gap-2">
        <span className="text-xxs text-textMuted w-12 shrink-0 flex items-center gap-1">
          <MemoryStick className="w-2.5 h-2.5" aria-hidden /> VRAM
        </span>
        <div
          className="flex-1 h-1 bg-border/40 rounded-full overflow-hidden"
          role="progressbar"
          aria-valuenow={vramPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`VRAM ${vramPct}% used`}
        >
          <div className="h-full rounded-full bg-sky-500 transition-all duration-500" style={{ width: `${vramPct}%` }} />
        </div>
        <span className="text-xxs text-textMuted w-8 text-right">
          {stats.vramUsedMB >= 1024 ? `${(stats.vramUsedMB / 1024).toFixed(1)}G` : `${stats.vramUsedMB}M`}
        </span>
      </div>
      {/* Temperature */}
      <div className="flex items-center justify-end gap-1">
        <Thermometer className={`w-3 h-3 ${tempColor}`} aria-hidden />
        <span className={`text-xxs font-medium ${tempColor}`}>{stats.tempC}°C</span>
      </div>
    </div>
  );
}

// ─── Connection Badge ─────────────────────────────────────────────────────────

function ConnectionBadge({ mode }: { mode: ConnectionMode }) {
  if (mode === 'wireless') {
    return (
      <span className="px-2 py-1 text-xs font-medium rounded-lg border bg-blue-500/10 text-blue-400 border-blue-500/20 flex items-center gap-1">
        <Wifi className="w-3 h-3" /> Wireless Transfer
      </span>
    );
  }
  return (
    <span className="px-2 py-1 text-xs font-medium rounded-lg border bg-green-500/10 text-green-400 border-green-500/20 flex items-center gap-1">
      <HardDrive className="w-3 h-3" /> Network Share (SMB)
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
