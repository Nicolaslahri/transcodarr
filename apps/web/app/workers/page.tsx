'use client';

import { useAppState } from '@/hooks/useTranscodarrSocket';
import { Cpu, Server, CheckCircle2, ShieldAlert } from 'lucide-react';
import { type WorkerInfo } from '@transcodarr/shared';

export default function WorkersPage() {
  const { workers } = useAppState();

  return (
    <div className="p-10 max-w-7xl mx-auto space-y-8">
      <header>
        <h1 className="text-4xl font-bold tracking-tight text-white mb-2">Fleet</h1>
        <p className="text-textMuted">Manage transcoding nodes and path resolutions.</p>
      </header>

      {workers.length === 0 ? (
        <div className="bg-surface border border-border rounded-2xl p-12 flex flex-col items-center justify-center text-center">
            <Server className="w-12 h-12 text-textMuted mb-4" />
            <h2 className="text-xl font-medium text-white mb-2">No Workers Found</h2>
            <p className="text-textMuted max-w-md">
                Start the Transcodarr Worker executable on a Windows PC with an Nvidia GPU. 
                It will automatically appear here via zero-config mDNS.
            </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {workers.map(w => <WorkerCard key={w.id} worker={w} />)}
        </div>
      )}
    </div>
  );
}

function WorkerCard({ worker }: { worker: WorkerInfo }) {
  const isPending = worker.status === 'pending';
  const isActive = worker.status === 'active';
  const isOffline = worker.status === 'offline';

  return (
    <div className={`relative overflow-hidden bg-surface border rounded-2xl p-6 transition-all duration-300 ${isPending ? 'border-yellow-500/50 shadow-[0_0_20px_rgba(234,179,8,0.1)]' : 'border-border'}`}>
        
        {isActive && (
            <div className="absolute top-0 left-0 w-full h-1 bg-border overflow-hidden">
                <div 
                    className="h-full bg-primary transition-all duration-500 ease-out" 
                    style={{ width: `${worker.currentProgress || 0}%` }} 
                />
            </div>
        )}

        <div className="flex justify-between items-start mb-6">
            <div className="flex gap-4">
                <div className="p-3 bg-background rounded-xl shrink-0 border border-border/50">
                    <Cpu className={`w-6 h-6 ${isOffline ? 'text-textMuted' : 'text-primary'}`} />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-white tracking-wide">{worker.name}</h3>
                    <p className="text-sm font-medium text-textMuted">{worker.host}:{worker.port}</p>
                </div>
            </div>
            
            {isPending && (
                <span className="px-3 py-1 bg-yellow-500/10 text-yellow-500 text-xs font-bold rounded-full flex gap-1.5 items-center">
                    <ShieldAlert className="w-3.5 h-3.5" /> Pending
                </span>
            )}
            {!isPending && !isOffline && (
                <span className="px-3 py-1 bg-green-500/10 text-green-400 text-xs font-bold rounded-full flex gap-1.5 items-center border border-green-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    {worker.status.toUpperCase()}
                </span>
            )}
            {isOffline && (
                <span className="px-3 py-1 bg-red-500/10 text-red-400 text-xs font-bold rounded-full border border-red-500/20">
                    OFFLINE
                </span>
            )}
        </div>

        <div className="space-y-4">
            <div>
                <div className="text-xs font-bold uppercase tracking-wider text-textMuted mb-2">Hardware Profile</div>
                <div className="flex items-center gap-2">
                    <span className="px-2 py-1 bg-background text-white text-xs font-medium rounded-md border border-border/50">
                        {worker.hardware.gpuName}
                    </span>
                    {worker.hardware.encoders.filter(e => e.includes('nvenc')).length > 0 && (
                        <span className="px-2 py-1 bg-green-900/30 text-green-400 text-xs font-bold rounded-md border border-green-500/30">
                            NVENC
                        </span>
                    )}
                </div>
            </div>

            {isPending && (
                <div className="pt-4 flex gap-3">
                    <button className="flex-1 bg-primary text-background font-bold py-2 rounded-xl hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
                        <CheckCircle2 className="w-4 h-4" /> Accept Worker
                    </button>
                </div>
            )}
            
            {isActive && worker.currentJobId && (
                <div className="pt-4 border-t border-border mt-4">
                    <div className="text-xs font-bold uppercase tracking-wider text-textMuted mb-3">Current Task</div>
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 relative flex-shrink-0">
                            {/* SVG Progress Ring */}
                            <svg className="w-full h-full transform -rotate-90">
                                <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="3" fill="transparent" className="text-border" />
                                <circle 
                                    cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="3" fill="transparent" 
                                    strokeDasharray={125.6} 
                                    strokeDashoffset={125.6 - ((worker.currentProgress || 0) / 100) * 125.6}
                                    className="text-primary transition-all duration-500 ease-out" 
                                />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                                {worker.currentProgress || 0}%
                            </div>
                        </div>
                        <div className="overflow-hidden">
                            <p className="text-sm font-medium text-white truncate">Transcoding...</p>
                            <p className="text-xs text-textMuted font-mono">{worker.currentFps} FPS</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    </div>
  );
}
