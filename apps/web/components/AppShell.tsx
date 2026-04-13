'use client';

import { useAppState } from '@/hooks/useTranscodarrSocket';
import { Sidebar } from '@/components/Sidebar';
import { SetupWizard } from '@/components/SetupWizard';
import { Radio } from 'lucide-react';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { meta, connected } = useAppState();

  // Server explicitly said we're in setup mode — show the wizard
  if (meta.mode === 'loading_setup') {
    return <SetupWizard onComplete={() => {}} />;
  }

  // Still waiting for server response — show neutral splash, NOT the wizard
  // (prevents wizard flashing on every normal page load)
  if (meta.mode === 'loading' && !connected) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background animate-in fade-in duration-500">
        <div className="flex flex-col items-center gap-6">
          <div className="relative w-16 h-16">
            {/* Outer slow ring */}
            <div
              className="absolute inset-0 rounded-full border-2 border-primary/20 animate-spin"
              style={{ animationDuration: '3s' }}
            />
            {/* Inner fast arc */}
            <div
              className="absolute inset-2 rounded-full border-2 border-t-primary border-r-transparent border-b-transparent border-l-transparent animate-spin"
              style={{ animationDuration: '1s' }}
            />
            {/* Logo icon */}
            <div className="absolute inset-0 flex items-center justify-center">
              <Radio className="w-6 h-6 text-primary" />
            </div>
          </div>
          <p className="text-textMuted text-sm tracking-wide">Connecting to Transcodarr…</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Sidebar />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </>
  );
}
