/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        nh: {
          blue: '#003882',
          green: '#00703C',
          yellow: '#FFDD00',
        },
      },
    },
  },
  plugins: [],
}
