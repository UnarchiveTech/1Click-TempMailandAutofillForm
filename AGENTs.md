# AGENTs

This document contains information about AI agents used in this project.

## Overview

Documentation about agent configurations, behaviors, and integration patterns.

Before changing product behavior or adding a feature, read [Product Context](docs/PRODUCT_CONTEXT.md) for the extension's purpose, core concepts, and product boundaries.

## Development Guidelines

### 1. Entrypoint Svelte File Changes

When making changes to entrypoint Svelte files in the `src/entrypoints/` directory, follow this order:

1. **First choice:** Make changes in `popup.svelte`
2. **Then:** Apply the same changes to `sidepanel.svelte`
3. **Finally:** Apply the same changes to `app.svelte`

This ensures consistency across all entrypoints (Popup, Sidepanel, and App views). All three entrypoints share similar structure and functionality, so changes must be reflected in all files to maintain feature parity.

### 2. JSON-Driven Mail Provider Configuration

All mail provider logic must be JSON-driven using `src/config/providers.jsonc`. Do not hardcode provider-specific logic in the code. Instead:

- Read provider configuration from `providers.jsonc`
- Use `loadProviderConfig(provider)` to get provider settings
- Check configuration flags like `customEmail.supported`, `expiry.renewable`, etc.
- All provider-specific behaviors should be controlled via JSON configuration

### 3. Translation Updates

When making changes that affect user-facing text or labels, update the translation files:

- Translation files are located in `src/locales/` (e.g., `en.json`, `ar.json`, etc.)
- `en.json` is the **source of truth** - all other locales must mirror its exact key structure
- Add new translation keys for any new UI text
- Update existing keys if text changes
- Ensure all supported languages receive the same updates: `ar`, `de`, `es`, `fr`, `ja`, `zh`, `th`
- If an interpolation variable (e.g. `{n}`, `{count}`) is used in `en.json`, it **must** appear in every other locale for that same key

#### Localization Policy - What Must Be Localized vs What Stays English (Mandatory)

`en.json` is the canonical *source* language, but "English by default" applies to
**developer-facing** text only. Anything a user can see, hear, or read -
screen-reader text included - is user-facing and must be routed through a key,
even when English is the value most locales end up using.

| Must be localized (route through `t()` / `tSync()` / `$t()`) | Stays English (do not add a key) |
|--------------------------------------------------------------|----------------------------------|
| Visible UI text: labels, buttons, headings, empty states, hints - e.g. the preferred-domain `<label>` in `CreateAddressDialog.svelte` (`disposable.preferredDomain`) | Diagnostic logs: `logError` / `logWarn` / `logDebug` / `console.*` - e.g. `safeStorageSet: Write blocked due to storage quota limits.` |
| Toasts (`toastStore.*`, `showToast`) - e.g. `toasts.operationFailed` in `OrganizeView.svelte` | Error objects whose message is only ever logged, in background/utility code - e.g. `logError('Failed to copy email', …)`. Error prose in `src/features/**` is **not** exempt: the gate flags it, because feature errors reach toasts and dialogs - return a code from there instead |
| Dialogs, confirm prompts and destructive-action copy - e.g. `backup.importTitle` | Machine error *codes*: `invalid-current-password`, `locked-out` (`SettingsView.svelte` vault flow), `duplicate_live` (`address-actions.ts`) - the code is a protocol token; only its rendering is localized |
| Desktop notifications - `createBrowserNotification({ title, message })` is 100% `tSync` today (`email-storage.ts`, `notifications.*`) | Page-content matching corpora: `form-detector.ts` phrase lists, `promotional-email-detector.ts`, `iconMapping.ts` - they match English text *in the host page*; translating them is a functional regression |
| Accessibility text: `aria-label` / `title` / `alt` / `placeholder` - e.g. `title={$t('identities.exportCsv')}` in `IdentitiesView.svelte` | Technical tokens: user-agent strings (`user-agent.ts`, e.g. `MacIntel`), MIME types, header names, provider ids/URLs, and brand display names (`providers.jsonc`, e.g. "Gmail") |
| Content-script UI injected into host pages (OTP wait panel, autofill buttons, tooltips) - `autofill-buttons.ts` is fully keyed, `dom/tooltip.ts` receives already-translated text | Demo/content fixtures that emulate received mail - `demo-mode.ts` sample email bodies |
| User-visible error/status detail, including interpolated values - e.g. `preferences.aiRescanFailed` with `values: { … }` | The `default:` option of `$t(key, { default })` - a fallback *message* for a missing key, never the shipped string and never a key name (a counted message selects its key by count; see the plural rule below) |
| Browser surfaces outside the app shell: extension `name` / `description` / `commands.*.description` in `wxt.config.ts` (shown on `chrome://extensions`, the shortcuts page and the store listing) and entrypoint HTML `<title>` | - |
| Unit tokens (byte units) - see the unit-token rule below | - |

**Unit tokens are routable, not necessarily translated.** Byte units use
`preferences.storage{Bytes,Kilobytes,Megabytes,Gigabytes}`: `fr` renders
`o / Ko / Mo / Go` and `ar` renders `بايت / كيلوبايت / ميجابايت`, while the other
five locales keep the English value verbatim. "KB" being understood almost
everywhere is fine - the requirement is that the token comes from a key, so a
locale that *does* differ typographically can, and so two call sites cannot drift
apart on rounding. Never inline a unit or a formatted size ("4.2 MB") in a view:
a string spelled at the call site is invisible to every gate. One formatter,
`formatBytes` in `@/utils/storage/storageMonitor.js`, is the only byte formatter.

**Counted messages pick their key by the COUNT.** Every counted string ships as a pair - `<key>` for exactly one, `<key>Plural` for every other count - and the choice is made at the call site through `pluralMessage($t, { oneKey, otherKey }, n, extraValues)` (`src/utils/i18n/i18n-plural.ts`), never through `$t(base, { default: basePlural })`. `svelte-i18n` reads `default` **only when the key is missing**, so a dictionary that carries the base key always rendered the singular: seven call sites shipped "5 address" in all eight locales, and no gate could see it, because both keys existed, both were referenced, and the plural was unreachable text. Both halves stay named as literals in the pair, which is what keeps every scanner able to see them: `check-locale-key-references` existence-checks them (the `oneKey` / `otherKey` property names are what put them in a `*Key:` position), and `bun run check-plural-keys` (audit + CI) proves each pair is static, complete, distinct, `<oneKey>Plural`-spelled and slot-identical on both sides, and that no `<key>Plural` in `en.json` is left unpaired - while `tests/unit/utils/i18n-plural.test.ts` renders every pair through the real dictionaries in all eight locales, so a plural that reaches no count fails the suite rather than shipping.

**Errors: return codes, render keys.** Background handlers that answer
`{ success: false, error: '<English prose>' }` force the UI to either show English
or discard the detail. Return a stable code and map it through
`ERROR_CODE_TO_TRANSLATION_KEY` / `getTranslationKeyForErrorCode()`
(`src/utils/errors.ts`) - the mechanism exists for exactly this and must be used
rather than re-invented per handler.

**Exception - agent-facing WebMCP tool payloads.** The `webmcpTool` handler
(`message-handler.ts`) and `src/entrypoints/background/webmcp/tools.ts` answer in
English prose **by design**: `webmcp-bridge.content.ts` forwards those payloads to
the page's model context, where an agent reads them - no extension UI ever renders
them - so the English detail *is* the product there (the dispatch comment on
`webmcpTool` is the authority). Do not localize them to `errors.*` codes; and do
not pass an `errors.*` UI code through into that payload either - map it to
English at the boundary (as `burn_inbox`'s delete failure does).

**A key and its slot values are ONE value (`LocalizedMessage`).** A key that
declares a `{slot}` is meaningless without its values, so a producer returns
`localizedMessage('errors.webdavUploadStatus', { status })` and a consumer renders
that whole value with `translateResultMessage(res.error, $t)`. There is no
separate `params` argument to drop, which is the point: the compiler rejects
`localizedMessage('errors.webdavUploadStatus')` (`TS2554`, proven by the
type-level assertions in `tests/unit/utils/translate-result-message.test.ts`).
`SLOT_BEARING_ERROR_KEYS` lists the slot-bearing keys - add a new one there when
`en.json` gains it (a test fails until you do, and listing it is what makes the
values mandatory), and never hand the key to a consumer as a bare string.
`BaseExtensionError` carries the same pair as `translationKey` +
`translationValues`; `toResultError(err, fallbackKey)` resolves them for a
payload. The bare-string arm of `translateResultMessage` exists only for keys
that crossed the messaging boundary, where no type follows them - that path keeps
the "never render a raw `{slot}`" guard as its runtime belt.

**Anti-patterns to avoid (each observed in this codebase):**

1. **Inverted fallback** - `res.error || $t('webdav.testFailed')` makes the
   localized string unreachable, because the raw string is present in exactly the
   failure case that matters. Prefer the localized generic message plus a logged
   detail; never let raw prose win by ordering.
2. **Raw keys rendered to users** - `t()` / `tSync()` return the key itself on a
   miss (`i18n-shared.js`). A guessed section path (`inbox.preferredDomain` where
   the real key is `disposable.preferredDomain`) prints `inbox.preferredDomain` on
   screen. A literal key must exist in `en.json` at that exact path - verify, don't
   assume.
3. **Interpolating raw error prose into a localized sentence** -
   `$t('preferences.aiRescanFailed', { values: { error: res?.error || 'unknown' } })`
   leaks both the English payload and the hardcoded `'unknown'`.
4. **Localizing only the `||` fallback of an expression** (same failure as #1).
5. **Localizing an error whose string is also a control-flow token** - compare the
   value against a code, translate only at render time.

**What the gates enforce - and what they miss.** Hardcoded user-facing English is
policed by `bun run check-hardcoded-english`, part of `bun run audit` (the
pre-commit *and* CI gate). It scans four layers:

| Layer | Catches |
|-------|---------|
| `.svelte` | literal `placeholder` / `aria-label` / `ariaLabel` / `title` / `label` / `alt`, `toastStore.*('literal')`, `prompt` / `confirm` / `alert`, `$t('…') || 'Literal'`, visible text nodes, user-facing option-property literals |
| `entrypoints/background` | notification, context-menu, toolbar-tooltip and omnibox copy |
| `entrypoints/content` | DOM-assigned copy in the injected UI |
| `features` | sentence-cased error/result strings (`throw new Error('…')`, `{ error: '…' }`, `|| '…'`) that surface in toasts and dialogs |

**Code → key existence is now gated too.** `bun run check-locale-key-references`
(pre-commit + audit + CI) checks every literal sitting in a *translation-key
position* - `$t`/`t`/`tSync`/`translate`/`get(t)` arguments,
`translateResultMessage`, the fallback-key argument of `renderResultError` /
`localizedErrorMessageOrFallback`, `*Key:` and `default:` properties, `*KEY` /
`*KEYS` string-record map values, a key-shaped literal **returned** from a helper
(`$t(statusPillLabel(pill))` - the call is in a key position, the literal is not,
so `t()` would render raw `address.live` text on a rename), and the
`ERROR_CODE_TO_TRANSLATION_KEY` map - against `en.json` at that
exact path (anti-pattern 2). It is a ratchet: `scripts/baselines/locale-key.txt` lists the
pre-existing offenders as `<path><TAB><key>` rows, a NEW finding fails the build,
and a row whose call site was fixed also fails until it is removed with
`bun scripts/check-locale-key-references.ts --update`. Never add a row to silence
a new key - fix the call site, or add the key to `en.json` and every locale.

Still **not** covered - for these, you are the gate:

- **Payload-preferred ordering**: `res.error || $t('…')` is the inverse of the
  pattern the check looks for, so the raw English silently wins (anti-pattern 1).
- **Background `{ success: false, error: '…' }` payloads** - the background scan
  targets notification/menu/tooltip/omnibox copy, not response payloads.
- **Entrypoint HTML `<title>`** - never substituted (see *Browser surfaces*
  below), so it is assigned at runtime instead. The manifest fields *are* covered
  by `check-locale-messages`, but routing a **new** manifest string through
  `src/locales` + the `MESSAGE_SOURCES` map is still on you.

**Browser surfaces are generated from `src/locales`.** Strings the browser
renders itself cannot go through `$t()` at runtime: they are written to
`public/_locales/<code>/messages.json` and referenced from `wxt.config.ts` as
`__MSG_<key>__`. Those dictionaries are a **derived artifact - never hand-edit
them.** Each `__MSG_` key maps to a `src/locales` key (`MESSAGE_SOURCES` in
`scripts/generate-locale-messages.ts`): `extName` is
`actionTitle.tempMailAndAutofill`, i.e. the same string `AppLayout` puts in the
window title and the toolbar tooltip renders, so the three cannot disagree; the
rest live in the `manifest.*` namespace.

**Store-listing metadata is generated the same way.** The store dashboard's
long description (`store.detail`) and the per-screenshot captions
(`store.caption.*`) also live in `src/locales`; the same generator derives
`store-listing/<code>.json` from them. There is no WebExtensions plumbing for
these - the release agent reads the per-locale file when filling the store
dashboard instead of translators hand-maintaining eight copies there, where
nothing can check completeness. The caption source is `store.caption.<slug>`
with the slug equal to the screenshot file name, and the generator maps each
caption to a real file in `docs-site/public/screenshots/` (the docs e2e
screenshot pipeline emits `<slug>-light.png` / `<slug>-dark.png`; the store
listing ships the light variant, `STORE_SCREENSHOT_VARIANT` in the generator).
It also enforces the store dashboards' length limits (16 000 chars for the
detail, 100 per caption) so an over-long translation fails the audit instead of
being silently truncated at upload. To add or reorder a store screenshot: add
the `store.caption.<slug>` key to `en.json` + every locale, add the slug →
`store.caption.<slug>` entry to `STORE_SOURCES` in the generator (curated
listing order), and re-run `bun run generate-locale-messages` - the audit test
fails if the `<slug>-light.png` file does not exist.

Adding a browser-surface string therefore means:

1. Add the key to `src/locales/en.json` **and every locale** (exactly as for any
   other user-facing string) - or reuse an existing key such as
   `actionTitle.tempMailAndAutofill`.
2. Add its `__MSG_<key>__` ↔ `src/locales` mapping in
   `scripts/generate-locale-messages.ts`, and reference the placeholder from
   `wxt.config.ts`.
3. Run `bun run generate-locale-messages`. `bun run check-locale-messages`
   (pre-commit + CI) then fails whenever the generated artifacts (both the
   `_locales` dictionaries and `store-listing/*.json`) are stale or a
   `__MSG_*__` placeholder referenced by the manifest has no source.

`zh_CN` is Chrome's code for Simplified Chinese (`zh` in `src/locales`); the
generator owns that mapping. Because the strings live in `src/locales`,
`check-translations` already proves every locale carries them and
`mirror-locales` fills new locales and keys automatically.

Two platform limits to accept:

- These strings follow the **browser UI language**, while the in-app UI follows
  the user's in-app preference - `browser.i18n` cannot be switched at runtime.
- `__MSG_*__` is substituted in the manifest and CSS only, **never in HTML**.
  Entrypoint titles are therefore assigned at runtime by `AppLayout`
  (`document.title = $t('actionTitle.tempMailAndAutofill')`). The static
  `<title>` is a pre-hydration fallback - except in `popup/index.html`, where it
  must stay `__MSG_extName__` because WXT lifts that value into
  `action.default_title`, which Chrome *does* substitute.

There is **no path-level allowlist** for hardcoded English: `.hardcoded-english-ignore`
is gone, and `bun run check-hardcoded-english` scans every file - `src/features/**`
included, which now reports zero findings. "Every file" means every file
`.gitignore` does not cover, resolved through one shared lister for all gates
(§16) - so an ignored file is invisible to this gate and to `bun run check` alike. The script keeps a *value* allowlist for
holds that are intentionally English in every locale (brand names, keycaps, format
badges, abbreviations, search-pill syntax, shell commands, examples); a whole file
is never excused. Migrate English to locale keys (UI text) or stable codes the UI
maps (feature errors) - adding a suppression file only resurrects the bypass that
removing it closed.

#### Translation Completeness Tooling

An automated checker enforces the above rules at multiple levels:

| Layer | Command | When it runs |
|-------|---------|--------------|
| **Pre-commit hook** | `bun run check-translations` | On every `git commit` via lefthook |
| **Unit test** | `bun test` | Locally and in CI - file: `tests/unit/utils/i18n-check.test.ts` |
| **CI step** | `Check translation completeness` | On every PR via `pr-validation.yml` |
| **Manual** | `bun run check-translations` | Run anytime to audit locale files |

**Adding a new translation key** - workflow:
1. Add the key and English value to `src/locales/en.json`
2. Add the translated value to every other locale file in the same section
3. Run `bun run check-translations` to confirm no keys are missing
4. Commit - the pre-commit hook will re-verify automatically

**What the checker detects:**
- Keys present in `en.json` but missing from another locale (❌ error - blocks CI)
- Keys present in a locale but absent from `en.json` (⚠️ warning - does not block CI)
- Interpolation variables present in an English string but missing from a translation (❌ error)

#### Terminology Drift Tooling (one concept = one term per locale)

Completeness checks prove every key exists with matching variables; they cannot see that two keys
name the SAME concept and a locale renders it two different ways. That is exactly how real
mistranslations shipped (docs/dedupe-proposal.md): ar/th rendered the command palette as
"محفز الأوامر" / "ปาลเมตรคำสั่ง" while the same locale's `keyboardShortcuts.fixedCommandPalette`
carried the established term, and de used "Erscheinung" in the settings nav where
`settings.appearance` already said "Darstellung".

`bun run check-terminology-drift` (pre-commit via `bun run audit` + CI +
`tests/unit/scripts/check-terminology-drift.test.ts`) closes this with **curated groups** in
`scripts/check-terminology-drift.ts`: each `TERMINOLOGY_GROUPS` entry is an explicit, reviewed
assertion that its members name one concept, so every locale must render them with one term.
Two member modes:

| Mode | Meaning |
|------|---------|
| `exact` | every exact member's value must be IDENTICAL within a locale (the bare keys - a dialog title, a nav section, a shortcut-row label) |
| `contains` | the member is a composite (an "Open X (Alt)" action, a combined shortcut-list row) whose text must CONTAIN the term - catches the English term embedded inside an otherwise-translated string |

Rules:
- Recall is deliberately manual - "do these keys mean the same thing" is a translation judgment a
  script cannot make. When you spot a drifting pair, add a group to `TERMINOLOGY_GROUPS` (with the
  finding in `rationale`) and a regression sentinel in
  `tests/unit/scripts/check-terminology-drift.test.ts`.
- The groups validate themselves against `en.json` (a renamed key fails the gate's config check,
  not silently disappears), and `en` itself is checked: the source must satisfy its own assertions.
- `canonical` names the member whose value defines the term, so a finding points at the true
  outlier (de's regression reads "sectionAppearance should equal Darstellung", not the reverse).
- A key missing from a non-English locale is `check-translations`' finding, not this gate's - the
  two run adjacently in the audit chain, so no gap is left between them.

#### Background / Content-Script Translations (minimal locale sets)

The MV3 service worker is bundled as a single self-contained file, so any
locale dictionary it imports - even via `import()` - is inlined into
`background.js`. The full UI dictionaries (all 2,491 keys × 8 languages,
≈ 1,323 KiB (1,355,253 bytes) must therefore never enter the background bundle:

| Context | Module | Dictionaries |
|---------|--------|--------------|
| UI / utilities | `@/utils/i18n/i18n-utils.js` | full `src/locales/*.json` |
| Background worker | `@/utils/i18n/i18n-background.js` | minimal `src/locales/background/*.json` |
| Content scripts | `@/utils/i18n/content-i18n.js` | background `translate` handler (no bundled dicts) |

Both i18n modules share the same engine (`@/utils/i18n/i18n-shared.js`) and expose
identical APIs (`t`, `tSync`, `preloadTranslations`, …) - switching contexts is
just a one-line import change. `scripts/generate-background-locales.ts`
generates the minimal sets by scanning the background + content graphs for
translation calls, and `bun run check-background-locales` (pre-commit + CI)
fails if:

- `src/locales/background/*.json` is out of date, or
- any background/content-graph file imports `@/utils/i18n/i18n-utils.js`.

**When you add a translation call to background or content code:**
1. Add the key to `src/locales/en.json` + every locale (as above).
2. Run `bun run generate-background-locales` to update the minimal sets.
3. The pre-commit check re-verifies both steps.

**Notes:**
- `t()`/`tSync()` keys in background/content code must be string literals -
  the generator rejects dynamic keys (`${...}`) so nothing can silently
  regress to a raw key.
- Keys consumed indirectly (e.g. `errors.*` via the error-code map in
  `src/utils/errors.ts`, `translationKey:` options) are collected automatically.

## Common Patterns and Best Practices

### Storage Key Handling

When working with dynamic storage keys:

```typescript
// ✅ Correct - use dynamic key to access result
const storageKey = `selectedInstance_${providerId}` as const;
const result = await browser.storage.local.get([storageKey as string]) as Record<string, string>;
const selectedInstance = result[storageKey];

// ❌ Incorrect - destructuring with dynamic key doesn't work
const { [storageKey]: selectedInstance } = await browser.storage.local.get([storageKey as string]);
```

### Svelte 5 Reactivity Patterns

- **Derived values in closures:** In Svelte 5, closures over `$derived` values capture a snapshot at closure creation time, not a live reactive reference. Pass values directly instead of relying on closures.
- **Functional updates:** Use functional update patterns for setters to preserve computed fields when updating specific properties.

```typescript
// ✅ Correct - functional update preserves computed fields
setAllInboxes((prev) => prev.map(acc => acc.id === account.id ? { ...acc, autoExtend: newValue } : acc));

// ❌ Incorrect - passes raw storage objects without computed fields
setAllInboxes(updated);
```

### Event Handler Best Practices

Always use `e.stopPropagation()` on button click handlers to prevent event bubbling to parent elements:

```typescript
onclick={(e) => {
  e.stopPropagation();
  onToggleAutoExtend(account);
}}
```

### Type Safety with Functional Updates

When implementing setters that support both direct values and functional updates:

```typescript
setAllInboxes: (v) => {
  allInboxes = typeof v === 'function' ? (v as (prev: Account[]) => Account[])(allInboxes) : v;
}
```

### Skip Email Selection Pattern

When reloading inboxes after operations that shouldn't change the selected email (like toggle operations):

```typescript
await setters.loadInboxes(true); // skipEmailSelection = true
```

### Build Verification

Always run these **four** commands after substantive changes (in order):

1. `bun run typecheck`
2. `bun run format`
3. `bun run check`  (Biome)
4. `bun run build`

Also run `bun run check-translations` when any locale key changes.

#### Finding Bun on Windows

On Windows, `bun` may be installed even when the current PowerShell process
does not inherit the user's PATH (for example, inside a sandboxed coding
session). If `bun` is not recognized, do not immediately report it as missing.
Look for a usable existing installation first, in this order:

1. `Get-Command bun -ErrorAction SilentlyContinue` and `where.exe bun`.
2. Common per-user and package-manager paths, including
   `$env:USERPROFILE\.bun\bin\bun.exe`,
   `$env:LOCALAPPDATA\Programs\Bun\bun.exe`, WinGet Links/Packages, and
   Scoop's `apps\bun\current\bun.exe`.
3. Runtime/task-specific tool directories such as `C:\tmp` and `C:\tools`
   when the standard paths do not contain it. Keep recursive searches scoped
   to likely install roots rather than scanning the whole drive by default.
4. Invoke a discovered executable by its absolute path from PowerShell, for
   example `& 'C:\path\to\bun.exe' run typecheck`. If several checks are
   needed, store that path in a task-specific variable such as `$bunExe` and
   use `& $bunExe ...`; do not modify the user's persistent PATH.

If the executable exists but cannot be launched, investigate the sandbox or
execution permission as a separate issue.

**Sandbox-only installation is allowed.** If no existing copy is usable inside
the sandbox, agents may download an official Bun release and extract its portable
executable into a sandbox-writable, task-local temporary directory or a gitignored
workspace tools directory. Choose a version compatible with the project's
toolchain and invoke it by absolute path. This authorization covers sandbox-local
installation only: do not install globally, overwrite the user's existing Bun,
or change persistent PATH or system settings. Existing network and sandbox
permission requirements still apply. Report Bun as unavailable only after the
discovery steps and permitted sandbox-local installation have been attempted,
or explain the specific restriction that prevents installation.

### Decorative Pseudo-Element Pointer Events

Any `::before`/`::after` used purely for decoration - a 1px divider line, a specular glass rim, a glow or gradient wash - MUST declare `pointer-events: none`, because a positioned (`absolute`/`fixed`) pseudo-element paints above the host's in-flow (static) children, so a full-cover decorative pseudo silently swallows every click meant for interactive siblings underneath it (e.g. the split-pane divider's `::before` once ate pointer events along its whole centerline, making the resize handle un-grabbable at the exact center). The pseudo is never an input target - pseudo-elements cannot receive events, they always hit-test to their originating element - so `pointer-events: none` is free; inline glyphs that belong to an element's own box (like the EmailBody ↗ marker) and pseudos on interactive hosts themselves need nothing. `bun run check-pseudo-overlays` (pre-commit + audit) enforces this across Svelte `<style>` blocks, CSS files, and CSS injected as TS string literals.

### 4. Overlay / portal z-index scale (mandatory)

Single source of truth: `src/utils/ui/portal-layers.ts` (`PORTAL_Z`, plus
`CONTENT_Z` for the injected page UI, which is a separate document).

| Layer | z-index | Rule |
|-------|--------:|------|
| App + view chrome (nav island, sticky view headers) | **30** | Above content, below every overlay |
| Account selector overlay | **40** | Never raise above dialogs |
| Inline menus / in-pane overlays | **50** | Above chrome, below nav menus |
| Nav / more menus | ~100 | Below dialogs |
| Account ⋮ menus | 110 | Below dialogs |
| Toasts | **9000** | Below modal dialogs |
| Confirm / Tag / Export dialogs | **10000** | Body-portaled |
| Product tour | 10050 | Above dialogs |
| App tooltips | 100000 | Highest |

**Rules:**
- Confirm/Tag/any blocking dialog MUST portal to `document.body` and use `PORTAL_Z.dialog` (or `z-[10000]`).
- Do **not** invent ad-hoc z-index values on overlays. A number written at a call
  site cannot be reordered with the rest of the app: it at or above `PORTAL_Z.chrome`
  MUST name a member (`PORTAL_Z_CLASS.*`), and a flyout/menu MUST never carry a local
  value - `bun run audit-z-layers --strict` (pre-commit + `audit` + CI) fails both.
  Local literals below chrome (0, 1, 2, 10, 20 - avatar stacks, notches, dividers, a
  portaled dialog's own internals) are fine: they order ONE component's children and
  never compete across the app. The same audit pins the scale's ordering and that
  every `PORTAL_Z_CLASS` fragment matches its layer.
- Document any new portal layer in `portal-layers.ts` before use.

#### A number only works when no ancestor is a stacking context (mandatory)

An overlay nested under a stacking-context ancestor is JAILED: its z-index resolves
*inside* that ancestor, so it can never paint above a SIBLING of it however large the
number. This is how the Settings language selector came to paint behind the floating
nav island while carrying the *higher* layer (`menu` 50 vs `chrome` 30):
`.view-crossfade`, the wrapper around every view, kept a `transform` from its entry
animation, and the island is a sibling of the shell.

- **An entry animation declares NO fill mode.** A `both` / `forwards` fill keeps the
  animated properties, and a retained `transform` is a permanent stacking context.
  Removing `transform` from the final keyframe is NOT enough - measured on the built
  extension, Chrome kept `matrix(1, 0, 0, 1, 0, 0)` on `.view-crossfade`: the
  interpolated end value, not the `none` keyword, and an identity matrix orders and
  contains exactly like a real one. With no fill mode the properties revert to the
  element's own values (opacity 1, transform none) and the animation looks identical
  because every `to` pose here already IS that value. `email-row-exit` is the one
  documented exception (its retained pose is the exit itself) and lives in the
  audit's `EXIT_ANIMATIONS`; a stale exemption fails the audit.
- **A flyout that must beat chrome is BODY-PORTALED** (`portalFlyoutAction`), placed
  `position: fixed` against the viewport, re-placed on scroll (capture) and resize,
  and capped to the space it has. `LanguageMenu.svelte` is the reference: an in-place
  flyout was also clipped by the scroll container it lived in, so the tail of the
  language list was unreachable when the Settings page was short.
- A view's own sticky header may be chrome, but a menu INSIDE one is still jailed by
  that header's `backdrop-filter`; menus that must beat chrome take a portal, never a
  bigger number.
- Proven by `bun scripts/row-selection-shot.ts` (its chrome stage: the shell's
  computed transform is `none` after its entry animation, the live elements carry
  `chrome`/`menu`, and across the band where the menu overlaps the island the pointer
  never resolves to the island's chrome while the band's dominant PIXEL is the menu's
  own `--md-surface`, in `light-standard`, `dark-standard` and RTL) plus
  `tests/unit/scripts/audit-z-layers.test.ts`, which pins every one of those
  verdicts and asserts the repo itself carries no layering finding.

### 5. Debugging & code quality strictness

When fixing bugs or adding features, agents MUST:

1. **Reproduce mentally** - identify the exact state machine (selection, drag, storage key, view).
2. **Prefer root cause** over UI workarounds (e.g. don’t raise z-index to hide stacking traps; portal instead).
3. **No silent `catch {}`** on user-visible paths without a toast, log, or intentional comment (`/* ignore */` only for non-critical).
4. **Typed messaging** - background `type:` strings that the UI depends on must stay consistent; avoid stringly-typed renames without grepping callers.
5. **Multi-select integrity** - any bulk action (tag, archive, delete, export) must apply to **all** selected ids, not only the first.
6. **Locale keys** - never ship UI English-only; add `en.json` + all locales before finishing. The full boundary between user-facing text (must be keyed) and developer-facing text (stays English) is in §3 "Localization Policy".
7. **Entrypoint parity** - popup / sidepanel / app share `AppLayout`; do not fork feature logic per entrypoint.
8. **Svelte 5** - use `$state` / `$derived` / `$props` / `$effect`; no legacy `export let` for new code.
9. **No browser `confirm()` / `alert()`** - use ConfirmDialog / toast.
10. **DOM depth** - avoid pure pass-through wrappers (div/span/components) that add no layout, a11y, events, or state.
11. **Deduplication & Refactoring Completeness** - whenever deduplicating logic into a shared utility or replacing duplicate blocks, agents MUST perform a line-by-line inspection of both the original code and the target utility to verify complete semantic parity and ensure no subtle edge case, condition, or scoping detail (e.g. key scoping, event emission, lock semantics) is missed or regressed.
12. **Extraction Wiring Gate** - an extracted file, component, function, or module MUST NOT be treated as complete, and its original implementation MUST NOT be deleted, until every intended consumer is fully wired to the extracted implementation. Before removal, verify all intended call sites and imports with a global search, confirm the extracted contract preserves the original behavior, and run `bun run typecheck` plus `bun run check`. Unwired or orphaned extraction files must remain available until they are either fully wired or explicitly reverted as part of the same reviewed change.
13. **No Inline Lint Suppressions** - NEVER silence a diagnostic with an inline directive (`biome-ignore`, `svelte-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`). A suppressed diagnostic is invisible to the linter, the zero-warning gate, CI, and reviewers - it is the exact failure mode the strict gates exist to prevent. Fix the root cause instead. `bun run check-suppressions` (pre-commit + audit + CI) ratchets the frozen inventory in `scripts/baselines/suppressions.txt`: any NEW directive or grown count fails the build; counts may only decrease, and after a genuine fix shrink the baseline with `bun scripts/check-suppressions.ts --update`. If suppression is truly unavoidable, add a baseline row in the PR with justification - that is a visible exception, not a bypass.
14. **Restore every module mock** - Bun runs the whole unit suite in ONE process, and `mock.module()` replaces a module in the process-wide registry with no automatic undo. An unrestored mock therefore silently rewrites the world for whichever test file runs next, making the suite's verdict depend on file ORDER rather than on the code: renaming or moving a test file can break tests it never touched (67 files leaked this way before the gate existed). Every test file that calls `mock.module` MUST restore it - conventionally `afterAll(() => { mock.restore(); });` directly under its `bun:test` imports. `bun run check-mock-restore` (pre-commit + audit + CI) fails any file that mocks without restoring. Per-file isolation additionally hands every test file a fresh global object and module registry, so process-wide module state - e.g. the memoized master key in `src/utils/security/crypto.ts` - cannot leak between files either. **It is the `--isolate` FLAG that enforces this, not the bunfig key**: Bun 1.4.2 does NOT honour `[test] isolate = true`, and relying on that key alone is how twelve order-dependent tests in the expiry and email-storage suites came to fail in a full run while passing standalone (the shared registry kept whichever file loaded `notification-permission.ts` FIRST as the `wxt/browser` binding every later file then used, so their `mock.module` fakes were invisible to it and their notification counters stayed at zero). Every runner therefore passes the flag explicitly - the `test`/`test:watch`/`test:coverage` npm scripts, the pre-commit hook and CI (`--parallel` implies it, so `test:parallel` needs nothing) - and `tests/unit/harness/isolation-{a,b}.test.ts` is the guard: two files that each check what they can see of the other's module state and `globalThis` write BEFORE leaving their own mark, so exactly one fails if a runner ever drops the flag, in either run order. The bunfig key is kept only for a Bun that learns to read it. Because isolation makes the run order irrelevant, every test file must be able to pass entirely on its own: never rely on another file's mocks, cached state, or leftover storage.

15. **One lexer for every source scanner** - `scripts/source-lexer.ts` is the ONLY place that decides what counts as code: comment bodies, quoted strings (delimiters included), the static text of a template literal, `${…}` interpolations, regex literals, and the same-line bounding that keeps an apostrophe in Svelte prose (`Don't`) or a `/['"]/` regex from swallowing the rest of the file. A scanner reads a file through it - `stripComments()` (comments blanked, strings intact), `codeOnly()` (syntax only) or `analyzeSource()` (`inCode` / `inString` byte views) - rather than carrying its own comment/string state machine: `check-hardcoded-english`, `check-layer-tokens`, `check-locale-key-references`, `check-message-types`, `check-mock-restore`, `check-plural-keys` and `generate-background-locales` all classify through it today. `tests/unit/scripts/source-lexer.test.ts` fails a scanner that re-declares a comment-state variable, re-implements the classifier, or drops the import - so two gates can no longer disagree about what counts as code in the same file. Adding a scanner means importing the lexer, not writing a second one. (The suppression ratchet is the deliberate exception: its payload *is* the comment text.)

16. **One file-discovery mechanism for every gate** - `scripts/source-files.ts` is the ONLY place that decides which files a scanner looks at, and the rule it enforces is "gitignored ⇒ invisible". Ten scripts used to carry a private `collectSvelteFiles` / `collectFiles` / `walk` with its own skip list - one walked the entire repository, another skipped dotfiles and `node_modules` and `.output` - while `biome.json` sets `vcs.useIgnoreFile: true`, so `bun run check` (the last step of `bun run audit`, and of every pre-commit run) skipped `.gitignore` matches the walkers read anyway. The same scratch file could fail one gate and be invisible to another. The lister takes its file list from `git ls-files --cached --others --exclude-standard` (so ignored directories are never descended into and index entries whose file is gone are dropped), then removes the paths `git check-ignore --no-index` matches: `--no-index` is the point, because without it git shields *tracked* paths from its own rules and a tracked file under an ignored directory (this repo has several, e.g. `audit/*.md`) would read as not-ignored, contradicting biome, which skips it. If git cannot answer, both helpers fail OPEN and everything is scanned - a gate that scans too much is noisy, a gate that scans too little hides the violation. Gates call it rather than walking: `collectSourceFiles({ dirs, extensions, flat })` (repo-relative, sorted, so a finding never depends on filesystem order) or `collectAbsoluteFiles(dir, exts, { flat })`, with `flat` for the `src/locales/*.json` vs `src/locales/background/*.json` collision. Three exceptions are documented in `tests/unit/scripts/source-files.test.ts`, which also ratchets the wiring: every script invoked by `bun run audit` must import the lister, be classified as a named-input reader (checked to contain no walk), or be a justified walker of something not ours (`check-stale-builds` measures `.output/` mtimes; the responsive fitting checks walk browser caches in the user's home). `bun run audit` is `scripts/audit.ts`, and its `AUDIT_GATES` list IS the chain: the runner runs every gate and reports them all (a failing gate no longer stops the run, so one invocation shows every finding), and that same list is what this ratchet resolves - adding a gate to `audit` therefore cannot opt out of the rule by accident.

17. **Every module-level cache names its lifetime** - `bun run check-stale-caches` (pre-commit + audit + CI) flags a container declared at module scope and written after initialization with **no lifetime story**: a `Map`/`Set`/array/object record alive for the lifetime of its context (a service worker that runs for minutes-to-hours, an app tab for days, a content script for the page). Nothing evicts those entries on its own, so they outlive the truth they hold - a provider config captured before the user changed it, an address list from before a delete, a selection registry left behind by a view that was torn down, `cachedHtmlSettings` (which this gate found) still sanitizing with the flags another entrypoint replaced. The gate does not demand the cache be removed - caches are how the app stays usable - it demands each one NAME its lifetime, with at least one of: a **ttl** (entries stamped and compared to a clock: `Date.now()` / `performance.now()` beside `ttl` / `maxAge` / `expiresAt` / `timestamp` / `staleAfter`), an **invalidation path** (`.delete(` / `.clear(` / `delete x[k]` / `.shift()` / `.pop()` / `.splice(` / `x.length = 0`, a whole-container reset, or a `clear*` / `invalidate*` / `purge*` / `evict*` / `reset*` path the owner calls on teardown), a **bound** (`.size >` / `.length >` / `.slice(0,` / a `max*` constant, for a genuinely append-only cache), or **`WeakMap`/`WeakSet`** (keys are held weakly, so entries die with their owner). Evidence is read only from lines that mention the container, in the same file, AFTER its declaration - a clock elsewhere in the file is not a lifetime story for this container. A container never written after initialization is a lookup table (`new Set(['a'])`, a domain list), not a cache, and is not reported; a Svelte file is scanned in its `<script module>` block only, since instance state dies with the component while module state does not. `scripts/check-stale-caches.ts` owns the rules and documents what it cannot see (aliased writes, factory-built containers, property writes on a record, indented declarations, a `clear*` exported only for tests) - read that header before extending it, and import `scripts/source-lexer.ts` / `scripts/source-files.ts` rather than re-deciding what code is or which files to read (rules 15 and 16). The ratchet is `scripts/baselines/stale-caches.txt` (`<path><TAB><container><TAB># why`): a new finding fails, and so does a row whose container later grows evidence - the list may only shrink, and after a genuine fix remove rows with `bun scripts/check-stale-caches.ts --update`. Because a row that is NOT debt - a permanent registry whose entries can never go stale, like `registeredLocales` mirroring svelte-i18n's own process-global registry - is legitimate here (unlike the pure-debt `scripts/baselines/storage-rmw.txt`), the third column carries its reason and `--update` PRESERVES it; a row added without one reads as unexamined debt.

18. **Every toast undo callback names the generation guard** - `bun run check-undo-guards` (pre-commit via `audit` + CI) flags a toast registered with an undo callback that does not call `isUndoCurrent(...)` (`src/utils/storage/undo-generation.ts`) inside that callback. An undo that restores a storage snapshot is only meaningful while the state it describes is still the newest state; an unguarded one revives the exact stale-snapshot clobber the shared revision counter exists to prevent (delete A, do newer work, click A's still-visible Undo - newer work silently walked back). Registrations are matched through the canonical emitter signatures (`showToast`/`setShowToast` arg 3, `toastStore.success|warning|info|error` arg 3, `toastStore.add` arg 4); an inline arrow is inspected directly, a same-file `const`/`function` callback is resolved to its body, and any other expression reads conservatively as UNGUARDED (the gate cannot see through it, so the site must be baselined to ship). A callback that is not a snapshot undo does not need the guard - it needs a baseline row with a reason instead, using the repo's reason tags: `PLUMBING` (pass-through; the guard belongs at the producer, which this gate checks separately), `NOT-AN-UNDO` (an action button, e.g. "Go to mailbox"), `DIFF-BASED` (re-derives from CURRENT state, restores no snapshot), or `DEBT` (a snapshot-style undo genuinely without a guard - fix it, then drop the row). The ratchet is `scripts/baselines/undo-guards.txt` (`<path> <count> # reason`): a NEW unguarded site - or a grown count - fails the build, counts may only shrink, and after guarding a site remove rows with `bun scripts/check-undo-guards.ts --update` (reasons are preserved). `scripts/check-undo-guards.ts` owns the emitter table and documents what it cannot see (cross-file callbacks, guards behind indirection); the pure core is pinned by `tests/unit/scripts/check-undo-guards.test.ts`, which also asserts the live repository carries zero non-baselined sites.

19. **Every icon reference resolves against the catalog** - `bun run check-icon-references` (pre-commit + audit + CI) flags an `<Icon>` reference whose name the catalog in `src/ui/components/icons/Icon.svelte` does not define. The prop is deliberately open (`IconName = KnownIconName | (string & Record<never, never>)`, so an app-local composite needs no union edit) and an unknown name renders **nothing** - `if (!svg) return ''` - so a typo, or a name left behind by a catalog rename, is an invisible icon: no compile error, no runtime error, no gate. That is exactly how the rename to upstream Material Symbols names (`trash` → `delete`, `bell` → `notifications`, `x` → `close`, `plus` → `add`, `copy` → `contentCopy`) shipped five blank icons - three in the onboarding checklist, one in the shortcuts cheat sheet, one in the diagnostics perf panel. The gate reads the catalog **from the component itself** (its union, its path map, and any runtime alias it installs, `ICONS.gitHub = ICONS.github`), so adding a glyph there is all it takes to make a reference legal, and the gate can never disagree with the component it guards. Three shapes are checked: a `<Icon … name="…">` attribute or the string literals inside `name={…}` (`name={done ? 'checkCircle' : 'add'}` is two references; a literal an operator *compares against* - `fabKind === 'createAddress'` - is not one); an `icon:` / `iconName:` property literal **in a file that renders `<Icon>`** (the same-file metadata table a template drives through `name={row.icon}`), which is what keeps `ICON_KEYWORD_MAPPING` out of scope: its values are `ToastType` members fed to Toast, a different vocabulary that happens to share the word; and the string literal that reaches `name` through a **same-file binding** - `const glyph = 'trash'; … <Icon name={glyph} />` - which the other two miss because the expression carries no literal and there is no table to read. Two DECLARATION checks sit behind those, and they are what close the within-file and cross-module holes. The first is a same-file binding handed to `name={…}` whose declared type leaves the compiler nothing to check: `const glyph: string = raw` (also `: IconName`, `= $derived<string>(…)`, `= raw as string`) is a finding and must name the catalog, while inference from already-typed sources (`const glyph = $derived(header.icon)`) and an annotated `KnownIconName` are not. The second is an icon **field** - `icon`, `iconName`, every `…Icon` compound (`pageIcon`, `headerPageIcon`, `secondaryIcon`) - declared `string`, or as the open `IconName` union `Icon`'s own `name` prop is deliberately typed as. Both leave the compiler nothing to check, so a new metadata table or local would ship a typo'd glyph with no gate at all. Neither has a ledger - `--update` refuses while either is red - so the fix is always a declaration that names the catalog; the field half's one exception is the provider-config schema's `ui.icon`, named in `VOCABULARY_FIELD_EXCEPTIONS` in `scripts/shared-vocabularies.ts` rather than in a ledger (a new untyped field has no row to hide in, and a row that stops matching a live untyped field fails too, so the exception list can only shrink - rule 20 owns the registry the field rule now lives in), and the binding half has none at all. What it cannot see, stated because the gate is a ratchet and not a proof: a name arriving from another module (`name={importedTable.icon}`), a computed name, references outside `src`, a `$props()` destructuring (its type lives in the annotation object literal the FIELD half reads - so a prop named `icon` / `iconName` / `…Icon` is covered there and one named something else is not), a binding whose type the file never writes down (`= computeGlyph()`) or writes twice (the first declaration is the one resolved), and a field declaration that is not a `:` annotation at all (an expression in a claimed property, e.g. `{ icon: size || 'sm' }`) - only a cast inside such an expression is judged, since a cast is a type assertion - and both rules flag only the two tokens (`string`, the open `IconName`) that leave a declaration unchecked. The field half follows a same-file `type X = …` alias transitively (rule 20), so `type Glyphs = string` no longer hides its `string`; an alias imported from another module stays a review duty for the reason stated there.


  **All three entrypoints are walked, one test per shell, each at the width where ITS chrome renders.** Sharing `AppLayout` does not make them the same page: the layout ladder is width-driven (`src/utils/ui/breakpoints.ts`), so `app.html` at popup width renders the popup's island - appending `app.html` to a URL list would measure the same chrome three times and leave the sidebar rail unseen. The popup is walked at 360×640 and the sidepanel at 420×820 (below `LAYOUT_WIDE_MIN` → floating island + Footer + More menu); the app shell at 1440×900 (≥ `LAYOUT_WIDE_MIN` → the rail, ≥ `LAYOUT_SPLIT_MIN` → the true list|detail split), where the rail is ASSERTED present before the walk claims to cover it (a wide layout with an undismissed offline banner renders that banner instead) and the icon-only state is reached the way a user reaches it, by clicking the rail's own collapse control. Splitting per shell is what makes a failure name its entrypoint, gives each its own budget, and lets `-g "app:"` re-run one shell - the single-test version reported a hang in one shell as all three failing and took longer than a CI step allows.

  **An icon that is invisible until hover is PROVED, not excused.** This design language hides controls until the pointer reaches them - `.split-collapse-btn` in `SplitViewShell.svelte` is `opacity: 0` because it "appears on hover for discoverability" - and no DOM read can tell that from a glyph a CSS regression faded out. So a page-side pass reports such icons instead of judging them (marking them `data-icon-blind`), the driver hovers each one's own control with a real mouse move, and the surface is measured again: one that comes back is counted as revealed on hover; one that does not is a blank, named `invisible (opacity:0 subtree, no hover reveal)`. Measured both ways - deleting the reveal rule turns the seven nav/split chevrons in the app shell into exactly those findings. That hover is the only reason anything is hit-tested (a faded icon covered by an open modal's scrim cannot be reached to be proved, so it is counted as `unproven` and printed rather than failed, while every other icon is still measured - testing instead of hovering would drop a scrolled list's rows, which no other surface carries).

20. **Every carrier of a shared vocabulary names its union, and every vocabulary-keyed table declares its key type** - `bun run check-vocabulary-fields` (pre-commit via `audit` + CI) is the general half of rule 19. Rule 19 is about *references* (`<Icon name=…>` must resolve); this one is about *declarations*, and it is **registry-driven** so the next shared vocabulary costs one entry, not a new script. `scripts/shared-vocabularies.ts` names each vocabulary - the union a declaration must name (`KnownIconName`, `View`, `ActivityViewId`, `AddressStatus`), the module that exports it, the field-name pattern that CARRIES it (`icon` / `iconName` / `…Icon`; `view` / `viewId` / `…ViewId`; `accountStatus` / `…AccountStatus`), the **open types** that leave the compiler nothing to check (`string`, plus `IconName` - the open union `Icon`'s own prop is deliberately typed as), the runtime validator a boundary narrows untrusted input through (`isView`, `isActivityViewId`, `isAddressStatus`, or the member array itself for the icon catalog), the `membersArray` the tokens are read from, and, for each, the `why` and the `fieldExclusions` that say what it deliberately leaves out (`name` is a form input's field; `icons` is a list). Two rules read it:

    - **A carrier must be declared with the vocabulary's type**, so a value the compiler cannot check becomes one it can: `view: string` → `view: View`. The TYPE is read as an expression (`readTypeExpression`), not line by line, because three shapes move the offending token off the line a reader would look at: a union broken across lines (`pageIcon:\n  | string\n  | undefined` - read line-bounded, its `string` member was never judged), a CAST (`icon: raw as string`, also `raw as unknown as string` - a cast IS a type assertion, so only a literal type is exempt: `'raw as string'` is the string-literal type and is not judged), a same-file ALIAS (`type GlyphName = string` makes `{ icon: GlyphName }` a finding; aliases are followed transitively - `scanTypeAliases` + `resolveAliases` - and a finding shows both readings, `icon: GlyphName  - same-file aliases expand it to: string`), and a DERIVED type (`view: Meta['view']`, `pageIcon: Pick<Meta, 'pageGlyph'>['pageGlyph']`, `Readonly<Meta['view']>`, an `Omit`/alias chain - followed to the member it looks up by `derivedCarrierType` + `scanTypeBodies`, which also read `interface` bodies, and reported with the path: `view: Meta['destination']  - derived from Meta.destination, which is declared string`, because the fix is in the OTHER declaration). A name declared in ANOTHER module is not followed - not as an alias, not as a lookup base: the gate reads one file's own declarations, and an imported name could be the union, so the boundary is stated rather than guessed (as is a lookup whose key is not literals this file can read, `Meta[Kind]`). A carrier is a finding only when EVERY vocabulary that claims its name is left unchecked - `viewId: ActivityViewId` is as checked as `viewId: View` - and a raw payload read from storage or off a message is excused only by a `VOCABULARY_FIELD_EXCEPTIONS` row, named **in code with its reason** because it is a trust boundary rather than debt: wrapping it in `View` would be a lie the compiler accepts, so the row says what narrows it instead. The list may only shrink (a row whose carrier is now typed fails, and `--update` refuses while a carrier rule is red). A `$props()` destructuring's annotation, a callback's own parameter (`setCurrentView: (view: string) => void` - the type is the callback, its parameter is what is judged), and a declaration quoted in a comment or a string body are all handled as such rather than as findings. What the address-status entry buys on top of the other three is the failure mode: a lifecycle carrier the compiler cannot check is a misspelling that reads as NEITHER `archived` NOR `deleted`, so the comparison simply fails, the address stays live, and a deleted inbox keeps being filled into host-page forms - silence rather than a blank glyph or empty cell. `accountStatus` is the persisted vocabulary the writers write (`AddressStatus`); the DERIVED display status (`status`, `LifecycleStatus`, which also admits `expired`) and its neighbours are named in that entry's `fieldExclusions`, and `AutofillAddressLike` in `src/entrypoints/content/shared/address-liveness.ts` keeps its runtime tolerance for a stranger value - the type states what the writers write, the predicate is what guards the reader.
    - **A lookup table keyed by a vocabulary must declare its key type.** The evidence is the keys, not the name: a `Record<string, T>` whose keys are ≥ `TABLE_MIN_MEMBERS` (6) tokens of a vocabulary, at ≥ `TABLE_MEMBER_RATIO` (half) of its keys, is a finding - so a country-code or keyword map is untouched - and only the vocabulary with the MOST matches is named (a `View | dialog:*` table is advised the wider `ActivityViewId`). Accepted: `Record<View, T>`, `Partial<Record<View, T>>`, `{…} satisfies Record<View, T>`, a named alias, a mapped type, and - judged by what they derive, through `typeKeysChecked` - `Pick<X, K>` (whose keys ARE K, so `Pick<Record<string, T>, 'a' | 'b'>` is CHECKED: those literals are the key set, a case the old `Record<string,` text match got wrong in the safe direction), `Omit<X, K>` (whose keys are X's, so `Omit<Record<string, T>, 'x'>` is not), a mapped type's domain (`{ [K in string]: T }` is not, `{ [K in keyof StringKeyed]: T }` is not), `keyof X`, a same-file alias of any of them, and `Record<K, …>` where K is a union containing `string`/`number` in any position (`Record<string | View, T>` was previously missed because the match expected `string` first and alone). `Record<string, View>` is still `string`-keyed, which is the whole point: `Record<string, T>` says any string is a key, so a missing or misspelled entry is `undefined` at runtime instead of an error. A name this file does not declare stays the boundary, exactly as for a carrier: the rule's claim is about `string`, not about the registry.

The verdict is reported (`checked`) for every table the rule reads, not only for the failures - a green run that read zero tables is the same silence as a bug, and that silence is exactly how a table whose type carries braces of its own (`Record<string, { icon: string }>`) once read as no table at all: the scanner took the annotation's `{ … }` for the body, balanced it and returned. `bun run check-vocabulary-fields --list` prints every carrier and every table with its verdict. Nothing here has a baseline file: `--update` does not exist, because the fix is always a declaration that names the union. `tests/unit/scripts/check-vocabulary-fields.test.ts` pins the pure core and asserts the live tree is non-vacuous (carriers and read tables both > 0, no unchecked table anywhere in `src`).

### 6. Cross-browser (Firefox / Safari) polish

- Use `browser` from `wxt/browser` (not `chrome.*` alone).
- Avoid Chrome-only APIs without feature detection (`browser.management`, optional permissions).
- Prefer standard CSS; keep `-webkit-overflow-scrolling: touch` and `scrollbar-width` for scroll containers.
- Manifest `browser_specific_settings.gecko` must stay valid; Safari builds use the same MV3 shell via WXT targets.
- Test critical paths (storage, alarms, content script fill) with opaque CORS / no-cors assumptions in mind.

### 7. Shared UI Component Reuse (Mandatory)

Before creating custom Tailwind cards, search boxes, status badges, or empty states in any view or component, agents MUST inspect and reuse established UI primitives and composites:

- **Setting Cards**: Use `<SettingCard>` for setting card shells (`bg-md-surface-container rounded-2xl p-4 shadow-sm border`).
- **Search Headers**: Use `<SearchFilterHeader>` for top search/filter control rows across list views.
- **Status Badges & Chips**: Use `<Badge variant="..." />` (`primary`, `success`, `warning`, `error`, `neutral`, `tag`, `outline`).
- **Empty List States**: Use `<EmptyState icon="..." title="..." description="..." actionLabel="..." onAction={...} />`.
- **Loading Skeletons**: Use `<Skeleton width="..." height="..." radius="..." />` instead of inline `animate-pulse` markup.
- **Tag Chips**: Use `<TagPill>` for a tag chip. It is the one chip component
  behind the Organize/Tags hub, the address-list rows and the tag dialog, so a
  tag cannot look - or read - differently per surface.

#### Tag Chips: One Usage Fact, One Formatter (Mandatory)

A tag chip answers "how many addresses use this, and which ones?" - and the
number and the hover that names them are the SAME fact, so they come from one
helper: `tagUsageInfo(t, usage, tag)` (`src/utils/address/address-tags.ts`) returns
`{ count, label } | null`, where `label` is `tagManagement.usedBy` with the
addresses filled in and `null` means nothing carries the tag (so no chip count,
and no tooltip rather than an empty "Used by:"). The usage map itself is
`buildTagAddressUsage(addresses)`, keyed by the LOWER-CASED tag name, read back
through `tagUsageEmails`/`tagUsageInfo` so a chip can never miss on casing.

- `TagPill` takes `usage?: TagUsage | null` and owns the rendering: the count
  inside the pill, the hover from `usage.label`, and a fallback to the tag name
  when there is no usage. Callers pass `tagUsageInfo(...)`; they never build the
  count and the tooltip separately - a chip that computes them in two places
  ends up claiming "3" while listing two addresses.
- A tag is one tag regardless of casing, so it is one **color**: `buildTagColors(
  addresses)` returns `{ <lower-cased name>: color }` and every surface reads it
  through `tagColorFor(colors, tag)`. The winner is the color the MOST addresses
  write, ties keeping the first one seen - the same rule `caseVariantTags` uses to
  pick the spelling a merge keeps, so color and spelling are never chosen by two
  different rules. A `{ <exact spelling>: color }` map (what each surface used to
  build for itself) let `banking` and `Banking` hold a color each, so one tag
  painted a different chip per row. `mergeTagSpellings(addresses, canonical, color)`
  takes that one color and writes it into every merged entry, so storage converges
  on what the UI was already showing. Where a color map is passed as a prop
  (`AddressCard`, `AddressView`, `TagDialog`), its keys are the LOWER-CASED names -
  the dialog looks up through `tagColorFor`, never `tagColors[name]`.
- **The tag dialog's palette is the TAG's color, not a default for the next typed
  tag.** `pickColor` recolors the tags in the selection, and the background runs
  every saved tag's color through `unifyTagColors` - `applyTagEditToAddresses`,
  shared by `updateAddressTag` and `updateAddressesTag` - so the color reaches
  EVERY address carrying the tag. Writing it only to the addresses the message
  named left the tag stored in two colors, and because the chips resolve a tag to
  ONE color, the user watched their pick get ignored. A single-tag message with NO
  color fans out to nothing: falling back to the record's own color (or the
  default) would silently recolor a tag nobody edited.
  `tagManagement.tagColorHint` (shown while an existing tag is selected) is what
  discloses the reach, and the dialog seeds both `currentTags` and the swatch
  through `tagColorFor` - a row's own stored color is never the dialog's opening
  state, or it would contradict the chips outside.
- **The palette marks the chosen color with a TICK, and nothing when there is no
  swatch to mark.** `chosenSwatch` is the palette entry equal to the color in play
  (`swatchFor`, case-INSENSITIVE - a tag stored as `#6366f1` is the swatch
  `#6366F1`), so opening the dialog on a tag ticks that tag's ONE color, a pick moves
  the tick, and a tag whose color is one of these eight is never represented by a
  different swatch. A color outside the palette (a custom hex) ticks NOTHING, and
  that absence is the answer: the row must not mark a default instead, because then a
  mark would no longer mean "this tag's color". A brand-new tag starts unmarked for
  the same reason - the default a typed tag would take is not a choice the user made.
  The tick is ink ON the swatch's own color, so it uses `getContrastColor`; it is
  decorative (`aria-checked` already carries the state), and `data-chosen` marks it
  for the real-extension probe (`scripts/tag-merge-shot.ts` asserts the tick is on
  the tag's color on open and on the pick afterwards). `tests/unit/components/dialogs/tag-dialog-swatch.test.ts`
  mounts the real component for the same facts in-process.
- The count is `aria-hidden`: the pill's accessible name is its action ("Edit tag
  banking") and the tooltip already names every address behind the number.
- `AddressesView`'s row chip must stay a `<span role="button">`, not a
  `TagPill`: it sits inside the row's own `<button>`, and a nested button is
  invalid. It still routes text, count and hover through the same helper.
- `data-tag-chip` marks every chip for the real-extension probe
  (`scripts/tag-merge-shot.ts` asserts each chip's count equals the number of
  emails its own tooltip names, that one tag is never painted two colors, and that
  the Organize hub card repeats none of them). It reads the address list **while a
  seeded case split is still live** - after the merge every address writes one
  spelling in one color, which a spelling-keyed map would render correctly by
  accident, so the post-merge read alone has no teeth.
  It then reseeds a COLOR split with no spelling split (three addresses, two of
  them writing the majority color) and drives that cleanup: the hub must offer it
  - and not a spelling merge - and the color that survives must be the MOST-USED
  one, which is what tells "majority wins" apart from "first seen wins". A missing
  offer is polled for and reported as a failure rather than an unexplained timeout.
  A third scenario reseeds that split, opens the tag dialog from the mailbox on the
  address holding the MINORITY color and picks Red - a color no address writes, so
  the result cannot be reached by accident - then asserts all three addresses store
  it. Every view wait polls and reports instead of throwing, so "the address list
  never appeared" reads as a missing surface rather than a stack trace.
- **Storage that disagrees with the chips is an ACTION, not a shrug.** The hub's
  card carries one cleanup button when - and only when - storage holds a
  disagreement the UI has already resolved, and there are two of them, one per axis:
  `caseVariantTags(addresses, catalogNames)` → "Merge {n} spellings"
  (`mergeSpellings*`), and `colorVariantTags(addresses)` → "Unify {n} colors"
  (`unifyColors*`). Each is one confirm away from making storage match the screen.
  - `unifyTagColors(addresses, tag, color)` rewrites ONLY the colors - the
    spellings are left exactly as they are, unlike `mergeTagSpellings`, which is
    why the two cannot be one button. They share `rewriteTag`, the single walk that
    matches a tag by lower-cased name in both schemas, decides which addresses
    count as carriers, and keeps the legacy `tag`/`tagColor` mirror on `tags[0]`.
  - The color offer is SUPPRESSED while the spelling merge is on the card: that
    merge already writes `buildTagColors`'s answer, so two buttons would be the
    same fix offered twice. `{:else if}` on `group.otherColors.length > 0` is that
    rule, and it is why a card never shows both.
  - Both offers disappear on their own once applied, because both rewrite
    storage into the state the detector no longer fires on.
- The Organize/Tags hub card is the chip plus its actions, and nothing else: it
  does NOT repeat the usage that the chip's hover already carries as a trailing
  address list. That list restated `tagManagement.usedBy` one line per address, so
  the card grew with every address a tag gained and said nothing the hover did not
  - which is what left the hub unable to stay compact.

#### Row surfaces: hover, active and selected come from ONE contract (Mandatory)

Every list row in the app - mailbox rows, address cards, identity rows, saved
logins, sidebar destinations, palette and menu results, dropdown rows - states
its state through one contract, and no view supplies a fill, an edge or a hover
wash of its own:

| | API (`src/utils/ui/row-surface.ts`) | painted by (`src/styles/row-surfaces.css`) |
|---|---|---|
| resting | `rowSurface({})` → `.row-surface` | the hover / pressed wash |
| selected (ticked) | `rowSurface({ selected: true })` | `.row-surface-selected`: `secondary-container`, deepened toward its own ink in the two `standard` palettes |
| active (open / current) | `rowSurface({ active: true })` | `.row-surface-active`: `secondary-container/60`, deepened the same way and always a step BELOW `selected` |
| highlighted (jumped to) | `rowSurface({ highlighted: true })` | `.row-surface-highlighted`: `primary/50` (`/28` in the dark palettes) - the one state in a different HUE |
| unread (modifier) | `rowSurface({ unread: true })` | `.row-surface-unread`: the quietest wash; emitted only when no state applies |

`rowSurface` emits the resting class plus **at most one** state class
(precedence: selected > active > highlighted > unread), and `rowInk(role, state)`
gives the row's text the ink that state owes (`primary` / `meta` / `icon`). A row
therefore never mixes two states or picks half the pair: the view chooses the
STATE, the contract chooses the pixels.

The stylesheet is imported **unlayered** (`src/styles.css`), which is load-beating
on purpose: Tailwind's utilities live in `@layer utilities`, so a view's static
`bg-md-tertiary-container`, or its own `bg-md-primary/5`, would otherwise win
with no error at all - that is exactly how the identity row's selected fill came
to never paint. The same unlayered rule is why hover cannot repaint a ticked row
(`.row-surface:not(.row-surface-selected):hover`).

The mailbox row keeps its own vocabulary on top of the contract
(`mailRowSurfaceClass` / `SELECTED_ROW_INK` / `mailRowStarClass` in
`src/utils/ui/mail-row-state.ts`), and both of its renderings (the virtualised
list and the cross-mailbox group list) call them rather than hand-rolling a
fill.

- **Never a ring, and never a second shape.** `.ring-2` is a NON-inset
  box-shadow on a row inside an `overflow-hidden` swipe wrapper, so all four
  sides of the old `ring-2 ring-md-secondary` were clipped away - the indicator
  did not paint at all. And an earlier version of this contract answered the
  weak-fill problem by ADDING a shape: a 3px `on-secondary-container` bar at the
  inline start plus a 1px rim. Both are gone, because a state is its fill and
  the rim drew a line between two ADJACENT ticked rows that the design never
  had. The probe now asserts the opposite of the old rule: the row paints NO
  `box-shadow` at all, and the inline-start column is the fill.
- **A state is a FILL, and the fill must be strong enough for the palette it
  lands in.** `secondary-container` separates from the row on its own in the
  medium/high palettes (4.91:1…10.49:1) and in `dark-standard` (1.98:1), but in
  `light-standard` it measures **1.22:1** - the same pixel as a hover wash
  (1.10:1). There the fill is deepened toward the container's own ink (dark in
  the light palette, light in the dark one, so one rule separates in both), and
  the numbers are worst-case across every surface base a selectable row rests on
  (`surface`, `-container-low`, `-container`, `-container-high`):

  | palette | selected (was) | active (was) |
  |---|---|---|
  | `light-standard` | **2.20:1** (1.22) | 1.90:1 (1.12) |
  | `dark-standard` | **2.07:1** (1.98) | 1.90:1 (1.44) |
  | medium / high | unchanged 4.91:1…10.49:1 | unchanged 2.28:1…4.30:1 |

  The percentages belong to the PALETTE, which is why they are written as
  `:root[data-theme=…]` rules in the sheet rather than picked per view.
- **The ink follows the fill, which is why it is a variable set.** Deepening the
  fill takes luminance away from the container's own ink: on the 2.20:1
  light-standard fill `on-secondary-container` measures 4.4:1 - under the 4.5:1
  body floor it has on the untouched container - while that palette's
  `on-surface` measures 8.0:1. So `ROW_INK_SELECTED` names `--row-ink-{primary,
  meta, icon}`, the sheet derives them from a per-state `--row-ink-core` at
  `/85` and `/70`, and only the sheet may choose the core. A view cannot know the
  palette, so it must not name a role.
- **A wash is not a place for a state.** A selectable row must rest on a base its
  own fill can separate from: `secondary-container` against
  `surface-container-highest` is **1.34:1** in `dark-standard` / 1.22:1 in
  `light-standard` - the container-vs-container span, where no fill from this
  family can separate - so the login card and the address card rest on
  `surface-container-high` instead, and a test fails any element that both calls
  `rowSurface(…)` and paints `bg-md-surface-container-highest`.
- **The states stay ordered, and the hover stays weakest.** `selected` >
  `active` > hover in every palette, or hovering an unselected row reads as
  opening it. `dark-high` is where that bites: its container is light, so a 60%
  wash is a mid tone - 3.05:1 of separation, but the row's own light ink only
  measures 3.1:1 on it - so its `active` is *weaker* (40%) and its hover weaker
  still, and a 50% hover wash that out-painted `active` (3.50:1 vs 2.66:1) is
  exactly the inversion the control contract exists to prevent, on rows.
- **Hierarchy on a tinted row comes from size and weight, never from opacity.**
  `on-surface/50` measured 2.23:1…3.74:1 and `on-surface/40` 1.93:1…2.92:1 on
  this fill across the themes - the mud this replaces. The ink is the palette's
  row-ink core at a measured step: full for the subject and sender, `/85` for
  the date and the body preview, `/70` for the unstarred star (icon floor 3:1).
  A **starred** star drops the amber on a selected row (1.5:1…2.3:1 on the
  fill) and lets the filled glyph carry "starred".
- **Hover and press must not repaint it.** The rule is unlayered on purpose:
  Tailwind's utilities live in `@layer utilities`, so a plain
  `bg-md-secondary-container` class still loses to
  `hover:bg-md-surface-variant/40`, and hovering a ticked row would wash the
  selection away.

Proven by `tests/unit/utils/row-surface.test.ts` (the state API; for every state
and every theme the fill's separation from every base a selectable row rests on,
the ordering `selected` > `active` > hover, the ink on the fill read through the
palette's own `--row-ink-core`, and that no state paints a `box-shadow` - parsed
from the stylesheet, so a retoken or a percentage change fails on the numbers),
`tests/unit/utils/mail-row-state.test.ts` (the mailbox's vocabulary over it) and
by `bun scripts/row-selection-shot.ts`, which
drives the built extension in `light-standard`, `dark-standard` and `ar` (RTL)
- ticking two adjacent rows through the avatar control, then reading computed
styles **and pixels**: the row's dominant pixel must be the fill the sheet
declares FOR THAT PALETTE, the inline-start column must be that same fill (there
is no bar to find there any more), the row must paint no `box-shadow` at all,
the untouched row must not be painted, hovering must not change the background,
and every line of ink must clear 4:1 on it.

The same probe then walks the four surfaces beyond the mailbox that state a row's
state through the contract - the addresses list (ticked), the identity rows (the
open one), saved logins (ticked) and the automation rules (the row the keyboard
sits on) - through the app's own open-view handoff, and reads each cue out of the
**pixels of that screen**: the row's dominant pixel must be the declared fill
composited over what the row rests on (`active` is a 60% wash), the fill must
separate from the resting sibling's own pixel, the inline-start window must be
the fill rather than an edge, and a resting sibling of the same kind must show
neither. What each state paints is PARSED from `src/styles/row-surfaces.css`
per theme rather than restated in the probe, and the one BORDER cue left (the
credentials domain's select-all disc) is
read as a WINDOW of the first few columns rather than one pixel: an inset shadow
paints inside the padding box, so a row with a 1px border starts its own bar one
pixel along (the automation row's ink sits at x = 2…3), and a 2px border on a
24px control sits on a fractional boundary. Two consequences worth knowing: the
credentials rows are stored with generated ids, so a case addresses them by rank
inside their domain section rather than by a seeded id; and the addresses tick
enters selection mode because the row paints `selected` on the TICK - a tick that
left `selectionMode` false showed a check on a row that showed no state at all.

#### Selected controls: chips, toggles and chooser rows (`controlSurface`)

A control that is applied or not - a filter chip, a filter/view toggle, a
segment, a chooser row or card - states it through `controlSurface(selected)`
(`src/utils/ui/row-surface.ts`, values in `src/styles/row-surfaces.css`), never
through an arm pair of its own. The resting classes stay on the element and the
contract's unlayered rule overrides them when applied, so a view writes ONE
class list and no `? :`:

```svelte
class="… border border-md-outline-variant text-md-on-surface/60
       {controlSurface(filterActive)}"
```

`--md-primary` is 6.15:1 against the surface in `light-standard` (10.91:1 in
`dark-standard`, 11.4…16.3:1 in the medium/high themes) and `--md-on-primary` on
it is 6.48:1…18.41:1 in all six - so the applied form is a **solid accent role**
(a control is applied or not, and unlike a ticked ROW - which must stay a
container tint deep enough to read on its own base - a control has no fill it has
to blend with), and its ink comes from the contract's `color` (a child that
carries its own `text-*`, like a `<td>` in the onboarding comparison row, takes
`CONTROL_INK_SELECTED` instead).

**The idle hover is a NEUTRAL whisper laid OVER the resting fill** -
`background-image: linear-gradient(<on-surface 8%>, …)`, never
`background-color`, so it composes with a transparent button and with a tinted
pill alike; a `background-color` would swap a grey pill's resting token for the
parent's surface, which reads as the control switching itself off. Measured: ≤1.23:1
against the control's own resting pixel in every theme, at least 4× weaker than
the applied fill.

What this replaces, and why the whole family had to move: the idle hover was
`bg-md-surface-variant` (**1.23:1**) while the applied form was
`bg-md-primary/10` (**1.15:1**) - hovering an unapplied filter painted a
STRONGER fill than applying it, and the applied state's only real cue was its
1px border. `bun run audit-row-surfaces` reported it as HOVER-EQUAL at 10 sites;
widening the scan from the flag's NAME to the arm pair's SHAPE (a 10-15% accent
fill against an idle arm hovering to a surface token) found 5 more that
name-keyed discovery had missed - `sortBy !== 'newest'`, `otpOnly`,
`hasAttachment`, the export wizard's format cards and the address strip's drop
targets. It is now **zero** app-wide, and the migration covers the mailbox and
activity filter chips, the four address-drawer tag pills, the filter/view
toggles, the identity DOB segments and the onboarding provider row.

Two neighbours it does NOT cover, on purpose: a checkbox card (`Import` /
`Export` backup categories) keeps its state on the checkbox plus a 6:1 border -
its `/10` fill was decoration that competed with its own hover, so it is gone
rather than re-tokenised, and a solid `primary` card would swallow the
checkbox's own `primary` glyph; and a drop target is a third axis (a drag
affordance), reported separately by the audit and made clip-proof with
`ring-inset` rather than given a selection fill.

**Three shapes of one state.** The shape decides WHERE the state is painted,
never which state it is.

- `controlSurface(active, 'underline')` - `.control-underline-selected`, for a
  control whose container is already a surface (a primary tab in a strip): its
  ink plus a 2px `--md-primary` bottom bar (an INSET shadow, so the tab's box
  never grows) at 5.01…10.80:1 against the strip, rather than a fill that would
  restyle the strip. The segmented tab strip states both of its variants this
  way: the pill's applied segment used to be `bg-md-surface` on a
  `bg-md-surface-variant` track - **1.23:1**, the entire surface-family span -
  which is why it read as no state at all in the two `standard` themes, and the
  badge on an applied segment must keep its wash NEUTRAL (`bg-md-on-surface/10`)
  because `primary-container` on a `primary` fill is only **1.54:1** in the
  high-contrast themes.
- `controlSurface(active, 'border')` - `.control-border-selected`, for a control
  whose own box holds content a fill would swallow (the credentials domain's
  select-all disc holds a favicon): the state is the border in the accent role,
  `--md-primary` at 5.29…14.42:1 against the surface family, and the 2px border
  sits INSIDE the box so no clipping ancestor can remove it the way it removed
  the `ring-md-primary` this replaces. It paints no fill and no ink, so the
  content keeps the surface it was legible on.

**No view may invent a hover mechanism either.** `hover:brightness-*` is a
`filter`, so it brightens everything inside the control - and on the credentials
disc it brightened the accent border that CARRIES the state while its computed
`background-color` never moved, which is invisible to a background read and
showed up only as the pixel probe's 15/255 on the disc's dominant pixel. It now
takes the contract's whisper, and the disc's applied state excludes that whisper
(see the exclusions below). The predicate behind the cue and the predicate behind
the click are one function (`isDomainFullySelected`) so a disc cannot claim a
domain is fully ticked while its own handler disagrees.

The whisper is the **idle** cue, and both selectors name every applied shape
that paints the control's own surface - `.control-surface-selected` and
`.control-border-selected` - so a wash can never land on the pixels that carry a
state. The underline shape needs no exclusion and gets none: its state is its
ink and its bar, which no translucent wash imitates.

Proven by `tests/unit/utils/row-surface.test.ts` (the API, the sheet parsed for
both sides, the whisper's exclusions on disk, and the applied fill ≥4× the
whisper on every surface-family base in all six themes), the audit's
`HOVER-EQUAL` count of zero, and
`bun scripts/row-selection-shot.ts`, whose control stage drives the built
extension to **every** applied-control surface - the mailbox's filter toggle,
layout view toggle, selection-strip chip and two real inline **filter chips**
(`is:otp`, `has:attachment`), the addresses segmented tab and filter toggle, and
the identities and saved-logins filter toggles (**63 cases**) - and reads PIXELS
out of the SAME element in three states: resting, hovered while still off, and
applied. It runs in **all six themes plus RTL**, because the failures this
replaces were theme-specific (the pill segment's 1.23:1 was `light-standard`
while the same pair measured 1.98:1 in `dark-standard`, i.e. the two `standard`
themes did not even agree with each other). The assertions are the contract's
own, on screen: applied's dominant pixel equals `--md-primary` **exactly** in
every pass (≤2/255 off), the idle hover moves the control at most **20**/255 from
its own resting pixel, and applied moves it **137-239**/255 - ≥4× the hover's own
move, and ≥**4.3:1** applied-vs-hovered everywhere (4.3-4.55 on the segmented
tab, the tightest surface; 5.24-13.36 on the rest, up to 13.36 in `dark-high`). A
`hover-*`/`selected` arm pair in a view cannot pass it by writing both classes,
because the applied state is graded against the accent ROLE, not against its own
declaration.

Two things about that stage are worth knowing before extending it. **The mailbox
filter row is transient**: those chips render only while the search field is
focused, and focusing is exactly what clicking a chip takes away - the field's
`onBlur` sets `searchFocused = false` on a **200ms** timer, so the chip that was
just applied is unmounted before a `transition-colors` could even settle, and a
naive read 350ms after the click finds nothing. The case therefore declares a
`reveal` (`#inbox-search-input`) that re-opens the row before each of the three
reads - the path a user takes anyway - and the applied pixel is read from the
re-rendered chip, i.e. the same control in the same state. **And an applied
filter is not free**: `is:otp` empties the seeded row list, which is what the
selection-strip chip is measured against, so the chips run LAST in the mailbox
group and declare a `reset` that turns them off again. An earlier read of this
layout concluded the chips "are not in the popup at all" - it had looked at
boot, where the search field is unfocused and the row genuinely does not exist.

**No state may be signalled by an OUTWARD ring.** `ring-*` paints outside the
border box, so any clipping ancestor removes it (`overflow-y-auto` clips on BOTH
axes), and it is never the only cue the audit accepts. The replacements are
clip-proof by construction, and each is measured: the row contract's INSET bar,
a `border-2` on a disc (the border sits inside the box, and a constant
`border-transparent` in the idle arm keeps the box from popping), the control
contract's fill, and `ring-inset` where a ring really is the right shape. Three
sites moved for this reason: the automation rule row the keyboard sits on
(`focusedRuleId` → `rowSurface({ active })`, replacing a
`ring-1 ring-md-primary/50` that measured **2.18:1** in `light-standard` - under
the 3:1 a cue owes, before clipping is even considered); the credentials domain
select-all disc (a `border-md-primary` at 5.29…14.42:1 against the surface
family, replacing a `ring-md-primary` that fell to **1.54:1** against the
`primary-container` it ringed in the high-contrast themes); and two selection
discs whose ring restated a state their row or fill already carried, which is one
signal too many rather than a second one.

#### Avatar and favicon sizing: one tier per role (Mandatory)

Every letter avatar and favicon takes a TIER from
`src/utils/ui/avatar-size.ts` - never a px number, and never a `w-N h-N` pair
invented at the call site.

| tier  | px | role |
|-------|----|------|
| `xs`  | 16 | inline inside a text line: filter chips, provider pills, strips |
| `sm`  | 20 | inline metadata: a message's sender, usage-map favicons, credits |
| `md`  | 24 | overlapping sender stacks, and the favicon in a 24px padded disc |
| `lg`  | 28 | compact rows and strips: grouped mail rows, OTP/autofill strips, menus |
| `xl`  | 32 | the address card and the panel-header avatar |
| `row` | 36 | **the list-row avatar - one size for every list row** |

**The rule that matters most: a list row's leading avatar is `row`.** Mailbox
rows (both renderings), address rows, identity rows and saved-login rows all take
it, so two lists can never show two sizes for the same thing again.

Why the call site does not get to decide. The same role had shipped at eight
sizes: the leading avatar of a *list row* was **35px** in the mailbox, **36px** in
the addresses list, **40px** on the identity row and **28px** in the mailbox's
grouped list. And because a `w-*` class on the component suppresses the inline
size style, `size={35}` inside a `w-9 h-9` wrapper declared 35 and painted 36;
the address detail's usage-map favicon declared `size={16}` inside a `w-5 h-5`
box while painting `w-3.5 h-3.5` - three numbers for one 14px icon. A number at a
call site cannot be checked; a tier can.

- `Avatar.svelte` / `FaviconImage.svelte` take `size?: AvatarTier` and resolve
  their own px from it (so the letter's font ratio and the Google-favicon request
  size follow the box). A wrapper that must be exactly a tier's box uses
  `AVATAR_BOX[tier]`; a glyph inside one - a check tick, a `person` fallback, an
  alert triangle - uses `AVATAR_INK[tier]`, so the tick in a 36px avatar is one
  size app-wide instead of `w-4` in one view and `w-5` in the next.
- A caller painting into a box it does not own (a lift-out flip layer) passes
  `w-full h-full`; `bun run check-avatar-sizes` (`scripts/check-avatar-sizes.ts`,
  pre-commit + `audit` + CI) fails any other size class, any numeric `size`, and
  any call site that names no tier. It scans every `.svelte` file under `src/`
  except the two primitives themselves, which own their box internally.
- The tier name is also type-checked (`AvatarTier`), so a typo fails
  `bun run typecheck`; the gate covers the `size={expr}` cases the compiler cannot
  see through.
- Two neighbours stay out of the scale on purpose: the identity form's 48px
  profile-picture **upload preview** is a form control, not an avatar in a list,
  and a drop target or a select-all disc is a control whose box may legitimately
  be larger than the icon it holds (the credentials disc is `md` holding an `sm`
  favicon, i.e. exactly its 2px-border inset).

Proven by `tests/unit/utils/avatar-size.test.ts` (every box and ink class
recomputed from the tier's px, the ladder's ordering, and a wiring assertion that
all four list surfaces lay their row avatar out on `row`),
`tests/unit/scripts/check-avatar-sizes.test.ts` (the gate's verdicts: numeric
size, disagreeing box, missing tier, unknown tier - and the two forms that are
legal), `tests/unit/components/primitives/avatar.test.ts` (every tier paints its
own px; the default is `sm`) and the geometry e2e
(`tests/e2e/avatar-geometry.e2e.ts`, whose matrix IS the tier ladder, so a new
tier cannot ship without pixel coverage) - and, in the running extension, by
`bun scripts/row-selection-shot.ts`, which drives the built app to all four lists
and measures the actual bounding box of each row's select control: **36×36 in
`light-standard`, `dark-standard` and RTL (`ar`)** for the mailbox row, the
addresses row, the identity row and the saved-login row. That stage is also what
found the one avatar the sources could not describe: the credentials row's
selector matched the drag hint's 12px dismiss `✕` first, so the row avatar now
exposes `aria-pressed` (a toggle control should say whether it is pressed
anyway) and the probe addresses it by that state rather than by rank.

#### Every selected / active row: the audit, and what a fill may not be

The mailbox row is the app's own reference implementation of a selected row; the
rest of the app is measured against the same question by
`bun run audit-row-surfaces` (`scripts/audit-row-surfaces.ts`). It scans every
selection-conditional class arm pair under `src/ui` with the shared
`source-lexer`, resolves each fill through `src/styles/theme.css`, and reports -
per `light-standard` / `dark-standard` - the separation of the fill from the
surface under it, the separation of the idle state's HOVER (the noise floor a
selection must beat), and the separation of any border/ring cue.

**The rule the numbers establish: the plain container tint cannot carry a state
by itself in the two `standard` themes.** The whole surface family
(`surface` … `surface-container-highest` … `surface-variant`) spans **1.23:1** in
`light-standard` and 1.98:1 in `dark-standard`, against a floor of **1.8:1** - the
same floor the nav's selected segment had to satisfy, and the reason those two
palettes deepen their fills (see the row contract above: 2.20:1 / 2.07:1). The
40%/15%/10% tints that were meant to be a fill are, in fact, indistinguishable
from a hover wash (measured 1.05-1.26:1) or invisible altogether - which is why
the row contract reaches 2:1 by mixing the container toward its own ink rather
than by adding a shape, and why a selectable row must not rest on
`surface-container-highest`, whose 1.34:1 against the container leaves a fill no
room at all.

Four failure modes the audit names, and what each one means:

- **SILENT** - below the floor on EVERY surface family, so no baseline choice can
  rescue it (e.g. `bg-md-primary/15` for an active sidebar child: 1.23:1 light /
  1.36:1 dark).
- **DEAD-FILL** - the conditional fill never paints at all: Tailwind emits a
  static sibling (`bg-md-tertiary-container`) LATER in the group-ordered
  stylesheet, and equal specificity means source order wins. The identity row's
  open state is this: only its 1px `border-md-primary/40` (1.74:1 in
  `light-standard`) survives.
- **RING-ONLY** - the only cue is a non-inset `ring-*`, which is painted OUTSIDE
  the border box and is therefore removed by any clipping ancestor.
  `overflow-y-auto` counts as clip on both axes (a non-`visible` axis makes the
  other compute to `auto`), so the addresses list's ring survives only because
  its container spends exactly its 2px of `px-0.5` padding on it, while the
  selector drawer's ring - an `overflow-y-auto` list with no inline padding - is
  cut off at both inline edges.
- **HOVER-EQUAL** - the idle state's hover paints what the selected state paints,
  so hovering a neighbour reads as selecting it.

A view therefore does not pick its own fill alpha: the row surface and its ink
come from the contract above, and a conditional arm pair whose element also calls
`rowSurface({ … })` is reported as **contract-backed** rather than graded here
(the values are the contract's test's job). The rows that predate the contract
have all been migrated - the remaining findings are controls (segmented tabs,
filter chips, radio cards, the star button, automated-focus rings), which are
listed under `--all`. `--strict` exits non-zero on row-level SILENT /
DEAD-FILL / RING-ONLY findings, so the report stays a usable ratchet as new
surfaces arrive. The scan's mechanism and the theme arithmetic are pinned by
`tests/unit/scripts/audit-row-surfaces.test.ts`.

### 8. UI Design Reference

Follow [Design.md](docs/Design.md) for Material Design 3 guidance and the complete responsive action-button layout rules. Preserve established product choices documented there, including the existing tab design.

**Inter-button gap must track the current button padding**: XS = 8px, S = 12px, M/L/XL = 8px are baseline ceilings. In every fit state use `gap = min(authoredGap, tierGap, max(4px, 0.75 × currentSidePadding))`; preserve smaller authored gaps and the 8px dialog-footer baseline. Shrink the gap as soon as the padding cap requires it, without the former 75%-budget delay. Prevent distributed alignment (`space-between`, `space-around`, `space-evenly`) from enlarging the visual gap. At 4px side padding the 4px gap floor wins. This is separate from the 1.75:1 side-padding-to-icon/label-gap rule inside each button. Follow `docs/Design.md` §8.3 for fitting, restoration and measurement details.

**Button groups must have equal outer insets**: use symmetric inline container padding and fill the whole content width. If equal button widths would clip a label, preserve natural widths and add an equal share of spare width to each button. Do not leave that space after the last button or add it to the inter-button gaps.

### 9. Content Script Messaging & Non-Blocking Rejections

- **Typed Messaging**: All `browser.runtime.sendMessage` calls between entrypoints (UI, Content Scripts, Background) MUST use `{ type: 'handler_name' }` matching the `RuntimeMessage` interface in `src/utils/types.ts`. Do **not** send un-typed `{ action: '...' }` strings.
- **automatic verification**: `bun run check-message-types` (pre-commit + CI) verifies BOTH directions: forward, it fails any `sendMessage` / `tabs.sendMessage` / `sendMessageViaBg` call whose literal `type`/`action` string is not declared in `RuntimeMessage` (or that can't be statically resolved); reverse, it fails any `RuntimeMessage` member that has neither a registered handler in the background `handlers` object (`message-handler.ts`) nor an explicit entry in the script's `ALLOWED_UNHANDLED` allowlist (content `onMessage` listeners, extension-page UI listeners, the offscreen audio doc, or intentional fire-and-forget broadcasts) - so orphaned message types and untyped sends can't accumulate. When you add a new message, add its member to `BackgroundMessage`/`ContentMessage` in `src/utils/types.ts` AND register it in `message-handler.ts` (or extend `ALLOWED_UNHANDLED` with the actual receiver) first.
- **Non-Blocking Rejections**: In content scripts (`src/entrypoints/content/`), asynchronous `browser.runtime.sendMessage` calls inside DOM event listeners must append `.catch(logError)` or `.catch(/* ignore */)` to prevent uncaught extension context invalidation errors in host webpage developer consoles.

### 10. Sensitive Data Clipboard Purge Policy

- Any user action that copies sensitive data (OTPs, passwords, magic link tokens, recovery keys, secret seeds) MUST use `copyToClipboardAndSchedulePurge(text, delayMs)` (default 30s for OTPs/passwords, 60s for generic text) with user-facing toast feedback.

### 11. View Name Consistency & Global Refactoring Strictness (Mandatory)

1. **View Identifiers and Routing Metadata**:
   - `src/features/types/view-types.ts` is the single source of truth for valid `View` identifiers.
   - `src/ui/views/view-registry.ts` owns split-layout and view-routing metadata only (currently exposed through helpers such as `isSettingsSplitView()`); do not treat it as a second source of view identifiers.
2. **Navbar Membership and Ordering**:
   - Navbar-eligible views declare a `NavBarFlag` in their co-located `*.nav.ts` file. The flag owns the canonical key, rendered view, label, icon, and default `order`.
   - Every navbar flag must also be explicitly registered in `NAV_FLAGS` in `src/utils/ui/nav-layout.ts`. A co-located flag file that is not registered is not part of the navbar.
   - `NAV_FLAGS_ORDERED` and `DEFAULT_NAV_ORDER` derive the canonical navbar order from the flags. Orders must be unique, contiguous, and start at `1`; `scripts/check-nav-flags.ts` validates this during builds.
   - `customNavOrder` is a user preference and intentionally overrides the canonical flag order at runtime. Invalid or obsolete stored keys must be filtered out and missing canonical items appended - and each key must appear at most ONCE, because the pill and the More menu render a keyed list where a repeated key is a Svelte error rather than a double item. That repair lives in `normalizeNavOrder()` (`nav-layout.ts`) and is applied at the pipeline's entry (`computeNavLayout`, `layoutStore.setCustomNavOrder`, the reorder page), so no consumer decides it differently.
   - `Footer.svelte`, `SidebarNav.svelte`, `Header.svelte`, and `AppLayout.svelte` must consume the shared `layoutStore.navLayout`/`computeNavLayout()` rather than duplicating navbar ordering or overflow logic.
   - Mail-provider failover order (for example, `getProviderFailoverOrder()`) is unrelated to navbar order and must not be used for navigation.
3. **Canonical View Mapping**:
   - `mailbox`: Primary mailbox and message thread reading view (never `main`).
   - `addresses`: Email address and inbox management page (never `mailboxManagement` or `mailSettings`).
   - `settings`: Main extension settings hub (never `mailSettings`).
   - `organize`: Unified Tags, Labels, and Filters hub.
   - `autofill`: Profiles and Credentials hub.
3. **Exhaustive Propagated Renames**: Whenever a view name, prop name, or storage key is renamed or modified, agents MUST perform a global search and update **every single reference** across the codebase in the same turn. This includes:
   - Type definitions (`src/features/types/view-types.ts`)
   - Registry metadata (`src/ui/views/view-registry.ts`)
   - Shell layouts & navs (`AppLayout.svelte`, `SidebarNav.svelte`, `Footer.svelte`, `Header.svelte`)
   - View components (`ExtensionSettingsView.svelte`, `AddressesView.svelte`, etc.)
   - Utilities (`sidebar-fab.ts`, `view-display-names.ts`)
   - Shortcuts, tour steps, and background handlers (`shortcuts.ts`, `tour-steps.ts`, `background/index.ts`)
4. **Zero Legacy Aliases**: Never leave partial string aliases, fallback checks for old names, or split logic across files. Any view rename must be 100% atomic and unified across all entrypoints.

### 12. Allowed Tools for Code Editing (Mandatory)

1. **Native Built-in Editing Tools Only**: Agents MUST use standard built-in file editing tools (`replace_file_content`, `multi_replace_file_content`, `write_to_file`) when creating or modifying code files in the project.
2. **No Script-Based File Modifications Without Explicit Permission**: Running external shell scripts or execution commands (e.g. PowerShell scripts, Bash one-liners, Python/Node regex replacers) to modify source code files is strictly prohibited. If a task requires a script-based bulk edit, agents MUST ask for explicit user permission first before executing any such script.

### 13. Shared Working Tree - No `git checkout` / Destructive Restores (Mandatory)

This working tree is **shared**: other agents, the user, and the IDE frequently hold **uncommitted changes** in the same files, and that is the permanent, expected state of this repo. Treat every modified file as carrying someone else's work. Rules:

1. **`git checkout` is FORBIDDEN** - and so is anything else that restores or discards uncommitted working-tree state (`git restore`, `git reset --hard`, `git clean`, `git stash` / `git stash drop`). Restoring a file from HEAD silently deletes whoever last edited it; their uncommitted work does not survive a checkout. There is no file that is safe to bulk-reset.
2. **Always check for uncommitted changes first**: before writing to any code file, run `git status --short -- <path>` (plus `git diff -- <path>` when needed) to see whether that file already holds uncommitted hunks. Pre-existing hunks are untouchable - your edits must be layered on top of them, never replacing them.
3. **Backing out your own edits is always surgical**: run `git diff` to see exactly what you changed, then restore ONLY your own hunks via targeted file edits. This costs more tokens than `git checkout` - do it anyway; preserving the other agents' uncommitted work outranks token economy.
4. **Re-verify after every change**: `git status --short` and `git diff` must confirm you touched only the intended lines and that every pre-existing uncommitted hunk is still present and unmodified.

### 14. Context-Window Compaction Recovery (Mandatory)

Whenever the conversation context window has been compacted/summarized (or an agent resumes after a long gap, restart, or handoff), the agent MUST re-read the following files **in full, in this order, before doing any other work**:

1. `AGENTS.md` - re-establish all project rules (never rely on memory of them).
2. `package.json` - exact script names, dependencies, and toolchain versions.
3. `wxt.config.ts` - build targets, entrypoint config, and manifest settings.

Rules:

- This re-read is **mandatory and blocking**: no edits, no terminal commands for the task, no assumptions carried over from the summary - read first, then act.
- Do **not** skip any of the three files even if the compaction summary seems complete; summaries preserve facts about files, not file contents.
- After the re-read, run `git status --short` to re-sync with the shared working tree before touching any file (see rule 13).
- This rule does NOT authorize full re-reads of large source files (`AppLayout.svelte`, `message-handler.ts`, etc.) - for those, use targeted searches/windows around what the task needs to preserve context budget.

## Agent Configurations

<!-- Add your agent configurations here -->

## Usage

<!-- Add usage instructions here -->

## Debugging the live extension with Chrome, Firefox, and Safari DevTools MCP

When a UI change "does nothing" in the browser, the first suspect is a stale
build - run `bun scripts/check-stale-builds.ts` and make sure the browser loads
the current output rather than yesterday's artifact.

### Dependencies and build output in a Codex worktree

A Codex worktree may lack `node_modules` and `.output` even when the main
checkout has both. Before concluding that browser testing is unavailable:

1. Run `git worktree list --porcelain` to discover the main checkout and other
   worktrees. Use the reported paths rather than guessing a directory or
   hardcoding a developer's machine path.
2. Check the current worktree and the main checkout for `node_modules`, the
   installed Playwright package, and `.output/chrome-mv3/manifest.json`. On
   Windows, inspect `Get-Command bun -All` and `where.exe bun`; Bun may be
   exposed through a `bun.cmd` shim rather than a directly discoverable
   `bun.exe`.
3. Existing dependencies can support a diagnostic Playwright script through an
   explicit package path. Load the selected extension build through an absolute
   path in the browser launch arguments. Follow `tests/e2e/fixtures.ts` for the
   extension launch and storage-seeding pattern, using a dedicated or temporary
   browser profile and demo data.
4. Verify which checkout produced that build. Run
   `bun scripts/check-stale-builds.ts` in that checkout and compare the relevant
   source files and uncommitted changes with the worktree under review. A main
   checkout build demonstrates that checkout's UI; it does not verify different
   worktree changes. Build the worktree's current sources when those changes
   need verification.
5. Keep diagnostic scripts and screenshots in the writable worktree or an
   authorized output directory. Respect filesystem and browser permissions;
   request the required access when needed. Do not modify another checkout's
   dependencies, build output, or existing changes merely to obtain screenshots.

Use the existing screenshot scripts below when applicable, or the documented
Playwright fallback when MCP is unavailable.

### Chrome / Chromium

To drive the REAL built extension in a browser (click through the UI, read
extension storage, screenshot):

1. `bun run build`
2. `bun scripts/mcp-debug-extension.ts` - launches an extension-capable
   Chromium with `.output/chrome-mv3` loaded and remote debugging on
   `http://127.0.0.1:9222`. It auto-detects Playwright's bundled Chromium,
   system Chrome, or Edge; override with `MCP_CHROME_PATH` or
   `MCP_DEBUG_PORT`.
3. The client's Chrome DevTools MCP server attaches via the ignored local
   `.mcp.json` (`--browser-url=http://127.0.0.1:9222`). Restart the MCP client
   if it was already running.

First launch may require enabling Developer mode in `chrome://extensions` once;
the `.wxt/mcp-profile` user-data directory persists it.

### Firefox

Mozilla's official Firefox DevTools MCP server uses WebDriver BiDi and is
configured with the tracked template at
`docs/firefox-devtools-mcp.json`. Copy that template into the MCP client's
project/user configuration, then follow the project-specific guide in
`docs/firefox-devtools-mcp.md`.

For repeatable extension validation, use the repository's Firefox smoke suite:

```bash
bun run build:firefox
bun run test:e2e:firefox
```

The smoke suite packages `.output/firefox-mv3` as a temporary XPI, installs it
in a temporary Firefox session, verifies content-script injection, and tests the
`Alt+Shift+Z` autofill command (Firefox's default). Firefox WebDriver does not support the same
straightforward `moz-extension://` UI navigation used by the Chromium suite,
so use Firefox MCP primarily for page, console, network, screenshot, and
exploratory debugging; use the Chromium suite for deep extension-UI coverage.

Run Mozilla's current server with:

```text
npx -y @mozilla/firefox-devtools-mcp@latest
```

Use a dedicated profile and trusted pages only. MCP can inspect or modify
browser-accessible data, including cookies and sessions. Avoid connecting it to
a normal browsing profile.

### Safari

Apple's official Safari DevTools MCP server is built into Safari 27 and later
and Safari Technology Preview 247 and later. It runs from the system driver,
not an npm package, and is configured with the tracked template at
`docs/safari-devtools-mcp.json`. Copy that template into the MCP client's
project/user configuration, then follow the project-specific guide in
`docs/safari-devtools-mcp.md`.

Before connecting an agent, enable Safari → Settings → Advanced → **Show
features for web developers**, then Safari → Settings → Developer → **Allow
remote automation and external agents**. The default server command is:

```text
/usr/bin/safaridriver --mcp
```

Safari MCP is intended for live Safari page inspection, DOM interactions,
JavaScript evaluation, console/network diagnosis, screenshots, and exploratory
compatibility/accessibility debugging. Build the extension bundle and run the
WebKit engine smoke test separately:

```bash
bun run build:safari
bun run test:e2e:webkit
```

Use a trusted agent and keep sensitive tabs closed. Captured page content,
screenshots, console output, and evaluated results are sent to the MCP client;
the server itself runs locally.

Manual fallback (no MCP): drive the UI with a Playwright script like the e2e
suite does (`tests/e2e/`), run the browser-specific smoke suite, or attach the
browser's native DevTools.
