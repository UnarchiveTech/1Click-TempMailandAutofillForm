import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Entrypoint Parity (AGENTS.md Rule 1)', () => {
  const root = join(import.meta.dir, '..', '..', '..', 'src', 'entrypoints');
  const popupSrc = readFileSync(join(root, 'popup', 'Popup.svelte'), 'utf-8');
  const sidepanelSrc = readFileSync(join(root, 'sidepanel', 'Sidepanel.svelte'), 'utf-8');
  const appSrc = readFileSync(join(root, 'app', 'App.svelte'), 'utf-8');

  test('all entrypoint svelte files import AppLayout', () => {
    expect(popupSrc).toContain("import AppLayout from '@/ui/blocks/layout/AppLayout.svelte'");
    expect(sidepanelSrc).toContain("import AppLayout from '@/ui/blocks/layout/AppLayout.svelte'");
    expect(appSrc).toContain("import AppLayout from '@/ui/blocks/layout/AppLayout.svelte'");
  });

  test('all entrypoints gate only the initial locale load without remounting the UI later', () => {
    // Accept both a standalone isLoading import and a merged one (biome
    // organizeImports merges same-module imports); the invariant is that
    // Loading another dictionary must not destroy navigation or unsaved input.
    const isLoadingImport = "import { isLoading } from 'svelte-i18n'";
    expect(popupSrc).toContain(isLoadingImport);
    expect(sidepanelSrc).toContain(isLoadingImport);
    expect(appSrc).toContain('isLoading');
    expect(appSrc).toContain("from 'svelte-i18n'");
    for (const source of [popupSrc, sidepanelSrc, appSrc]) {
      expect(source).toContain('let initialLocaleReady = $state(false)');
      expect(source).toContain('if (!$isLoading) initialLocaleReady = true');
      expect(source).toContain('{#if !initialLocaleReady && $isLoading}');
    }
  });

  test('all entrypoint svelte files pass their respective context to AppLayout', () => {
    expect(popupSrc).toContain('<AppLayout context="popup" />');
    expect(sidepanelSrc).toContain('<AppLayout context="sidepanel" />');
    expect(appSrc).toContain('<AppLayout context="app" />');
  });
});
