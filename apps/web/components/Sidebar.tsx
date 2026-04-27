'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, ListVideo, Cpu, Film, Settings, Zap, Radio, X } from 'lucide-react';
import { useAppState, type AppMeta } from '@/hooks/useTranscodarrSocket';
import { useEscapeKey } from '@/hooks/useEscapeKey';
import { useCallback, useEffect, useRef } from 'react';

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

// SidebarInner is extracted into its own component so the desktop and mobile
// drawer branches each get a fresh React subtree. Previously both branches
// rendered the SAME JSX literal, doubling the DOM tree and producing two
// duplicate `aria-live` connection-status regions in the markup.
function SidebarInner({
  meta, connected, hasActiveJobs, pendingWorkersCount, nav, pathname, onClose,
  closeButtonRef,
}: {
  meta: AppMeta;
  connected: boolean;
  hasActiveJobs: boolean;
  pendingWorkersCount: number;
  nav: typeof mainNav;
  pathname: string;
  onClose?: () => void;
  closeButtonRef?: React.RefObject<HTMLButtonElement>;
}) {
  const isLoading = meta.mode === 'loading';
  return (
    <aside className="w-60 shrink-0 h-full flex flex-col border-r border-border bg-surface">
      {/* Logo */}
      <div className="px-6 py-7 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
            <Radio className="w-4 h-4 text-background" aria-hidden />
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
          {/* Close button — only rendered in the mobile drawer (not desktop) */}
          {onClose && (
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="ml-1 p-1 rounded-lg text-textMuted hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Close menu"
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {nav.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
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
              <Icon className="w-4.5 h-4.5 shrink-0" aria-hidden />
              <span className="flex-1">{label}</span>
              {href === '/queue' && hasActiveJobs && (
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse shrink-0" aria-label="Active jobs in queue" />
              )}
              {showFleetBadge && (
                <span
                  // amber-200 (#fde68a) on amber-500/30 over bg-surface (#121216)
                  // computes to ~8:1 contrast — comfortably above WCAG 2.1 AA.
                  // (Earlier comments quoted ≥4.5:1 which understated it.)
                  className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-amber-500/30 text-amber-200 text-xxs font-semibold"
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
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps) {
  const pathname  = usePathname();
  const { meta, connected, jobs, workers } = useAppState();

  const nav       = meta.mode === 'worker' ? workerNav : mainNav;
  const hasActiveJobs = jobs.some(j => ['transcoding', 'dispatched', 'receiving', 'sending', 'swapping', 'finalizing'].includes(j.phase ?? j.status));
  // Number of pending (unapproved) workers — surfaced as a badge on the Fleet
  // nav item so new users notice they need to approve a worker without having
  // to hunt for it on the workers page.
  const pendingWorkersCount = workers.filter(w => w.status === 'pending').length;

  // Drawer focus management — used to autofocus the close button on open
  // and restore focus to the trigger (hamburger) on close.
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Close drawer on route change
  useEffect(() => { onClose?.(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc closes the drawer via the shared stack hook so nested modals (if any
  // ever land inside the drawer) get correct top-of-stack semantics.
  const handleEscape = useCallback(() => onClose?.(), [onClose]);
  useEscapeKey(mobileOpen, handleEscape);

  // Focus management: on open, snapshot document.activeElement and move
  // focus into the dialog (close button). On close, restore focus to that
  // element so the user resumes where they were. If the original trigger
  // was unmounted (e.g. route changed), fall back to the <main> element so
  // focus never silently lands on <body>.
  useEffect(() => {
    if (!mobileOpen) return;
    previouslyFocused.current = (document.activeElement as HTMLElement) ?? null;
    closeButtonRef.current?.focus();
    return () => {
      const trigger = previouslyFocused.current;
      if (trigger && trigger.isConnected) {
        trigger.focus?.();
      } else {
        const fallback = document.querySelector<HTMLElement>('main');
        if (fallback) {
          if (!fallback.hasAttribute('tabindex')) fallback.setAttribute('tabindex', '-1');
          fallback.focus();
        }
      }
    };
  }, [mobileOpen]);

  return (
    <>
      {/* Desktop sidebar — always visible lg+. Hidden via CSS at <lg, where the
          mobile drawer takes over. Each branch instantiates its own subtree
          to avoid the duplicate aria-live region the audit flagged. */}
      <div className="hidden lg:flex h-screen sticky top-0">
        <SidebarInner
          meta={meta}
          connected={connected}
          hasActiveJobs={hasActiveJobs}
          pendingWorkersCount={pendingWorkersCount}
          nav={nav}
          pathname={pathname}
        />
      </div>

      {/* Mobile drawer — slide in from left */}
      {mobileOpen && (
        <div className="lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />
          {/* Panel */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="fixed inset-y-0 left-0 z-50 flex h-full animate-in slide-in-from-left duration-300"
          >
            <SidebarInner
              meta={meta}
              connected={connected}
              hasActiveJobs={hasActiveJobs}
              pendingWorkersCount={pendingWorkersCount}
              nav={nav}
              pathname={pathname}
              onClose={onClose}
              closeButtonRef={closeButtonRef}
            />
          </div>
        </div>
      )}
    </>
  );
}
