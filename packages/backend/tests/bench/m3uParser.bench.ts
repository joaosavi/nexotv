import { bench, describe, it, expect } from 'vitest';
import { parseM3U } from '../../src/parsers/m3uParser';
import { generateLargeM3U } from '../helpers/fixtures';

const m3u_1k  = generateLargeM3U(1_000);
const m3u_10k = generateLargeM3U(10_000);
const m3u_50k = generateLargeM3U(50_000);

// Baseline (first run, 2026-03-19):
// 1k:  <20ms
// 10k: <150ms
// 50k: <800ms

describe('parseM3U performance', () => {
  bench('1k channels',  () => { parseM3U(m3u_1k); });
  bench('10k channels', () => { parseM3U(m3u_10k); });
  bench('50k channels', () => { parseM3U(m3u_50k); });
});

it('parseM3U with 50k channels does not exceed 200MB heap increase', () => {
  const before = process.memoryUsage().heapUsed;
  parseM3U(m3u_50k);
  const after = process.memoryUsage().heapUsed;
  const deltaMB = (after - before) / 1024 / 1024;
  expect(deltaMB).toBeLessThan(200);
});
