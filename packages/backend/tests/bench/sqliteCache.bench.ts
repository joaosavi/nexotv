import { bench, describe, beforeAll, afterAll } from 'vitest';
import { init, set, get, close } from '../../src/utils/sqliteCache';

beforeAll(() => init(null)); // in-memory
afterAll(() => close());

describe('sqliteCache performance', () => {
  bench('1k set (compressed)', () => {
    for (let i = 0; i < 1000; i++) {
      set(`key:${i}`, { data: 'x'.repeat(1000), i }, 60000);
    }
  });

  bench('1k get', () => {
    for (let i = 0; i < 1000; i++) {
      get(`key:${i}`);
    }
  });
});
