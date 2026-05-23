/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{svelte,js,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"Segoe UI Emoji"',
          '"Apple Color Emoji"',
          '"Noto Color Emoji"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      colors: {
        // Material Design Primary
        'md-primary': 'var(--md-primary)',
        'md-on-primary': 'var(--md-on-primary)',
        'md-primary-container': 'var(--md-primary-container)',
        'md-on-primary-container': 'var(--md-on-primary-container)',

        // Material Design Secondary
        'md-secondary': 'var(--md-secondary)',
        'md-on-secondary': 'var(--md-on-secondary)',
        'md-secondary-container': 'var(--md-secondary-container)',
        'md-on-secondary-container': 'var(--md-on-secondary-container)',

        // Material Design Tertiary
        'md-tertiary': 'var(--md-tertiary)',
        'md-on-tertiary': 'var(--md-on-tertiary)',
        'md-tertiary-container': 'var(--md-tertiary-container)',
        'md-on-tertiary-container': 'var(--md-on-tertiary-container)',

        // Material Design Error
        'md-error': 'var(--md-error)',
        'md-on-error': 'var(--md-on-error)',
        'md-error-container': 'var(--md-error-container)',
        'md-on-error-container': 'var(--md-on-error-container)',

        // Material Design Success
        'md-success': 'var(--md-success)',
        'md-on-success': 'var(--md-on-success)',

        // Material Design Warning
        'md-warning': 'var(--md-warning)',
        'md-on-warning': 'var(--md-on-warning)',

        // Material Design Surface
        'md-surface': 'var(--md-surface)',
        'md-on-surface': 'var(--md-on-surface)',
        'md-surface-variant': 'var(--md-surface-variant)',
        'md-on-surface-variant': 'var(--md-on-surface-variant)',
        'md-surface-container-lowest': 'var(--md-surface-container-lowest)',
        'md-surface-container-low': 'var(--md-surface-container-low)',
        'md-surface-container': 'var(--md-surface-container)',
        'md-surface-container-high': 'var(--md-surface-container-high)',
        'md-surface-container-highest': 'var(--md-surface-container-highest)',

        // Material Design Background
        'md-background': 'var(--md-background)',
        'md-on-background': 'var(--md-on-background)',

        // Material Design Outline
        'md-outline': 'var(--md-outline)',
        'md-outline-variant': 'var(--md-outline-variant)',

        // Material Design Inverse
        'md-inverse-surface': 'var(--md-inverse-surface)',
        'md-inverse-on-surface': 'var(--md-inverse-on-surface)',
        'md-inverse-primary': 'var(--md-inverse-primary)',

        // Material Design Shadow/Scrim
        'md-shadow': 'var(--md-shadow)',
        'md-scrim': 'var(--md-scrim)',
      },
    },
  },
  plugins: [],
};
