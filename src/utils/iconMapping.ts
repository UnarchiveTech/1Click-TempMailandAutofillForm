import type { ToastType } from '@/components/feedback/Toast.svelte';

/**
 * Universal keyword-to-icon mapping for toast notifications
 * Maps action keywords to their corresponding toast icon types (all 39 icons)
 */
export const ICON_KEYWORD_MAPPING: Record<string, ToastType> = {
  // Delete/Remove → deleted (trash icon)
  delete: 'deleted',
  deleted: 'deleted',
  remove: 'deleted',
  trash: 'deleted',

  // Archive/Unarchive → archived (archive icon)
  archive: 'archived',
  archived: 'archived',
  unarchive: 'archived',
  unarchived: 'archived',

  // Copy/Clone → copy (copy icon)
  copy: 'copy',
  copied: 'copy',
  clone: 'copy',

  // Export/Download → download (download icon)
  export: 'download',
  exported: 'download',
  download: 'download',
  downloaded: 'download',

  // Edit/Modify/Update → edit (edit icon)
  edit: 'edit',
  edited: 'edit',
  modify: 'edit',
  modified: 'edit',
  update: 'edit',
  updated: 'edit',
  change: 'edit',
  changed: 'edit',

  // Extend/Renew/Auto-extend → auto-renew (auto-renew icon)
  extend: 'auto-renew',
  extended: 'auto-renew',
  renew: 'auto-renew',
  renewed: 'auto-renew',
  'auto-extend': 'auto-renew',
  'auto extend': 'auto-renew',

  // Save → success (checkmark icon)
  save: 'success',
  saved: 'success',

  // Create/Add → plus (plus icon)
  create: 'plus',
  created: 'plus',
  add: 'plus',
  added: 'plus',
  'new': 'plus',

  // Login/Authentication → shield (shield icon)
  login: 'shield',
  'logged in': 'shield',
  authenticated: 'shield',
  auth: 'shield',
  signin: 'shield',
  'signed in': 'shield',

  // Error/Failed → error (alert triangle icon)
  error: 'error',
  failed: 'error',
  fail: 'error',
  cannot: 'error',
  unable: 'error',
  invalid: 'error',

  // Warning → warning (warning icon)
  warning: 'warning',
  warn: 'warning',

  // Expired/Expiry → expired (clock icon)
  expire: 'expired',
  expired: 'expired',
  expiry: 'expired',

  // Undo → back (back icon)
  undo: 'back',
  undone: 'back',
  revert: 'back',

  // Info/Information → info (info circle icon)
  info: 'info',
  information: 'info',

  // Back/Return → back (back icon)
  back: 'back',
  return: 'back',
  'go back': 'back',

  // Statistics/Analytics → chart (bar chart icon)
  stat: 'chart',
  stats: 'chart',
  statistics: 'chart',
  analytics: 'chart',
  chart: 'chart',

  // Notification → bell (bell icon)
  notification: 'bell',
  notify: 'bell',
  alert: 'bell',

  // Open/Expand → chevron-down (chevron down icon)
  open: 'chevron-down',
  expand: 'chevron-down',
  show: 'chevron-down',

  // Close/Collapse → chevron-up (chevron up icon)
  close: 'chevron-up',
  collapse: 'chevron-up',
  hide: 'chevron-up',

  // Email/Message → envelope (envelope icon)
  email: 'envelope',
  message: 'envelope',
  mail: 'envelope',

  // Filter → filter (filter icon)
  filter: 'filter',
  search: 'search',
  find: 'search',

  // Hot/Trending → flame (flame icon)
  hot: 'flame',
  trending: 'flame',
  popular: 'flame',

  // External/GitHub → github (github icon)
  github: 'github',
  external: 'github',
  'open in github': 'github',

  // Web/Internet → globe (globe icon)
  web: 'globe',
  internet: 'globe',
  online: 'globe',
  website: 'globe',

  // Inbox → inbox (inbox icon)
  inbox: 'inbox',
  mailbox: 'inbox',

  // Security/Lock → lock (lock icon)
  lock: 'lock',
  secure: 'lock',
  private: 'lock',
  protected: 'lock',

  // Screen/Display → monitor (monitor icon)
  screen: 'monitor',
  display: 'monitor',
  monitor: 'monitor',

  // Dark mode → moon (moon icon)
  dark: 'moon',
  night: 'moon',
  'dark mode': 'moon',

  // Light mode → sun (sun icon)
  light: 'sun',
  day: 'sun',
  'light mode': 'sun',

  // QR Code → qr (qr icon)
  qr: 'qr',
  qrcode: 'qr',
  scan: 'qr',

  // Refresh/Reload → refresh (refresh icon)
  refresh: 'refresh',
  reload: 'refresh',
  sync: 'refresh',

  // Settings → settings (settings icon)
  setting: 'settings',
  settings: 'settings',
  config: 'settings',
  configure: 'settings',
  preference: 'settings',

  // Tag/Label → tag (tag icon)
  tag: 'tag',
  label: 'tag',
  category: 'tag',

  // User/Profile → user (user icon)
  user: 'user',
  profile: 'user',
  account: 'user',

  // Success/Completed/Done → success (checkmark icon)
  success: 'success',
  completed: 'success',
  done: 'success',
  complete: 'success',
  finished: 'success',
  ok: 'success',
  ready: 'success',
};

/**
 * Detect toast icon type from message using universal keyword mapping
 */
export function detectIconFromMessage(message: string): ToastType {
  const lowerMessage = message.toLowerCase();

  // Check each keyword in the mapping
  for (const [keyword, iconType] of Object.entries(ICON_KEYWORD_MAPPING)) {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escapedKeyword}\\b`, 'i');
    if (regex.test(lowerMessage)) {
      return iconType;
    }
  }

  // Default fallback
  return 'success';
}
