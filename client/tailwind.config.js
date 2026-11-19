/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ivory: {
          50: '#FDFCF9',
          100: '#F8F7F4',
          200: '#EFECE6',
          300: '#E2DDD4',
          400: '#C8C1B4',
        },
        forest: {
          50: '#EEF5F0',
          100: '#DCECE2',
          200: '#B8D8C5',
          300: '#8ABFA2',
          500: '#357A5B',
          600: '#276146',
          700: '#1B4D3E',
          800: '#153D31',
          900: '#0E2B22',
        },
        charcoal: {
          400: '#8C9490',
          500: '#6D7570',
          600: '#4F5753',
          700: '#383F3C',
          800: '#262C29',
          900: '#1A1E1C',
        },
        gold: {
          400: '#E2B74D',
          500: '#D4AF37',
          600: '#B59224',
        },
      },
      fontFamily: {
        sans: [
          '"Pretendard JP Variable"',
          '"Pretendard JP"',
          '"Pretendard"',
          '"Noto Sans JP"',
          '"Apple SD Gothic Neo"',
          '"Malgun Gothic"',
          'system-ui',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
