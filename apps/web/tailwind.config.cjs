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
  ]
};

module.exports = config;
