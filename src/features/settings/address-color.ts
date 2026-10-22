import { parseStringRecord, updateStoredObject } from '@/utils/storage/rmw.js';
import { hexToHue, hslToHex } from '@/utils/theme/color-utils.js';

/** The per-inbox accent-colour map. Written by the colour picker and by the
 * domain-rewrite migration, both from the UI. */
const ADDRESS_COLORS_KEY = 'addressColors';

/**
 * Serialized read-modify-write of the accent-colour map.
 *
 * `storage.local.set` replaces the whole map, so the two flows that write it -
 * assigning a colour to an inbox that has none, and moving a legacy
 * address-keyed colour onto the inbox id when the domain is rewritten - each
 * read the map, edit it and write it back; whichever landed second erased the
 * other's inbox. The updater therefore runs against the map storage last held.
 *
 * The updater may legitimately have nothing to change (the migration finds no
 * colour for that inbox); it returns the value it was given, which writes the
 * map back identically - one redundant write, never a lost one.
 */
export function updateAddressColors(
  updater: (current: Record<string, string>) => Record<string, string>
): Promise<Record<string, string>> {
  return updateStoredObject(ADDRESS_COLORS_KEY, updater, parseStringRecord);
}

export function getAddressColor(
  address: string,
  addressId: string | undefined,
  addressColors: Record<string, string>,
  customColor: string,
  persistColors: (updater: (current: Record<string, string>) => Record<string, string>) => void
): string {
  if (!address && !addressId) return customColor || '#4c662b';
  const idKey = addressId || '';
  // Prefer id key; fall back to legacy address key once, then migrate to id
  if (idKey && addressColors[idKey]) {
    return addressColors[idKey];
  }
  if (address && addressColors[address]) {
    const legacy = addressColors[address];
    if (idKey) {
      persistColors((current) => {
        const next = { ...current, [idKey]: current[address] ?? legacy };
        delete next[address];
        return next;
      });
    }
    return legacy;
  }

  // Generate a random hue that doesn't conflict with existing active colors
  const activeHues = Object.values(addressColors)
    .map(hexToHue)
    .filter((h) => h !== null) as number[];

  let chosenHue = Math.floor(Math.random() * 360);
  let attempts = 0;

  while (attempts < 100) {
    const isTooClose = activeHues.some((h) => {
      const diff = Math.abs(h - chosenHue) % 360;
      const shortest = diff > 180 ? 360 - diff : diff;
      return shortest < 30; // at least 30 degrees apart
    });

    if (!isTooClose) break;
    chosenHue = Math.floor(Math.random() * 360);
    attempts++;
  }

  const generatedColor = hslToHex(chosenHue, 0.6, 0.45);
  const key = idKey || address;
  persistColors((current) => ({ ...current, [key]: generatedColor }));
  return generatedColor;
}
