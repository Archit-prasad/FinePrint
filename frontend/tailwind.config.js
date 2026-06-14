/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      animation: {
        'float-a': 'float 4.2s ease-in-out infinite',
        'float-b': 'float 5.1s ease-in-out infinite 1.4s',
        'float-c': 'float 4.7s ease-in-out infinite 0.7s',
        'float-d': 'float 3.9s ease-in-out infinite 2.2s',
        'float-e': 'float 5.4s ease-in-out infinite 1.7s',
        'float-f': 'float 4.3s ease-in-out infinite 0.9s',
        'slide-up': 'slideUp 0.5s cubic-bezier(0.22,1,0.36,1) both',
        'fade-in':  'fadeIn 0.4s ease-out both',
        'spin-ring':'spin 1s linear infinite',
        'line-pulse':'linePulse 5s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%,100%': { transform: 'translateY(0px) rotate(0deg)' },
          '33%':     { transform: 'translateY(-14px) rotate(1.2deg)' },
          '66%':     { transform: 'translateY(7px) rotate(-0.6deg)' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(24px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        linePulse: {
          '0%,100%': { opacity: '0.35' },
          '50%':     { opacity: '0.85' },
        },
      },
    },
  },
  plugins: [],
};
