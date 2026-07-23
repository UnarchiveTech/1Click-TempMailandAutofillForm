import type { View } from '@/features/types/view-types.js';

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'auto' | 'center';

export interface ProductTourStep {
  /** Stable id for analytics / skip logic */
  id: string;
  /** i18n key under productTour.steps.<id>.title */
  titleKey: string;
  /** i18n key under productTour.steps.<id>.body */
  bodyKey: string;
  /**
   * CSS selector for the element to spotlight.
   * Prefer [data-tour="…"] attributes. Empty / missing → centered card.
   */
  target?: string;
  /** Navigate to this view before measuring the target */
  view?: View;
  /** Preferred tooltip placement relative to the target */
  placement?: TourPlacement;
  /** Extra padding around the spotlight hole (px) */
  padding?: number;
}

export const PRODUCT_TOUR_STORAGE_KEY = 'productTourCompleted';
export const PRODUCT_TOUR_PENDING_KEY = 'pendingProductTour';
export const PRODUCT_TOUR_VERSION_KEY = 'productTourVersion';
/** Bump when tour steps change so returning users can optionally re-see it. */
export const PRODUCT_TOUR_VERSION = 2;
