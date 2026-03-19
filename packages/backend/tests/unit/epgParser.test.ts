import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseEPG,
  parseEPGTime,
  getCurrentProgram,
  getUpcomingPrograms,
} from '../../src/parsers/epgParser';
import { SAMPLE_XMLTV } from '../helpers/fixtures';

afterEach(() => {
  vi.useRealTimers();
});

// ─── parseEPG ────────────────────────────────────────────────────────────────

describe('parseEPG', () => {
  it('parses valid XMLTV and returns structured epgData map', async () => {
    // Fake time before all programs so none are filtered out by the cutoff
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T10:00:00Z'));
    const epgData = await parseEPG(SAMPLE_XMLTV);
    expect(typeof epgData).toBe('object');
    expect(epgData['cnn.us']).toBeDefined();
    expect(epgData['cnn.us'].length).toBeGreaterThan(0);
  });

  it('returns empty object on invalid XML', async () => {
    const result = await parseEPG('<not valid xml!!!');
    expect(result).toEqual({});
  });

  it('returns empty object on empty string', async () => {
    const result = await parseEPG('');
    expect(result).toEqual({});
  });

  it('handles multiple channels and programs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T10:00:00Z'));
    const xml = [
      '<?xml version="1.0"?>',
      '<tv>',
      '  <programme start="20260319120000 +0000" stop="20260319130000 +0000" channel="ch1">',
      '    <title>Show A</title>',
      '  </programme>',
      '  <programme start="20260319120000 +0000" stop="20260319130000 +0000" channel="ch2">',
      '    <title>Show B</title>',
      '  </programme>',
      '</tv>',
    ].join('\n');
    const epgData = await parseEPG(xml);
    expect(Object.keys(epgData)).toHaveLength(2);
    expect(epgData['ch1'][0].title).toBe('Show A');
    expect(epgData['ch2'][0].title).toBe('Show B');
  });
});

// ─── parseEPGTime ────────────────────────────────────────────────────────────

describe('parseEPGTime', () => {
  it('parses YYYYMMDDHHmmss +0000 format', () => {
    const d = parseEPGTime('20260319120000 +0000');
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(2); // March = index 2
    expect(d.getUTCDate()).toBe(19);
    expect(d.getUTCHours()).toBe(12);
    expect(d.getUTCMinutes()).toBe(0);
  });

  it('parses YYYYMMDDHHmmss +0300 with offset', () => {
    // 12:00 +03:00 and 09:00 +00:00 should be the same moment
    const withOffset = parseEPGTime('20260319120000 +0300');
    const utcEquiv = parseEPGTime('20260319090000 +0000');
    expect(withOffset.getTime()).toBe(utcEquiv.getTime());
  });

  it('applies epgOffsetHours correctly', () => {
    const base = parseEPGTime('20260319120000 +0000');
    const shifted = parseEPGTime('20260319120000 +0000', 2);
    expect(shifted.getTime()).toBe(base.getTime() + 2 * 3600000);
  });

  it('returns NaN for completely invalid string', () => {
    const d = parseEPGTime('not-a-date');
    expect(isNaN(d.getTime())).toBe(true);
  });
});

// ─── getCurrentProgram ───────────────────────────────────────────────────────

describe('getCurrentProgram', () => {
  const makeEpgData = () => ({
    'cnn.us': [
      {
        start: new Date('2026-03-19T12:00:00Z').getTime(),
        stop: new Date('2026-03-19T13:00:00Z').getTime(),
        title: 'CNN Newsroom',
        desc: 'Live news coverage',
      },
      {
        start: new Date('2026-03-19T13:00:00Z').getTime(),
        stop: new Date('2026-03-19T14:00:00Z').getTime(),
        title: 'The Situation Room',
        desc: '',
      },
    ],
  });

  it('returns current program for known channel at given time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:30:00Z'));
    const prog = getCurrentProgram(makeEpgData(), 'cnn.us');
    expect(prog).not.toBeNull();
    expect(prog!.title).toBe('CNN Newsroom');
  });

  it('returns null when no program active at given time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T11:00:00Z'));
    const prog = getCurrentProgram(makeEpgData(), 'cnn.us');
    expect(prog).toBeNull();
  });

  it('returns null for unknown channel', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:30:00Z'));
    const prog = getCurrentProgram(makeEpgData(), 'nonexistent');
    expect(prog).toBeNull();
  });
});

// ─── getUpcomingPrograms ─────────────────────────────────────────────────────

describe('getUpcomingPrograms', () => {
  const makeEpgData = () => ({
    'cnn.us': [
      {
        start: new Date('2026-03-19T12:00:00Z').getTime(),
        stop: new Date('2026-03-19T13:00:00Z').getTime(),
        title: 'CNN Newsroom',
        desc: 'Live',
      },
      {
        start: new Date('2026-03-19T13:00:00Z').getTime(),
        stop: new Date('2026-03-19T14:00:00Z').getTime(),
        title: 'The Situation Room',
        desc: '',
      },
      {
        start: new Date('2026-03-19T14:00:00Z').getTime(),
        stop: new Date('2026-03-19T15:00:00Z').getTime(),
        title: 'News Tonight',
        desc: '',
      },
    ],
  });

  it('returns N upcoming programs in order', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:30:00Z'));
    const upcoming = getUpcomingPrograms(makeEpgData(), 'cnn.us', 5);
    expect(upcoming.length).toBeGreaterThan(0);
    for (let i = 1; i < upcoming.length; i++) {
      expect(upcoming[i].startTime.getTime()).toBeGreaterThanOrEqual(
        upcoming[i - 1].startTime.getTime()
      );
    }
  });

  it('returns empty array when no future programs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T16:00:00Z')); // after all programs
    const upcoming = getUpcomingPrograms(makeEpgData(), 'cnn.us', 5);
    expect(upcoming).toEqual([]);
  });

  it('respects the limit parameter', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T12:30:00Z'));
    const upcoming1 = getUpcomingPrograms(makeEpgData(), 'cnn.us', 1);
    const upcoming2 = getUpcomingPrograms(makeEpgData(), 'cnn.us', 2);
    expect(upcoming1.length).toBeLessThanOrEqual(1);
    expect(upcoming2.length).toBeLessThanOrEqual(2);
    expect(upcoming2.length).toBeGreaterThanOrEqual(upcoming1.length);
  });
});
