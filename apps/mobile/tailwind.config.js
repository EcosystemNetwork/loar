/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: '#000000',
        surface: '#0a0a0a',
        card: '#111111',
        border: '#222222',
        primary: '#7c3aed',
        'primary-light': '#a78bfa',
        accent: '#06b6d4',
        success: '#10b981',
        warning: '#f59e0b',
        error: '#ef4444',
        muted: '#6b7280',
        'text-primary': '#ffffff',
        'text-secondary': '#9ca3af',
        'text-tertiary': '#6b7280',
      },
      fontFamily: {
        sans: ['System'],
      },
    },
  },
  plugins: [],
};
