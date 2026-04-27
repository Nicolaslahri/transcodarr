/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0c',
        surface: '#121216',
        surfaceHover: '#1c1c22',
        primary: '#00d9ff',
        text: '#ffffff',
        // Bumped from #8a8a93 → #b4b4c0 to clear WCAG 2.1 AA 4.5:1 against
        // bg-surface (#121216) for body text. The previous shade failed the
        // contrast threshold and was particularly bad at 50–60% opacity.
        textMuted: '#b4b4c0',
        border: '#2a2a35',
        // NOTE: a "statusInfo/Warn/Error/Success/Muted" semantic palette was
        // briefly added here but had zero usages anywhere in the codebase —
        // it was dead weight advertising a system that doesn't exist. When
        // we do the real status-colour refactor, define them again at that
        // point alongside the migration.
      },
      fontSize: {
        // Smaller-than-xs token so chrome (timestamps, helper text) doesn't
        // need arbitrary text-[10px] overrides scattered across components.
        // 12px / 16px line — the original 11px / 14px clipped 10–12px icons
        // in flex rows and was below the legibility floor for body text.
        xxs: ['12px', { lineHeight: '16px' }],
      },
      fontFamily: {
        sans: ['var(--font-inter)'],
      },
      keyframes: {
        shimmer: {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        // CRITICAL: 100% keyframes in fill-mode-`both` animations must NOT
        // include a non-`none` transform value. Even `translateY(0)` /
        // `translateX(0)` / `scale(1)` qualify as "having a transform" per
        // CSS spec, and create a containing block for `position: fixed`
        // descendants — modals would anchor to whichever animated ancestor
        // wraps them instead of the viewport. Omit the transform line so it
        // reverts to the base computed value (`none`) at end-of-animation.
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1' },
        },
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%':   { opacity: '0', transform: 'scale(0.94)' },
          '100%': { opacity: '1' },
        },
        'slide-down': {
          '0%':   { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1' },
        },
        'slide-right': {
          '0%':   { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1' },
        },
        'glow-pulse': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(0,217,255,0)' },
          '50%':      { boxShadow: '0 0 24px 4px rgba(0,217,255,0.12)' },
        },
        'glow-pulse-green': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(74,222,128,0)' },
          '50%':      { boxShadow: '0 0 20px 3px rgba(74,222,128,0.10)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-4px)' },
        },
        'number-pop': {
          '0%':   { transform: 'scale(1)' },
          '40%':  { transform: 'scale(1.12)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        shimmer:           'shimmer 2s linear infinite',
        'fade-up':         'fade-up 0.45s cubic-bezier(0.16,1,0.3,1) both',
        'fade-in':         'fade-in 0.3s ease both',
        'scale-in':        'scale-in 0.3s cubic-bezier(0.16,1,0.3,1) both',
        'slide-down':      'slide-down 0.3s cubic-bezier(0.16,1,0.3,1) both',
        'slide-right':     'slide-right 0.35s cubic-bezier(0.16,1,0.3,1) both',
        'glow-pulse':      'glow-pulse 2.5s ease-in-out infinite',
        'glow-pulse-green':'glow-pulse-green 2.5s ease-in-out infinite',
        float:             'float 3s ease-in-out infinite',
        'number-pop':      'number-pop 0.25s ease both',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.16,1,0.3,1)',
      },
    },
  },
  plugins: [],
}
