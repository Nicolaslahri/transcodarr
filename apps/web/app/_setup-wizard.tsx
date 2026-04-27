'use client';

import { useState } from 'react';
import { Cpu, Server, CheckCircle2, Loader2, ChevronRight, Wifi, WifiOff } from 'lucide-react';

type Role = 'main' | 'worker';
type DiscoveredNode = { host: string; port: number };
type ScanState = 'idle' | 'scanning' | 'done';

export default function SetupWizard() {
  const [step, setStep]                 = useState<'role' | 'configure'>('role');
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [port, setPort]                 = useState('');
  const [mainUrl, setMainUrl]           = useState('');
  const [saving, setSaving]             = useState(false);
  const [portError, setPortError]       = useState('');
  const [scanState, setScanState]       = useState<ScanState>('idle');
  const [discovered, setDiscovered]     = useState<DiscoveredNode[]>([]);

  const defaultPort = selectedRole === 'main' ? 3001 : 3002;
  const apiBase = typeof window !== 'undefined'
    ? `http://${window.location.hostname}:${window.location.port || 3001}`
    : '';

  const handleRoleClick = (role: Role) => {
    setSelectedRole(role);
    setPort(role === 'main' ? '3001' : '3002');
    setDiscovered([]);
    setScanState('idle');
    setStep('configure');
  };

  const handleScan = async () => {
    setScanState('scanning');
    setDiscovered([]);
    try {
      const res  = await fetch(`${apiBase}/api/setup/discover`);
      const data = await res.json() as DiscoveredNode[];
      setDiscovered(data);
      setScanState('done');
      // If exactly one found, auto-fill
      if (data.length === 1) setMainUrl(`http://${data[0].host}:${data[0].port}`);
    } catch {
      setScanState('done');
    }
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
      await fetch(`${apiBase}/api/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: selectedRole,
          port: parseInt(port, 10),
          ...(selectedRole === 'worker' && mainUrl ? { mainUrl } : {}),
        }),
      });

      // Node restarts on the newly chosen port — redirect there
      const newPort   = parseInt(port, 10);
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
            <button
              onClick={() => handleRoleClick('main')}
              className="relative group text-left bg-surface border-2 border-border hover:border-textMuted/50 hover:bg-surface/80 rounded-3xl p-8 transition-all duration-300 overflow-hidden"
            >
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

            <button
              onClick={() => handleRoleClick('worker')}
              className="relative group text-left bg-surface border-2 border-border hover:border-textMuted/50 hover:bg-surface/80 rounded-3xl p-8 transition-all duration-300 overflow-hidden"
            >
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
  const Icon = selectedRole === 'main' ? Server : Cpu;

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
            <label htmlFor="setup-port" className="block text-sm font-semibold text-white mb-2">
              Port <span className="text-textMuted font-normal">(this node will listen here)</span>
            </label>
            <input
              id="setup-port"
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={e => { setPort(e.target.value); setPortError(''); }}
              placeholder={String(defaultPort)}
              disabled={saving}
              aria-describedby="setup-port-help"
              aria-invalid={!!portError}
              className="w-full bg-background border border-border rounded-xl px-4 py-3 text-white text-base
                placeholder:text-textMuted/50 focus:outline-none focus:border-primary/60 transition-colors
                disabled:opacity-50"
            />
            {portError && <p className="mt-1.5 text-xs text-red-400" role="alert">{portError}</p>}
            <p id="setup-port-help" className="mt-1.5 text-xs text-textMuted">
              Default: {defaultPort}. Change only if that port is already in use on this machine.
            </p>
          </div>

          {/* Main URL — worker only */}
          {selectedRole === 'worker' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="setup-main-url" className="text-sm font-semibold text-white">
                  Main Node URL
                </label>
                <button
                  type="button"
                  onClick={handleScan}
                  disabled={saving || scanState === 'scanning'}
                  aria-busy={scanState === 'scanning'}
                  aria-controls="setup-scan-results"
                  className="flex items-center gap-1.5 text-xs text-textMuted hover:text-white transition-colors disabled:opacity-40"
                >
                  {scanState === 'scanning'
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Scanning (4 s)…</>
                    : <><Wifi className="w-3.5 h-3.5" aria-hidden /> Scan network</>
                  }
                </button>
              </div>

              {/* Scan results — wrapped in role=status aria-live so screen
                  readers announce when the scan completes and how many
                  nodes were found. */}
              <div id="setup-scan-results" role="status" aria-live="polite">
                {scanState === 'done' && discovered.length > 0 && (
                  <div className="mb-2 space-y-1">
                    <span className="sr-only">{`Scan complete. Found ${discovered.length} ${discovered.length === 1 ? 'node' : 'nodes'}.`}</span>
                    {discovered.map(n => (
                      <button
                        type="button"
                        key={`${n.host}:${n.port}`}
                        onClick={() => setMainUrl(`http://${n.host}:${n.port}`)}
                        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors
                          ${mainUrl === `http://${n.host}:${n.port}`
                            ? 'border-yellow-500/60 bg-yellow-500/10 text-white'
                            : 'border-border bg-background text-textMuted hover:text-white hover:border-textMuted/50'
                          }`}
                      >
                        <span className="font-mono">{n.host}:{n.port}</span>
                        {mainUrl === `http://${n.host}:${n.port}` && <CheckCircle2 className="w-4 h-4 text-yellow-500" aria-hidden />}
                      </button>
                    ))}
                  </div>
                )}

                {scanState === 'done' && discovered.length === 0 && (
                  <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-background border border-border">
                    <WifiOff className="w-4 h-4 text-textMuted shrink-0" aria-hidden />
                    <p className="text-xs text-textMuted">
                      No Main Nodes found via mDNS. Enter the IP address manually below
                      — e.g. <span className="text-white font-mono">http://192.168.0.63:3001</span>
                    </p>
                  </div>
                )}
              </div>

              <input
                id="setup-main-url"
                type="url"
                value={mainUrl}
                onChange={e => setMainUrl(e.target.value)}
                placeholder="http://192.168.0.63:3001"
                disabled={saving}
                aria-describedby="setup-main-url-help"
                className="w-full bg-background border border-border rounded-xl px-4 py-3 text-white text-base
                  placeholder:text-textMuted/50 focus:outline-none focus:border-yellow-500/60 transition-colors
                  disabled:opacity-50 font-mono"
              />
              <p id="setup-main-url-help" className="mt-1.5 text-xs text-textMuted">
                You can change this later in Worker Settings if needed.
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
