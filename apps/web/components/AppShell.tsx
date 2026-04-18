'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useAppState } from '@/hooks/useTranscodarrSocket';
import { Sidebar } from '@/components/Sidebar';
import { SetupWizard } from '@/components/SetupWizard';
import { Radio, LayoutDashboard, ListVideo, Cpu, Film, Settings, Zap } from 'lucide-react';

const mainNav = [
  { href: '/overview', icon: LayoutDashboard, label: 'Overview' },
  { href: '/queue',    icon: ListVideo,        label: 'Queue'    },
  { href: '/workers',  icon: Cpu,              label: 'Fleet'    },
  { href: '/library',  icon: Film,             label: 'Library'  },
  { href: '/settings', icon: Settings,         label: 'Settings' },
];

const workerNav = [
  { href: '/',         icon: Zap,        label: 'Status'   },
  { href: '/queue',    icon: ListVideo,  label: 'Queue'    },
  { href: '/settings', icon: Settings,   label: 'Settings' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { meta, connected } = useAppState();
  const pathname = usePathname();

  // Server explicitly said we're in setup mode — show the wizard
  if (meta.mode === 'loading_setup') {
    return <SetupWizard onComplete={() => {}} />;
  }

  // Still waiting for server response — show neutral splash
  if (meta.mode === 'loading' && !connected) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background animate-in fade-in duration-500">
        <div className="flex flex-col items-center gap-6">
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-full border-2 border-primary/20 animate-spin" style={{ animationDuration: '3s' }} />
            <div className="absolute inset-2 rounded-full border-2 border-t-primary border-r-transparent border-b-transparent border-l-transparent animate-spin" style={{ animationDuration: '1s' }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <Radio className="w-6 h-6 text-primary" />
            </div>
          </div>
          <p className="text-textMuted text-sm tracking-wide">Connecting to Transcodarr…</p>
        </div>
      </div>
    );
  }

  const nav = meta.mode === 'worker' ? workerNav : mainNav;

  return (
    <>
      {/* ── Desktop sidebar ─────────────────────────────────────── */}
      <Sidebar />

      {/* ── Content column ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-surface shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-primary flex items-center justify-center shrink-0">
              <Radio className="w-3.5 h-3.5 text-background" />
            </div>
            <span className="font-bold text-white text-sm truncate">Transcodarr</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
            <span className="text-xs text-textMuted">{connected ? 'Live' : 'Offline'}</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto pb-20 lg:pb-0">{children}</main>

        {/* Mobile bottom tab bar */}
        <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 flex items-stretch border-t border-border bg-surface/95 backdrop-blur-md">
          {nav.map(({ href, icon: Icon, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                  active ? 'text-primary' : 'text-textMuted hover:text-white'
                }`}
              >
                <Icon className={`w-5 h-5 ${active ? 'text-primary' : ''}`} />
                <span>{label}</span>
                {active && <span className="absolute bottom-0 w-1 h-1 rounded-full bg-primary" />}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}
