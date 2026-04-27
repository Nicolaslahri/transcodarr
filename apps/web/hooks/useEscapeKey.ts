'use client';

import { useEffect, useRef } from 'react';

/**
 * Closes a modal / drawer / popover when the user presses Escape.
 *
 * Usage:
 *   useEscapeKey(isOpen, () => setOpen(false));
 *
 * Stack semantics: when multiple modals are open simultaneously (e.g. the
 * RecipePicker opens on top of the Watched-Folder editor), a single Esc
 * press should close ONLY the topmost one — not all of them at once.
 *
 * Implementation notes:
 *   - The stack is a list of refs (not closures). Callers typically pass
 *     fresh arrow functions each render (`() => setOpen(false)`), so
 *     pushing the closure directly would make every render add a new entry
 *     and the cleanup remove a stale one. By pushing a ref-wrapper instead,
 *     the stack entry is stable across renders; we just rebind the ref's
 *     `.current` to the latest callback each render.
 *   - The global keydown listener is installed lazily on first mount and
 *     never removed (modals come and go often enough that re-installing
 *     each time is wasteful, and a single dormant listener is harmless).
 *   - Esc is `stopPropagation`'d only when there's a top-of-stack entry to
 *     fire — empty stack lets Esc bubble naturally.
 */

type HandlerRef = { current: () => void };
const escapeStack: HandlerRef[] = [];
let listenerInstalled = false;

function ensureListener(): void {
  if (listenerInstalled || typeof window === 'undefined') return;
  listenerInstalled = true;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = escapeStack[escapeStack.length - 1];
    if (top) {
      e.stopPropagation();
      e.preventDefault();
      top.current();
    }
  });
}

export function useEscapeKey(active: boolean, onEscape: () => void): void {
  // Hold the latest callback in a ref so the stack entry stays stable even
  // when callers pass a fresh arrow function on every render. Without this,
  // each render would push a new closure and the cleanup function captured
  // an older one — under React StrictMode (mount→unmount→mount) and rapid
  // parent re-renders, Esc could fire a stale closure.
  const handlerRef = useRef(onEscape);
  handlerRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    ensureListener();
    escapeStack.push(handlerRef);
    return () => {
      const idx = escapeStack.lastIndexOf(handlerRef);
      if (idx !== -1) escapeStack.splice(idx, 1);
    };
  }, [active]);
}
