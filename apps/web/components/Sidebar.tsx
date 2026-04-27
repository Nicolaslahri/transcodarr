'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, ListVideo, Cpu, Film, Settings, Zap, Radio, X } from 'lucide-react';
import { useAppState } from '@/hooks/useTranscodarrSocket';
import { useEffect } from 'react';

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

interface SidebarProps {
  /** Mobile drawer open state — irrelevant on desktop where sidebar is always visible */
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const pathname  = usePathname();
  const { meta, connected, workers } = useAppState();

  const nav       = meta.mode === 'worker' ? workerNav : mainNav;
  const isLoading = meta.mode === 'loading';
  // Number of pending (unapproved) workers — surfaced as a badge on the Fleet
  // nav item so new users notice they need to approve a worker without having
  // to hunt for it on the workers page.
  const pendingWorkersCount = workers.filter(w => w.status === 'pending').length;

  // Close drawer on route change
  useEffect(() => { onClose?.(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape — keyboard users expect this and the audit flagged that
  // none of the modals support it. Only attaches when the drawer is actually
  // open so we don't override Esc on every page.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen, onClose]);

  const inner = (
    <aside className="w-60 shrink-0 h-full flex flex-col border-r border-border bg-surface">
      {/* Logo */}
      <div className="px-6 py-7 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
            <Radio className="w-4 h-4 text-background" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <p className="font-bold text-white text-sm leading-tight">Transcodarr</p>
              <span className="text-xxs bg-white/10 px-1.5 py-0.5 rounded-md text-white/70 font-mono">
                v{meta.version || '1.0.0'}
              </span>
            </div>
            <p className="text-xs text-textMuted leading-tight mt-0.5">
              {isLoading ? '…' : meta.mode === 'worker' ? 'Worker Node' : 'Main Node'}
            </p>
          </div>
          {/* Close button — mobile only */}
          {onClose && (
            <button
              onClick={onClose}
              className="lg:hidden ml-1 p-1 rounded-lg text-textMuted hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close menu"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {nav.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          // Show a small amber badge on the Fleet nav item when workers are
          // awaiting approval. Without this users had to discover pending
          // workers by visiting /workers — easy to miss for the first auto-
          // discovered worker on a fresh install.
          const showFleetBadge = label === 'Fleet' && pendingWorkersCount > 0;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`nav-link relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
                ${active
                  ? 'active bg-primary/10 text-primary before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:bg-primary before:rounded-r'
                  : 'text-textMuted hover:text-white hover:bg-white/5'
                }`}
            >
              <Icon className="w-4.5 h-4.5 shrink-0" />
              <span className="flex-1">{label}</span>
              {showFleetBadge && (
                <span
                  className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-amber-500/20 text-amber-300 text-xxs font-semibold"
                  aria-label={`${pendingWorkersCount} ${pendingWorkersCount === 1 ? 'worker' : 'workers'} awaiting approval`}
                >
                  {pendingWorkersCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Connection status */}
      <div className="px-6 py-4 border-t border-border">
        <div className="flex items-center gap-2" role="status" aria-live="polite">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${connected ? 'bg-green-400 animate-pulse' : 'bg-amber-400 animate-pulse'}`}
            aria-hidden
          />
          <span className="text-xs text-textMuted truncate">
            {connected ? (meta.name || 'Connected') : 'Reconnecting…'}
          </span>
        </div>
      </div>
    </aside>
  );

  return (
    <>
      {/* Desktop sidebar — always visible lg+ */}
      <div className="hidden lg:flex h-screen sticky top-0">
        {inner}
      </div>

      {/* Mobile drawer — slide in from left */}
      {mobileOpen && (
        <>
          {/* Backdrop */}
          <div
            className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />
          {/* Panel */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="lg:hidden fixed inset-y-0 left-0 z-50 flex h-full animate-in slide-in-from-left duration-300"
          >
            {inner}
          </div>
        </>
      )}
    </>
  );
}
