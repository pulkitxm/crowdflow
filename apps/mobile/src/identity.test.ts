import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => { store.set(key, value); },
  },
}));

const { storedPersonId, storePersonId, validPersonId } = await import('./identity');

beforeEach(() => store.clear());

describe('person identity', () => {
  it('accepts sequential positive whole numbers', () => {
    expect(validPersonId(1)).toBe(true);
    expect(validPersonId(500_000)).toBe(true);
    expect(validPersonId(0)).toBe(false);
    expect(validPersonId(1.5)).toBe(false);
  });

  it('stores and restores the selected person', async () => {
    await storePersonId(42);
    expect(await storedPersonId()).toBe(42);
  });

  it('rejects invalid values before storage', async () => {
    await expect(storePersonId(-1)).rejects.toThrow('positive whole number');
    expect(store.size).toBe(0);
  });

  it('ignores corrupt persisted values', async () => {
    store.set('crowdflow.person.v1', '01');
    expect(await storedPersonId()).toBeNull();
  });
});

