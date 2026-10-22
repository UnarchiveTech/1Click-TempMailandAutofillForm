import { browser } from 'wxt/browser';
import { withLock } from '@/utils/mutex.js';
import { isObjectRecord } from '@/utils/storage/storage-shape-guards.js';
import { writeWithRetry } from '@/utils/storage/storage-write.js';

/** Merge one checkbox into the latest map, including writes from other windows. */
export async function setPolicyReviewed(key: string, reviewed: boolean): Promise<void> {
  await withLock('policyReviewedMap_lock', async () => {
    const { policyReviewedMap } = await browser.storage.local.get('policyReviewedMap');
    const current = isObjectRecord(policyReviewedMap)
      ? Object.fromEntries(
          Object.entries(policyReviewedMap).filter(([, value]) => typeof value === 'boolean')
        )
      : {};
    await writeWithRetry({ policyReviewedMap: { ...current, [key]: reviewed } });
  });
}
