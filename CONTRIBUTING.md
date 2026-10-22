# Contributing to 1Click Temp Mail Autofill Form

This guide is the entry point for human contributors and coding agents. It explains the development workflow and points to the product and architecture references needed to make changes safely.

Before changing behavior, read:

- [Product Context](docs/PRODUCT_CONTEXT.md) for the extension's purpose, capabilities, and domain rules.
- [Architecture](docs/ARCHITECTURE.md) for the codebase's technical structure.
- [Agent instructions](AGENTS.md) for repository-specific implementation requirements.

The implementation is the final source of truth when a document is stale. Update the relevant document when a product capability, browser behavior, or architecture changes.

## Community Expectations

Be respectful, inclusive, and constructive. We welcome contributions from everyone regardless of background or experience level.

## Getting Started

### Prerequisites

- **Bun 1.4 or newer** - the project scripts and checks use Bun, including Bun-specific APIs. Use Bun for the documented development and validation workflow. Install instructions for Windows, macOS, and Linux are maintained at [bun.sh](https://bun.sh/docs/installation).
- Git
- Basic knowledge of TypeScript, Svelte 5 (runes), and MV3 browser extension development

### Product, UI, and Dependency Principles

- Preserve the existing product model in [Product Context](docs/PRODUCT_CONTEXT.md); in particular, do not conflate addresses, identities, sites, credentials, mailbox rules, and site rules.
- Follow the existing UI components and interaction patterns. The project uses Material color foundations and custom interface patterns; this does **not** mean every component follows Material Design 3. Preserve the established tab design. Check the component and the UI references before changing presentation.
- Use shared tokens and primitives where they already cover the behavior. Follow the overlay z-index policy in `AGENTS.md` and `src/utils/ui/portal-layers.ts` rather than adding local layer values.
- Keep dependencies intentional because they ship in browser bundles. Before adding one, check whether existing platform APIs or project utilities suffice, review its license and maintenance, and measure the production build impact. Do not vendor a library solely to avoid adding a dependency.


### Setting Up Development Environment

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/UnarchiveTech/1Click-TempMailandAutofillForm.git
   cd 1Click-TempMailandAutofillForm
   ```
3. Install dependencies (Bun):
   ```bash
   bun install
   ```
4. Install git hooks:
   ```bash
   lefthook install
   # pre-commit runs: check-translations, check-background-locales, check-message-types, audit, etc.
   ```
5. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

### Browser DevTools MCP (optional, local only)

The project supports live debugging through the official DevTools MCP server
for Chrome/Chromium, Firefox, and Safari. MCP configuration is machine- and
client-specific, so the repository's root `.mcp.json` is intentionally ignored
by Git. Do **not** remove `.mcp.json` from `.gitignore`, commit a personal MCP
configuration, or add credentials to a shared config. Configure the servers in
your MCP client's user/project settings, or create an ignored local `.mcp.json`
for development.

After adding a server, restart the MCP client so it reloads the configuration.
The following entries can be added alongside any existing local MCP servers.

#### Chrome / Chromium

Chrome's MCP server connects to the extension-capable debugging browser started
by the repository helper:

```bash
bun run build
bun scripts/mcp-debug-extension.ts
```

The helper loads `.output/chrome-mv3` and exposes Chrome DevTools on
`http://127.0.0.1:9222`. Add this entry to the local MCP configuration:

```json
{
  "chrome-devtools": {
    "command": "npx",
    "args": [
      "-y",
      "chrome-devtools-mcp@latest",
      "--browser-url=http://127.0.0.1:9222"
    ],
    "env": {}
  }
}
```

There is no global install; `npx -y` downloads the current
`chrome-devtools-mcp` package when the client starts. Enable Developer mode in
`chrome://extensions` on the first launch if Chrome requests it.

#### Firefox

Mozilla's official server is installed on demand with `npx`. Build the Firefox
bundle first when testing the extension itself:

```bash
bun run build:firefox
```

Add this entry to the local MCP configuration:

```json
{
  "firefox-devtools": {
    "command": "npx",
    "args": [
      "-y",
      "@mozilla/firefox-devtools-mcp@latest",
      "--tool-preset",
      "developer",
      "--start-url",
      "about:blank",
      "--profile-path",
      ".wxt/firefox-mcp-profile"
    ],
    "env": {
      "START_URL": "about:blank"
    }
  }
}
```

Use the dedicated `.wxt/firefox-mcp-profile` only; never point MCP at a normal
Firefox profile containing cookies, sessions, or saved credentials. For
repeatable extension validation, run `bun run test:e2e:firefox` separately.
See [docs/firefox-devtools-mcp.md](docs/firefox-devtools-mcp.md) for
`--connect-existing` and extension-debugging limitations.

#### Safari

Apple's official Safari MCP server is built into Safari 27 and later and Safari
Technology Preview 247 and later. It requires macOS; there is no npm package to
install. Enable these settings first:

1. Safari → Settings → Advanced → **Show features for web developers**.
2. Safari → Settings → Developer → **Allow remote automation and external
   agents**.

Add this entry to the local MCP configuration:

```json
{
  "safari-devtools": {
    "command": "/usr/bin/safaridriver",
    "args": ["--mcp"],
    "env": {}
  }
}
```

For Safari Technology Preview, replace the command with
`/Applications/Safari Technology Preview.app/Contents/MacOS/safaridriver`.
Build the Safari bundle with `bun run build:safari` when validating the
extension, and use `bun run test:e2e:webkit` for the separate Playwright WebKit
engine smoke test. See [docs/safari-devtools-mcp.md](docs/safari-devtools-mcp.md)
for the full setup and official Apple/WebKit references.

## Development Workflow

### Making Changes

1. Make your changes following the project structure and coding standards
2. If needed, format only the files you changed:
   ```bash
   bun x biome format --write path/to/changed-file
   ```
3. Run the verification commands:
   ```bash
   bun run typecheck          # Svelte and TypeScript checks
   bun run check              # Biome lint + format check
   bun run test               # unit and integration tests
   bun run audit              # repository gates; reports every failing gate
   ```
4. Build the affected browser target; before submitting browser-shared changes, build all targets:
   ```bash
   bun run build:all          # Chrome, Firefox, and Safari build targets
   ```
5. Run the browser target you are working on:
   ```bash
   bun run dev                # Chrome dev server (auto-reload). Firefox: `bun run dev:firefox`
   ```

`bun run build` builds **Chrome only**. The production build matrix is Chrome, Firefox, and Safari; a WebKit Playwright run is an engine smoke test and does not replace testing the Safari extension build. When changing browser APIs, permissions, manifest configuration, or content-script behavior, validate each affected target and report any target that could not be exercised.

### Commit Messages

Use clear and descriptive commit messages:
- `feat: add OTP auto-detection feature`
- `fix: resolve email rendering issue`
- `docs: update README installation instructions`
- `style: format code with Biome`

### Pull Request Process

1. Push your changes to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
2. Create a pull request to the `main` branch (not `master`)
3. Ensure your PR passes all CI checks:
   - Biome (`bun run check`)
   - TypeScript (`bun run typecheck`)
   - Unit/integration tests (`bun run test`)
   - Repository gates (`bun run audit`)
   - Build verification (`bun run build:all` in CI)
4. Provide a clear description of your changes
5. Link related issues if applicable

## Coding Standards

### Code Style
- Use Biome for code formatting and linting (`bun run check` / `bun run format`)
- Follow the existing code structure
- Use TypeScript for type safety
- Keep functions small and focused
- Add comments for complex logic
- Prefer `Bun.*` in `scripts/*` (Bun-native) and `wxt/browser` + Web APIs in `src/` (extension runtime - neither Node nor Bun exists there). `wxt.config.ts` is the exception: it runs via `jiti` (Node) even under `bun x wxt`, so it uses `Bun.file ?? readFileSync` fallback.

### Browser API Portability (WXT)

Use `import { browser } from 'wxt/browser'` as the default entry point for extension APIs, including APIs that are specific to Chrome, Firefox, or Safari when WXT's types expose them. Do not use `chrome.*` or `globalThis.chrome` merely because an API is Chrome-specific: WXT's `browser` export selects the native `browser` or `chrome` object at runtime. WXT does not implement every API or make browser-exclusive APIs available on other browsers; an API can be typed and still be `undefined` in a browser that does not support it. See [WXT's extension API guide](https://wxt.dev/guide/essentials/extension-apis).

Browser-specific access or workarounds are appropriate only when there is a concrete reason, such as:

- The API exists only in the target browser (for example, Chrome's `sidePanel` or `offscreen` APIs).
- The installed WXT type declarations omit or misrepresent an API, especially a Firefox- or Safari-specific API. Prefer augmenting the `Browser` type or adding a narrow local type over switching to a raw browser global solely to satisfy TypeScript.
- A documented WXT limitation or version-specific runtime issue requires a native-global workaround.

For each browser-specific API or workaround:

1. Add a nearby comment naming the affected browser(s), the WXT limitation or API availability reason, and the fallback or intended behavior elsewhere.
2. Feature-detect the API at runtime (`browser.someApi?.someMethod`) and handle unsupported browsers or missing permissions without breaking unrelated features.
3. Keep permissions and manifest entries scoped to the build targets that need them. Verify the relevant Chrome, Firefox, or Safari build when changing target-specific configuration.

Do not describe a browser-only feature as a WXT limitation when WXT already exposes the API. In particular, WXT's `browser` export is a cross-browser alias, not a per-method polyfill; distinguish missing type support from missing runtime support.

#### Current project browser bias (verified)

Chrome is the currently published/default build target. Firefox and Safari builds are maintained, but some code and developer tooling are Chrome-first. This is the current inventory to keep in mind when changing browser APIs; it is not a claim that every browser has feature parity:

| Target / area | Current browser-specific use | Classification |
|---|---|---|
| Chrome | `browser.offscreen` for MV3 notification audio, with the `offscreen` permission added only to Chrome builds; optional `sidePanel`; `management.getSelf().installType`; callback `runtime.lastError`. | `offscreen` and `sidePanel` are Chrome capabilities. WXT exposes these APIs in the current type surface but cannot provide them in browsers that lack them. Raw `globalThis.chrome` checks around side-panel setup and install-type display are present, but are not evidence of a WXT API gap by themselves. |
| Firefox | Direct Web Audio in the document-based background context; special handling for `notifications.getPermissionLevel() === 'unspecified'`; Firefox notification settings URL. A `storage.session` → local fallback exists for Firefox before 115. | Runtime compatibility branches. The configured Firefox minimum is 115, so the pre-115 fallback is defensive for versions below the supported floor. |
| Safari / WebKit | Prefixed `webkitAudioContext` and `webkitSpeechRecognition` fallbacks, plus recognition of the `safari-web-extension://` URL scheme. | Web-platform compatibility and URL handling; no Safari-only WebExtension API path was found in the current source scan. |
| WebMCP | Page-world code checks `document.modelContext` / `navigator.modelContext` and skips registration when unavailable; the current diagnostic mentions Chrome's testing flag. | Experimental page API, not a WXT extension API. Keep it optional and do not treat its absence as a failure of normal extension features. |
| Developer tooling | The default build and much of the E2E / visual tooling use Chrome (`chrome.storage`, `chrome-extension://`, and a Chrome executable). Dedicated Firefox and WebKit build/test paths also exist. | Tooling is Chrome-biased; a Chrome pass alone does not validate Firefox or Safari behavior. |

Known compatibility gap: `openNotificationSettingsPage()` branches for Firefox, then sends every other browser-including Safari-to a `chrome://settings/...` URL. It catches a blocked navigation and returns `false`, but has no Safari-specific destination. When changing this flow, add a Safari path or preserve the explicit failure/manual-instructions behavior rather than assuming the Chrome URL works there.

The entrypoint bootstraps currently assign the same native API object to both `window.browser` and `window.chrome`; this is a compatibility alias, not two independent implementations. Likewise, tests and visual scripts that call `chrome.*` are Chrome harness code, not proof that shipped runtime code needs the raw Chrome global. Re-check the installed WXT implementation and types before adding a vendor-global workaround, and keep this inventory updated when browser-specific paths change.

### File Organization
- `src/entrypoints/` - extension contexts: popup, side panel, full app, background worker, and content scripts.
- `src/features/` - domain workflows and business logic.
- `src/ui/` - page views, layout blocks, overlays, and reusable components.
- `src/utils/` - shared platform, storage, security, localization, and UI helpers.
- `src/config/providers.jsonc` - provider behavior and fetch configuration.
- `src/locales/` - translation sources; `en.json` defines the canonical key structure.
- `tests/` - unit, integration, browser E2E, and visual checks.
- `scripts/` - repository checks, generators, packaging, and browser tooling.
- `docs/` - contributor and technical references; `docs-site/` is the separate user-facing documentation site. `audit/` contains audit material, not the contributor documentation index.

See [Architecture](docs/ARCHITECTURE.md) for the domain-by-domain code map rather than relying on this short directory index.

### Svelte Best Practices
- Use Svelte 5 runes (`$state`, `$derived`, `$props`, `$effect`)
- Keep components small and reusable
- Use TypeScript with Svelte components
- Follow accessibility guidelines (use ARIA attributes, semantic HTML)

## Testing

For code changes, run the checks listed in [Development Workflow](#development-workflow). At minimum, run the relevant unit tests and build the affected browser target. Before submitting browser-shared changes, use `bun run build:all` to build Chrome, Firefox, and Safari targets.

Browser E2E coverage is separate from build coverage:

- Chromium: `bun run test:e2e`
- Firefox: `bun run test:e2e:firefox`
- WebKit engine: `bun run test:e2e:webkit` - this is not a Safari extension runtime test.

Manual testing should use the actual browser and extension surface affected by the change. A successful build or WebKit smoke test alone does not establish cross-browser behavior.

## Reporting Issues

When reporting issues, please include:
- Clear description of the problem
- Steps to reproduce
- Expected behavior
- Actual behavior
- Browser version and OS
- Screenshots if applicable

## Feature Requests

For feature requests:
- Describe the feature clearly
- Explain the use case
- Consider how it fits the product model in [Product Context](docs/PRODUCT_CONTEXT.md)
- Label proposed behavior as **Proposed**; describe it without a delivery timeline unless one is requested.
- Be open to discussion

## Questions

For questions about the project:
- Check existing documentation
- Search existing issues
- Create a new issue with the "question" label

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
