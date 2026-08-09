/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        accent: {
          50:  '#EEF0FC',
          100: '#D5DAF8',
          200: '#ABB4F1',
          400: '#7080E4',
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
            '--tw-prose-pre-code':      theme('colors.zinc.100'),
            '--tw-prose-pre-bg':        '#111111',
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
              background:   '#F1F1EE',
              padding:      '0.1em 0.35em',
              borderRadius: '4px',
              fontSize:     '0.85em',
              fontWeight:   '500',
            },
            pre: {
              background:   '#111111',
              color:        '#e4e4e7',
              borderRadius: '10px',
              border:       '1px solid #27272a',
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
