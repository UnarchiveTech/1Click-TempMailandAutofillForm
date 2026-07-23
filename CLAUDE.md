# AGENTs

This document contains information about AI agents used in this project.

## Overview

Documentation about agent configurations, behaviors, and integration patterns.

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

#### Translation Completeness Tooling

An automated checker enforces the above rules at multiple levels:

| Layer | Command | When it runs |
|-------|---------|--------------|
| **Pre-commit hook** | `bun run check-translations` | On every `git commit` via Husky |
| **Unit test** | `bun test` | Locally and in CI - file: `src/utils/i18n-check.test.ts` |
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

### 4. Overlay / portal z-index scale (mandatory)

Single source of truth: `src/utils/portal-layers.ts` (`PORTAL_Z`).

| Layer | z-index | Rule |
|-------|--------:|------|
| Account selector overlay | **40** | Never raise above dialogs |
| Nav / more menus | ~100 | Below dialogs |
| Toasts | **9000** | Below modal dialogs |
| Confirm / Tag / Export dialogs | **10000** | Body-portaled |
| Product tour | 10050 | Above dialogs |
| App tooltips | 100000 | Highest |

**Rules:**
- Confirm/Tag/any blocking dialog MUST portal to `document.body` and use `PORTAL_Z.dialog` (or `z-[10000]`).
- Do **not** invent ad-hoc z-index values on overlays inside transformed ancestors.
- Document any new portal layer in `portal-layers.ts` before use.

### 5. Debugging & code quality strictness

When fixing bugs or adding features, agents MUST:

1. **Reproduce mentally** — identify the exact state machine (selection, drag, storage key, view).
2. **Prefer root cause** over UI workarounds (e.g. don’t raise z-index to hide stacking traps; portal instead).
3. **No silent `catch {}`** on user-visible paths without a toast, log, or intentional comment (`/* ignore */` only for non-critical).
4. **Typed messaging** — background `type:` strings that the UI depends on must stay consistent; avoid stringly-typed renames without grepping callers.
5. **Multi-select integrity** — any bulk action (tag, archive, delete, export) must apply to **all** selected ids, not only the first.
6. **Locale keys** — never ship UI English-only; add `en.json` + all locales before finishing.
7. **Entrypoint parity** — popup / sidepanel / app share `AppLayout`; do not fork feature logic per entrypoint.
8. **Svelte 5** — use `$state` / `$derived` / `$props` / `$effect`; no legacy `export let` for new code.
9. **No browser `confirm()` / `alert()`** — use ConfirmDialog / toast.
10. **DOM depth** — avoid pure pass-through wrappers (div/span/components) that add no layout, a11y, events, or state.

### 6. Cross-browser (Firefox / Safari) polish

- Use `browser` from `wxt/browser` (not `chrome.*` alone).
- Avoid Chrome-only APIs without feature detection (`browser.management`, optional permissions).
- Prefer standard CSS; keep `-webkit-overflow-scrolling: touch` and `scrollbar-width` for scroll containers.
- Manifest `browser_specific_settings.gecko` must stay valid; Safari builds use the same MV3 shell via WXT targets.
- Test critical paths (storage, alarms, content script fill) with opaque CORS / no-cors assumptions in mind.

### 7. Product positioning

This extension is **temp-mail + form autofill**, **not** a full password manager. Do not market or implement general vault-browser features beyond disposable identity replay of credentials the user already created with this extension.

## Agent Configurations

<!-- Add your agent configurations here -->

## Usage

<!-- Add usage instructions here -->
