'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { useReducedMotion } from '@/hooks/useReducedMotion';

/**
 * Per-route enter animation. Runs once per navigation (Next.js App Router
 * remounts `template.tsx` on every route change).
 *
 * History — this previously caused intermittent BLANK PAGES on client-side
 * navigation:
 *   - `gsap.from(el, { opacity: 0, y: 10 })` sets opacity:0 instantly, then
 *     tweens back to opacity:1.
 *   - On unmount we call `ctx.revert()` which is supposed to restore the
 *     pre-tween state, but in React 18 StrictMode + Next 14 fast nav, the
 *     mount → revert → mount sequence could leave the inline style stuck at
 *     `opacity: 0`, rendering the next page blank until a hard refresh.
 *
 * Two fixes applied:
 *   1. `clearProps: 'opacity,transform'` on the tween — once it completes,
 *      GSAP removes the inline styles entirely so React/CSS take over with
 *      whatever the page declared.
 *   2. `useReducedMotion` short-circuit — under prefers-reduced-motion, skip
 *      the tween entirely. Otherwise users with motion preferences would
 *      still see GSAP's instant opacity:0 set (CSS @media doesn't reach
 *      GSAP-applied inline styles).
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (reducedMotion || !containerRef.current) return;
    const el = containerRef.current;
    const ctx = gsap.context(() => {
      gsap.from(el, {
        opacity: 0,
        y: 10,
        duration: 0.4,
        ease: 'power2.out',
        // clearProps removes the inline style after the tween finishes so
        // the element doesn't stay stuck at opacity:0 if revert misfires.
        clearProps: 'opacity,transform',
      });
    });
    return () => {
      ctx.revert();
      // Defensive: if revert somehow left the inline style behind, blow it
      // away so the next nav starts clean.
      if (el && el.style) {
        el.style.opacity = '';
        el.style.transform = '';
      }
    };
  }, [reducedMotion]);

  return <div ref={containerRef}>{children}</div>;
}
