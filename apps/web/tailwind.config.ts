import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#09090B',
        surface: '#18181B',
        surface2: '#202024',
        primary: '#2563EB',
        secondary: '#3B82F6',
        muted: '#A1A1AA',
      },
      borderRadius: { xl: '18px' },
      keyframes: {
        rise: { '0%': { opacity: '0', transform: 'translateY(14px)' }, '100%': { opacity: '1', transform: 'none' } },
      },
      animation: { rise: 'rise .5s ease' },
    },
  },
  plugins: [],
};
export default config;
