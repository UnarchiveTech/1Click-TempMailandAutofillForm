export type View =
  | 'main'
  | 'mailSettings'
  | 'settings'
  | 'analytics'
  | 'loginInfo'
  | 'archivedEmails'
  | 'emailDetail'
  | 'messageDetail'
  | 'about'
  | 'identities'
  /** Autofill manager: Profiles + Credentials tabs */
  | 'autofill'
  | 'keybindings'
  | 'tagManagement'
  | 'filtersManagement'
  | 'mailProvider'
  | 'storagePerformance'
  | 'labelManagement'
  | 'mailboxManagement'
  | 'constantsSettings'
  | 'diagnostics'
  /** Unified Tags / Labels / Filters hub */
  | 'organize'
  /** QA autofill playground */
  | 'playground';
