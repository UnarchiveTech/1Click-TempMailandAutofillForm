# Source Directory Structure

This document outlines the current structure of the `src/` directory.

## Overview

```
src/
├── components/          # Reusable UI components
│   ├── feedback/       # Feedback components (toasts, notifications)
│   ├── icons/          # Icon components
│   ├── layout/         # Layout components (Header, Footer, ErrorBoundary)
│   ├── overlays/       # Overlay/dialog components
│   └── ui/             # General UI components
│       ├── account/    # Account-related UI components
│       └── mail/       # Mail-related UI components
├── composables/        # Reusable Svelte composables/hooks
├── config/             # Configuration files
│   └── providers/      # Email provider configurations
├── entrypoints/        # Extension entry points
│   ├── app/            # Full-page app entry point
│   ├── background/     # Background service worker
│   ├── content/        # Content script (injected into web pages)
│   ├── onboarding/     # Onboarding entry point
│   ├── popup/          # Popup entry point
│   └── sidepanel/      # Sidepanel entry point
├── features/           # Feature-specific business logic
│   ├── account/        # Account management features
│   ├── analytics/      # Activity tracking features
│   ├── archived-mail/  # Archived email features
│   ├── identities/     # Identity management features
│   ├── import-export/  # Import/export features
│   ├── inbox/          # Inbox/email management features
│   ├── keyboard-shortcuts/ # Keyboard shortcut features
│   ├── login-info/     # Saved login info features
│   ├── onboarding/     # Onboarding features
│   ├── qr/             # QR code features
│   ├── settings/       # Settings features
│   └── theme/          # Theme management features
├── lib/                # External libraries and utilities
│   └── locales/        # Internationalization files
├── services/           # Business logic services
│   └── dsl/            # Domain-specific language services
├── stores/             # State management (Svelte stores)
├── utils/              # Utility functions
└── views/              # Page/view components
```

## Detailed Breakdown

### components/
**Purpose:** Reusable UI components organized by type and functionality

- `feedback/` - Toast notifications and feedback UI
- `icons/` - 40+ icon components (AppLogo, IconAlertTriangle, etc.)
- `layout/` - Header, Footer, ErrorBoundary
- `overlays/` - Dialogs (ConfirmDialog, EditEmailDialog, QrDialog, TagDialog)
- `ui/` - General UI components
  - `account/` - AccountSelector, AccountCard
  - `mail/` - EmailList, MessageDetail, EmailDetail

### composables/
**Purpose:** Reusable Svelte 5 composables and hooks

- `useConfirmDialog.ts` - Dialog state management
- `useToast.ts` - Toast notification composable

### config/
**Purpose:** Application configuration

- `providers/` - Email provider configurations (burner.json, guerrilla.json, etc.)
- `providers.jsonc` - Main providers configuration (JSONC: comments + trailing commas allowed)
- `providers.schema.jsonc` - Schema validation (JSONC for inline docs)

### entrypoints/
**Purpose:** Extension entry points (popup, sidepanel, background, content scripts)

- `app/` - Full-page application entry point
- `background/` - Background service worker
  - `credentials/` - Credential management
  - `inbox/` - Inbox background processing
  - `parsing/` - Email parsing logic
  - `runtime/` - Runtime message handling
- `content/` - Content script injected into web pages
  - `autofill/` - Autofill functionality
  - `dom/` - DOM manipulation utilities
  - `otp/` - OTP detection and handling
- `onboarding/` - Onboarding flow entry point
- `popup/` - Popup entry point
- `sidepanel/` - Sidepanel entry point

### features/
**Purpose:** Feature-specific business logic organized by domain

- `account/` - Account management (tag-actions.ts)
- `analytics/` - Activity tracking (analytics-actions.ts)
- `archived-mail/` - Archived email handling (archived-actions.ts)
- `identities/` - Identity management (identity-actions.ts)
- `import-export/` - Import/export functionality (backup-manager.ts)
- `inbox/` - Inbox/email management
  - `email-filters.ts` - Email filtering logic
  - `inbox-actions.ts` - Inbox actions
  - `inbox-bulk-actions.ts` - Bulk operations
  - `inbox-export.ts` - Export functionality
  - `inbox-management.ts` - Inbox state management
- `keyboard-shortcuts/` - Keyboard shortcuts (shortcuts.ts)
- `login-info/` - Saved login info (login-actions.ts)
- `onboarding/` - Onboarding logic (onboarding-actions.ts)
- `qr/` - QR code generation (qr-actions.ts)
- `settings/` - Settings management (settings-actions.ts)
- `theme/` - Theme management (theme-actions.ts)

### lib/
**Purpose:** External libraries and third-party utilities

- `locales/` - i18n translation files (en.json, es.json, fr.json)
- `i18n.ts` - Internationalization setup

### services/
**Purpose:** Business logic services

- `email-service.ts` - Email service logic
- `ping-service.ts` - Provider ping service
- `dsl/` - Domain-specific language for email fetching
  - `email-fetcher.ts` - Email fetching DSL implementation
  - `README.md` - DSL documentation

### stores/
**Purpose:** Global state management (Svelte stores)

- `toastStore.ts` - Toast notification state

### utils/
**Purpose:** Utility functions and helpers

- `activity-tracker.ts` - Activity event tracking
- `constants.ts` - Application constants
- `crypto.ts` - Cryptographic utilities
- `errors.ts` - Error handling utilities
- `iconMapping.ts` - Icon keyword mapping for toasts
- `instance-manager.ts` - Provider instance management
- `logger.ts` - Logging utilities
- `provider-validation.ts` - Provider configuration validation
- `time.ts` - Time utilities
- `time.test.ts` - Time utilities tests
- `types.ts` - TypeScript type definitions
- `validation.ts` - Validation utilities
- `validation.test.ts` - Validation tests

### views/
**Purpose:** Page/view components

- `AboutView.svelte` - About page
- `ActivityView.svelte` - Activity tracking page
- `ExtensionSettingsView.svelte` - Extension settings page
- `IdentitiesView.svelte` - Identities management page
- `InboxView.svelte` - Main inbox view
- `MailManagementView.svelte` - Mail management page
- `SavedLoginInfoView.svelte` - Saved login info page

## Current Architecture Pattern

**Hybrid Approach:**
- **Feature-based** for business logic (`features/`)
- **Type-based** for UI components (`components/`)
- **Type-based** for utilities (`utils/`, `stores/`, `services/`)
- **Entrypoint-based** for extension contexts (`entrypoints/`)

This structure follows a hybrid pattern where:
- Feature-specific code is organized by domain in `features/`
- Shared/reusable code is organized by type in top-level folders
- Entry points are separated by extension context
