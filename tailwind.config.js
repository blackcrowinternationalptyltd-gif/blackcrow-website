/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      screens: {
        xs: '480px',
      },
      colors: {
        'bc-bg':        '#0D0D0D',
        'bc-surface':   '#1E1E1E',
        'bc-mid':       '#2A2A2A',
        'bc-card':      '#3A3A3A',
        'bc-red':       '#CC0000',
        'bc-red-hover': '#AA0000',
        'bc-divider':   '#333333',
        'bc-secondary': '#AAAAAA',
        'bc-arctic':    '#00AADD',
      },
      fontFamily: {
        display: ['"Bebas Neue"', 'sans-serif'],
        ui:      ['Inter', 'sans-serif'],
      },
      borderRadius: {
        pill: '999px',
      },
    },
  },
  plugins: [],
};
