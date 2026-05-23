import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  vite: () => ({
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    build: {
      chunkSizeWarningLimit: 600,
    },
  }),
  manifestVersion: 3,
  srcDir: 'src',
  outDir: '.output',

  manifest: {
    name: '1Click: Temp Mail & Autofill Form',
    version: '3.0.0',
    description:
      'Generate temporary email addresses and auto-fill OTPs and login forms with one click.',
    action: {
      default_popup: 'popup.html',
      default_icon: 'icons/icon128.png',
    },
    icons: {
      '16': 'icons/icon16.png',
      '32': 'icons/icon32.png',
      '48': 'icons/icon48.png',
      '64': 'icons/icon64.png',
      '128': 'icons/icon128.png',
    },
    browser_specific_settings: {
      gecko: {
        id: '1click-temp-mail@unarchive.tech',
      },
    },
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'none'; base-uri 'self'; img-src 'self' https: data:;",
    },
    permissions: ['storage', 'alarms', 'notifications', 'clipboardWrite', 'scripting', 'cookies'],
    host_permissions: ['<all_urls>'],
    commands: {
      'autofill-form': {
        suggested_key: {
          default: 'Alt+Shift+F',
          mac: 'Alt+Shift+F',
        },
        description: 'Autofill the signup form on the current page',
      },
    },
  },
});
