import { bench, describe, it, expect } from 'vitest';
import { parseEPG } from '../../src/parsers/epgParser';
import { generateLargeXMLTV } from '../helpers/fixtures';

const xml_small  = generateLargeXMLTV(10, 50);   // ~500 programs
const xml_medium = generateLargeXMLTV(100, 100);  // ~10k programs
const xml_large  = generateLargeXMLTV(500, 200);  // ~100k programs

// Baseline (first run, 2026-03-19):
// 500 programs:  <50ms
// 10k programs:  <500ms
// 100k programs: <5000ms

describe('parseEPG performance', () => {
  bench('500 programs',  async () => { await parseEPG(xml_small,  console); });
  bench('10k programs',  async () => { await parseEPG(xml_medium, console); });
  bench('100k programs', async () => { await parseEPG(xml_large,  console); });
});

it('parseEPG with 100k programs does not exceed 500MB heap increase', async () => {
  const before = process.memoryUsage().heapUsed;
  await parseEPG(xml_large, console);
  const after = process.memoryUsage().heapUsed;
  const deltaMB = (after - before) / 1024 / 1024;
  expect(deltaMB).toBeLessThan(500);
});
