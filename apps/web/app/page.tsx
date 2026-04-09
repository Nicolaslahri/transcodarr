'use client';

import { Activity, Cpu, HardDrive, Zap } from 'lucide-react';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { useAppState } from '@/hooks/useTranscodarrSocket';

export default function Dashboard() {
  const { stats, connected } = useAppState();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.stat-card', {
        y: 20,
        opacity: 0,
        duration: 0.8,
        stagger: 0.1,
        ease: 'power3.out'
      });
      // Animate numbers
      gsap.utils.toArray<HTMLElement>('.stat-value').forEach((el) => {
          const endValue = parseFloat(el.dataset.value || '0');
          gsap.fromTo(el, { innerHTML: 0 }, {
              innerHTML: endValue,
              duration: 1.5,
              ease: 'power2.out',
              snap: { innerHTML: endValue % 1 !== 0 ? 0.1 : 1 },
              onUpdate: function() {
                  const val = parseFloat(this.targets()[0].innerHTML);
                  el.innerHTML = endValue % 1 !== 0 ? val.toFixed(1) : Math.round(val).toString();
              }
          });
      });
    }, containerRef);
    return () => ctx.revert();
  }, [stats]); // Re-animate when stats heavily change or initially load

  return (
    <div ref={containerRef} className="p-10 max-w-7xl mx-auto space-y-8">
      <header className="flex justify-between items-end">
        <div>
            <h1 className="text-4xl font-bold tracking-tight text-white mb-2">Overview</h1>
            <p className="text-textMuted">Monitor your fleet and queue status.</p>
        </div>
        <div className="flex items-center gap-2 mb-2">
            <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-sm font-medium text-textMuted">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard icon={<Activity className="text-primary" />} title="Jobs Today" value={stats.jobsToday} suffix="" />
        <StatCard icon={<HardDrive className="text-green-400" />} title="Storage Saved" value={stats.gbSaved} suffix=" GB" />
        <StatCard icon={<Cpu className="text-purple-400" />} title="Workers Online" value={stats.workersOnline} suffix="" />
        <StatCard icon={<Zap className="text-yellow-400" />} title="Active Transcodes" value={stats.activeJobs} suffix="" />
      </div>

      <div className="mt-12 bg-surface border border-border rounded-2xl p-8 flex flex-col items-center justify-center min-h-[300px]">
        <div className="w-16 h-16 rounded-full bg-border/50 flex items-center justify-center mb-4">
          <Zap className="text-textMuted w-8 h-8" />
        </div>
        <h2 className="text-xl font-medium text-white mb-2">Awaiting Jobs</h2>
        <p className="text-textMuted max-w-sm text-center">
          The engine is running and workers are connected. Add a watched path or drop a file to begin automatically transcoding.
        </p>
      </div>
    </div>
  );
}

function StatCard({ icon, title, value, suffix }: { icon: React.ReactNode; title: string; value: number; suffix: string }) {
  return (
    <div className="stat-card bg-surface border border-border rounded-2xl p-6 flex items-start gap-4 transition-colors hover:border-border/80 hover:bg-surfaceHover">
      <div className="p-3 bg-background rounded-xl shrink-0">
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-medium text-textMuted mb-1">{title}</h3>
        <p className="text-3xl font-bold text-white tracking-tight flex items-baseline gap-1">
          <span className="stat-value" data-value={value}>{value}</span>
          {suffix && <span className="text-lg text-textMuted font-medium">{suffix}</span>}
        </p>
      </div>
    </div>
  );
}
