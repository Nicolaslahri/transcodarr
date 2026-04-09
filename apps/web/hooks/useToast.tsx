'use client';

import { createContext, useContext, useState, ReactNode, useCallback, useRef } from 'react';
import gsap from 'gsap';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Toast {
  id: string;
  type: 'worker-discovered' | 'success' | 'error' | 'info';
  title: string;
  message: string;
  workerId?: string;
  onAccept?: () => void;
  onReject?: () => void;
  duration?: number; // ms — default 30000 for worker-discovered, 5000 otherwise
}

interface ToastContextType {
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    const duration = toast.duration ?? (toast.type === 'worker-discovered' ? 30000 : 5000);
    setToasts(prev => [...prev, { ...toast, id }]);
    setTimeout(() => removeToast(id), duration);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be inside ToastProvider');
  return ctx;
}

// ─── Toast UI ─────────────────────────────────────────────────────────────────

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999 }}
      className="flex flex-col gap-3 pointer-events-none"
    >
      {toasts.map(t => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // Entrance animation
  const handleRef = (el: HTMLDivElement | null) => {
    if (!el) return;
    (ref as any).current = el;
    gsap.fromTo(el,
      { x: 60, opacity: 0, scale: 0.95 },
      { x: 0, opacity: 1, scale: 1, duration: 0.4, ease: 'back.out(1.4)' }
    );
  };

  const dismiss = (cb?: () => void) => {
    if (!ref.current) { cb?.(); onDismiss(toast.id); return; }
    gsap.to(ref.current, {
      x: 60, opacity: 0, scale: 0.9, duration: 0.25, ease: 'power2.in',
      onComplete: () => { cb?.(); onDismiss(toast.id); }
    });
  };

  const isWorker = toast.type === 'worker-discovered';

  return (
    <div
      ref={handleRef}
      className={`pointer-events-auto w-[360px] rounded-2xl border shadow-2xl shadow-black/40 overflow-hidden
        ${isWorker
          ? 'bg-[#111] border-yellow-500/40 shadow-yellow-500/5'
          : 'bg-surface border-border'
        }`}
    >
      {/* Top accent bar */}
      {isWorker && <div className="h-0.5 w-full bg-gradient-to-r from-yellow-500 via-orange-400 to-yellow-500" />}

      <div className="p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-lg
            ${isWorker ? 'bg-yellow-500/10' : 'bg-primary/10'}`}>
            {isWorker ? '🟡' : toast.type === 'success' ? '✅' : toast.type === 'error' ? '❌' : 'ℹ️'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm">{toast.title}</p>
            <p className="text-textMuted text-xs mt-0.5 truncate">{toast.message}</p>
          </div>
          <button
            onClick={() => dismiss()}
            className="text-textMuted hover:text-white transition-colors text-xs shrink-0 p-1"
          >✕</button>
        </div>

        {isWorker && toast.onAccept && (
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => dismiss(toast.onAccept)}
              className="flex-1 py-2 px-3 bg-yellow-500 hover:bg-yellow-400 text-black text-xs font-bold rounded-xl transition-colors"
            >
              ✓ Add to Fleet
            </button>
            <button
              onClick={() => dismiss(toast.onReject)}
              className="py-2 px-3 bg-background hover:bg-border text-textMuted text-xs font-medium rounded-xl transition-colors border border-border"
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
