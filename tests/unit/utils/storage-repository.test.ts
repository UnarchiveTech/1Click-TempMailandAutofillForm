import { describe, expect, test } from 'bun:test';
import {
  createLockedListRepository,
  createStorageRepository,
  type StorageAreaLike,
} from '@/utils/storage/storage-repository.js';

function createMemoryArea(): StorageAreaLike {
  const values: Record<string, unknown> = {};
  return {
    get: async (keys) => {
      if (keys === null || keys === undefined) return { ...values };
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(
        requested.filter((key) => key in values).map((key) => [key, values[key]])
      );
    },
    set: async (items) => {
      Object.assign(values, items);
    },
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
  };
}

describe('createStorageRepository', () => {
  test('loads a stored value and falls back to a fresh default when absent', async () => {
    const area = createMemoryArea();
    const repository = createStorageRepository(area, 'settings', () => ({ enabled: false }));

    expect(await repository.load()).toEqual({ enabled: false });
    await repository.save({ enabled: true });
    expect(await repository.load()).toEqual({ enabled: true });
  });

  test('updates through one typed read-modify-write and removes the key', async () => {
    const area = createMemoryArea();
    const repository = createStorageRepository<number>(area, 'count', 0);

    expect(await repository.update((current) => current + 1, 'storage_repository_test_lock')).toBe(
      1
    );
    expect(await repository.load()).toBe(1);

    await repository.remove();
    expect(await repository.load()).toBe(0);
  });
});

describe('createLockedListRepository', () => {
  test('reject-mode protects capacity without truncating oversized legacy lists during cleanup', async () => {
    const area = createMemoryArea();
    await area.set({ rules: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
    const repo = createLockedListRepository<{ id: string }>(area, 'rules', {
      maxItems: 2,
      overflow: 'reject',
      lockName: 'repository_capacity_test',
    });
    await repo.update((items) => items.map((item) => ({ ...item })));
    expect(await repo.load()).toHaveLength(3);
    await expect(repo.update((items) => [...items, { id: 'd' }])).rejects.toThrow(
      'rule-limit-exceeded'
    );
    await repo.removeWhere((item) => item.id === 'c');
    expect(await repo.load()).toEqual([{ id: 'a' }, { id: 'b' }]);
  });
  test('serializes full-list save behind an in-flight locked update', async () => {
    const area = createMemoryArea();
    const repository = createLockedListRepository<{ id: string }>(area, 'items', {
      maxItems: 10,
      lockName: 'locked_list_save_test_lock',
    });
    await repository.save([{ id: 'initial' }]);

    let releaseUpdate: () => void = () => {};
    let updateStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      updateStarted = resolve;
    });
    const updateGate = new Promise<void>((resolve) => {
      releaseUpdate = resolve;
    });

    const updatePromise = repository.update(async (current) => {
      updateStarted();
      await updateGate;
      return [...current, { id: 'updated' }];
    });
    await started;

    // Save is invoked second, so the lock contract requires it to win after
    // the earlier update commits. An unlocked save can race and be overwritten
    // by the update's stale full-list write.
    const savePromise = repository.save([{ id: 'saved' }]);
    releaseUpdate();
    await Promise.all([updatePromise, savePromise]);

    expect(await repository.load()).toEqual([{ id: 'saved' }]);
  });
});
