import { browser } from 'wxt/browser';
import {
  PRODUCT_TOUR_PENDING_KEY,
  PRODUCT_TOUR_STORAGE_KEY,
  PRODUCT_TOUR_VERSION,
  PRODUCT_TOUR_VERSION_KEY,
} from './tour-types.js';

export async function isProductTourCompleted(): Promise<boolean> {
  try {
    const res = (await browser.storage.local.get([
      PRODUCT_TOUR_STORAGE_KEY,
      PRODUCT_TOUR_VERSION_KEY,
    ])) as {
      [PRODUCT_TOUR_STORAGE_KEY]?: boolean;
      [PRODUCT_TOUR_VERSION_KEY]?: number;
    };
    if (!res[PRODUCT_TOUR_STORAGE_KEY]) return false;
    // Completed for an older version still counts as completed (user can replay)
    return true;
  } catch {
    return false;
  }
}

export async function markProductTourCompleted(): Promise<void> {
  await browser.storage.local.set({
    [PRODUCT_TOUR_STORAGE_KEY]: true,
    [PRODUCT_TOUR_VERSION_KEY]: PRODUCT_TOUR_VERSION,
    [PRODUCT_TOUR_PENDING_KEY]: false,
  });
}

export async function setPendingProductTour(pending: boolean): Promise<void> {
  await browser.storage.local.set({ [PRODUCT_TOUR_PENDING_KEY]: pending });
}

export async function isPendingProductTour(): Promise<boolean> {
  try {
    const res = (await browser.storage.local.get([PRODUCT_TOUR_PENDING_KEY])) as {
      [PRODUCT_TOUR_PENDING_KEY]?: boolean;
    };
    return !!res[PRODUCT_TOUR_PENDING_KEY];
  } catch {
    return false;
  }
}

export async function clearPendingProductTour(): Promise<void> {
  await browser.storage.local.set({ [PRODUCT_TOUR_PENDING_KEY]: false });
}
