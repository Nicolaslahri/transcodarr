'use client';

import { useAppState } from '@/hooks/useTranscodarrSocket';
import dynamic from 'next/dynamic';

// Lazy-load all UIs — only one will ever mount per session
const WorkerStatusPage  = dynamic(() => import('./_worker-status'));
const MainOverviewPage  = dynamic(() => import('./_main-overview'));
const SetupWizardPage   = dynamic(() => import('./_setup-wizard'));

// Spinner while we wait for /api/meta
function Loading() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <p className="text-textMuted text-sm">Connecting…</p>
      </div>
    </div>
  );
}

export default function RootPage() {
  const { meta } = useAppState();

  if (meta.mode === 'loading') return <Loading />;
  if (meta.mode === 'loading_setup') return <SetupWizardPage />;
  if (meta.mode === 'worker')  return <WorkerStatusPage />;
  return <MainOverviewPage />;
}
