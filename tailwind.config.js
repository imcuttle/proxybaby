/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // macOS 深色主题调色板
        pb: {
          bg: '#1e1e1e',
          panel: '#252526',
          sidebar: '#2b2b2b',
          border: '#3a3a3a',
          hover: '#333333',
          selected: '#094771',
          text: '#e4e4e4',
          muted: '#9a9a9a',
          accent: '#007acc',
          success: '#4ec9b0',
          warn: '#ce9178',
          error: '#f14c4c',
          method: {
            get: '#4ec9b0',
            post: '#569cd6',
            put: '#dcdcaa',
            delete: '#f14c4c',
            patch: '#c586c0',
          },
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Text',
          'PingFang SC',
          'Helvetica Neue',
          'sans-serif',
        ],
        mono: ['SF Mono', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      fontSize: {
        xs: ['11px', '14px'],
        sm: ['12px', '16px'],
        base: ['13px', '18px'],
      },
    },
  },
  plugins: [],
};
