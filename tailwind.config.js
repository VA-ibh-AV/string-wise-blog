/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      // Matches the --accent custom property in src/index.css. The runtime
      // theme is driven by those CSS variables; this scale exists only for the
      // `accent-*` utilities hardcoded inside the post visualizers.
      // 300 and 500 were missing, which silently no-op'd `border-accent-300`
      // and `bg-accent-500` in the PostgreSQL post.
      colors: {
        accent: {
          50:  '#EEF0FC',
          100: '#D5DAF8',
          200: '#ABB4F1',
          300: '#8B98EB',
          400: '#7080E4',
          500: '#5C71DB',
          600: '#4C63D2',
          700: '#3A4FB5',
          800: '#2B3E9A',
          900: '#1A2770',
        },
        paper: '#F9F8F6',
      },
      typography: (theme) => ({
        DEFAULT: {
          css: {
            '--tw-prose-body':          theme('colors.zinc.700'),
            '--tw-prose-headings':      theme('colors.zinc.900'),
            '--tw-prose-links':         theme('colors.accent.600'),
            '--tw-prose-bold':          theme('colors.zinc.900'),
            '--tw-prose-counters':      theme('colors.zinc.500'),
            '--tw-prose-bullets':       theme('colors.zinc.300'),
            '--tw-prose-hr':            theme('colors.zinc.200'),
            '--tw-prose-quotes':        theme('colors.zinc.900'),
            '--tw-prose-quote-borders': theme('colors.accent.200'),
            '--tw-prose-captions':      theme('colors.zinc.500'),
            '--tw-prose-code':          theme('colors.zinc.900'),
            '--tw-prose-pre-code':      'var(--code-fg)',
            '--tw-prose-pre-bg':        'var(--code-bg)',
            maxWidth: 'none',
            fontSize: '1.0625rem',
            lineHeight: '1.75',
            h1: {
              fontFamily: theme('fontFamily.mono').join(', '),
              fontWeight: '700',
              fontSize: '2rem',
              letterSpacing: '-0.02em',
            },
            h2: {
              fontFamily: theme('fontFamily.mono').join(', '),
              fontWeight: '600',
              fontSize: '1.35rem',
              letterSpacing: '-0.015em',
              marginTop: '2.5em',
            },
            h3: {
              fontFamily: theme('fontFamily.mono').join(', '),
              fontWeight: '500',
              fontSize: '1.1rem',
            },
            'code::before': { content: '""' },
            'code::after':  { content: '""' },
            code: {
              fontFamily:   theme('fontFamily.mono').join(', '),
              background:   'var(--surface-muted)',
              padding:      '0.1em 0.35em',
              borderRadius: '4px',
              fontSize:     '0.85em',
              fontWeight:   '500',
            },
            pre: {
              background:   'var(--code-bg)',
              color:        'var(--code-fg)',
              borderRadius: '10px',
              border:       '1px solid var(--code-border)',
            },
            'pre code': {
              background:   'transparent',
              padding:      '0',
              fontSize:     '0.875em',
            },
            a: {
              textDecoration:         'underline',
              textDecorationColor:    theme('colors.accent.200'),
              textUnderlineOffset:    '3px',
              fontWeight:             '500',
              transition:             'color 0.15s',
              '&:hover': {
                color:                theme('colors.accent.700'),
                textDecorationColor:  theme('colors.accent.400'),
              },
            },
            blockquote: {
              fontStyle:     'normal',
              borderLeftWidth: '3px',
            },
          },
        },
      }),
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
