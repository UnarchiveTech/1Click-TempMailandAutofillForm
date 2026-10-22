export type ToolbarButton =
  | 'star'
  | 'archive'
  | 'delete'
  | 'download'
  | 'forward'
  | 'markUnread'
  | 'print';
export type ToolbarButtonVisibility = Record<ToolbarButton, boolean>;

export const DEFAULT_TOOLBAR_BUTTON_VISIBILITY: ToolbarButtonVisibility = {
  star: true,
  archive: true,
  delete: true,
  download: true,
  forward: true,
  markUnread: true,
  print: true,
};

/** Missing, removed or malformed preferences preserve the default controls. */
export function parseToolbarButtonVisibility(raw: unknown): ToolbarButtonVisibility {
  const next = { ...DEFAULT_TOOLBAR_BUTTON_VISIBILITY };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return next;
  for (const key of Object.keys(next) as Array<keyof ToolbarButtonVisibility>) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'boolean') next[key] = value;
  }
  return next;
}
