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

All mail provider logic must be JSON-driven using `src/config/providers.json`. Do not hardcode provider-specific logic in the code. Instead:

- Read provider configuration from `providers.json`
- Use `loadProviderConfig(provider)` to get provider settings
- Check configuration flags like `customEmail.supported`, `expiry.renewable`, etc.
- All provider-specific behaviors should be controlled via JSON configuration

### 3. Translation Updates

When making changes that affect user-facing text or labels, update the translation files:

- Translation files are located in `src/locales/` (e.g., `en.json`, `ar.json`, etc.)
- Add new translation keys for any new UI text
- Update existing keys if text changes
- Ensure all supported languages receive the same updates

## Common Patterns and Best Practices

### Storage Key Handling

When working with dynamic storage keys:

```typescript
// ✅ Correct - use dynamic key to access result
const storageKey = `selectedInstance_${providerId}` as const;
const result = await browser.storage.local.get([storageKey as any]) as Record<string, string>;
const selectedInstance = result[storageKey];

// ❌ Incorrect - destructuring with dynamic key doesn't work
const { [storageKey]: selectedInstance } = await browser.storage.local.get([storageKey as any]);
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

## Agent Configurations

<!-- Add your agent configurations here -->

## Usage

<!-- Add usage instructions here -->
