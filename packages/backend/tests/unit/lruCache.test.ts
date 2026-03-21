import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import LRUCache from '../../src/utils/lruCache';

describe('LRUCache', () => {
  let cache: LRUCache;

  beforeEach(() => {
    cache = new LRUCache({ max: 3, ttl: 1000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined for missing key', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('returns stored value', () => {
    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');
  });

  it('returns undefined after TTL expires', () => {
    vi.useFakeTimers();
    cache.set('key', 'value');
    vi.advanceTimersByTime(1001);
    expect(cache.get('key')).toBeUndefined();
  });

  it('does NOT evict before TTL expires', () => {
    vi.useFakeTimers();
    cache.set('key', 'value');
    vi.advanceTimersByTime(999);
    expect(cache.get('key')).toBe('value');
  });

  it('evicts oldest entry when max is exceeded', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // 'a' is oldest — should be evicted
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('promotes accessed key to most-recent position', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // Access 'a' → promotes it to most-recent, order: b, c, a
    cache.get('a');
    cache.set('d', 4); // should evict 'b' (now oldest)
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('evicts the correct key after promotion', () => {
    cache.set('x', 10);
    cache.set('y', 20);
    cache.set('z', 30);
    cache.get('x'); // promote 'x' → order: y, z, x
    cache.set('w', 40); // evicts 'y'
    expect(cache.get('y')).toBeUndefined();
    expect(cache.get('z')).toBe(30);
    expect(cache.get('x')).toBe(10);
    expect(cache.get('w')).toBe(40);
  });

  it('handles max=1 correctly', () => {
    const tiny = new LRUCache({ max: 1, ttl: 10000 });
    tiny.set('a', 1);
    tiny.set('b', 2);
    expect(tiny.get('a')).toBeUndefined();
    expect(tiny.get('b')).toBe(2);
  });

  it('has() promotes key like get()', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.has('a'); // promote 'a' → order: b, c, a
    cache.set('d', 4); // evicts 'b'
    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
  });

  it('delete() removes a key', () => {
    cache.set('key', 'value');
    cache.delete('key');
    expect(cache.get('key')).toBeUndefined();
  });

  it('clear() empties the cache', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });

  it('expires entries using fake timers', () => {
    vi.useFakeTimers();
    const timedCache = new LRUCache({ max: 10, ttl: 5000 });
    timedCache.set('x', 42);
    expect(timedCache.get('x')).toBe(42);
    vi.advanceTimersByTime(5001);
    expect(timedCache.get('x')).toBeUndefined();
  });

  describe('getSize()', () => {
    it('returns 0 for empty cache', () => {
      expect(cache.getSize()).toBe(0);
    });

    it('returns correct count after sets', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      expect(cache.getSize()).toBe(2);
    });

    it('counts TTL-expired entries that have not been lazy-evicted', () => {
      vi.useFakeTimers();
      cache.set('a', 1);
      vi.advanceTimersByTime(1001); // TTL expired
      // 'a' not accessed, so still in map
      expect(cache.getSize()).toBe(1);
    });
  });

  describe('evictLeastRecentlyUsed()', () => {
    it('removes the n oldest entries', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      const evicted = cache.evictLeastRecentlyUsed(2);
      expect(evicted).toBe(2);
      expect(cache.getSize()).toBe(1);
      // 'a' and 'b' are oldest (insertion order), 'c' stays
      expect(cache.get('a')).toBeUndefined();
      expect(cache.get('b')).toBeUndefined();
      expect(cache.get('c')).toBe(3);
    });

    it('respects LRU order — promoted entries are not evicted first', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.set('c', 3);
      cache.get('a'); // promotes 'a' to most-recent → order: b, c, a
      const evicted = cache.evictLeastRecentlyUsed(1);
      expect(evicted).toBe(1);
      expect(cache.get('b')).toBeUndefined(); // 'b' is now oldest
      expect(cache.get('a')).toBe(1);         // 'a' was promoted — survives
      expect(cache.get('c')).toBe(3);
    });

    it('returns actual evicted count when n exceeds cache size', () => {
      cache.set('a', 1);
      const evicted = cache.evictLeastRecentlyUsed(10);
      expect(evicted).toBe(1); // only 1 entry existed
      expect(cache.getSize()).toBe(0);
    });

    it('returns 0 and is a no-op on empty cache', () => {
      const evicted = cache.evictLeastRecentlyUsed(5);
      expect(evicted).toBe(0);
      expect(cache.getSize()).toBe(0);
    });
  });
});
