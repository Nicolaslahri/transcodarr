'use client';

/**
 * Per-route enter animation. Runs once per navigation (Next.js App Router
 * remounts `template.tsx` on every route change).
 *
 * History — three iterations of THIS bug already, the first two were mine:
 *
 *   v1: `gsap.from(el, { opacity: 0, y: 10 })` — left elements stuck at
 *       opacity:0 under StrictMode + fast nav, blank pages.
 *
 *   v2: Added `clearProps: 'opacity,transform'`. Fixed the blank page but
 *       GSAP's `y: 10` was applied as `transform: translate3d(...)` on
 *       this wrapper. Per CSS spec, `transform` on an ancestor creates a
 *       new containing block for `position: fixed` descendants. So every
 *       modal (which uses `fixed inset-0`) anchored to THIS DIV instead
 *       of the viewport, appearing inside the page content.
 *
 *   v3: Replaced GSAP with Tailwind's `animate-in fade-in duration-300`,
 *       thinking opacity-only had no transform side-effect. WRONG —
 *       tailwindcss-animate's `animate-in` utility wraps every entry
 *       keyframe in `transform: translate3d(var(--tw-enter-translate-x,0),
 *       var(--tw-enter-translate-y,0), 0)`, even for fade-only variants.
 *       The translate is `0,0,0` (no visual movement) but the property
 *       IS SET, which creates the same containing block. Modal still
 *       broken.
 *
 *   v4 (current): use a hand-written `.page-fade-in` class in globals.css
 *       that touches ONLY opacity. No transform anywhere in the keyframe.
 *       Verified by reading the keyframe. The `@media (prefers-reduced-
 *       motion: reduce)` block in globals.css makes this a no-op for
 *       users who opt out — no separate JS gate needed.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-fade-in">{children}</div>;
}
