import { t } from '@/utils/i18n/i18n-utils.js';
import { logError } from '@/utils/logger.js';
import { rgbToHex } from '@/utils/theme/color-utils.js';

export interface QRSetters {
  setQrDialogOpen: (open: boolean) => void;
  setQrCanvas: (canvas: HTMLCanvasElement | null) => void;
  setShowToast: (message: string, type?: 'success' | 'error' | 'warning') => void;
}

export function openQrDialog(setters: QRSetters): void {
  // QrDialog is rendered through ModalDialog, which owns the shared dialog
  // lifecycle including focus trapping and restoration.
  setters.setQrDialogOpen(true);
}

export function closeQrDialog(
  setters: QRSetters,
  openTimerId?: ReturnType<typeof setTimeout> | null
): void {
  if (openTimerId != null) clearTimeout(openTimerId);
  setters.setQrDialogOpen(false);
}

export async function generateQRCode(canvas: HTMLCanvasElement, text: string, customColor: string) {
  if (!canvas || !text) {
    logError('QR error: Missing canvas or text', { canvas: !!canvas, text });
    return;
  }
  try {
    // Get the primary color from CSS variable or use custom color
    const primaryColor =
      customColor ||
      getComputedStyle(document.documentElement).getPropertyValue('--md-primary').trim() ||
      'var(--md-primary)';

    // Convert RGB to hex if necessary
    const darkColor = rgbToHex(primaryColor);
    const lightColor = rgbToHex(
      getComputedStyle(document.documentElement).getPropertyValue('--md-surface').trim() ||
        'var(--md-surface)'
    );

    const QRCode = await import('qrcode');
    await QRCode.toCanvas(canvas, text, {
      width: 160,
      margin: 2,
      color: {
        dark: darkColor,
        light: lightColor,
      },
    });
  } catch (e) {
    logError('QR error: Failed to generate QR code', {
      error: e instanceof Error ? e.message : String(e),
      text: text.substring(0, 50),
      canvas: !!canvas,
    });
  }
}

export async function downloadQrCode(
  qrCanvas: HTMLCanvasElement | null,
  selectedEmail: string,
  showToast: (message: string) => void
) {
  if (!qrCanvas) return;
  const link = document.createElement('a');
  link.download = `qr-${selectedEmail}.png`;
  link.href = qrCanvas.toDataURL();
  link.click();
  showToast(await t('toasts.qrCodeDownloaded'));
}

export async function copyQrImage(
  qrCanvas: HTMLCanvasElement | null,
  showToast: (message: string, type?: 'success' | 'error' | 'warning') => void
) {
  if (!qrCanvas) return;
  try {
    const blob = await new Promise<Blob | null>((resolve) => qrCanvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      throw new Error('Failed to generate image blob from canvas');
    }
    const item = new ClipboardItem({ 'image/png': blob });
    await navigator.clipboard.write([item]);
    showToast(await t('toasts.qrCodeCopiedToClipboard'));
  } catch (e) {
    logError('Failed to copy QR code:', e);
    showToast(await t('toasts.qrCodeCopyFailed'), 'error');
  }
}
