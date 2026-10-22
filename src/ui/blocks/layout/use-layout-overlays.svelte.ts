import type { ToastType } from '@/ui/blocks/feedback/toast-types.js';
import type { PaletteCommand } from '@/ui/blocks/overlays/palette-command-types.js';
import type { ProviderConfig } from '@/utils/email/email-service.js';

export type QrDialogComponentType =
  | typeof import('@/ui/blocks/dialogs/QrDialog.svelte')['default']
  | null;

// Backup/export dialogs are lazy-loaded (same pattern as QrDialog): their
// feature code (backup-actions, webdav-sync, inbox-export) is heavy and only
// needed once the user opens a dialog. Types stay static for prop checking.
export type ExportBackupDialogComponentType =
  | typeof import('@/ui/blocks/dialogs/ExportBackupDialog.svelte')['default']
  | null;
export type ImportBackupDialogComponentType =
  | typeof import('@/ui/blocks/dialogs/ImportBackupDialog.svelte')['default']
  | null;
export type ExportWizardDialogComponentType =
  | typeof import('@/ui/blocks/dialogs/ExportWizardDialog.svelte')['default']
  | null;

export interface OverlayState {
  showExportBackupDialog: boolean;
  showImportBackupDialog: boolean;
  productTourOpen: boolean;
  demoModeActive: boolean;
  qrDialogOpen: boolean;
  qrCanvas: HTMLCanvasElement | null;
  qrOpenTimerId: ReturnType<typeof setTimeout> | null;
  QrDialogComponent: QrDialogComponentType;
  ExportBackupDialogComponent: ExportBackupDialogComponentType;
  ImportBackupDialogComponent: ImportBackupDialogComponentType;
  ExportWizardDialogComponent: ExportWizardDialogComponentType;
  createAddressDialogOpen: boolean;
  pendingCreateProviderConfig: ProviderConfig | undefined;
  exportWizardOpen: boolean;
  cheatSheetOpen: boolean;
  commandPaletteOpen: boolean;
  activeTooltip: { text: string; x: number; y: number; align?: 'center' | 'start' } | null;
  tooltipRef: HTMLElement | null;
}

export type OverlaySetters = {
  [K in keyof OverlayState as `set${Capitalize<K>}`]: (value: OverlayState[K]) => void;
};

export interface OverlayDomain {
  state: OverlayState;
  setters: OverlaySetters;
  cleanup: () => void;
}

export function createLayoutOverlays(): OverlayDomain {
  const state: OverlayState = $state({
    showExportBackupDialog: false,
    showImportBackupDialog: false,
    productTourOpen: false,
    demoModeActive: false,
    qrDialogOpen: false,
    qrCanvas: null,
    qrOpenTimerId: null,
    QrDialogComponent: null,
    ExportBackupDialogComponent: null,
    ImportBackupDialogComponent: null,
    ExportWizardDialogComponent: null,
    createAddressDialogOpen: false,
    pendingCreateProviderConfig: undefined,
    exportWizardOpen: false,
    cheatSheetOpen: false,
    commandPaletteOpen: false,
    activeTooltip: null,
    tooltipRef: null,
  });

  const cleanup = () => {
    if (state.qrOpenTimerId !== null) {
      clearTimeout(state.qrOpenTimerId);
      state.qrOpenTimerId = null;
    }
  };

  const setters: OverlaySetters = {
    setShowExportBackupDialog: (value) => (state.showExportBackupDialog = value),
    setShowImportBackupDialog: (value) => (state.showImportBackupDialog = value),
    setProductTourOpen: (value) => (state.productTourOpen = value),
    setDemoModeActive: (value) => (state.demoModeActive = value),
    setQrDialogOpen: (value) => (state.qrDialogOpen = value),
    setQrCanvas: (value) => (state.qrCanvas = value),
    setQrOpenTimerId: (value) => (state.qrOpenTimerId = value),
    setQrDialogComponent: (value) => (state.QrDialogComponent = value),
    setExportBackupDialogComponent: (value) => (state.ExportBackupDialogComponent = value),
    setImportBackupDialogComponent: (value) => (state.ImportBackupDialogComponent = value),
    setExportWizardDialogComponent: (value) => (state.ExportWizardDialogComponent = value),
    setCreateAddressDialogOpen: (value) => (state.createAddressDialogOpen = value),
    setPendingCreateProviderConfig: (value) => (state.pendingCreateProviderConfig = value),
    setExportWizardOpen: (value) => (state.exportWizardOpen = value),
    setCheatSheetOpen: (value) => (state.cheatSheetOpen = value),
    setCommandPaletteOpen: (value) => (state.commandPaletteOpen = value),
    setActiveTooltip: (value) => (state.activeTooltip = value),
    setTooltipRef: (value) => (state.tooltipRef = value),
  };

  return { state, setters, cleanup };
}

export type LayoutOverlays = ReturnType<typeof createLayoutOverlays>;
export type OverlayCleanup = () => void;
export type OverlayToastType = ToastType;
export type OverlayPaletteCommand = PaletteCommand;
