import type { browser } from 'wxt/browser';
import { logDebug, logError, logWarn } from '@/utils/logger.js';

export interface TagSetters {
  onReloadAddresses: () => Promise<void>;
}

export async function updateAddressTag(
  accountId: string,
  tag: string,
  ext: typeof browser,
  setters: TagSetters,
  color?: string
): Promise<boolean> {
  logDebug(`[tag-actions] updateAddressTag called for: ${accountId}, tag: ${tag}, color: ${color}`);
  try {
    const response = await ext.runtime.sendMessage({
      type: 'updateAddressTag',
      addressId: accountId,
      tag,
      color,
    });
    logDebug(`[tag-actions] Message response: ${JSON.stringify(response)}`);
    if (response && (response as { success: boolean }).success) {
      logDebug('[tag-actions] Calling onReloadAddresses');
      await setters.onReloadAddresses();
      logDebug('[tag-actions] onReloadAddresses completed');
      return true;
    }
    // success:false (e.g. stale addressId deleted in another window) - the
    // tag was NOT applied; leave an explicit trace instead of silent fall-through.
    logWarn('[tag-actions] updateAddressTag rejected by background:', {
      accountId,
      error: (response as { error?: unknown } | undefined)?.error,
    });
    return false;
  } catch (e) {
    logError('Failed to update tag:', undefined, e instanceof Error ? e : new Error(String(e)));
    return false;
  }
}

/** Replace full multi-tag list on an address */
export async function updateAddressTags(
  accountId: string,
  tags: Array<{ name: string; color: string }>,
  ext: typeof browser,
  setters: TagSetters
): Promise<boolean> {
  try {
    const response = await ext.runtime.sendMessage({
      type: 'updateAddressTag',
      addressId: accountId,
      tags,
      tag: tags[0]?.name || '',
      color: tags[0]?.color,
    });
    if (response && (response as { success: boolean }).success) {
      await setters.onReloadAddresses();
      return true;
    }
    logWarn('[tag-actions] updateAddressTags rejected by background:', {
      accountId,
      error: (response as { error?: unknown } | undefined)?.error,
    });
    return false;
  } catch (e) {
    logError('Failed to update tags:', undefined, e instanceof Error ? e : new Error(String(e)));
    return false;
  }
}
