import type { ToastType } from '@/ui/blocks/feedback/toast-types.js';
import { loadProviderConfig, type ProviderConfig } from '@/utils/email/email-service.js';
import type { TranslateFn } from '@/utils/i18n/i18n-utils.js';
import { logDebug } from '@/utils/logger.js';
import { withAddressLock } from '@/utils/mutex.js';
import { domainIndexKey } from '@/utils/storage/storage-keys.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';
import type { AddressSetters } from './address-actions.js';
import { createAddress as createAddressAction, migrateEmailBags } from './address-actions.js';

export interface AddressCreatorOptions {
  ext: Browser;
  addressSetters: AddressSetters;
  selectedProvider: string;
  selectedProviderInstance: string;
  showToast: (
    message: string | { message: string; type?: ToastType; icon?: ToastType },
    type?: ToastType,
    undoAction?: (() => void) | null,
    actionLabel?: string | null
  ) => void;
  getTranslation: TranslateFn;
  /** Set highlight on the addresses page for newly created address */
  setHighlightAddress: (addr: string | null) => void;
  /** Reload all addresses after mutation */
  reloadAddresses: (skipEmailSelection?: boolean) => Promise<void>;
  /** Navigate to mailbox view */
  navigateToMailbox: () => void;
  /** Navigate to addresses view */
  navigateToAddresses: () => void;
  /** Whether the addresses page is currently shown */
  isOnAddressesPage: () => boolean;
  /** Select an address as the active mailbox */
  setSelectedEmail: (email: string) => void;
  /** Set displayed email */
  setDisplayedEmail: (email: string) => void;
}

export async function createAddress(
  options: AddressCreatorOptions,
  provider?: string,
  instanceId?: string,
  emailUser?: string,
  preferredDomain?: string
): Promise<string | null> {
  const { ext, addressSetters, showToast, getTranslation } = options;

  // Demo isolation: never hit real providers while demoMode is on
  try {
    const { isDemoMode, createDemoAddress } = await import('@/features/demo/demo-mode.js');
    if (await isDemoMode(ext)) {
      const addr = await createDemoAddress(ext, emailUser);
      await options.reloadAddresses(false);
      if (addr) {
        options.setSelectedEmail(addr);
        options.setDisplayedEmail(addr);
        showToast(getTranslation('toasts.newAddressCreated'), 'success');
      }
      return addr;
    }
  } catch {
    /* fall through to real create */
  }

  const fromAddresses = options.isOnAddressesPage();
  let createdAddr = await createAddressAction(
    ext,
    addressSetters,
    provider,
    instanceId,
    emailUser,
    {
      skipToast: fromAddresses,
    }
  );

  // After create: try to inject/rescan the active tab (site may already be open)
  try {
    await ext.runtime.sendMessage({ type: 'ensureActiveTabAutofill' });
  } catch {
    /* background may be waking */
  }

  // Apply preferred multi-domain only to the NEWLY created inbox.
  if (preferredDomain && createdAddr) {
    try {
      await withAddressLock(async () => {
        const result = (await ext.storage.local.get(['addresses'])) as {
          addresses?: import('@/utils/types.js').Address[];
        };
        const list = result.addresses || [];
        const idx = list.findIndex((i) => i.address === createdAddr);
        if (idx >= 0 && list[idx]?.address) {
          const prevAddr = list[idx].address;
          const user = prevAddr.split('@')[0];
          const nextAddr = `${user}@${preferredDomain}`;
          let domains: string[] = [];
          try {
            domains = loadProviderConfig(list[idx].provider).multiDomain?.domains || [];
          } catch {
            domains = [];
          }
          if (domains.includes(preferredDomain) && prevAddr !== nextAddr) {
            list[idx] = { ...list[idx], address: nextAddr, emailUser: user };
            // Commit the address, active ID, storage index, and migrated mail
            // bags together. A failed migration leaves the old address intact.
            await migrateEmailBags(ext, prevAddr, nextAddr, {
              addresses: list,
              activeAddressId: list[idx].id,
            });
            options.setSelectedEmail(nextAddr);
            createdAddr = nextAddr;
            const di = domains.indexOf(preferredDomain);
            if (di >= 0) {
              await writeWithRetry({
                [domainIndexKey(list[idx].provider, user)]: di,
              });
            }
            await options.reloadAddresses(true);
            options.setSelectedEmail(nextAddr);
          }
        }
      });
    } catch (e) {
      logDebug(`Could not apply preferred domain: ${String(e)}`);
    }
  }

  if (fromAddresses && createdAddr) {
    options.setHighlightAddress(createdAddr);
    showToast(
      getTranslation('toasts.newAddressCreated'),
      'success',
      () => options.navigateToMailbox(),
      getTranslation('toasts.goToMailbox')
    );
  }
  return createdAddr;
}

export function openCreateAddressDialog(
  options: AddressCreatorOptions,
  provider?: string,
  instanceId?: string
): {
  pendingProvider: string | undefined;
  pendingInstanceId: string | undefined;
  pendingConfig: ProviderConfig | undefined;
  openDialog: boolean;
} {
  const resolvedProvider = provider || options.selectedProvider || undefined;
  const resolvedInstanceId =
    instanceId ||
    (options.selectedProviderInstance && options.selectedProviderInstance !== 'random'
      ? options.selectedProviderInstance
      : undefined);

  // Use JSON config to decide if a custom username dialog is needed
  if (resolvedProvider) {
    try {
      const config = loadProviderConfig(resolvedProvider);
      const supportsCustom =
        config.capabilities?.supportsCustomEmail ?? config.customEmail?.supported;
      if (!supportsCustom) {
        void createAddress(options, resolvedProvider, resolvedInstanceId);
        return {
          pendingProvider: undefined,
          pendingInstanceId: undefined,
          pendingConfig: undefined,
          openDialog: false,
        };
      }
    } catch (error) {
      logDebug(`Could not load provider config for ${resolvedProvider}: ${String(error)}`);
    }
  }

  return {
    pendingProvider: resolvedProvider,
    pendingInstanceId: resolvedInstanceId,
    pendingConfig: resolvedProvider ? loadProviderConfig(resolvedProvider) : undefined,
    openDialog: true,
  };
}

export async function handleCreateAddressWithProvider(
  options: AddressCreatorOptions,
  provider?: string,
  instanceId?: string
): Promise<{
  pendingProvider: string | undefined;
  pendingInstanceId: string | undefined;
  pendingConfig: ProviderConfig | undefined;
  openDialog: boolean;
}> {
  if (provider) {
    try {
      const config = loadProviderConfig(provider);
      const supportsCustom =
        config.capabilities?.supportsCustomEmail ?? config.customEmail?.supported;
      if (!supportsCustom) {
        await createAddress(options, provider, instanceId);
        return {
          pendingProvider: undefined,
          pendingInstanceId: undefined,
          pendingConfig: undefined,
          openDialog: false,
        };
      }
    } catch (error) {
      logDebug(`Could not load provider config for ${provider}: ${String(error)}`);
    }
  }
  return openCreateAddressDialog(options, provider, instanceId);
}

/** Handle the result of the create-address dialog (random or custom username). */
export async function handleCreateAddressResult(
  options: AddressCreatorOptions,
  pendingProvider: string | undefined,
  pendingInstanceId: string | undefined,
  type: 'random' | 'custom',
  username?: string,
  domain?: string
): Promise<string | null> {
  if (type === 'random') {
    return createAddress(options, pendingProvider, pendingInstanceId, undefined, domain);
  }
  return createAddress(options, pendingProvider, pendingInstanceId, username, domain);
}
