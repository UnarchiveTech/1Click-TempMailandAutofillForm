import { normalizeNavIndicatorModes } from '@/utils/ui/nav-layout.js';

export interface NavbarPreferencesDeps {
  ext: Browser;
  setCustomNavOrder: (value: string[]) => void;
  setMinPrimaryItems: (value: unknown) => void;
  setAutoArrangeMore: (value: unknown) => void;
  setNavIndicatorModes: (value: unknown) => void;
}

export interface NavbarPreferencesController {
  start: () => Promise<() => void>;
}

export function createNavbarPreferencesController(
  deps: NavbarPreferencesDeps
): NavbarPreferencesController {
  return {
    start: async () => {
      const stored = (await deps.ext.storage.local.get([
        'customNavOrder',
        'minPrimaryItems',
        'autoArrangeMore',
        'navIndicatorModes',
      ])) as Record<string, unknown>;

      if (Array.isArray(stored.customNavOrder)) {
        deps.setCustomNavOrder(
          stored.customNavOrder.filter((value): value is string => typeof value === 'string')
        );
      }
      deps.setMinPrimaryItems(stored.minPrimaryItems);
      deps.setAutoArrangeMore(stored.autoArrangeMore);
      deps.setNavIndicatorModes(normalizeNavIndicatorModes(stored.navIndicatorModes));

      const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
        if (area !== 'local') return;
        if (changes.customNavOrder) {
          const value = changes.customNavOrder.newValue;
          deps.setCustomNavOrder(
            Array.isArray(value)
              ? value.filter((item): item is string => typeof item === 'string')
              : []
          );
        }
        if (changes.minPrimaryItems) {
          deps.setMinPrimaryItems(changes.minPrimaryItems.newValue);
        }
        if (changes.autoArrangeMore) {
          deps.setAutoArrangeMore(changes.autoArrangeMore.newValue);
        }
        if (changes.navIndicatorModes) {
          deps.setNavIndicatorModes(normalizeNavIndicatorModes(changes.navIndicatorModes.newValue));
        }
      };

      deps.ext.storage.onChanged.addListener(listener);
      return () => deps.ext.storage.onChanged.removeListener(listener);
    },
  };
}
