import { bench, describe } from 'vitest';
import LRUCache from '../../src/utils/lruCache';

describe('LRUCache performance', () => {
  bench('10k sequential set+get', () => {
    const cache = new LRUCache({ max: 1000, ttl: 60000 });
    for (let i = 0; i < 10_000; i++) {
      cache.set(`key${i}`, i);
      cache.get(`key${i % 500}`);
    }
  });

  bench('LRU eviction under max', () => {
    const cache = new LRUCache({ max: 100, ttl: 60000 });
    for (let i = 0; i < 10_000; i++) {
      cache.set(`key${i}`, i);
    }
  });
});
