'use client';

import { useAppState } from '@/hooks/useTranscodarrSocket';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';

interface WorkerStatus {
  workerId: string;
  hardware: any;
  currentJob: { jobId: string; fileName: string; progress: number; fps?: number; phase?: string } | null;
}

const RING_RADIUS    = 90;
const CIRCUMFERENCE  = 2 * Math.PI * RING_RADIUS; // ≈ 565.5

// ─── Encoder vendor colours ───────────────────────────────────────────────────

const VENDOR_COLORS: Record<string, string> = {
  nvidia: '#76b900',
  amd:    '#ed1c24',
  intel:  '#0071c5',
  cpu:    '#6b7280',
};

const VENDOR_LABEL: Record<string, string> = {
  nvidia: 'NVIDIA',
  amd:    'AMD',
  intel:  'Intel',
  cpu:    'CPU',
};

// ─── Phase label ──────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<string, string> = {
  receiving:   'Downloading…',
  transcoding: 'Transcoding',
  sending:     'Uploading…',
  swapping:    'Finishing…',
};

export default function WorkerStatusPage() {
  const { meta, connected } = useAppState();
  const [status, setStatus] = useState<WorkerStatus | null>(null);

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const ringRef      = useRef<SVGCircleElement>(null);
  const glowRef      = useRef<HTMLDivElement>(null);
  const progressRef  = useRef(0);

  // ── Polling ───────────────────────────────────────────────────────────────

  useEffect(() => {
    const apiUrl = typeof window !== 'undefined'
      ? `http://${window.location.hostname}:${window.location.port || 3001}`
      : '';

    const poll = async () => {
      try {
        const r = await fetch(`${apiUrl}/status`);
        const data = await r.json();
        setStatus(data);
      } catch {}
    };

    poll();
    const iv = setInterval(poll, 2000);
    return () => clearInterval(iv);
  }, []);

  // ── Entry animation ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from('.ws-block', { y: 30, opacity: 0, duration: 0.7, stagger: 0.1, ease: 'power3.out', clearProps: 'all' });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  // ── Idle breathing glow ───────────────────────────────────────────────────

  useEffect(() => {
    if (!glowRef.current) return;
    const tween = gsap.to(glowRef.current, {
      opacity: 0.18, scale: 1.25, duration: 2.8,
      repeat: -1, yoyo: true, ease: 'sine.inOut',
    });
    return () => { tween.kill(); };
  }, []);

  // ── Ring progress animation ───────────────────────────────────────────────

  useEffect(() => {
    if (!ringRef.current) return;
    const progress = status?.currentJob?.progress ?? 0;
    const target = CIRCUMFERENCE * (1 - progress / 100);
    gsap.to(ringRef.current, {
      strokeDashoffset: target,
      duration: 1.2,
      ease: 'power2.out',
    });
    progressRef.current = progress;
  }, [status?.currentJob?.progress]);

  const hw  = status?.hardware ?? meta.hardware;
  const job = status?.currentJob;
  const isIdle = !job;
  const vendor = (hw?.gpu ?? 'cpu') as string;
  const vendorColor = VENDOR_COLORS[vendor] ?? VENDOR_COLORS.cpu;
  const phaseLabel = job ? (PHASE_LABEL[job.phase ?? 'transcoding'] ?? 'Transcoding') : '';

  return (
    <div
      ref={containerRef}
      className="relative h-screen flex flex-col items-center justify-center overflow-hidden bg-background select-none"
    >
      {/* ── Ambient glow (always present, breathing when idle) ─────────────── */}
      <div
        ref={glowRef}
        className="absolute pointer-events-none rounded-full"
        style={{
          width: 600,
          height: 600,
          background: `radial-gradient(circle, ${isIdle ? vendorColor : '#00d9ff'}22 0%, transparent 70%)`,
          opacity: 0.08,
        }}
      />

      {/* ── Idle state ────────────────────────────────────────────────────── */}
      {isIdle && (
        <div className="relative flex flex-col items-center gap-8 px-8 text-center">
          {/* GPU hero */}
          <div className="ws-block">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-textMuted mb-3">
              {VENDOR_LABEL[vendor] ?? 'CPU'} · {meta.name || 'Worker Node'}
            </p>
            <h1
              className="text-5xl font-black tracking-tight leading-none"
              style={{ color: vendorColor }}
            >
              {hw?.gpuName ?? 'Ready'}
            </h1>
          </div>

          {/* Encoder badges */}
          {hw?.encoders && hw.encoders.length > 0 && (
            <div className="ws-block flex flex-wrap justify-center gap-2">
              {hw.encoders.some((e: string) => e.includes('nvenc'))  && <HWBadge label="NVENC"      color="green"  />}
              {hw.encoders.some((e: string) => e.includes('av1'))    && <HWBadge label="AV1"        color="purple" />}
              {hw.encoders.some((e: string) => e.includes('amf'))    && <HWBadge label="AMD AMF"    color="red"    />}
              {hw.encoders.some((e: string) => e.includes('qsv'))    && <HWBadge label="QuickSync"  color="blue"   />}
            </div>
          )}
          {(!hw?.encoders || hw.encoders.length === 0) && (
            <div className="ws-block">
              <HWBadge label="CPU Only" color="gray" />
            </div>
          )}

          {/* Status */}
          <div className="ws-block flex flex-col items-center gap-2">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
              <span className="text-textMuted text-sm">
                {connected ? 'Connected to Main Node · Waiting for a job…' : 'Disconnected from Main Node'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Transcoding state ─────────────────────────────────────────────── */}
      {!isIdle && job && (
        <div className="relative flex flex-col items-center gap-6 px-8 w-full max-w-lg text-center">
          {/* SVG Progress Ring */}
          <div className="ws-block relative">
            <svg
              viewBox="0 0 200 200"
              className="w-64 h-64 -rotate-90"
              aria-label={`${job.progress}% complete`}
            >
              {/* Subtle outer glow ring */}
              <circle
                cx="100" cy="100" r={RING_RADIUS + 6}
                fill="none" stroke="#00d9ff08" strokeWidth="12"
              />
              {/* Track */}
              <circle
                cx="100" cy="100" r={RING_RADIUS}
                fill="none" stroke="#ffffff0a" strokeWidth="8"
              />
              {/* Progress arc */}
              <circle
                ref={ringRef}
                cx="100" cy="100" r={RING_RADIUS}
                fill="none"
                stroke="#00d9ff"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={CIRCUMFERENCE}
                style={{ filter: 'drop-shadow(0 0 8px #00d9ffaa)' }}
              />
            </svg>

            {/* Center content — layered on top of SVG */}
            <div className="absolute inset-0 flex flex-col items-center justify-center rotate-0">
              <span className="text-5xl font-black text-white tabular-nums leading-none">
                {job.progress}
              </span>
              <span className="text-sm text-textMuted font-medium mt-1">%</span>
              <span
                className="text-xs font-bold uppercase tracking-widest mt-2"
                style={{ color: '#00d9ff' }}
              >
                {phaseLabel}
              </span>
            </div>
          </div>

          {/* Filename */}
          <div className="ws-block w-full">
            <p className="text-white font-semibold text-lg truncate">{job.fileName}</p>
            <div className="flex items-center justify-center gap-4 mt-2 flex-wrap">
              {job.fps && (
                <span className="text-xs text-textMuted font-mono">
                  <span className="text-white font-semibold">{job.fps}</span> fps
                </span>
              )}
              <span className="text-xs font-bold px-2 py-0.5 rounded-full border"
                style={{ color: vendorColor, borderColor: vendorColor + '40', background: vendorColor + '12' }}>
                {VENDOR_LABEL[vendor] ?? 'CPU'}
              </span>
            </div>
          </div>

          {/* Hardware badges strip */}
          {hw?.encoders && hw.encoders.length > 0 && (
            <div className="ws-block flex flex-wrap justify-center gap-2 opacity-60">
              {hw.encoders.some((e: string) => e.includes('nvenc'))  && <HWBadge label="NVENC"      color="green"  />}
              {hw.encoders.some((e: string) => e.includes('av1'))    && <HWBadge label="AV1"        color="purple" />}
              {hw.encoders.some((e: string) => e.includes('amf'))    && <HWBadge label="AMD AMF"    color="red"    />}
              {hw.encoders.some((e: string) => e.includes('qsv'))    && <HWBadge label="QuickSync"  color="blue"   />}
            </div>
          )}
        </div>
      )}

      {/* ── Bottom status bar ─────────────────────────────────────────────── */}
      <div className="ws-block absolute bottom-8 left-0 right-0 flex justify-center">
        <div className="flex items-center gap-3 px-4 py-2 bg-surface/80 backdrop-blur-sm border border-border rounded-full text-xs text-textMuted">
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
          <span>{meta.name || 'Worker Node'}</span>
          <span className="text-border">·</span>
          <span className="font-mono text-white/50">{meta.version || '1.0.0'}</span>
          {!isIdle && (
            <>
              <span className="text-border">·</span>
              <span style={{ color: '#00d9ff' }}>{PHASE_LABEL[job?.phase ?? 'transcoding'] ?? 'Transcoding'}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── HW Badge ─────────────────────────────────────────────────────────────────

function HWBadge({ label, color }: { label: string; color: 'green' | 'purple' | 'red' | 'blue' | 'gray' }) {
  const styles = {
    green:  'bg-green-900/30 text-green-400 border-green-500/30',
    purple: 'bg-purple-900/30 text-purple-400 border-purple-500/30',
    red:    'bg-red-900/30 text-red-400 border-red-500/30',
    blue:   'bg-blue-900/30 text-blue-400 border-blue-500/30',
    gray:   'bg-background text-textMuted border-border',
  };
  return (
    <span className={`px-3 py-1 text-xs font-bold rounded-full border ${styles[color]}`}>{label}</span>
  );
}
