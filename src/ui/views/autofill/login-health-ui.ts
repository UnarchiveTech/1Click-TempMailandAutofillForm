/**
 * Presentational helpers for the Saved Logins health scorecard.
 * Single source of truth for severity → tone/icon/label mapping so the
 * aggregate scorecard (LoginHealthScorecard.svelte) and the per-login chips
 * in SavedLoginsView.svelte never drift apart.
 */
import type {
  LoginHealthIssueKind,
  LoginHealthSeverity,
} from '@/features/login-info/login-auditor.js';

export type HealthSeverityTone = 'error' | 'warning' | 'neutral' | 'good';

/** Severity → semantic tone used to pick MD3 color tokens. */
export const LOGIN_HEALTH_SEVERITY_TONE: Record<LoginHealthSeverity, HealthSeverityTone> = {
  high: 'error',
  medium: 'warning',
  low: 'neutral',
};

/** Issue kind → icon name (Icon.svelte catalog). */
export const LOGIN_HEALTH_KIND_ICON: Record<LoginHealthIssueKind, string> = {
  expired_mailbox: 'warning',
  reused_password: 'warning',
  stale_login: 'schedule',
};

/** Issue kind → savedLoginInfo.* translation key. */
export const LOGIN_HEALTH_KIND_LABEL_KEY: Record<LoginHealthIssueKind, string> = {
  expired_mailbox: 'savedLoginInfo.healthExpiredMailbox',
  reused_password: 'savedLoginInfo.healthReusedPassword',
  stale_login: 'savedLoginInfo.healthStaleLogin',
};

/** Small pill chip classes used for issue rows and per-login issue badges. */
export function healthChipClass(tone: HealthSeverityTone, active = false): string {
  if (active) {
    return 'bg-md-primary text-md-on-primary ring-2 ring-md-primary/40';
  }
  switch (tone) {
    case 'error':
      return 'bg-md-error/15 text-md-error';
    case 'warning':
      return 'bg-md-warning/15 text-md-warning';
    case 'neutral':
      return 'bg-md-surface-variant text-md-on-surface/55';
    case 'good':
      return 'bg-md-primary/15 text-md-primary';
  }
}

/** Icon color tint for a tone (rows / summary header). */
export function healthIconTint(tone: HealthSeverityTone): string {
  switch (tone) {
    case 'error':
      return 'text-md-error';
    case 'warning':
      return 'text-md-warning';
    case 'neutral':
      return 'text-md-on-surface/50';
    case 'good':
      return 'text-md-primary';
  }
}

/** One aggregate row of the scorecard - count of logins with that issue. */
export type HealthKindSummary = {
  kind: LoginHealthIssueKind;
  severity: LoginHealthSeverity;
  count: number;
};

/** Whole-vault aggregate computed across every saved login. */
export type LoginHealthSummary = {
  /** Overall 0-100 (average of per-login scores), 100 when no logins. */
  score: number;
  total: number;
  /** Logins carrying at least one issue. */
  atRisk: number;
  kinds: HealthKindSummary[];
};
