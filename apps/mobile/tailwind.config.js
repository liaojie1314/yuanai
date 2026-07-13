/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          from: '#1d4ed8',
          to: '#3b82f6',
          solid: '#3b82f6',
          hover: '#2563eb',
          light: '#eff6ff',
        },
        bg: {
          base: '#FAFAF8',
          surface: '#FFFFFF',
          elevated: '#F4F4F2',
        },
        text: {
          primary: '#1A1A2E',
          secondary: '#6B7280',
          muted: '#9CA3AF',
        },
        border: {
          default: '#E5E7EB',
          focus: '#3b82f6',
        },
        'bg-dark': {
          base: '#0F1117',
          surface: '#171A22',
          elevated: '#20242E',
        },
      },
      borderRadius: {
        chat: '18px',
      },
    },
  },
  plugins: [],
}
