/* eslint-disable global-require */
const plugin = require('tailwindcss/plugin');

const config = {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Hiragino Sans',
          'Yu Gothic',
          'Meiryo',
          'sans-serif'
        ],
        serif: ['Hiragino Mincho ProN', 'Yu Mincho', 'YuMincho', 'serif']
      },
      colors: {
        'background-color': 'var(--background-color)',
        'surface': 'var(--surface)',
        'surface-raised': 'var(--surface-raised)',
        'surface-hover': 'var(--surface-hover)',
        'ink': 'var(--ink)',
        'muted': 'var(--muted)',
        'line': 'var(--line)',
        'accent': 'var(--accent)',
        'on-accent': 'var(--on-accent)',
        'accent-soft': 'var(--accent-soft)',
        'danger': 'var(--danger)',
        'heatmap-empty': 'var(--heatmap-empty)',
        'heatmap-outside': 'var(--heatmap-outside)'
      },
      spacing: {
        21: '5.25rem'
      },
      maxWidth: {
        '60vw': '60vw'
      }
    }
  },
  plugins: [
    require('@tailwindcss/aspect-ratio'),
    require('@tailwindcss/forms'),
    plugin(({ addUtilities }) => {
      addUtilities(require('./tailwindcss/material-elevation.cjs'));
    })
  ],
  safelist: [
    {
      pattern: /grid-cols-(2|3)/,
      variants: ['md']
    },
    'animate-[pulse_0.5s_cubic-bezier(0.4,0,0.6,1)_1]',
    'animate-[pulse_1s_cubic-bezier(0.4,0,0.6,1)_infinite]'
  ]
};

module.exports = config;
