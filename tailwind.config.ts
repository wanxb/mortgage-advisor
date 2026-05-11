import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        advisor: {
          ink: '#14213d',
          primary: '#2563eb',
          green: '#0f766e',
          paper: '#f8fafc',
        },
      },
      boxShadow: {
        panel: '0 16px 48px rgba(15, 23, 42, 0.08)',
      },
    },
  },
  plugins: [],
} satisfies Config;
