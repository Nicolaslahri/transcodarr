'use client';

/**
 * Per-route enter animation. Runs once per navigation (Next.js App Router
 * remounts `template.tsx` on every route change).
 *
 * History — TWO bugs landed in successive attempts before this version:
 *
 *   v1: `gsap.from(el, { opacity: 0, y: 10 })` left elements stuck at
 *       opacity:0 under StrictMode + fast nav, rendering blank pages.
 *
 *   v2: Added `clearProps: 'opacity,transform'` to fix v1, but the
 *       `y: 10` translate is applied as `transform: translate3d(...)` on
 *       the template's wrapper div. A `transform` on an ancestor creates
 *       a new containing block for `position: fixed` descendants — so
 *       every modal in the app (which uses `fixed inset-0`) anchored to
 *       the template div instead of the viewport, appearing inside the
 *       page content. Visible glitch caught immediately.
 *
 * v3 (current): drop GSAP from the template entirely. Use Tailwind's
 * built-in `animate-in fade-in` (CSS animation, no transform) so the
 * page fade still happens but no transform exists for `fixed` modals
 * to anchor against. CSS animations also respect prefers-reduced-motion
 * via the global media-query in globals.css, so we don't need our own
 * useReducedMotion gate here.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-in fade-in duration-300">{children}</div>;
}
