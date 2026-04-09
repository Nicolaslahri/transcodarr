'use client';

import { useAppState } from '@/hooks/useTranscodarrSocket';
import { Sidebar } from '@/components/Sidebar';
import { SetupWizard } from '@/components/SetupWizard';

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
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="text-4xl">🎬</div>
          <p className="text-textMuted text-sm animate-pulse">Connecting to Transcodarr…</p>
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
