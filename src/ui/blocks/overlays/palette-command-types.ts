/**
 * Command palette entry model. Lives in a plain .ts module (not
 * CommandPalette.svelte) so .ts modules can import it under plain `tsc`,
 * which only exposes a default export on the ambient `*.svelte` shim.
 */
import type { KnownIconName } from '@/ui/components/icons/icon-names.js';

export type PaletteCommand = {
  id: string;
  label: string;
  hint?: string;
  /** Catalog glyph name - typed so a shared command table cannot name a blank. */
  icon?: KnownIconName;
  keywords?: string;
  /** Data records stay out of the default command list and appear on search. */
  queryOnly?: boolean;
  run: () => void;
};
