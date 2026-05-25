import { browser } from 'wxt/browser';
import { logError } from '@/utils/logger.js';
import type {
  Account,
  CredentialsHistoryItem,
  EmailHistoryItem,
  ExportData,
  ExportResult,
  ImportResult,
} from '@/utils/types.js';

async function exportData(): Promise<ExportResult> {
  try {
    const result = (await browser.storage.local.get([
      'emailHistory',
      'loginInfo',
      'darkMode',
      'inboxes',
      'activeInboxId',
    ])) as {
      emailHistory?: EmailHistoryItem[];
      loginInfo?: CredentialsHistoryItem[];
      darkMode?: string;
      inboxes?: Account[];
      activeInboxId?: string;
    };
    const {
      emailHistory = [],
      loginInfo = [],
      darkMode = '',
      inboxes = [],
      activeInboxId,
    } = result;

    const exportData: ExportData = {
      version: '3.0',
      exportDate: new Date().toISOString(),
      data: {
        emailHistory,
        loginInfo,
        settings: {
          darkMode: darkMode === 'true',
          activeAccountId: activeInboxId,
        },
        accounts: inboxes,
      },
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a') as HTMLAnchorElement;
    a.href = url;
    a.download = `oneclickautofill-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return { success: true };
  } catch (e: unknown) {
    logError('Error exporting data:', undefined, e instanceof Error ? e : new Error(String(e)));
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function importData(file: File): Promise<ImportResult> {
  try {
    const fileContent = await file.text();
    const importedData = JSON.parse(fileContent) as ExportData;

    if (!importedData.version || !importedData.data) {
      throw new Error('Invalid backup file format');
    }

    const { emailHistory = [], loginInfo = [], settings = {}, accounts = [] } = importedData.data;

    if (!Array.isArray(emailHistory) || !Array.isArray(loginInfo) || !Array.isArray(accounts)) {
      throw new Error('Invalid data format in backup file');
    }

    const raw2 = (await browser.storage.local.get(['emailHistory', 'loginInfo', 'inboxes'])) as {
      emailHistory?: EmailHistoryItem[];
      loginInfo?: CredentialsHistoryItem[];
      inboxes?: Account[];
    };
    const {
      emailHistory: existingEmails = [],
      loginInfo: existingCreds = [],
      inboxes: existingInboxes = [],
    } = raw2;

    const mergedEmails = [...existingEmails];
    emailHistory.forEach((newEmail: EmailHistoryItem) => {
      if (!mergedEmails.some((existing: EmailHistoryItem) => existing.email === newEmail.email)) {
        mergedEmails.push(newEmail);
      }
    });

    const mergedCreds = [...existingCreds];
    loginInfo.forEach((newCred: CredentialsHistoryItem) => {
      if (
        !mergedCreds.some(
          (existing: CredentialsHistoryItem) =>
            existing.domain === newCred.domain && existing.username === newCred.username
        )
      ) {
        mergedCreds.push(newCred);
      }
    });

    const mergedInboxes = [...existingInboxes];
    accounts.forEach((newInbox: Account) => {
      if (!mergedInboxes.some((existing: Account) => existing.id === newInbox.id)) {
        mergedInboxes.push(newInbox);
      }
    });

    const s = settings as { darkMode?: boolean; activeAccountId?: string };
    await browser.storage.local.set({
      emailHistory: mergedEmails,
      loginInfo: mergedCreds,
      inboxes: mergedInboxes,
      darkMode: s.darkMode ? 'true' : 'false',
      activeInboxId: s.activeAccountId,
    });

    return { success: true };
  } catch (e: unknown) {
    logError('Error importing data:', undefined, e instanceof Error ? e : new Error(String(e)));
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

declare global {
  interface Window {
    dataManager: {
      exportData: () => Promise<ExportResult>;
      importData: (file: File) => Promise<ImportResult>;
    };
  }
}

window.dataManager = {
  exportData,
  importData,
};

export { exportData, importData };
