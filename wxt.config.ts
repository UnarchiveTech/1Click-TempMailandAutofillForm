import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import jsoncParser from 'jsonc-parser';
import { defineConfig } from 'wxt';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PackageJson {
  version: string;
}

const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')) as PackageJson;

// Version precedence:
//   1. VERSION_OVERRIDE env var (used by `workflow_dispatch` in release.yml
//      to rebuild a specific published version without re-tagging).
//   2. package.json (single source of truth — bump with `bun pm pkg set
//      version=X.Y.Z` or `bun run bump-version`).
//   3. Hard-coded fallback for local dev if package.json is unreadable.
const version = process.env.VERSION_OVERRIDE?.replace(/^v/, '') || pkg.version || '0.0.0-dev';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  vite: () => ({
    plugins: [
      tailwindcss(),
      // Treat .jsonc files as JSON so the providers DSL can be commented.
      // Strips // and /* */ comments and trailing commas before JSON.parse.
      {
        name: 'jsonc-as-json',
        enforce: 'pre',
        transform(code, id) {
          if (id.endsWith('.jsonc') || id.includes('.jsonc?')) {
            return {
              code: `export default ${JSON.stringify(jsoncParser.parse(code))};`,
              map: null,
            };
          }
        },
      },
    ],
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
    version,
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
    permissions: [
      'storage',
      'alarms',
      'notifications',
      'clipboardWrite',
      'scripting',
      'cookies',
      'contextMenus',
    ],
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
