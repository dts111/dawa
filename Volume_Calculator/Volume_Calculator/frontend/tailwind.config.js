import defaultTheme from 'tailwindcss/defaultTheme'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Barlow', ...defaultTheme.fontFamily.sans],
      },
      colors: {
        brand: {
          50:  '#f4edfb',
          100: '#e5d3f5',
          400: '#8a4fd1',
          500: '#6422b4',
          600: '#521c94',
          700: '#3f1673',
        },
        ink: '#1a1c1e',
        cut:  '#e74c3c',
        fill: '#27ae60',
      },
    },
  },
  plugins: [],
}
