'use client';

import { useEffect } from 'react';

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
 * This is implemented via a small in-memory stack of open handlers. Each
 * call to useEscapeKey while `active=true` registers itself at the top of
 * the stack on mount and pops itself on unmount/deactivate. The keydown
 * listener (also installed once, lazily) only invokes the TOP entry.
 *
 * Modal authors should also:
 *   - Set role="dialog" aria-modal="true" on the panel
 *   - Provide a visible close button (Esc isn't discoverable for new users)
 *   - Consider returning focus to the trigger when closed
 */

type Handler = () => void;
const escapeStack: Handler[] = [];
let listenerInstalled = false;

function ensureListener(): void {
  if (listenerInstalled || typeof window === 'undefined') return;
  listenerInstalled = true;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = escapeStack[escapeStack.length - 1];
    if (top) {
      // Stop propagation so other (non-stack) Esc listeners don't also fire,
      // and prevent default so browser-level Esc actions (form-clear, etc.)
      // don't compound on top of our close handler.
      e.stopPropagation();
      e.preventDefault();
      top();
    }
  });
}

export function useEscapeKey(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    ensureListener();
    escapeStack.push(onEscape);
    return () => {
      const idx = escapeStack.lastIndexOf(onEscape);
      if (idx !== -1) escapeStack.splice(idx, 1);
    };
  }, [active, onEscape]);
}
