import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import jsoncParser from 'jsonc-parser';
import { defineConfig, type WxtViteConfig } from 'wxt';
import { packedLocalesPlugin, sharedUiI18nPlugin } from './scripts/vite/packed-locales.js';
import { defaultAutofillShortcut } from './src/utils/browser/command-shortcuts.js';
import { sanitizeVersionForManifest } from './src/utils/version-sanitize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PackageJson {
  version: string;
}

// Bun.file is ~2× faster than readFileSync when running under Bun, but
// wxt.config.ts is loaded via jiti (Node) even when invoked as `bun x wxt`,
// so fall back to readFileSync when the Bun global is unavailable.
let pkg: PackageJson;
const maybeBun = (globalThis as unknown as { Bun?: typeof Bun }).Bun;
if (maybeBun?.file) {
  pkg = (await maybeBun.file(join(__dirname, 'package.json')).json()) as PackageJson;
} else {
  const { readFileSync } = await import('node:fs');
  pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')) as PackageJson;
}

// Version precedence:
//   1. VERSION_OVERRIDE env var (used by `workflow_dispatch` in release.yml
//      to rebuild a specific published version without re-tagging).
//   2. package.json (single source of truth - bump with `bun pm pkg set
//      version=X.Y.Z` or `bun run bump-version`).
//   3. Hard-coded fallback for local dev if package.json is unreadable.
const rawVersion = process.env.VERSION_OVERRIDE?.replace(/^v/, '') || pkg.version || '0.0.0-dev';

// The package version is sanitized for the manifest by
// src/utils/version-sanitize.ts (see its docstring for the mapping and the
// release.yml byte-for-byte parity contract). The upstream `package.json`
// version MUST stay a valid 4-component semver when shipping beta/rc tags.
const version = sanitizeVersionForManifest(rawVersion);

// WXT and the app resolve separate Vite 8.3 patch versions in this install.
// Their recursive PluginHook types are runtime-compatible but TS 7 can exhaust
// its structural comparison across the two copies. Bridge only at the plugin
// boundary, keeping the rest of the WXT config checked.
type WxtPluginOption = NonNullable<WxtViteConfig['plugins']>[number];

function asWxtPlugin(plugin: unknown): WxtPluginOption {
  return plugin as WxtPluginOption;
}

const jsoncAsJsonPlugin = {
  name: 'jsonc-as-json',
  enforce: 'pre',
  transform(code: string, id: string) {
    if (id.endsWith('.jsonc') || id.includes('.jsonc?')) {
      return {
        code: `export default ${JSON.stringify(jsoncParser.parse(code))};`,
        map: null,
      };
    }
  },
};

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  hooks: {
    'vite:build:extendConfig'(entrypoints, config) {
      if (
        entrypoints.length > 0 &&
        entrypoints.every((entry) => entry.inputPath.endsWith('.html'))
      ) {
        config.plugins ??= [];
        config.plugins.push(asWxtPlugin(sharedUiI18nPlugin(__dirname)));
      }
    },
  },
  analysis: { outputFile: '.wxt/bundle-analysis.html' },
  vite: () => ({
    // Web-only output has its own URL prefix, including Vite's lazy CSS loader.
    ...(process.env.WEB_DEMO_BUILD === '1' ? { base: '/1click/extension/' } : {}),
    optimizeDeps: {
      rolldownOptions: {},
    },
    plugins: [
      asWxtPlugin(packedLocalesPlugin(__dirname)),
      asWxtPlugin(tailwindcss()),
      // Treat .jsonc files as JSON so the providers DSL can be commented.
      // Strips // and /* */ comments and trailing commas before JSON.parse.
      asWxtPlugin(jsoncAsJsonPlugin),
    ],
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    build: {
      // Views are code-split (see src/ui/blocks/layout/lazy-view.svelte.ts), so
      // the shell chunk holds chrome + dialogs + shared styles/locales only.
      // Keep the limit low enough that a view accidentally being statically
      // imported back into the shell fails the build loudly.
      chunkSizeWarningLimit: 500,
      // Content scripts run in an isolated (cross-world) namespace - Chrome cannot
      // use <link rel="modulepreload"> injected by Vite across worlds, producing
      // "preload ... is not used because it is a cross-world extension resource
      // mismatch" console warnings. Disable modulepreload to silence them.
      modulePreload: false,
      // [PLUGIN_TIMINGS] is an informational rolldown diagnostic that fires when
      // most of the build is spent inside plugin hooks. The remaining hook time
      // here is structural, not fixable per-build: ~500 Svelte module transforms
      // (vite-plugin-svelte) + WXT auto-import scans (unimport) over every
      // module - both inherent to the stack. The one actionable row (Tailwind
      // scanning non-source dirs on every CSS transform) is already handled via
      // `@source not` in src/styles.css. Suppress the check so routine builds
      // don't re-report an expected profile; re-enable it when profiling a
      // suspected build regression.
      rollupOptions: {
        checks: {
          pluginTimings: false,
        },
      },
    },
  }),
  // Auto-imports are fully migrated to explicit imports (codemod:
  // scripts/migrate-auto-imports.ts). Disabling Unimport removes its per-module
  // scan/transform pass (≈15% of build CPU) and speeds up dev startup.
  // Re-enable only if intentionally reintroducing implicit globals.
  imports: false,
  manifestVersion: 3,
  srcDir: 'src',
  outDir: process.env.WEB_DEMO_BUILD === '1' ? '.output/web-demo-extension' : '.output',

  manifest: (env) => ({
    // `name`, `description`, `action.default_title` and `commands.*.description`
    // are rendered by the BROWSER's own chrome (chrome://extensions, the
    // shortcuts page, the toolbar tooltip, the store listing), so they cannot
    // go through src/locales or `$t()`. They use the WebExtensions `__MSG_*__`
    // mechanism with dictionaries in `public/_locales/<code>/messages.json`,
    // generated by scripts/generate-locale-messages.ts (which also derives the
    // localized store-listing metadata in store-listing/<code>.json).
    // Chrome substitutes `__MSG_*__` in
    // the manifest and CSS only - never in HTML, which is why the entrypoint
    // `<title>` is set at runtime from the app's own i18n instead.
    //
    // Consequence to accept knowingly: these strings follow the BROWSER UI
    // language, while the in-app UI follows the user's in-app language
    // preference (the vanilla `browser.i18n` API cannot be switched at
    // runtime). The `extName` values are byte-identical to
    // `actionTitle.tempMailAndAutofill` in src/locales, so the manifest name
    // and the toolbar tooltip can never drift apart.
    //
    // `default_locale` is REQUIRED wherever a `_locales` directory exists, and
    // `zh_CN` (not `zh`) is Chrome's code for Simplified Chinese.
    default_locale: 'en',
    name: '__MSG_extName__',
    version,
    description: '__MSG_extDescription__',
    action: {
      default_popup: 'popup.html',
      default_icon: 'icons/icon128.png',
      default_title: '__MSG_extName__',
    },
    // Address-bar keyword (type "1c" then space) - credential / site suggestions
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
        // Required for all new AMO submissions since Nov 3, 2025 (existing
        // extensions are exempt for now). Declare the data types the extension
        // transmits OUTSIDE itself - do not suppress the build warning:
        //   required.authenticationInfo        - API tokens/keys sent to the
        //     user-configured mail-provider APIs (and the vault login fetch).
        //   required.personallyIdentifyingInfo - email addresses (temp aliases
        //     + the user's forwarding address) sent to provider APIs.
        //   required.locationInfo               - public client IP fetched from
        //     api.ipify.org for the {clientIp} DSL variable and passed to
        //     providers with requests.
        //   optional.personalCommunications    - email subject/body sent to the
        //     user-configured OpenAI-compatible endpoint in opt-in AI OTP
        //     detection mode (redacted; off by default). WebDAV backup of
        //     stored aliases/credentials is covered by the required auth/PII
        //     categories (only when the user configures a server).
        data_collection_permissions: {
          required: ['authenticationInfo', 'personallyIdentifyingInfo', 'locationInfo'],
          optional: ['personalCommunications'],
        },
      },
    },
    content_security_policy: {
      extension_pages:
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; connect-src 'self' https:;",
    },
    // The MAIN-world WebMCP page script (webmcp-page.unlisted.ts) is injected
    // into web pages by the webmcp-bridge content script as a `<script src>`
    // tag, which requires the file to be web-accessible.
    //
    // WHY NOT `scripting.executeScript({ world: 'MAIN' })`: that runs the file
    // with no tag and no web-accessible entry, but it requires HOST permission
    // for the tab, and `<all_urls>` is only an OPTIONAL permission here
    // (requested when the user adds a custom provider). It failed at runtime
    // with "Extension manifest must request permission to access the respective
    // host", so it cannot back a feature that must work on any page. A
    // declared content script's `matches` are not host-permission-gated the
    // same way, which is why the `<script src>` route works everywhere.
    //
    // `use_dynamic_url` is the platform's fingerprinting mitigation: the
    // resource is served from a per-session random path (`chrome.runtime.
    // getURL` returns it, so injection still resolves) and the STATIC
    // `chrome-extension://<id>/webmcp-page.js` path is not served to a page, so
    // a site cannot precompute or re-fetch it. The page script contains no
    // privileged APIs - only WebMCP registration + postMessage forwarding.
    web_accessible_resources: [
      {
        resources: ['webmcp-page.js'],
        matches: ['http://*/*', 'https://*/*'],
        use_dynamic_url: true,
      },
    ],
    permissions: [
      'storage',
      // Must be required (not optional) - Chrome omits unlimitedStorage from optional_permissions
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
      // chrome.offscreen hosts the audio document that plays the notification
      // sound (the MV3 service worker has no AudioContext). Firefox has no
      // offscreen API and plays via its event-page document instead, so the
      // permission is only declared for Chrome builds.
      ...(env.browser === 'chrome' ? ['offscreen'] : []),
    ],
    host_permissions: [
      // DNS-over-HTTPS used by the request-time SSRF/rebinding guard.
      'https://dns.google/*',
      // Direct favicon image fallback; avoids an opaque Google s2 redirect.
      'https://t0.gstatic.com/*',
      'https://api.guerrillamail.com/*',
      'https://alphac.qzz.io/*',
      'https://raceco.dpdns.org/*',
      'https://burner.kiwi/*',
      ...(process.env.NODE_ENV !== 'production'
        ? ['http://localhost/*', 'http://127.0.0.1/*']
        : []),
    ],
    optional_host_permissions: ['<all_urls>'],
    // optional_host_permissions: <all_urls> is requested only when the user adds a
    // custom mail-provider instance URL (see instance-manager / MailProviderView).
    // Content scripts match <all_urls> for autofill/OTP on arbitrary signup pages.
    // Document this rationale in store listings and ARCHITECTURE.md § Permissions.
    commands: {
      'autofill-form': {
        suggested_key: {
          default: defaultAutofillShortcut(env.browser),
          mac: defaultAutofillShortcut(env.browser),
        },
        description: '__MSG_cmdAutofillForm__',
      },
      'open-autofill-manager': {
        description: '__MSG_cmdOpenAutofillManager__',
      },
      'quick-generate-inbox': {
        suggested_key: {
          default: 'Alt+Shift+N',
          mac: 'Alt+Shift+N',
        },
        description: '__MSG_cmdQuickGenerateInbox__',
      },
      'copy-latest-otp': {
        suggested_key: {
          default: 'Alt+Shift+O',
          mac: 'Alt+Shift+O',
        },
        description: '__MSG_cmdCopyLatestOtp__',
      },
    },
  }),
});
