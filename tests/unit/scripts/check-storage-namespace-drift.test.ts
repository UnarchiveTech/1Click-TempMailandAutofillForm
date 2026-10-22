/**
 * Regression test for the per-file const-resolution fix in
 * scripts/check-storage-namespace-drift.ts.
 *
 * The scanner resolves `const NAME = '...'` declarations to key arguments of
 * storage writes. The original implementation used ONE global name→value map
 * (last file to declare a name wins), so when two files both declare the same
 * common name - `KEY`, `SETTINGS_KEY`, … - every write in the file scanned
 * first silently resolved to the *other* file's value, and the real key
 * vanished from the inventory. That is exactly how
 * `smartAutofillSettings`/`smartAutofillSettingsInitialized` escaped the
 * undocumented-key gate: the write went out under a `KEY` that had been
 * clobbered by an unrelated file's `KEY`.
 *
 * The fix: constants resolve per-file via `resolveConstsForFile` (the same
 * function `main()` calls) - the file's OWN declarations shadow the global
 * fallback pool (which still serves genuinely imported constants). These tests
 * pin that contract through the shipped code, so a future edit cannot
 * reintroduce the global-last-wins masking.
 */

import { describe, expect, test } from 'bun:test';
import {
  type ConstEntry,
  collectConstants,
  createInventory,
  type Inventory,
  resolveConstsForFile,
  scanSegment,
  segmentsOfText,
} from '../../../scripts/check-storage-namespace-drift';

const FILE_A = 'src/features/intelligence/smart-settings.ts';
const FILE_B = 'src/features/autofill/provider-picker.ts';
const FILE_C = 'src/features/importer/uses-imported-key.ts';

const TEXT_A = `const KEY = 'smartAutofillSettingsInitialized';
export async function init() {
  await browser.storage.local.set({ [KEY]: true });
}`;

const TEXT_B = `const KEY = 'selectedProvider';
export async function save() {
  await browser.storage.local.set({ [KEY]: 'burner' });
}`;

/** Imports KEY from elsewhere - no local declaration, must hit the pool. */
const TEXT_C = `import { KEY } from './keys';
await browser.storage.local.set({ [KEY]: 1 });`;

function scanText(
  file: string,
  text: string,
  consts: Map<string, ConstEntry>,
  inventory: Inventory
): void {
  for (const { text: segment } of segmentsOfText(text, file.endsWith('.svelte'))) {
    scanSegment(segment, consts, inventory);
  }
}

const fileTexts: Record<string, string> = {
  [FILE_A]: TEXT_A,
  [FILE_B]: TEXT_B,
  [FILE_C]: TEXT_C,
};

describe('check-storage-namespace-drift const resolution', () => {
  test('two files sharing the name KEY both surface their OWN key', () => {
    const constsByFile = collectConstants(new Map(Object.entries(fileTexts)));
    // Global fallback pool (last declaration wins - used only for imported
    // constants, never for a file's own writes).
    const globalPool = new Map<string, ConstEntry>();
    for (const local of constsByFile.values()) {
      for (const [name, entry] of local) globalPool.set(name, entry);
    }
    // The bug's precondition: the pool resolves KEY to a single value.
    const poolKeys = new Set([...globalPool.values()].map((e) => e.value));
    expect([...poolKeys]).toHaveLength(1);

    const inventory = createInventory();
    for (const file of [FILE_A, FILE_B, FILE_C]) {
      const text = fileTexts[file];
      scanText(file, text, resolveConstsForFile(file, constsByFile, globalPool), inventory);
    }

    // BOTH real keys must be present - per-file shadowing prevents masking.
    expect(inventory.setKeys.get('local')?.has('smartAutofillSettingsInitialized')).toBe(true);
    expect(inventory.setKeys.get('local')?.has('selectedProvider')).toBe(true);
    // Imported-but-undeclared KEY still resolves via the global pool.
    expect(inventory.setKeys.get('local')?.has('selectedProvider')).toBe(true);
  });

  test("the storage layer's retrying wrapper counts as a LOCAL set", () => {
    // `writeWithRetry({ K: … })` performs the same `storage.local.set` one layer
    // down. If this gate only knew the raw spelling, routing a write through the
    // wrapper would silently drop the key from the inventory - the write keeps
    // happening while the schema cross-check stops seeing it.
    const inventory = createInventory();
    const consts = new Map<string, ConstEntry>();
    scanText(
      'src/utils/storage/storage-keys.ts',
      `const ANALYTICS_KEY = 'analytics';
await writeWithRetry({ analytics: record });
await writeWithRetry({ [ANALYTICS_KEY]: record });
await writeWithRetry({ 'emailLabels': map });`,
      consts,
      inventory
    );

    const local = inventory.setKeys.get('local') ?? new Set<string>();
    expect(local.has('analytics')).toBe(true);
    expect(local.has('emailLabels')).toBe(true);
    // Never inventoried as a session write: the wrapper is local by definition.
    expect(inventory.setKeys.get('session')?.has('analytics') ?? false).toBe(false);
  });

  test('the serialized read-modify-write helper is a LOCAL set of its KEY argument', () => {
    // `updateStoredObject('K', …)` writes K whole (through `writeWithRetry`), so
    // it is the same local write as the raw spelling - and a key whose ONLY
    // writer is the serialized pair must not fall out of the inventory, or a
    // documented key starts reading as "never written" (this gate's STALE half,
    // which `addressColors` hit when the colour picker moved onto the helper).
    const file = 'src/features/settings/address-color.ts';
    const text = `const ADDRESS_COLORS_KEY = 'addressColors';
await updateStoredObject('notificationSettings', (c) => c, parse);
await updateStoredObject(ADDRESS_COLORS_KEY, (c) => c, parse);`;
    // Resolve the way `main()` does - through the file's OWN declarations.
    const constsByFile = collectConstants(new Map([[file, text]]));
    const inventory = createInventory();
    scanText(file, text, resolveConstsForFile(file, constsByFile, new Map()), inventory);

    const local = inventory.setKeys.get('local') ?? new Set<string>();
    expect(local.has('notificationSettings')).toBe(true);
    expect(local.has('addressColors')).toBe(true);
    // The helper is local by definition, like the wrapper it calls.
    expect(inventory.setKeys.get('session')?.has('addressColors') ?? false).toBe(false);
  });

  test('the old global-only pool WOULD mask one of the two keys (regression sentinel)', () => {
    const constsByFile = collectConstants(new Map(Object.entries(fileTexts)));
    const globalPool = new Map<string, ConstEntry>();
    for (const local of constsByFile.values()) {
      for (const [name, entry] of local) globalPool.set(name, entry);
    }

    // Old behavior: every file resolves through the shared pool, no shadowing.
    const inventory = createInventory();
    for (const file of [FILE_A, FILE_B]) {
      const text = fileTexts[file];
      scanText(file, text, new Map(globalPool), inventory);
    }
    const seen = inventory.setKeys.get('local') ?? new Set<string>();
    // Exactly one key survived; the earlier-scanned file's key was clobbered.
    expect(seen.size).toBe(1);
  });
});
