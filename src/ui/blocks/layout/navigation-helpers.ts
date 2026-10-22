import type { View } from '@/features/types/view-types.js';

export function headerBackTarget(view: View): View {
  switch (view) {
    case 'mailView':
      return 'mailbox';
    case 'addressView':
      return 'addresses';
    case 'tagManagement':
    case 'labelManagement':
    case 'filtersManagement':
      return 'organize';
    case 'mailProvider':
    case 'keybindings':
    case 'constantsSettings':
    case 'diagnostics':
    case 'storagePerformance':
    case 'addressAccentColors':
      return 'settings';
    default:
      return 'mailbox';
  }
}
