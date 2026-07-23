# Architecture

## Directory Layout

```
src/
├── components/          Reusable Svelte 5 UI components
│   ├── feedback/        Toasts, offline banner
│   ├── icons/           AppLogo, Icon (40+ icons)
│   ├── layout/          Header, Footer, ErrorBoundary
│   ├── overlays/        Modal dialogs (Confirm, CreateInbox, QR, Tag)
│   └── ui/              General UI widgets
│       ├── account/     AccountSelector, AccountCard
│       └── mail/        EmailList, EmailDetail, MessageDetail, FilterList
├── features/             Domain modules (inbox, settings, analytics, …)
├── config/              Provider DSL configuration
│   ├── providers.jsonc          Main provider config (JSONC - comments allowed)
│   ├── providers.schema.jsonc   Schema (documentation; not runtime-enforced)
│   └── providers-standard-example.json
├── entrypoints/         Extension entry points
│   ├── app/             Full-page app (app.html)
│   ├── background/      MV3 service worker
│   │   ├── credentials/  Session credential management
│   │   ├── inbox/        Inbox creation, expiry, periodic checks, email storage
│   │   ├── parsing/      OTP extraction from email bodies
│   │   └── runtime/      Runtime message router
│   ├── content/         Content script (injected into web pages)
│   │   ├── autofill/     Form detection, button injection, form filling, generators
│   │   ├── disposable/   Disposable-email hint chip
│   │   ├── dom/          Positioning, tooltip
│   │   └── otp/          OTP input detection and autofill
│   ├── popup/           Toolbar popup (popup.html)
│   └── sidepanel/       Browser side panel (sidepanel.html)
├── features/            Feature-specific business logic (one folder per domain)
│   ├── account/          Tag actions
│   ├── analytics/        Activity tracking
│   ├── archived-mail/    Archived email actions
│   ├── identities/       Identity profile management
│   ├── inbox/            Email filters, inbox actions, bulk actions, export, management
│   ├── keyboard-shortcuts/  Shortcut handling
│   ├── login-info/       Saved-login actions + shared credential crypto
│   ├── message-window/   Message window actions
│   ├── onboarding/       Onboarding actions
│   ├── qr/               QR code generation
│   ├── settings/         Settings load/save, import/export, custom instances
│   ├── theme/            Theme mode, custom color, contrast
│   └── types/            Shared View type
├── lib/                 i18n setup
│   └── locales/          Translation files (en, ar, de, es, fr, ja, zh)
├── styles.css + styles/theme.css  App CSS entry + generated MD3 colors
├── utils/               Utility functions and shared services
│   ├── dsl/              Email-fetcher DSL (request building, response parsing, timestamp handling)
│   ├── activity-tracker.ts
│   ├── color-utils.ts
│   ├── constants.ts      Named constants (intervals, limits, lengths)
│   ├── crypto.ts         AES-GCM encrypt/decrypt, PBKDF2 hash/verify
│   ├── csv-export.ts
│   ├── email-mapper.ts   Map raw emails for display, extract OTP
│   ├── email-service.ts  Generic provider API client (config-driven)
│   ├── email-threads.ts  Subject normalization + conversation grouping
│   ├── errors.ts         Structured error types + i18n error messages
│   ├── favicon.ts        Favicon fetching, caching, domain parsing
│   ├── focusTrap.ts
│   ├── i18n-utils.ts
│   ├── iconMapping.ts    Toast icon keyword detection
│   ├── instance-manager.ts  Provider instance management
│   ├── logger.ts         Structured logging with levels
│   ├── ping-service.ts
│   ├── provider-validation.ts
│   ├── sanitize-html.ts  DOMPurify wrapper
│   ├── secure-random.ts  crypto.getRandomValues-based randomness
│   ├── storage-keys.ts   Typed storage accessors + helpers
│   ├── storage-snapshot.ts
│   ├── storageMonitor.ts
│   ├── theme-generator.ts  Material You seed→scheme generation
│   ├── time.ts           Time formatting helpers
│   ├── time-store.ts
│   ├── toastStore.ts
│   ├── types.ts          Shared TypeScript types (single source of truth)
│   └── validation.ts     Input validation + SSRF defense + color sanitization
└── views/               Page-level Svelte components (one per View)
```

### Architecture Pattern

**Hybrid:** feature-based for business logic (`features/`), type-based for UI
(`components/`), type-based for utilities (`utils/`), entrypoint-based for
extension contexts (`entrypoints/`). All three UI surfaces share a single
`AppLayout.svelte` component.

---

## UI Surfaces

| Surface | Entry point | When used |
|---------|-------------|-----------|
| Popup | `src/entrypoints/popup/` | Toolbar icon click |
| Sidepanel | `src/entrypoints/sidepanel/` | Browser side panel |
| App (full page) | `src/entrypoints/app/` | "Expand" from header, or notification click |

All three mount `AppLayout` with a `context` prop (`'popup' | 'sidepanel' | 'app'`).

---

## Dialogs / Overlays

Location: `src/components/overlays/`

| Component | Purpose |
|-----------|---------|
| `ConfirmDialog.svelte` | Generic yes/no confirmation (delete inbox, hard reset, etc.) |
| `CreateInboxDialog.svelte` | Choose random vs. custom username when creating an inbox |
| `QrDialog.svelte` | QR code of the selected email address (download / copy image) |
| `TagDialog.svelte` | Set or edit a tag + color on an inbox |

All four use a focus trap (`src/utils/focusTrap.ts`) and are modal overlays.

---

## Content-Script Popup (injected into web pages)

Location: `src/entrypoints/content/autofill/autofill-buttons.ts`

| Element | Purpose |
|---------|---------|
| Per-field autofill button | Small icon button next to each input - opens the per-field popup |
| Autofill popup | Dropdown with "Fill Email", "Generate Password", "Autofill Entire Form", etc. |
| "Fill All" pill | Button positioned above the form - fills every field at once. Shows **"Re-use identity"** when a saved disposable identity exists for the current domain + active inbox |
| Disposable hint chip | Inline suggestion under email fields to use a temp alias instead (`disposable-detector.ts`) |

These are **not** Svelte components - they are DOM elements injected by the
content script into the host page.

---

## Pages (Views)

View switching lives in `AppLayout.svelte` via a `currentView` state variable.
The `View` type is defined in `src/features/types/view-types.ts`.

| View key | Component | Purpose |
|----------|-----------|---------|
| `main` | (inline in AppLayout) | Inbox list + email reading - the default landing view |
| `mailSettings` | `MailManagementView.svelte` | Manage inboxes: archive, delete, export, bulk actions |
| `emailDetail` | `EmailDetail.svelte` | Single inbox: email list + actions (refresh, mark read, export) |
| `messageDetail` | `MessageDetail.svelte` | Single email body view (supports threaded view) |
| `settings` | `ExtensionSettingsView.svelte` | Extension settings (theme, color, provider, notifications) |
| `analytics` | `ActivityView.svelte` | Usage stats + activity log |
| `loginInfo` | `SavedLoginsView.svelte` | Saved disposable identities (per-fill record) |
| `identities` | `IdentitiesView.svelte` | Manage reusable identity profiles (names, password, phone) |
| `about` | `AboutView.svelte` | About / version / links |
| `keybindings` | `KeyboardShortcutsView.svelte` | View & customize keyboard shortcuts |
| `tagManagement` | `TagManagementView.svelte` | Manage inbox tags |
| `filtersManagement` | `FiltersManagementView.svelte` | Manage saved email filters |
| `labelManagement` | `LabelManagementView.svelte` | Manage email labels |
| `mailProvider` | `MailProviderView.svelte` | Choose provider, instances, domains, refresh interval |
| `storagePerformance` | `StoragePerformanceView.svelte` | Storage usage, favicon cache, email retention settings |
| `mailboxManagement` | `MailManagementView.svelte` | Same as `mailSettings` but reached from Settings nav |

### Navigation

- **Footer** (`src/components/layout/Footer.svelte`) - primary nav bar with
  Mailbox / Settings / Activity / Saved Logins tabs + unread badge.
- **Header** (`src/components/layout/Header.svelte`) - logo, theme toggle, and
  "expand to full page" button (opens `app.html`).
- **Settings sub-nav** (`src/components/ui/SettingsSubNav.svelte`) - secondary
  nav inside Settings leading to the management sub-pages.