'use client';

import { useEffect, useState } from 'react';

/**
 * React hook returning the user's `prefers-reduced-motion` preference.
 *
 * The CSS `@media (prefers-reduced-motion: reduce)` block in globals.css
 * disables CSS-driven animation/transition durations, but GSAP runs its own
 * requestAnimationFrame loop and ignores those rules. Components that drive
 * animations through GSAP (count-ups, breathing glows, audio waves) should
 * read this value and either skip the animation or run a single end-state
 * tween.
 *
 * SSR-safe: returns false on the server, then re-evaluates on hydration.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
