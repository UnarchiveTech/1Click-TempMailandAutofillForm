/**
 * Recovery path for inbox records evicted past the archived-inbox cap.
 *
 * When the archived count exceeds `maxArchivedAddresses`, expiry-manager moves
 * the OLDEST archived records out of `addresses` into `archivedAddressOverflow`
 * instead of destroying them. This module restores such a record: it pulls it
 * out of the overflow list, brings its Offline Saved mail back into the live
 * bag, and re-adds the account to `addresses` as active - from there the normal
 * renew / archive / unarchive flows apply exactly as for any other mailbox.
 */

import { restoreArchivedEmailsToStored } from '@/entrypoints/background/address/email-storage.js';
import { withAddressLock } from '@/utils/mutex.js';
import {
  getAddresses,
  getArchivedAddressOverflow,
  setAddresses,
  setArchivedAddressOverflow,
} from '@/utils/storage/storage-keys.js';

/**
 * Restore one evicted archived-inbox record from the overflow list back into
 * the live inbox list. Returns true when the record existed and was restored,
 * false when it was not found (already restored / never evicted).
 */
export async function restoreArchivedOverflowAddress(addressId: string): Promise<boolean> {
  let restored = false;
  await withAddressLock(async () => {
    const overflow = await getArchivedAddressOverflow();
    const idx = overflow.findIndex((record) => record.id === addressId);
    if (idx === -1) return;
    const [record] = overflow.splice(idx, 1);

    // Bring the Offline Saved history back into the live bag, then re-add the
    // record as active so renew / expiry / archive flows apply from here on.
    await restoreArchivedEmailsToStored(record.address);
    const addresses = await getAddresses();
    addresses.push({
      ...record,
      accountStatus: 'active',
      // Fresh notification flags - the next expiry cycle can warn again.
      expiredNotified: false,
      expiringSoonNotified: false,
    });
    await setAddresses(addresses);
    await setArchivedAddressOverflow(overflow);
    restored = true;
  });
  return restored;
}
