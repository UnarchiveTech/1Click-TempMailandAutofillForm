import {
  clearPendingProductTour,
  markProductTourCompleted,
} from '@/features/product-tour/tour-storage.js';
import type { View } from '@/features/types/view-types.js';
import type { ToastFn } from '@/ui/blocks/layout/use-toast.js';
import type { TranslateFn } from '@/utils/i18n/i18n-utils.js';
import type { Address } from '@/utils/types.js';

export interface ProductTourDeps {
  showToast: ToastFn;
  getTranslation: TranslateFn;
  setCurrentView: (v: View) => void;
  setProductTourOpen: (open: boolean) => void;
  getAllAddresses: () => Address[];
  getAccounts: () => Address[];
}

export async function startProductTour(deps: ProductTourDeps): Promise<void> {
  if (!deps.getAllAddresses().length && !deps.getAccounts().length) {
    try {
      await clearPendingProductTour();
    } catch {
      /* ignore */
    }
    return;
  }
  deps.setCurrentView('mailbox');
  deps.setProductTourOpen(true);
}

export async function finishProductTour(deps: ProductTourDeps): Promise<void> {
  deps.setProductTourOpen(false);
  try {
    await markProductTourCompleted();
    await clearPendingProductTour();
  } catch {
    /* ignore */
  }
  deps.setCurrentView('mailbox');
  deps.showToast(deps.getTranslation('productTour.completedToast'), 'success');
}

export async function skipProductTour(deps: ProductTourDeps): Promise<void> {
  deps.setProductTourOpen(false);
  try {
    await markProductTourCompleted();
    await clearPendingProductTour();
  } catch {
    /* ignore */
  }
  deps.setCurrentView('mailbox');
}
