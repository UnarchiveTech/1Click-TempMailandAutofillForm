export const LAST_BACKUP_AT_KEY = 'lastBackupExportAt';

/** Read the last successful backup export time for settings and recovery UI. */
export async function getLastBackupExportAt(ext: {
  storage: {
    local: { get: (keys: string[] | null) => Promise<Record<string, unknown>> };
  };
}): Promise<number | null> {
  try {
    const res = (await ext.storage.local.get([LAST_BACKUP_AT_KEY])) as {
      [LAST_BACKUP_AT_KEY]?: number;
    };
    const value = res[LAST_BACKUP_AT_KEY];
    return typeof value === 'number' && value > 0 ? value : null;
  } catch {
    /* ignore */
    return null;
  }
}
