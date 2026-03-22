/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Legacy brand (sky-blue) — kept for existing components ──────────
        brand: {
          50:  '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        // ── Krythor Gold — premium hierarchy, selected state, orchestrators ─
        gold: {
          50:  '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
          950: '#2d1a02',
        },
        // ── Arc (electric blue) — activity, live signal, running state ──────
        arc: {
          50:  '#edfaff',
          100: '#d6f3ff',
          200: '#b5eaff',
          300: '#83deff',
          400: '#48caff',
          500: '#1eaeff',
          600: '#068ef5',
          700: '#0270d4',
          800: '#075aab',
          900: '#0c4d8a',
          950: '#0a2f54',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'monospace'],
      },
      animation: {
        'fadeIn':      'fadeIn 0.2s ease-in',
        'arc-pulse':   'arcPulse 2s ease-in-out infinite',
        'gold-pulse':  'goldPulse 2.5s ease-in-out infinite',
        'flow-line':   'flowLine 1.8s linear infinite',
        // ── Command Center animations ──────────────────────────────────────
        'cc-float':     'cc-float 3s ease-in-out infinite',
        'cc-ring':      'cc-ring 1.5s linear infinite',
        'cc-flicker':   'cc-flicker 0.45s ease-in-out infinite',
        'cc-spin-fast': 'cc-spin-fast 0.75s linear infinite',
        'cc-wave':      'cc-wave 1.4s ease-out infinite',
        'cc-strobe':    'cc-strobe 0.3s ease-in-out 3',
        'cc-scan':      'cc-scan 2s linear infinite',
        'cc-flow-arc':  'cc-flow-arc 1.2s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        arcPulse: {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 0 0 rgba(30,174,255,0)' },
          '50%':      { opacity: '0.85', boxShadow: '0 0 8px 2px rgba(30,174,255,0.25)' },
        },
        goldPulse: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.7' },
        },
        flowLine: {
          '0%':   { strokeDashoffset: '24' },
          '100%': { strokeDashoffset: '0' },
        },
        // ── Command Center animations ──────────────────────────────────────
        'cc-float':     { '0%,100%': { transform: 'translateY(0px)' }, '50%': { transform: 'translateY(-6px)' } },
        'cc-ring':      { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } },
        'cc-flicker':   { '0%,100%': { opacity: '1' }, '30%': { opacity: '0.3' }, '60%': { opacity: '0.85' } },
        'cc-spin-fast': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } },
        'cc-wave':      { '0%': { transform: 'scale(1)', opacity: '0.7' }, '100%': { transform: 'scale(2.8)', opacity: '0' } },
        'cc-strobe':    { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.05' } },
        'cc-scan':      { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } },
        'cc-flow-arc':  { '0%': { strokeDashoffset: '200' }, '100%': { strokeDashoffset: '0' } },
      },
    },
  },
  plugins: [],
};
