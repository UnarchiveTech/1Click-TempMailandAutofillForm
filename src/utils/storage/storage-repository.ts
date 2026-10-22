import { withLock } from '@/utils/mutex.js';
import { writeWithRetry } from './storage-write.js';

/** Minimal browser.storage area contract used by the repository helpers. */
export interface StorageAreaLike {
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

export interface StorageRepository<T> {
  load(): Promise<T>;
  save(value: T): Promise<void>;
  remove(): Promise<void>;
  update(updater: (current: T) => T | Promise<T>, lockName?: string): Promise<T>;
}

export interface LockedListRepository<T> {
  load(): Promise<T[]>;
  save(items: T[]): Promise<void>;
  update(updater: (current: T[]) => T[] | Promise<T[]>): Promise<T[]>;
  removeWhere(predicate: (item: T) => boolean): Promise<T[]>;
}

type DefaultValue<T> = T | (() => T);

function resolveDefault<T>(value: DefaultValue<T>): T {
  return typeof value === 'function' ? (value as () => T)() : value;
}

/**
 * Create a typed repository for one storage key. The primitive intentionally
 * does not swallow storage errors; feature repositories decide whether a read
 * failure should fall back, log, or surface to their caller.
 */
export function createStorageRepository<T>(
  area: StorageAreaLike,
  key: string,
  defaultValue: DefaultValue<T>
): StorageRepository<T> {
  const load = async (): Promise<T> => {
    const result = await area.get([key]);
    return key in result && result[key] !== undefined
      ? (result[key] as T)
      : resolveDefault(defaultValue);
  };

  // Writes go through the retry wrapper: a repository save that hits a
  // transient storage hiccup should land on the next attempt instead of
  // rejecting into a caller's error toast.
  const save = async (value: T): Promise<void> => {
    await writeWithRetry({ [key]: value }, { area });
  };

  const remove = async (): Promise<void> => {
    await area.remove([key]);
  };

  const update = async (updater: (current: T) => T | Promise<T>, lockName?: string): Promise<T> => {
    const run = async () => {
      const next = await updater(await load());
      await save(next);
      return next;
    };
    return lockName ? withLock(lockName, run) : run();
  };

  return { load, save, remove, update };
}

export interface LockedListRepositoryOptions<T> {
  maxItems: number;
  lockName: string;
  parse?: (value: unknown) => T[];
  /** Reject user-owned lists at capacity instead of silently evicting data. */
  overflow?: 'truncate' | 'reject';
  /** Runs after persistence, while the same mutation lock is still held. */
  onSaved?: (previous: T[], next: T[]) => Promise<void>;
}

/**
 * Create a capped, locked list repository. Parsing stays feature-owned so
 * malformed legacy records can be filtered without weakening the generic
 * storage primitive's type contract.
 */
export function createLockedListRepository<T>(
  area: StorageAreaLike,
  key: string,
  options: LockedListRepositoryOptions<T>
): LockedListRepository<T> {
  const storage = createStorageRepository<T[]>(area, key, []);
  const load = async (): Promise<T[]> => {
    const value = await storage.load();
    return options.parse ? options.parse(value) : value;
  };
  const save = async (items: T[]): Promise<void> => {
    await withLock(options.lockName, async () => {
      const previous = options.onSaved || options.overflow === 'reject' ? await load() : [];
      const parsed = options.parse ? options.parse(items) : items;
      if (
        options.overflow === 'reject' &&
        parsed.length > options.maxItems &&
        parsed.length > previous.length
      ) {
        throw new Error('rule-limit-exceeded');
      }
      const next = options.overflow === 'reject' ? parsed : parsed.slice(0, options.maxItems);
      await storage.save(next);
      await options.onSaved?.(previous, next);
    });
  };
  const update = async (updater: (current: T[]) => T[] | Promise<T[]>): Promise<T[]> => {
    return withLock(options.lockName, async () => {
      const current = await storage.load();
      const parsed = options.parse ? options.parse(current) : current;
      const next = await updater(parsed);
      if (
        options.overflow === 'reject' &&
        next.length > options.maxItems &&
        next.length > parsed.length
      ) {
        throw new Error('rule-limit-exceeded');
      }
      const bounded = options.overflow === 'reject' ? next : next.slice(0, options.maxItems);
      await storage.save(bounded);
      await options.onSaved?.(parsed, bounded);
      return bounded;
    });
  };
  const removeWhere = async (predicate: (item: T) => boolean): Promise<T[]> =>
    update((current) => current.filter((item) => !predicate(item)));

  return { load, save, update, removeWhere };
}
