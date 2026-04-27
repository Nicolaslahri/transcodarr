'use client';

import { useEffect } from 'react';

/**
 * Closes a modal / drawer / popover when the user presses Escape.
 *
 * Usage:
 *   useEscapeKey(isOpen, () => setOpen(false));
 *
 * The listener only attaches while `active` is true so we don't capture Esc
 * on the whole app. Multiple modals can stack: each one's handler fires.
 *
 * Modal authors should also:
 *   - Set role="dialog" aria-modal="true" on the panel
 *   - Provide a visible close button (Esc isn't discoverable for new users)
 *   - Consider returning focus to the trigger when closed
 */
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onEscape]);
}
