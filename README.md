# 1Click Temp Mail Autofill Form

Generate temporary email addresses and auto-fill OTPs and login forms with one click.

For the shared product model used by contributors and coding agents, see [Product Context](docs/PRODUCT_CONTEXT.md).

## Features

- **Temporary Email Generation**: Create disposable email addresses instantly
- **OTP Auto-Detection**: Automatically detects and extracts OTP codes from emails
- **Form Auto-Fill**: One-click OTP and email form filling
- **Multiple Browser Support**: Chrome (published), Firefox & Safari builds (export-ready; store listings coming soon)
- **Identity Management**: Manage multiple identities with custom names
- **Inbox Management**: View and manage emails across multiple inboxes
- **Tag System**: Organize inboxes with custom tags and colors
- **Demo signup pages**: Built-in showcase forms for practicing Autofill in demo mode

## Browser API Compatibility

Chrome is the currently published target; Firefox and Safari builds are also maintained. Extension API calls use WXT's `browser` export by default. In the installed WXT version, this is a runtime alias for the native `browser` or `chrome` object-not a polyfill that implements every API or removes browser differences. WXT's generated types are Chrome-based: a Firefox- or Safari-specific API may need type augmentation, while a typed Chrome API can still be absent at runtime in another browser. See [WXT's extension API guide](https://wxt.dev/guide/essentials/extension-apis) and [our contribution rules](CONTRIBUTING.md#browser-api-portability-wxt).

Browser-specific APIs and fallbacks currently used include:

| Target or capability | Current use | Compatibility behavior |
|---|---|---|
| Chrome MV3 | `offscreen` document for notification audio; the permission is added only to Chrome builds. The optional `sidePanel` API provides the side-panel surface. | Feature-detect optional APIs. Other browsers are not given Chrome-only APIs by WXT. |
| Firefox | Direct Web Audio in its document-based background context; `storage.session` falls back to local storage on Firefox versions before 115. | Keep these as runtime fallbacks; don't make session storage or an offscreen document a requirement for the handoff or sound feature. |
| Safari / WebKit | `webkitAudioContext` is a fallback when a DOM context lacks the standard `AudioContext`. | This is a Web Audio compatibility path, not a Safari-only WebExtension API. |
| Pages exposing WebMCP | The extension injects a page-world script because `document.modelContext` / `navigator.modelContext` belongs to the page context, not the extension API namespace. | The script checks for the API and skips registration when it is unavailable. This is an experimental page API, not a WXT limitation. |

Use the shared `browser` namespace for browser-specific extension APIs whenever WXT exposes them; feature-detect them because WXT does not polyfill them into other browsers. Add a browser-specific branch when the feature exists only on that target or the behavior differs. Use a raw vendor global only for a verified runtime-specific limitation-not merely because an API is exclusive to one browser or missing from TypeScript types. For each exception, document the reason, scope permissions to the relevant build, and provide a graceful fallback where possible. A raw `chrome.*` reference in existing code is not by itself evidence that WXT lacks that API.

## Permissions

This extension declares `host_permissions: ["<all_urls>"]` in its manifest. That sounds broader than it behaves - here's what it actually enables and why each capability requires it.

### What the extension does on every page

1. **Form autofill content script** - `src/entrypoints/content/index.ts:13` registers a content script with `matches: ["<all_urls>"]`. It scans every page for signup/login forms and injects an "Autofill" button. The product is universal form autofill; there is no fixed list of "signup sites" to enumerate, so the match pattern is necessarily open-ended.
2. **Disposable email detector** - `src/entrypoints/content/disposable/disposable-detector.ts` highlights the active email field when the user starts typing a known disposable domain. Operates on every page.
3. **OTP autofill** - `src/entrypoints/content/otp/otp-handler.ts` watches for OTP code inputs on any site and offers one-click fill.

A content script's `matches` array implicitly requires matching `host_permissions`; declaring `<all_urls>` keeps the two in sync.

### What the background script does on every page

4. **Context menu - "Create Temp Email"** - `src/entrypoints/background/index.ts` registers a context menu item on every page (`contexts: ['page', 'link', 'editable']`). When clicked, it creates an address, copies it through the privacy-aware background clipboard path, and checks whether autofill is ready in the target tab. If the content script needs injection, `src/entrypoints/background/tab-autofill.ts` uses `browser.scripting.executeScript` after the user's context-menu action.
5. **Context menu - "Exclude from Autofill"** - `src/entrypoints/background/index.ts:80-135` reads `tab.url` to label the menu per-site. Reading `tab.url` for an arbitrary cross-origin tab in MV3 requires a matching host permission.
6. **Keyboard autofill - `Alt+Shift+Z` in Firefox; `Alt+Shift+F` in Chrome/Safari** - the `autofill-form` browser command fills eligible forms in the active tab, subject to site permissions and autofill settings. Browser shortcut preferences can override these defaults.
7. **Per-domain autofill blocklist** - `src/utils/storage/storage-keys.ts:201-219` lets the user exclude specific sites. The blocklist check needs to read `tab.url` for the active tab on every navigation.

### What network requests it makes

8. **Mail provider APIs** - `src/utils/email/email-service.ts:190` and `src/utils/dsl/email-fetcher.ts:194-197` call provider endpoints with `credentials: 'include'`. Credentialed cross-origin fetches from a service worker require the target host in `host_permissions`. Bundled providers: Guerrilla Mail (`api.guerrillamail.com`) and Burner.kiwi instances (`alphac.qzz.io`, `raceco.dpdns.org`, `burner.kiwi`).
9. **User-added provider instances** - `src/features/settings/settings-actions.ts:379-431` and `src/utils/provider/instance-manager.ts:94-108` let the user add custom instance URLs. After SSRF-safe validation (`src/utils/validation.ts:67-100` blocks private IPs), any public https URL may be added and then fetched with credentials. The set of target domains is therefore unbounded by design.
10. **Favicon fetcher** - `src/entrypoints/background/runtime/message-handler.ts` and `src/utils/ui/favicon.ts` fetch favicons for email-sender and website domains through guarded background requests. The Google fallback uses the direct `t0.gstatic.com/faviconV2` image endpoint with a declared host permission. DNS validation must succeed before fetching; redirects are rejected. If that validation service is unavailable, the UI keeps its letter avatar.

### What the extension does NOT do

To be explicit about scope:

- **No browsing-history collection.** The content script only inspects `<form>` elements, `<input>` values typed by the user, and DOM structure. It does not log, store, or transmit page content.
- **Scoped cookie management.** The `cookies` permission is used solely to manage authorization cookies (such as `PHPSESSID`) for email providers like Guerrilla Mail, scoped strictly to the provider API origin.
- **No `chrome.webRequest` interception.** The extension does not observe, block, or modify network traffic.
- **No keystroke logging, no page text exfiltration, no remote-script injection.** The content script's CSP is locked down in `wxt.config.ts:79-81`.

### Minimum-viable alternative considered

`<all_urls>` could in principle be replaced with an enumerated list of bundled provider hosts + a smaller set of "common signup sites," but:

- The product's value proposition is "autofill on *any* site the user signs up on," which has no upper bound.
- User-added custom provider instances make the fetch target set genuinely unbounded.
- The context menu and keyboard shortcut must work on whatever tab the user invokes them on.

Narrowing the permission would require either removing the universal-autofill feature, removing custom provider instances, or introducing dynamic `permissions.request` flows (not currently implemented) - all of which are larger product tradeoffs.

### References

- Chrome: [Declare permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions) and [host permissions](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests#host-permissions)
- Firefox: [host_permissions in Manifest V3](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions)
- Source: `wxt.config.ts:82-91` (manifest declaration), `src/entrypoints/content/index.ts:12-14` (content script)

## Data Collection & Privacy Disclosure

This section mirrors the `data_collection_permissions` declaration in
`wxt.config.ts:146-169` and is the canonical source for store-listing privacy
disclosures (Firefox Add-ons "Data Collection" form, Chrome Web Store "Data
Usage" section). If the manifest declaration changes, update this section in
the same change.

Firefox's `browser_specific_settings.gecko.data_collection_permissions`
declares what this extension transmits **outside itself**:

| Firefox data type | Required / Optional | What is transmitted | When |
|---|---|---|---|
| `authenticationInfo` | Required | Mail-provider API keys/tokens (Guerrilla Mail, Burner.kiwi, user-added custom instances) | On inbox refresh and address operations against the user-configured provider API |
| `personallyIdentifyingInfo` | Required | Email addresses - generated temp aliases and the user's configured forwarding address | Sent to provider APIs when creating / querying inboxes |
| `locationInfo` | Required | The client's public IP address | Fetched once from api.ipify.org for the `{clientIp}` DSL variable and passed to providers with requests |
| `personalCommunications` | Optional | Email subject + body (PII redacted) | Only in opt-in AI OTP-detection mode, sent to the OpenAI-compatible endpoint the user configures; off by default |

Everything else stays local to the extension:

- **No analytics / telemetry.** Page-visit counters (`src/features/analytics/visit-tracker.ts`) are stored in `browser.storage.local` and never transmitted.
- **No email storage outside the extension.** Emails, OTPs, credentials, and settings live in local storage; the only outbound flows are the four rows above plus user-initiated WebDAV backup/restore (covered by the required auth/PII categories; happens only when the user configures a server).
- **Autofill reads are local.** Content scripts inspect form fields to autofill OTPs and logins; page content is never logged, stored, or transmitted.
- **Connectivity / security checks transmit no user content** (e.g. the `google.com/generate_204` reachability probe; DNS-based SSRF validation sends only the custom instance hostname being validated).

## Install from stores

| Browser | Status | Where to install |
|---------|--------|------------------|
| **Chrome** | ✅ Published | [Chrome Web Store](https://chromewebstore.google.com/detail/1click-temp-mail-with-aut/oilafkncmnboohnekbnokkifjbnjeecn) |
| **Firefox** | 🔜 Coming soon | [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/1click-temp-mail/) |
| **Safari** | 🔜 Coming soon | [App Store](https://apps.apple.com/app/1click-temp-mail) |
| **Edge** | 🔜 Coming soon | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/) |

Firefox, Safari, and Edge links above are **store pages that are not live yet** - they will light up as each listing is submitted and approved (see [docs/RELEASE_PLAN.md](docs/RELEASE_PLAN.md) for the rollout plan). Until then, install from a GitHub Release zip via the developer/sideload steps below, or load it from a local build.

## Installation (developer / sideload)

### Chrome
1. Download the latest release from the [Releases](https://github.com/UnarchiveTech/1Click-TempMailandAutofillForm/releases) page
2. Extract the downloaded zip file
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable "Developer mode" in the top right
5. Click "Load unpacked" and select the extracted folder

### Firefox
1. Download the latest Firefox release from the [Releases](https://github.com/UnarchiveTech/1Click-TempMailandAutofillForm/releases) page
2. Extract the downloaded zip file
3. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
4. Click "Load Temporary Add-on" and select the `manifest.json` file in the extracted folder

### Safari (export-ready)

WXT builds a Safari-compatible MV3 web-extension bundle at `.output/safari-mv3/` with `manifest.json` at the folder root - exactly the shape Apple's packagers expect. Safari extensions are distributed as apps through the **App Store**; there is no Safari extension store that accepts raw zips. Since 2025, Apple's **Safari Web Extension Packager** packages the bundle for you from any web browser - no Mac or Xcode needed.

**One-time prerequisites:** an [Apple Developer Program](https://developer.apple.com/programs/enroll/) membership and an app record in [App Store Connect](https://appstoreconnect.apple.com) (platforms: macOS, iOS, or both; iOS also covers iPadOS and visionOS).

**Option A - upload a zip to App Store Connect (any OS, no Xcode):**

```bash
# One command: builds the Safari MV3 bundle and zips its CONTENTS so
# manifest.json lands at the archive root - the layout Apple's packager requires:
bun run package:safari
# -> safari-extension-<version>.zip   (verify: unzip -l safari-extension-<version>.zip)
```

GitHub Releases (from `release.yml`) attach this `safari-extension-<version>.zip` next to the Chrome and Firefox zips, so you can grab it from there instead of building locally.

1. In App Store Connect, open your app record → **Xcode Cloud** tab → **Safari Web Extension Packager** → **Upload**, and select the zip.
2. Apple assembles the app in the cloud (packaging compute is deducted from the 25 h/month Xcode Cloud included with the Developer Program).
3. Track packaging on the **Builds** page, distribute to beta testers with **TestFlight**, then submit the packaged build for App Store review - all from the web.

**Option B - local Xcode wrapper (macOS, for development or Xcode Cloud):**

```bash
bun run build:safari
xcrun safari-web-extension-packager .output/safari-mv3 \
  --app-name "1Click Temp Mail" \
  --bundle-identifier "com.unarchivetech.1click-temp-mail" \
  --macos-only --no-open --force
```

Notes:
- `safari-web-extension-packager` is the renamed `safari-web-extension-converter`; it prints warnings for manifest keys the current Safari does not support - review them rather than ignoring them.
- `bun run zip:safari` produces a plain WXT archive; for store uploads use the zip layout above (contents at root, `manifest.json` top-level).
- Enable a locally built wrapper in Safari → Settings → Extensions during development.

Firefox, Safari, and Edge store pages above are placeholders until listings go live (see [docs/RELEASE_PLAN.md](docs/RELEASE_PLAN.md)); Chrome uses the real Web Store URL. Firefox and Safari releases on GitHub are sideload/developer packages - end users install them from the stores.

## Browser DevTools MCP

For live browser inspection, use the official DevTools MCP integration for the
browser you are testing:

- **Chrome / Chromium**: use the local MCP configuration described in
  [AGENTS.md](AGENTS.md#debugging-the-live-extension-with-chrome-firefox-and-safari-devtools-mcp).
- **Firefox**: Mozilla's official server and project workflow are documented in
  [docs/firefox-devtools-mcp.md](docs/firefox-devtools-mcp.md).
- **Safari**: Apple ships the official server inside Safari 27+ and Safari
  Technology Preview 247+; it is started with `safaridriver --mcp`, not
  installed as an npm package. See
  [docs/safari-devtools-mcp.md](docs/safari-devtools-mcp.md) and the copyable
  [Safari MCP config](docs/safari-devtools-mcp.json).

The Safari integration requires macOS and **Allow remote automation and
external agents** in Safari's Developer settings.

## Development

### Prerequisites
- Node.js 18+ or Bun
- Git

### Setup

```bash
# Clone the repository
git clone https://github.com/UnarchiveTech/1Click-TempMailandAutofillForm.git
cd 1Click-TempMailandAutofillForm

# Install dependencies
bun install

# Run development server (Chrome)
bun run dev

# Run development server (Firefox)
bun run dev:firefox
```

### Build

```bash
# Build for all browsers (Chrome + Firefox + Safari MV3)
bun run build

# Build for a single browser
bun run build:chrome
bun run build:firefox
bun run build:safari   # Safari MV3 export; convert with Xcode / safari-web-extension-converter

# Zip for all browsers
bun run zip

# Zip for a single browser
bun run zip:chrome
bun run zip:firefox
bun run zip:safari
```

### Linting and Type Checking

```bash
# Run Biome lint check
bun run lint

# Fix linting issues
bun run lint:fix

# Format code
bun run format

# Run TypeScript type check
bun run typecheck
```

## Project Structure

```
src/
├── components/          # Reusable UI components
├── entrypoints/         # Extension entry points (app, popup, sidepanel, background)
├── features/            # Feature-specific logic (inbox, identities, etc.)
├── utils/               # Utility functions and types
└── views/               # Page views (Inbox, Identities, Settings, etc.)
```

## Contributing

Contributions are welcome! Please read our [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Third-Party Attributions

### Material Color Utilities

This project includes a lightweight, vendored port of Google's [`@material/material-color-utilities`](https://github.com/material-components/material-color-utilities) (Apache 2.0 License). The original library is 102 KB; the vendored version in `src/utils/theme/material-color-utils.ts` is ~80 KB (source) and implements the Material 3 `SchemeTonalSpot` color algorithm used for dynamic theme generation (`src/utils/theme/theme-generator.ts`). The content script does NOT bundle the solver - it uses the precomputed palette in `src/utils/content/content-default-theme-colors.ts` (regenerate with `bun run generate-content-theme`).

- **Original library**: https://github.com/material-components/material-color-utilities
- **License**: Apache License, Version 2.0
- **Source file**: `src/utils/theme/material-color-utils.ts`
- **Usage**: `import { Hct, SchemeTonalSpot, MaterialDynamicColors } from '@/utils/theme/material-color-utils.js'` in `src/utils/theme/theme-generator.ts`
- **Build-time tool**: `scripts/generate-theme.ts` still imports the full `@material/material-color-utilities` package (listed as a devDependency) for CLI theme generation, which is not shipped to the browser.

## Support

For issues, questions, or suggestions, please open an issue on GitHub.
