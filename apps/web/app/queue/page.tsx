'use client';

import { useAppState } from '@/hooks/useTranscodarrSocket';
import { Film, CheckCircle2, RotateCcw, XCircle, AlertTriangle } from 'lucide-react';
import type { Job } from '@transcodarr/shared';
import { useEffect, useRef } from 'react';
import gsap from 'gsap';

export default function QueuePage() {
  const { jobs } = useAppState();

  const activeJobs = jobs.filter(j => ['queued', 'dispatched', 'transcoding', 'swapping'].includes(j.status));
  const completedJobs = jobs.filter(j => j.status === 'complete');
  const failedJobs = jobs.filter(j => j.status === 'failed');

  return (
    <div className="p-10 max-w-7xl mx-auto space-y-12">
      <header>
        <h1 className="text-4xl font-bold tracking-tight text-white mb-2">Queue</h1>
        <p className="text-textMuted">Active transcodes and processing history.</p>
      </header>

      <section>
          <h2 className="text-sm font-bold uppercase tracking-widest text-textMuted mb-4">Active Processing ({activeJobs.length})</h2>
          <div className="space-y-3">
              {activeJobs.length === 0 ? (
                  <div className="p-6 bg-surface border border-border border-dashed rounded-xl text-center text-textMuted text-sm">
                      No active jobs.
                  </div>
              ) : (
                  activeJobs.map(job => <JobRow key={job.id} job={job} />)
              )}
          </div>
      </section>
      
      <section>
          <h2 className="text-sm font-bold uppercase tracking-widest text-textMuted mb-4">Completed ({completedJobs.length})</h2>
          <div className="space-y-3">
              {completedJobs.slice(0, 5).map(job => <CompletedJobRow key={job.id} job={job} />)}
          </div>
      </section>
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
    const isTranscoding = job.status === 'transcoding';
    const waveRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isTranscoding && waveRef.current) {
            const bars = waveRef.current.children;
            const ctx = gsap.context(() => {
                gsap.to(bars, {
                    scaleY: 1,
                    duration: 0.4,
                    stagger: {
                        each: 0.1,
                        repeat: -1,
                        yoyo: true
                    },
                    ease: "sine.inOut"
                });
            }, waveRef);
            return () => ctx.revert();
        }
    }, [isTranscoding]);

    return (
        <div className="bg-surface border border-border rounded-xl p-4 flex items-center gap-6">
            <div className="p-3 bg-background rounded-xl shrink-0">
                <Film className="w-5 h-5 text-textMuted" />
            </div>
            
            <div className="flex-1 min-w-0">
                <h3 className="text-white font-medium truncate">{job.fileName}</h3>
                <div className="flex items-center gap-3 text-xs text-textMuted mt-1">
                    <span className="font-mono bg-background px-2 font-medium py-0.5 rounded border border-border">
                        {job.status.toUpperCase()}
                    </span>
                    {job.workerName && <span>Assigned to {job.workerName}</span>}
                    {job.fps && <span>{job.fps} FPS</span>}
                </div>
            </div>

            <div className="flex items-center gap-6 shrink-0">
                {isTranscoding && (
                    <div ref={waveRef} className="flex items-end gap-[2px] h-6 w-8">
                        <div className="w-1.5 h-2 bg-primary rounded-sm transform scale-y-50 origin-bottom" />
                        <div className="w-1.5 h-4 bg-primary rounded-sm transform scale-y-50 origin-bottom" />
                        <div className="w-1.5 h-6 bg-primary rounded-sm transform scale-y-50 origin-bottom" />
                        <div className="w-1.5 h-3 bg-primary rounded-sm transform scale-y-50 origin-bottom" />
                    </div>
                )}

                <div className="w-32 text-right">
                    <div className="flex justify-between text-xs mb-1">
                        <span className="text-textMuted font-medium">{job.progress}%</span>
                    </div>
                    <div className="h-1.5 bg-background rounded-full overflow-hidden border border-border">
                        <div 
                            className="h-full bg-primary transition-all duration-500 ease-out"
                            style={{ width: `${job.progress}%` }}
                        />
                    </div>
                </div>

                <button className="p-2 hover:bg-background rounded-lg text-textMuted hover:text-red-400 transition-colors">
                    <XCircle className="w-5 h-5" />
                </button>
            </div>
        </div>
    );
}

function CompletedJobRow({ job }: { job: Job }) {
    const savedBytes = (job.sizeBefore || 0) - (job.sizeAfter || 0);
    const savedMb = Math.round(savedBytes / 1024 / 1024);
    const savedPct = job.sizeBefore ? Math.round((savedBytes / job.sizeBefore) * 100) : 0;

    return (
        <div className="bg-background border border-border/50 opacity-70 rounded-xl p-4 flex items-center gap-6">
             <div className="p-2 shrink-0">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
            </div>
            
            <div className="flex-1 min-w-0">
                <h3 className="text-white font-medium truncate text-sm">{job.fileName}</h3>
            </div>

            <div className="flex items-center gap-4 shrink-0 text-sm">
                <span className="text-green-400 font-medium whitespace-nowrap">Saved {savedMb} MB</span>
                <span className="text-textMuted px-2 py-1 bg-surface rounded-md border border-border font-mono text-xs">
                    -{savedPct}%
                </span>
            </div>
        </div>
    );
}
