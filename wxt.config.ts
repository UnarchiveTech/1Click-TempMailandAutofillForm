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
//   2. package.json (single source of truth - bump with `bun pm pkg set
//      version=X.Y.Z` or `bun run bump-version`).
//   3. Hard-coded fallback for local dev if package.json is unreadable.
const rawVersion = process.env.VERSION_OVERRIDE?.replace(/^v/, '') || pkg.version || '0.0.0-dev';

/**
 * Sanitize a semver string for use as a Chrome MV3 manifest `version` field.
 *
 * Chrome requires 1-4 dot-separated integers, each 0-65536, with NO
 * pre-release/build suffix. Firefox is more permissive (accepts strings),
 * but the same field is shared in `browser_specific_settings.gecko`, so we
 * sanitize once and use the sanitized form for both targets.
 *
 *   3.0.0-beta-8  →  3.0.0.8   (beta-8 appended as 4th integer)
 *   1.0.0-rc1     →  1.0.0.1
 *   2.0.0         →  2.0.0    (no change)
 *
 * Note: this is irreversible. If a release ships as 3.0.0-beta-8 and
 * 3.0.0-beta-9, both will collapse to 3.0.0.8 / 3.0.0.9. Bump to a
 * 4-component semver (e.g. 3.0.0.8 → 3.0.0.9) before cutting the next
 * pre-release. The release.yml CI step verifies the built version matches
 * the expected one, so the upstream `package.json` version MUST be a valid
 * 4-component semver when shipping beta/rc tags.
 */
function sanitizeVersionForManifest(version: string): string {
  const [core = '', pre = ''] = version.split('-', 2);
  const parts = core.split('.').map((p) => Number.parseInt(p, 10));
  // Strip any non-numeric garbage
  const clean = parts.filter((n) => Number.isFinite(n) && n >= 0 && n <= 65536);
  if (pre) {
    // Append the pre-release counter as a 4th integer (0-65535)
    const preNum = Number.parseInt(pre.replace(/\D/g, ''), 10);
    if (Number.isFinite(preNum) && clean.length < 4) {
      clean.push(preNum || 1);
    }
  }
  // Pad to at least 1 integer; truncate to at most 4
  const final = clean.slice(0, 4);
  if (final.length === 0) return '0.0.0';
  return final.join('.');
}

const version = sanitizeVersionForManifest(rawVersion);

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
      // Popup UI + Material styles + locales live in one shell chunk; 800 was noisy.
      chunkSizeWarningLimit: 1200,
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
      default_title: '1Click: Temp Mail & Autofill Form',
    },
    // Address-bar keyword (type "1c" then space) — credential / site suggestions
    omnibox: {
      keyword: '1c',
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
        // Firefox desktop / Android MV3
        strict_min_version: '115.0',
      },
    },
    content_security_policy: {
      extension_pages:
        "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; connect-src 'self' https:;",
    },
    permissions: [
      'storage',
      // Must be required (not optional) — Chrome omits unlimitedStorage from optional_permissions
      'unlimitedStorage',
      'alarms',
      'notifications',
      'clipboardWrite',
      'clipboardRead',
      'scripting',
      'cookies',
      'contextMenus',
      'activeTab',
      'declarativeNetRequest',
    ],
    host_permissions: [
      'https://api.guerrillamail.com/*',
      'https://alphac.qzz.io/*',
      'https://raceco.dpdns.org/*',
      'https://burner.kiwi/*',
    ],
    optional_host_permissions: ['<all_urls>'],
    commands: {
      'autofill-form': {
        suggested_key: {
          default: 'Alt+Shift+F',
          mac: 'Alt+Shift+F',
        },
        description: 'Autofill the signup form on the current page',
      },
      'open-autofill-manager': {
        description: 'Open Autofill manager (Profiles & Credentials)',
      },
    },
  },
});
