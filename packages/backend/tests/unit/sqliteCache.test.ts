import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Do NOT mock env here — sqliteCache.ts uses a runtime require('../config/env')
// that bypasses Vitest's ESM mock registry. The real env module loads fine
// (dotenv gracefully handles a missing .env), and since we pass ':memory:' to
// init(), the repoRoot value is fetched but never actually used.
import * as sqliteCache from '../../src/utils/sqliteCache';

describe('sqliteCache', () => {
  beforeEach(() => {
    // Use ':memory:' path for fully in-memory SQLite — no filesystem I/O
    sqliteCache.init(':memory:');
  });

  afterEach(() => {
    vi.useRealTimers();
    sqliteCache.close();
  });

  describe('set / get', () => {
    it('stores and retrieves a value', () => {
      sqliteCache.set('key1', { data: 'hello' }, 60000);
      expect(sqliteCache.get('key1')).toEqual({ data: 'hello' });
    });

    it('returns null for missing key', () => {
      expect(sqliteCache.get('nonexistent')).toBeNull();
    });

    it('returns null after TTL expires', () => {
      vi.useFakeTimers();
      sqliteCache.set('expiring', { x: 1 }, 1000);
      vi.advanceTimersByTime(1001);
      expect(sqliteCache.get('expiring')).toBeNull();
    });

    it('compresses with gzip and decompresses transparently', () => {
      const large = { data: 'x'.repeat(1000) };
      sqliteCache.set('compressed', large, 60000);
      expect(sqliteCache.get('compressed')).toEqual(large);
    });
  });

  describe('setRaw / getRaw', () => {
    it('stores and retrieves raw JSON without compression', () => {
      sqliteCache.setRaw('raw1', { raw: true }, 60000);
      expect(sqliteCache.getRaw('raw1')).toEqual({ raw: true });
    });

    it('returns null after TTL expires', () => {
      vi.useFakeTimers();
      sqliteCache.setRaw('raw-expire', { x: 1 }, 1000);
      vi.advanceTimersByTime(1001);
      expect(sqliteCache.getRaw('raw-expire')).toBeNull();
    });
  });

  describe('del', () => {
    it('removes an existing key', () => {
      sqliteCache.set('toDelete', 'value', 60000);
      sqliteCache.del('toDelete');
      expect(sqliteCache.get('toDelete')).toBeNull();
    });

    it('is a no-op for missing key', () => {
      expect(() => sqliteCache.del('nope')).not.toThrow();
    });
  });

  describe('cleanExpired', () => {
    it('deletes expired entries and returns count', () => {
      vi.useFakeTimers();
      sqliteCache.set('exp1', 'v1', 500);
      sqliteCache.set('exp2', 'v2', 500);
      sqliteCache.set('keep', 'v3', 60000);
      vi.advanceTimersByTime(600);
      const deleted = sqliteCache.cleanExpired();
      expect(deleted).toBe(2);
    });

    it('does not delete entries within TTL', () => {
      sqliteCache.set('live', 'value', 60000);
      const deleted = sqliteCache.cleanExpired();
      expect(deleted).toBe(0);
      expect(sqliteCache.get('live')).toEqual('value');
    });
  });

  describe('fallback to in-memory', () => {
    it('init(":memory:") returns a working in-memory database', () => {
      // beforeEach already called init(':memory:') — verify it works
      sqliteCache.set('mem-test', { inMemory: true }, 60000);
      expect(sqliteCache.get('mem-test')).toEqual({ inMemory: true });
    });
  });
});
