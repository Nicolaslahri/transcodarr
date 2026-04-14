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
        textMuted: '#8a8a93',
        border: '#2a2a35'
      },
      fontFamily: {
        sans: ['var(--font-inter)'],
      },
      keyframes: {
        shimmer: {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%':   { opacity: '0', transform: 'scale(0.94)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'slide-down': {
          '0%':   { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-right': {
          '0%':   { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
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
