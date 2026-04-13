'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, ListVideo, Cpu, Film, Settings, Zap, Radio } from 'lucide-react';
import { useAppState } from '@/hooks/useTranscodarrSocket';

const mainNav = [
  { href: '/overview', icon: LayoutDashboard, label: 'Overview' },
  { href: '/queue',    icon: ListVideo,        label: 'Queue'    },
  { href: '/workers',  icon: Cpu,              label: 'Fleet'    },
  { href: '/library',  icon: Film,             label: 'Library'  },
  { href: '/settings', icon: Settings,         label: 'Settings' },
];

const workerNav = [
  { href: '/',         icon: Zap,        label: 'Status'  },
  { href: '/queue',    icon: ListVideo,  label: 'Queue'   },
  { href: '/settings', icon: Settings,   label: 'Settings' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { meta, connected } = useAppState();

  const nav = meta.mode === 'worker' ? workerNav : mainNav;
  const isLoading = meta.mode === 'loading';

  return (
    <aside className="w-60 shrink-0 h-screen sticky top-0 flex flex-col border-r border-border bg-surface">
      {/* Logo */}
      <div className="px-6 py-7 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
            <Radio className="w-4 h-4 text-background" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className="font-bold text-white text-sm leading-tight">Transcodarr</p>
              <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded-md text-white/70 font-mono">
                v{meta.version || '1.0.0'}
              </span>
            </div>
            <p className="text-xs text-textMuted leading-tight mt-0.5">
              {isLoading ? '…' : meta.mode === 'worker' ? 'Worker Node' : 'Main Node'}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {nav.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
                ${active
                  ? 'bg-primary/10 text-primary before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:bg-primary before:rounded-r'
                  : 'text-textMuted hover:text-white hover:bg-white/5'
                }`}
            >
              <Icon className="w-4.5 h-4.5 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Connection status */}
      <div className="px-6 py-4 border-t border-border">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-xs text-textMuted truncate">
            {connected ? (meta.name || 'Connected') : 'Disconnected'}
          </span>
        </div>
      </div>
    </aside>
  );
}
