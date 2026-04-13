'use client';

import { createContext, useContext, useState, ReactNode, useCallback, useRef, useEffect } from 'react';
import { Cpu, CheckCircle2, AlertCircle, Info, X, Check, Trash2 } from 'lucide-react';
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
      style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 99999, pointerEvents: 'none' }}
      className="flex flex-col gap-3"
    >
      {toasts.map(t => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    gsap.fromTo(ref.current,
      { x: 64, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.35, ease: 'power3.out' }
    );
  }, []);

  // cb fires immediately — animation is purely cosmetic
  const dismiss = (cb?: () => void) => {
    cb?.();
    if (!ref.current) { onDismiss(toast.id); return; }
    gsap.to(ref.current, {
      x: 64, opacity: 0, duration: 0.2, ease: 'power2.in',
      onComplete: () => onDismiss(toast.id),
    });
  };

  const isWorker = toast.type === 'worker-discovered';

  const iconMap = {
    'worker-discovered': <Cpu className="w-4 h-4 text-yellow-400" />,
    'success':           <CheckCircle2 className="w-4 h-4 text-green-400" />,
    'error':             <AlertCircle className="w-4 h-4 text-red-400" />,
    'info':              <Info className="w-4 h-4 text-primary" />,
  };

  const accentColor = {
    'worker-discovered': 'border-yellow-500/30',
    'success':           'border-green-500/30',
    'error':             'border-red-500/30',
    'info':              'border-primary/30',
  }[toast.type];

  return (
    <div
      ref={ref}
      style={{ pointerEvents: 'auto' }}
      className={`w-80 rounded-2xl border bg-surface shadow-2xl shadow-black/50 overflow-hidden ${accentColor}`}
    >
      {/* Accent top line */}
      {isWorker && <div className="h-px w-full bg-gradient-to-r from-transparent via-yellow-500/60 to-transparent" />}

      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0
            ${isWorker ? 'bg-yellow-500/10' : toast.type === 'success' ? 'bg-green-500/10' : toast.type === 'error' ? 'bg-red-500/10' : 'bg-primary/10'}`}>
            {iconMap[toast.type]}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <p className="font-semibold text-white text-sm leading-tight">{toast.title}</p>
            <p className="text-textMuted text-xs mt-0.5 leading-relaxed">{toast.message}</p>
          </div>
          <button
            onClick={() => dismiss()}
            className="text-textMuted hover:text-white transition-colors p-1 shrink-0 -mt-0.5 -mr-1 rounded-lg hover:bg-white/5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {isWorker && toast.onAccept && (
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => dismiss(toast.onAccept)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-yellow-500 hover:bg-yellow-400 text-black text-xs font-bold rounded-xl transition-colors"
            >
              <Check className="w-3.5 h-3.5" /> Add to Fleet
            </button>
            <button
              onClick={() => dismiss(toast.onReject)}
              className="flex items-center justify-center gap-1.5 py-2 px-3 bg-background hover:bg-white/5 text-textMuted hover:text-white text-xs font-medium rounded-xl border border-border transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
