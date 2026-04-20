'use client';

import { useState } from 'react';
import { Cpu, Server, CheckCircle2, Loader2, ChevronRight } from 'lucide-react';

type Role = 'main' | 'worker';

export default function SetupWizard() {
  const [step, setStep]             = useState<'role' | 'configure'>('role');
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [port, setPort]             = useState('');
  const [mainUrl, setMainUrl]       = useState('');
  const [saving, setSaving]         = useState(false);
  const [portError, setPortError]   = useState('');

  const defaultPort = selectedRole === 'main' ? 3001 : 3002;

  const handleRoleClick = (role: Role) => {
    setSelectedRole(role);
    setPort(role === 'main' ? '3001' : '3002');
    setStep('configure');
  };

  const validatePort = (v: string) => {
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 1 || n > 65535) return 'Enter a port between 1 and 65535';
    return '';
  };

  const handleLaunch = async () => {
    const err = validatePort(port);
    if (err) { setPortError(err); return; }
    setPortError('');
    setSaving(true);

    try {
      const apiUrl = typeof window !== 'undefined'
        ? `http://${window.location.hostname}:${window.location.port || 3001}`
        : '';

      await fetch(`${apiUrl}/api/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: selectedRole,
          port: parseInt(port, 10),
          ...(selectedRole === 'worker' && mainUrl ? { mainUrl } : {}),
        }),
      });

      // Node restarts on the newly chosen port — redirect there
      const newPort = parseInt(port, 10);
      const newOrigin = `http://${window.location.hostname}:${newPort}`;
      setTimeout(() => {
        if (newPort === (window.location.port ? parseInt(window.location.port) : 80)) {
          window.location.reload();
        } else {
          window.location.replace(newOrigin);
        }
      }, 3000);
    } catch {
      setSaving(false);
    }
  };

  // ─── Step 1: Choose role ─────────────────────────────────────────────────────
  if (step === 'role') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 selection:bg-primary/30">
        <div className="max-w-3xl w-full">
          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight mb-4">
              Welcome to Transcodarr
            </h1>
            <p className="text-lg text-textMuted max-w-xl mx-auto">
              Zero-config intelligent media transcoding. What is the role of this machine in your fleet?
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            {/* Main Node */}
            <button
              onClick={() => handleRoleClick('main')}
              className="relative group text-left bg-surface border-2 border-border hover:border-textMuted/50 hover:bg-surface/80 rounded-3xl p-8 transition-all duration-300 overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-transparent" />
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 bg-background text-textMuted group-hover:text-white transition-colors duration-300">
                <Server className="w-7 h-7" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                Main Node
                <ChevronRight className="w-5 h-5 text-textMuted group-hover:text-white transition-colors" />
              </h2>
              <p className="text-textMuted text-sm leading-relaxed mb-6">
                Manages the job queue, watches your media folders, and serves the Web Hub.
              </p>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background border border-border text-xs font-medium text-textMuted">
                Best for Raspberry Pi, NAS, or Server
              </div>
            </button>

            {/* Worker Node */}
            <button
              onClick={() => handleRoleClick('worker')}
              className="relative group text-left bg-surface border-2 border-border hover:border-textMuted/50 hover:bg-surface/80 rounded-3xl p-8 transition-all duration-300 overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-transparent" />
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6 bg-background text-textMuted group-hover:text-white transition-colors duration-300">
                <Cpu className="w-7 h-7" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                Worker Node
                <ChevronRight className="w-5 h-5 text-textMuted group-hover:text-white transition-colors" />
              </h2>
              <p className="text-textMuted text-sm leading-relaxed mb-6">
                Connects to the Main Node to provide GPU-accelerated transcoding power.
              </p>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background border border-border text-xs font-medium text-textMuted">
                Best for Windows PC with NVIDIA/AMD GPU
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step 2: Configure port (+ Main URL for worker) ──────────────────────────
  const accentColor = selectedRole === 'main' ? 'primary' : 'yellow-500';
  const Icon        = selectedRole === 'main' ? Server : Cpu;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 selection:bg-primary/30">
      <div className="max-w-lg w-full">
        <div className="text-center mb-10">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6
            ${selectedRole === 'main' ? 'bg-primary/20 text-primary' : 'bg-yellow-500/20 text-yellow-500'}`}>
            <Icon className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">
            Configure {selectedRole === 'main' ? 'Main' : 'Worker'} Node
          </h1>
          <p className="text-textMuted text-sm">
            This port will be saved and reused across restarts and resets.
          </p>
        </div>

        <div className={`bg-surface border-2 rounded-3xl p-8 space-y-6
          ${selectedRole === 'main' ? 'border-primary/30' : 'border-yellow-500/30'}`}>

          {/* Port */}
          <div>
            <label className="block text-sm font-semibold text-white mb-2">
              Port <span className="text-textMuted font-normal">(this node will listen here)</span>
            </label>
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={e => { setPort(e.target.value); setPortError(''); }}
              placeholder={String(defaultPort)}
              disabled={saving}
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-white text-base
                placeholder:text-textMuted/50 focus:outline-none focus:border-primary/60 transition-colors
                disabled:opacity-50"
            />
            {portError && <p className="mt-1.5 text-xs text-red-400">{portError}</p>}
            <p className="mt-1.5 text-xs text-textMuted">
              Default: {defaultPort}. Change if that port is already in use on this machine.
            </p>
          </div>

          {/* Main URL — worker only */}
          {selectedRole === 'worker' && (
            <div>
              <label className="block text-sm font-semibold text-white mb-2">
                Main Node URL <span className="text-textMuted font-normal">(optional — set later in Settings)</span>
              </label>
              <input
                type="url"
                value={mainUrl}
                onChange={e => setMainUrl(e.target.value)}
                placeholder="http://192.168.1.100:3001"
                disabled={saving}
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-white text-base
                  placeholder:text-textMuted/50 focus:outline-none focus:border-yellow-500/60 transition-colors
                  disabled:opacity-50"
              />
              <p className="mt-1.5 text-xs text-textMuted">
                The address of your Main Node. You can set or change this later in Worker Settings.
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={() => { setStep('role'); setSaving(false); }}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl border border-border text-textMuted text-sm font-medium
                hover:text-white hover:border-textMuted/50 transition-colors disabled:opacity-40"
            >
              Back
            </button>

            <button
              onClick={handleLaunch}
              disabled={saving}
              className={`flex-1 flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold
                text-white transition-all duration-200 disabled:opacity-60
                ${selectedRole === 'main'
                  ? 'bg-primary hover:bg-primary/90 shadow-[0_0_20px_rgba(var(--color-primary),0.3)]'
                  : 'bg-yellow-500 hover:bg-yellow-400 shadow-[0_0_20px_rgba(234,179,8,0.25)]'
                }`}
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {selectedRole === 'worker' ? 'Setting up (ffmpeg download may take a minute)…' : 'Starting…'}
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Launch {selectedRole === 'main' ? 'Main' : 'Worker'} Node on port {port || defaultPort}
                </>
              )}
            </button>
          </div>
        </div>

        {saving && (
          <p className="text-center text-textMuted text-xs mt-6">
            Node is restarting on port <span className="text-white font-semibold">{port}</span> — redirecting you there…
          </p>
        )}
      </div>
    </div>
  );
}
