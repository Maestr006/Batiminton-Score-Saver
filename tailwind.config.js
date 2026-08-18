/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        court: {
          DEFAULT: '#1F5D50', // deep court green
          dark: '#123B33',
          line: '#F6F3EC', // chalk line off-white
        },
        cork: {
          DEFAULT: '#F2B705', // shuttlecock cork yellow
          dark: '#C98F00',
        },
        ink: '#122019',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Inter"', 'sans-serif'],
      },
      backgroundImage: {
        'court-lines':
          "repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(246,243,236,0.06) 39px, rgba(246,243,236,0.06) 40px)",
      },
    },
  },
  plugins: [],
}
