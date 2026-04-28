'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Portal-based modal wrapper.
 *
 * WHY: `position: fixed` is positioned relative to its containing block, NOT
 * the viewport, when an ancestor has `transform`, `filter`, `backdrop-filter`,
 * `perspective`, `contain: paint`, or `will-change` set to anything that
 * creates a containing block. Per CSS spec, even `transform: translateY(0)`
 * counts. Tailwind's `animate-in fade-in`, our own `fade-up` keyframes with
 * `animation-fill-mode: both`, GSAP's `y:` properties, and many other utilities
 * all leave a transform on ancestors during/after their animations.
 *
 * Trying to keep every ancestor transform-free indefinitely is whack-a-mole.
 * Portal sidesteps the problem: `createPortal(children, document.body)` mounts
 * the modal as a direct child of <body>, which has no transform, so the
 * modal's `fixed inset-0` always anchors to the viewport.
 *
 * Usage:
 *   <Modal open={isOpen}>
 *     <div role="dialog" aria-modal="true" ...>
 *       ...your modal panel...
 *     </div>
 *   </Modal>
 *
 * The component renders nothing on the server (createPortal needs the DOM)
 * and waits for the first effect to run before portaling, avoiding hydration
 * mismatches.
 */
export function Modal({ open, children }: { open: boolean; children: ReactNode }) {
  // Track mount on the client so the first render matches SSR (returning null
  // for both server + first client render). After hydration, flip to the
  // portal on the next effect tick.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!open || !mounted || typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
