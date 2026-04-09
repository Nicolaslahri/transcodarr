'use client';

import { useAppState } from '@/hooks/useTranscodarrSocket';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { Activity, Cpu, HardDrive, Zap, ArrowRight, CheckCircle2, Clock } from 'lucide-react';

// Main node overview dashboard
export default function OverviewPage() {
  const { stats, connected, meta, jobs, workers } = useAppState();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.stat-card', { y: 20, opacity: 0, duration: 0.7, stagger: 0.08, ease: 'power3.out' });
      gsap.utils.toArray<HTMLElement>('.stat-value').forEach((el) => {
        const end = parseFloat(el.dataset.value || '0');
        gsap.fromTo(el, { innerText: '0' }, {
          duration: 1.4, ease: 'power2.out',
          onUpdate() {
            const val = end * this.progress();
            el.innerText = end % 1 !== 0 ? val.toFixed(1) : Math.round(val).toString();
          },
          onComplete() { el.innerText = end % 1 !== 0 ? end.toFixed(1) : end.toString(); }
        });
      });
    }, containerRef);
    return () => ctx.revert();
  }, [stats]);

  const recentJobs = jobs.slice(0, 5);

  return (
    <div ref={containerRef} className="p-10 max-w-7xl mx-auto space-y-10">
      {/* Header */}
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white mb-1">Overview</h1>
          <p className="text-textMuted">Monitor your fleet and transcoding queue.</p>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-sm text-textMuted">{connected ? 'Live' : 'Offline'}</span>
        </div>
      </header>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard icon={<Activity className="text-primary w-5 h-5" />}  label="Jobs Today"    value={stats.jobsToday}    suffix="" />
        <StatCard icon={<HardDrive className="text-green-400 w-5 h-5" />} label="Space Saved" value={stats.gbSaved}       suffix=" GB" />
        <StatCard icon={<Cpu className="text-purple-400 w-5 h-5" />}   label="Workers Online" value={stats.workersOnline} suffix="" />
        <StatCard icon={<Zap className="text-yellow-400 w-5 h-5" />}   label="Active Jobs"   value={stats.activeJobs}   suffix="" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Activity */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="font-bold text-white text-sm">Recent Activity</h2>
            <a href="/queue" className="flex items-center gap-1 text-xs text-textMuted hover:text-primary transition-colors">
              View all <ArrowRight className="w-3 h-3" />
            </a>
          </div>
          <div className="divide-y divide-border">
            {recentJobs.length === 0 && (
              <div className="px-6 py-8 text-center text-textMuted text-sm">No recent jobs</div>
            )}
            {recentJobs.map(job => (
              <div key={job.id} className="px-6 py-3.5 flex items-center gap-4">
                {job.status === 'complete'
                  ? <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                  : job.status === 'transcoding'
                  ? <Zap className="w-4 h-4 text-primary shrink-0 animate-pulse" />
                  : <Clock className="w-4 h-4 text-textMuted shrink-0" />
                }
                <span className="flex-1 text-sm text-white truncate">{job.fileName}</span>
                <span className={`text-xs font-medium ${
                  job.status === 'complete' ? 'text-green-400' :
                  job.status === 'failed' ? 'text-red-400' :
                  'text-textMuted'
                }`}>{job.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Fleet Summary */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <h2 className="font-bold text-white text-sm">Fleet</h2>
            <a href="/workers" className="flex items-center gap-1 text-xs text-textMuted hover:text-primary transition-colors">
              Manage <ArrowRight className="w-3 h-3" />
            </a>
          </div>
          <div className="divide-y divide-border">
            {workers.length === 0 && (
              <div className="px-6 py-8 text-center text-textMuted text-sm">No workers discovered yet</div>
            )}
            {workers.map(w => (
              <div key={w.id} className="px-6 py-3.5 flex items-center gap-4">
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  w.status === 'active' ? 'bg-primary animate-pulse' :
                  w.status === 'idle' ? 'bg-green-400' :
                  w.status === 'pending' ? 'bg-yellow-400' :
                  'bg-red-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-medium">{w.name}</p>
                  <p className="text-xs text-textMuted">{w.hardware.gpuName}</p>
                </div>
                <span className="text-xs text-textMuted">{w.status.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, suffix }: { icon: React.ReactNode; label: string; value: number; suffix: string }) {
  return (
    <div className="stat-card bg-surface border border-border rounded-2xl p-5 flex items-start gap-4 hover:border-border/60 transition-colors">
      <div className="p-2.5 bg-background rounded-xl border border-border/50 shrink-0">{icon}</div>
      <div>
        <p className="text-xs text-textMuted font-medium mb-1">{label}</p>
        <p className="text-3xl font-bold text-white flex items-baseline gap-1">
          <span className="stat-value" data-value={value}>{value}</span>
          {suffix && <span className="text-base text-textMuted font-normal">{suffix}</span>}
        </p>
      </div>
    </div>
  );
}
