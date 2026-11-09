import typography from '@tailwindcss/typography';

// Colors are driven by CSS variables (see index.css) so the whole UI can switch
// between dark (default) and light themes by toggling a `.light` class on <html>.
// Each value uses `<alpha-value>` so Tailwind's /opacity modifiers still work.
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Brand colors are set at runtime from Admin → Branding (lib/brandTheme.js
        // writes the variables); index.css holds the defaults. The accent flips to a
        // darker shade in light mode so it stays readable on white.
        'brand':       v('--c-brand'),
        'brand-dark':  v('--c-brand-dark'),
        'brand-light': v('--c-brand-light'),
        'on-brand':    v('--c-on-brand'),
        'accent':      v('--c-accent'),
        'accent-dark': v('--c-accent-dark'),
        surface: {
          900: v('--c-surface-900'),
          800: v('--c-surface-800'),
          700: v('--c-surface-700'),
          600: v('--c-surface-600'),
          500: v('--c-surface-500'),
          400: v('--c-surface-400'),
        },
        // Text/neutral scale (only the shades the app actually uses are themed;
        // the rest keep Tailwind defaults via deep-merge).
        gray: {
          50:  v('--c-gray-50'),
          100: v('--c-gray-100'),
          200: v('--c-gray-200'),
          300: v('--c-gray-300'),
          400: v('--c-gray-400'),
          500: v('--c-gray-500'),
          600: v('--c-gray-600'),
          700: v('--c-gray-700'),
        },
        // Status colors used by badges/alerts. In light mode the variable values
        // swap roles (the "-900" tint becomes a pale background, the "-400" text
        // becomes a dark, readable shade).
        amber: { 400: v('--c-amber-400'), 900: v('--c-amber-900') },
        blue:  { 300: v('--c-blue-300'), 400: v('--c-blue-400'), 800: v('--c-blue-800'), 900: v('--c-blue-900') },
        green: { 300: v('--c-green-300'), 400: v('--c-green-400'), 800: v('--c-green-800'), 900: v('--c-green-900') },
        red:   { 300: v('--c-red-300'), 400: v('--c-red-400'), 800: v('--c-red-800'), 900: v('--c-red-900') },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      // Drive rich-text (guide) colors from the same theme variables so `prose`
      // is readable in both themes — no need for prose-invert.
      typography: {
        DEFAULT: {
          css: {
            '--tw-prose-body':          'rgb(var(--c-gray-300))',
            '--tw-prose-headings':      'rgb(var(--c-gray-100))',
            '--tw-prose-lead':          'rgb(var(--c-gray-300))',
            '--tw-prose-links':         'rgb(var(--c-accent))',
            '--tw-prose-bold':          'rgb(var(--c-gray-100))',
            '--tw-prose-counters':      'rgb(var(--c-gray-500))',
            '--tw-prose-bullets':       'rgb(var(--c-gray-500))',
            '--tw-prose-hr':            'rgb(var(--c-surface-500))',
            '--tw-prose-quotes':        'rgb(var(--c-gray-200))',
            '--tw-prose-quote-borders': 'rgb(var(--c-surface-500))',
            '--tw-prose-captions':      'rgb(var(--c-gray-500))',
            '--tw-prose-code':          'rgb(var(--c-accent))',
            '--tw-prose-pre-code':      'rgb(var(--c-gray-200))',
            '--tw-prose-pre-bg':        'rgb(var(--c-surface-900))',
            '--tw-prose-th-borders':    'rgb(var(--c-surface-500))',
            '--tw-prose-td-borders':    'rgb(var(--c-surface-600))',
          },
        },
      },
    },
  },
  plugins: [typography],
};
