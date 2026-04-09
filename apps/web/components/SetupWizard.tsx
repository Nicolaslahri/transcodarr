'use client';

import { useState } from 'react';
import { Cpu, Server, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';

type Step = 'choose' | 'worker-ip' | 'saving' | 'done';

interface Props {
  onComplete: () => void;
}

export function SetupWizard({ onComplete }: Props) {
  const [step, setStep]     = useState<Step>('choose');
  const [role, setRole]     = useState<'main' | 'worker' | null>(null);
  const [mainIp, setMainIp] = useState('');
  const [error, setError]   = useState('');
  const [scanning, setScanning] = useState(false);

  const scanForMainNode = async () => {
    setStep('worker-ip');
    setScanning(true);
    try {
      const res = await fetch('/api/setup/discover');
      const ips = await res.json();
      if (ips && ips.length > 0) {
        setMainIp(ips[0]);
      }
    } catch (e) {
      // silently ignore scan failures, they can easily fallback to manual entry
    } finally {
      setScanning(false);
    }
  };

  const save = async (selectedRole: 'main' | 'worker') => {
    setStep('saving');
    setError('');
    try {
      const body: any = { role: selectedRole };
      if (selectedRole === 'worker' && mainIp) body.mainUrl = `http://${mainIp}:3001`;

      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(await res.text());
      setStep('done');
      // Give the server 2 s to restart, then reload
      setTimeout(() => {
        onComplete();
        window.location.reload();
      }, 2000);
    } catch (e: any) {
      setError(e.message ?? 'Setup failed');
      setStep(selectedRole === 'worker' ? 'worker-ip' : 'choose');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flex items-center justify-center p-6">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
            <span className="text-3xl">🎬</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Welcome to Transcodarr</h1>
          <p className="text-textMuted mt-2 text-sm">Let's get your node configured. This only takes a moment.</p>
        </div>

        {/* ── Step: Choose role ─────────────────────────────────────────── */}
        {step === 'choose' && (
          <div className="space-y-4">
            <p className="text-xs font-bold uppercase tracking-widest text-textMuted text-center mb-6">
              What is this machine?
            </p>

            <button
              onClick={() => { setRole('main'); save('main'); }}
              className="w-full group bg-surface border border-border hover:border-primary/50 rounded-2xl p-6 text-left transition-all duration-200 hover:shadow-lg hover:shadow-primary/5"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 bg-primary/10 rounded-xl border border-primary/20 group-hover:bg-primary/20 transition-colors">
                  <Server className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-bold text-lg mb-1">Main Node</h3>
                  <p className="text-textMuted text-sm leading-relaxed">
                    The central hub. Manages the job queue, coordinates workers, and hosts the web interface.
                    <br />
                    <span className="text-primary/80 text-xs mt-1 inline-block">✓ Recommended for your NAS or always-on server (Pi, Unraid, Synology)</span>
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-textMuted group-hover:text-primary transition-colors mt-1 shrink-0" />
              </div>
            </button>

            <button
              onClick={() => { setRole('worker'); scanForMainNode(); }}
              className="w-full group bg-surface border border-border hover:border-yellow-500/50 rounded-2xl p-6 text-left transition-all duration-200 hover:shadow-lg hover:shadow-yellow-500/5"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 bg-yellow-500/10 rounded-xl border border-yellow-500/20 group-hover:bg-yellow-500/20 transition-colors">
                  <Cpu className="w-6 h-6 text-yellow-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-bold text-lg mb-1">Worker Node</h3>
                  <p className="text-textMuted text-sm leading-relaxed">
                    A transcoding engine. Receives jobs from the Main node and uses its GPU/CPU to do the actual encoding.
                    <br />
                    <span className="text-yellow-400/80 text-xs mt-1 inline-block">✓ Ideal for gaming PCs or dedicated GPU machines</span>
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-textMuted group-hover:text-yellow-400 transition-colors mt-1 shrink-0" />
              </div>
            </button>
          </div>
        )}

        {/* ── Step: Worker — enter Main IP ──────────────────────────────── */}
        {step === 'worker-ip' && (
          <div className="bg-surface border border-border rounded-2xl p-8 space-y-6">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Connect to Main Node</h2>
              <p className="text-textMuted text-sm">Enter the IP address of the machine running the Main node.</p>
            </div>

            <div>
              <div className="flex justify-between items-end mb-2">
                <label className="text-xs font-bold uppercase tracking-wider text-textMuted block">
                  Main Node IP Address
                </label>
                {scanning && (
                  <span className="text-xs text-primary flex items-center gap-1.5 animate-pulse">
                    <Loader2 className="w-3 h-3 animate-spin border-0" />
                    Scanning network
                  </span>
                )}
              </div>
              <input
                value={mainIp}
                onChange={e => { setMainIp(e.target.value); setError(''); }}
                placeholder={scanning ? "Scanning..." : "192.168.1.100"}
                autoFocus
                disabled={scanning}
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-white font-mono focus:outline-none focus:border-primary/50 text-sm disabled:opacity-50"
                onKeyDown={e => e.key === 'Enter' && mainIp && !scanning && save('worker')}
              />
              {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
              <p className="text-textMuted text-xs mt-2">
                You can find this in your router's admin panel or by running <code className="text-primary bg-primary/10 px-1 rounded">hostname -I</code> on the Main machine.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('choose')}
                className="px-4 py-2.5 text-sm text-textMuted hover:text-white transition-colors rounded-xl border border-border hover:bg-white/5"
              >
                ← Back
              </button>
              <button
                disabled={!mainIp}
                onClick={() => save('worker')}
                className="flex-1 py-2.5 bg-primary text-background text-sm font-bold rounded-xl hover:bg-primary/90 transition-colors disabled:opacity-40"
              >
                Connect &amp; Continue →
              </button>
            </div>
          </div>
        )}

        {/* ── Step: Saving ──────────────────────────────────────────────── */}
        {step === 'saving' && (
          <div className="bg-surface border border-border rounded-2xl p-12 text-center">
            <Loader2 className="w-10 h-10 text-primary animate-spin mx-auto mb-4" />
            <h2 className="text-white font-bold text-lg">Configuring your node…</h2>
            <p className="text-textMuted text-sm mt-2">Saving configuration and restarting services.</p>
          </div>
        )}

        {/* ── Step: Done ────────────────────────────────────────────────── */}
        {step === 'done' && (
          <div className="bg-surface border border-green-500/20 rounded-2xl p-12 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-400 mx-auto mb-4" />
            <h2 className="text-white font-bold text-xl">You're all set!</h2>
            <p className="text-textMuted text-sm mt-2">Reloading the interface…</p>
          </div>
        )}
      </div>
    </div>
  );
}
