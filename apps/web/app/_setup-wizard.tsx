'use client';

import { useState } from 'react';
import { Cpu, Server, CheckCircle2, Loader2 } from 'lucide-react';

export default function SetupWizard() {
  const [selectedRole, setSelectedRole] = useState<'main' | 'worker' | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async (role: 'main' | 'worker') => {
    setSelectedRole(role);
    setSaving(true);
    
    try {
      const apiUrl = typeof window !== 'undefined'
        ? `http://${window.location.hostname}:${window.location.port || 3001}`
        : '';
        
      await fetch(`${apiUrl}/api/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      
      // Wait for process to restart, then reload page
      setTimeout(() => window.location.reload(), 3000);
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 selection:bg-primary/30">
      <div className="max-w-3xl w-full">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-tight mb-4">
            Welcome to Transcodarr
          </h1>
          <p className="text-lg text-textMuted max-w-xl mx-auto">
            Zero-config intelligent media transcoding. What is the role of this machine in your fleet?
          </p>
        </div>

        {/* Options */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
          {/* Main Node */}
          <button
            onClick={() => handleSave('main')}
            disabled={saving}
            className={`relative group text-left bg-surface border-2 rounded-3xl p-8 transition-all duration-300 overflow-hidden
              ${selectedRole === 'main' 
                ? 'border-primary shadow-[0_0_40px_rgba(var(--color-primary),0.2)]' 
                : 'border-border hover:border-textMuted/50 hover:bg-surface/80'
              }
              ${saving && selectedRole !== 'main' ? 'opacity-50 grayscale' : ''}
            `}
          >
            <div className={`absolute top-0 left-0 w-full h-1 transition-all duration-500 ${selectedRole === 'main' ? 'bg-primary' : 'bg-transparent'}`} />
            
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 transition-colors duration-300
              ${selectedRole === 'main' ? 'bg-primary/20 text-primary' : 'bg-background text-textMuted group-hover:text-white'}
            `}>
              <Server className="w-7 h-7" />
            </div>
            
            <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
              Main Node
              {selectedRole === 'main' && <CheckCircle2 className="w-5 h-5 text-primary" />}
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
            onClick={() => handleSave('worker')}
            disabled={saving}
            className={`relative group text-left bg-surface border-2 rounded-3xl p-8 transition-all duration-300 overflow-hidden
              ${selectedRole === 'worker' 
                ? 'border-yellow-500 shadow-[0_0_40px_rgba(234,179,8,0.15)]' 
                : 'border-border hover:border-textMuted/50 hover:bg-surface/80'
              }
              ${saving && selectedRole !== 'worker' ? 'opacity-50 grayscale' : ''}
            `}
          >
             <div className={`absolute top-0 left-0 w-full h-1 transition-all duration-500 ${selectedRole === 'worker' ? 'bg-yellow-500' : 'bg-transparent'}`} />
             
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 transition-colors duration-300
              ${selectedRole === 'worker' ? 'bg-yellow-500/20 text-yellow-500' : 'bg-background text-textMuted group-hover:text-white'}
            `}>
              <Cpu className="w-7 h-7" />
            </div>
            
            <h2 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
              Worker Node
              {selectedRole === 'worker' && <CheckCircle2 className="w-5 h-5 text-yellow-500" />}
            </h2>
            <p className="text-textMuted text-sm leading-relaxed mb-6">
              Connects to the Main Node to provide GPU-accelerated transcoding power.
            </p>
            
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background border border-border text-xs font-medium text-textMuted">
              Best for Windows PC with NVIDIA/AMD GPU
            </div>
          </button>
        </div>

        {/* Loading State */}
        <div className={`text-center transition-opacity duration-300 ${saving ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <Loader2 className="w-6 h-6 animate-spin text-textMuted mx-auto mb-3" />
          <p className="text-white font-medium">Configuring {selectedRole === 'main' ? 'Main' : 'Worker'} Node...</p>
          <p className="text-textMuted text-sm mt-1">
            {selectedRole === 'worker' ? 'Downloading ffmpeg automatically (this may take a minute). Restarting node...' : 'Restarting node...'}
          </p>
        </div>
      </div>
    </div>
  );
}
