/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          900: '#1a2332',
          800: '#2c3e50',
          700: '#34495e',
          500: '#3498db',
          400: '#5dade2',
        },
        cut:  '#e74c3c',
        fill: '#27ae60',
      },
    },
  },
  plugins: [],
}
