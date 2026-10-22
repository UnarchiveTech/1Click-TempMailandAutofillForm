import type { ToastFn } from '@/ui/blocks/layout/use-toast.js';
import {
  addToAutofillBlocklist,
  getAutofillBlocklist,
  normalizeBlocklistDomain,
  notifyAutofillBlocklistChanged,
  removeFromAutofillBlocklist,
  toggleAutofillBlocklist,
} from '@/utils/content/autofill-blocklist.js';
import type { TranslateFn } from '@/utils/i18n/i18n-utils.js';

export interface BlocklistSettingsDeps {
  showToast: ToastFn;
  getTranslation: TranslateFn;
  onBlocklistChanged: (list: string[]) => void;
}

export async function removeFromAutofillBlocklistSetting(
  deps: BlocklistSettingsDeps,
  domain: string
): Promise<void> {
  const removed = await removeFromAutofillBlocklist(domain);
  if (!removed) return;
  deps.onBlocklistChanged(await getAutofillBlocklist());
  void notifyAutofillBlocklistChanged();
  deps.showToast(deps.getTranslation('settings.domainRemovedFromBlocklist', { domain }), 'success');
}

export async function addToAutofillBlocklistSetting(
  deps: BlocklistSettingsDeps,
  domain: string
): Promise<void> {
  const cleaned = normalizeBlocklistDomain(domain);
  if (!cleaned) return;
  const added = await addToAutofillBlocklist(cleaned);
  if (!added) {
    deps.showToast(deps.getTranslation('settings.blocklistAlreadyAdded'), 'info');
    return;
  }
  deps.onBlocklistChanged(await getAutofillBlocklist());
  void notifyAutofillBlocklistChanged();
  deps.showToast(deps.getTranslation('settings.blocklistAdded', { domain: cleaned }), 'success');
}

export async function toggleAutofillBlocklistSetting(
  deps: BlocklistSettingsDeps,
  domain: string
): Promise<void> {
  const cleaned = normalizeBlocklistDomain(domain);
  if (!cleaned) return;
  const toggle = await toggleAutofillBlocklist(cleaned);
  if (!toggle.changed) {
    if (toggle.blocked)
      deps.showToast(deps.getTranslation('settings.blocklistAlreadyAdded'), 'info');
    return;
  }
  deps.onBlocklistChanged(await getAutofillBlocklist());
  void notifyAutofillBlocklistChanged();
  deps.showToast(
    toggle.blocked
      ? deps.getTranslation('settings.blocklistAdded', { domain: cleaned })
      : deps.getTranslation('settings.domainRemovedFromBlocklist', { domain: cleaned }),
    'success'
  );
}
