'use client';

import { useAppState } from '@/hooks/useTranscodarrSocket';
import { Sidebar } from '@/components/Sidebar';
import { SetupWizard } from '@/components/SetupWizard';

// AppShell: shows the setup wizard when in setup/loading mode,
// otherwise renders the full app with sidebar.
export function AppShell({ children }: { children: React.ReactNode }) {
  const { meta } = useAppState();
  const isSetup = meta.mode === 'loading_setup' || meta.mode === 'loading';

  // Show onboarding overlay when server is in setup mode
  if (isSetup) {
    return <SetupWizard onComplete={() => {}} />;
  }

  return (
    <>
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </>
  );
}
