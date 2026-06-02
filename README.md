# 1Click Temp Mail Autofill Form

Generate temporary email addresses and auto-fill OTPs and login forms with one click.

## Features

- **Temporary Email Generation**: Create disposable email addresses instantly
- **OTP Auto-Detection**: Automatically detects and extracts OTP codes from emails
- **Form Auto-Fill**: One-click OTP and email form filling
- **Multiple Browser Support**: Works on Chrome and Firefox
- **Identity Management**: Manage multiple identities with custom names
- **Inbox Management**: View and manage emails across multiple inboxes
- **Tag System**: Organize inboxes with custom tags and colors

## Permissions

This extension declares `host_permissions: ["<all_urls>"]` in its manifest. That sounds broader than it behaves — here's what it actually enables and why each capability requires it.

### What the extension does on every page

1. **Form autofill content script** — `src/entrypoints/content/index.ts:13` registers a content script with `matches: ["<all_urls>"]`. It scans every page for signup/login forms and injects an "Autofill" button. The product is universal form autofill; there is no fixed list of "signup sites" to enumerate, so the match pattern is necessarily open-ended.
2. **Disposable email detector** — `src/entrypoints/content/disposable/disposable-detector.ts` highlights the active email field when the user starts typing a known disposable domain. Operates on every page.
3. **OTP autofill** — `src/entrypoints/content/otp/otp-handler.ts` watches for OTP code inputs on any site and offers one-click fill.

A content script's `matches` array implicitly requires matching `host_permissions`; declaring `<all_urls>` keeps the two in sync.

### What the background script does on every page

4. **Context menu — "Create Temp Email"** — `src/entrypoints/background/index.ts:107-119` registers a context menu item on every page (`contexts: ['page', 'link', 'editable']`). When clicked, it calls `chrome.scripting.executeScript` against the right-clicked tab to write the new address to the clipboard. The target tab can be any site, so the scripting permission must cover all URLs.
5. **Context menu — "Exclude from Autofill"** — `src/entrypoints/background/index.ts:80-135` reads `tab.url` to label the menu per-site. Reading `tab.url` for an arbitrary cross-origin tab in MV3 requires a matching host permission.
6. **Keyboard shortcut — `Alt+Shift+F` autofill** — `src/entrypoints/background/runtime/message-handler.ts:561` queries the active tab on shortcut press and sends an `autofillForm` message; works on any site.
7. **Per-domain autofill blocklist** — `src/utils/storage-keys.ts:201-219` lets the user exclude specific sites. The blocklist check needs to read `tab.url` for the active tab on every navigation.

### What network requests it makes

8. **Mail provider APIs** — `src/utils/email-service.ts:190` and `src/utils/dsl/email-fetcher.ts:194-197` call provider endpoints with `credentials: 'include'`. Credentialed cross-origin fetches from a service worker require the target host in `host_permissions`. Bundled providers: Guerrilla Mail (`api.guerrillamail.com`) and Burner.kiwi instances (`alphac.qzz.io`, `raceco.dpdns.org`, `burner.kiwi`).
9. **User-added provider instances** — `src/features/settings/settings-actions.ts:379-431` and `src/utils/instance-manager.ts:94-108` let the user add custom instance URLs. After SSRF-safe validation (`src/utils/validation.ts:67-100` blocks private IPs), any public https URL may be added and then fetched with credentials. The set of target domains is therefore unbounded by design.
10. **Favicon fetcher** — `src/entrypoints/background/runtime/message-handler.ts:464-502` and `src/utils/favicon.ts:88-117` fetch favicons for arbitrary email-sender domains (e.g. `https://${sender}/favicon.ico` or via Google's favicon proxy).

### What the extension does NOT do

To be explicit about scope:

- **No browsing-history collection.** The content script only inspects `<form>` elements, `<input>` values typed by the user, and DOM structure. It does not log, store, or transmit page content.
- **No `chrome.cookies` access at runtime.** The `cookies` permission is declared in the manifest for forward compatibility, but no `browser.cookies.*` calls exist in the source. Session state is held in `browser.storage.session` only.
- **No `chrome.webRequest` interception.** The extension does not observe, block, or modify network traffic.
- **No keystroke logging, no page text exfiltration, no remote-script injection.** The content script's CSP is locked down in `wxt.config.ts:79-81`.

### Minimum-viable alternative considered

`<all_urls>` could in principle be replaced with an enumerated list of bundled provider hosts + a smaller set of "common signup sites," but:

- The product's value proposition is "autofill on *any* site the user signs up on," which has no upper bound.
- User-added custom provider instances make the fetch target set genuinely unbounded.
- The context menu and keyboard shortcut must work on whatever tab the user invokes them on.

Narrowing the permission would require either removing the universal-autofill feature, removing custom provider instances, or introducing dynamic `permissions.request` flows (not currently implemented) — all of which are larger product tradeoffs.

### References

- Chrome: [Declare permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions) and [host permissions](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests#host-permissions)
- Firefox: [host_permissions in Manifest V3](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions)
- Source: `wxt.config.ts:82-91` (manifest declaration), `src/entrypoints/content/index.ts:12-14` (content script)

## Installation

### Chrome
1. Download the latest release from the [Releases](https://github.com/yourusername/1click-temp-mail-autofill-form/releases) page
2. Extract the downloaded zip file
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable "Developer mode" in the top right
5. Click "Load unpacked" and select the extracted folder

### Firefox
1. Download the latest Firefox release from the [Releases](https://github.com/yourusername/1click-temp-mail-autofill-form/releases) page
2. Extract the downloaded zip file
3. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
4. Click "Load Temporary Add-on" and select the `manifest.json` file in the extracted folder

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
# Build for Chrome
bun run build

# Build for Firefox
bun run build:firefox

# Create zip package
bun run zip
bun run zip:firefox
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

## Support

For issues, questions, or suggestions, please open an issue on GitHub.
