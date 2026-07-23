/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{svelte,js,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Roboto',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          '"Segoe UI Emoji"',
          '"Apple Color Emoji"',
          '"Noto Color Emoji"',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      /**
       * MD3 type scale mapped to Tailwind text-* (375×600 popup / mobile width).
       * Prefer semantic classes from styles.css (MD3 type utilities) for new UI.
       */
      fontSize: {
        xs: [
          'var(--md-type-body-small-size)',
          {
            lineHeight: 'var(--md-type-body-small-line)',
            letterSpacing: 'var(--md-type-body-small-tracking)',
          },
        ],
        sm: [
          'var(--md-type-body-medium-size)',
          {
            lineHeight: 'var(--md-type-body-medium-line)',
            letterSpacing: 'var(--md-type-body-medium-tracking)',
          },
        ],
        base: [
          'var(--md-type-body-large-size)',
          {
            lineHeight: 'var(--md-type-body-large-line)',
            letterSpacing: 'var(--md-type-body-large-tracking)',
          },
        ],
        lg: [
          'var(--md-type-title-large-size)',
          {
            lineHeight: 'var(--md-type-title-large-line)',
            letterSpacing: 'var(--md-type-title-large-tracking)',
          },
        ],
        xl: [
          'var(--md-type-headline-small-size)',
          {
            lineHeight: 'var(--md-type-headline-small-line)',
            letterSpacing: 'var(--md-type-headline-small-tracking)',
          },
        ],
        '2xl': [
          'var(--md-type-headline-medium-size)',
          {
            lineHeight: 'var(--md-type-headline-medium-line)',
            letterSpacing: 'var(--md-type-headline-medium-tracking)',
          },
        ],
        '3xl': [
          'var(--md-type-headline-large-size)',
          {
            lineHeight: 'var(--md-type-headline-large-line)',
            letterSpacing: 'var(--md-type-headline-large-tracking)',
          },
        ],
        'label-sm': [
          'var(--md-type-label-small-size)',
          {
            lineHeight: 'var(--md-type-label-small-line)',
            letterSpacing: 'var(--md-type-label-small-tracking)',
          },
        ],
        'title-md': [
          'var(--md-type-title-medium-size)',
          {
            lineHeight: 'var(--md-type-title-medium-line)',
            letterSpacing: 'var(--md-type-title-medium-tracking)',
          },
        ],
        'title-lg': [
          'var(--md-type-title-large-size)',
          {
            lineHeight: 'var(--md-type-title-large-line)',
            letterSpacing: 'var(--md-type-title-large-tracking)',
          },
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
