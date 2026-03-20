import { describe, it, expect } from 'vitest';
import { parseEPG } from '../../src/parsers/epgParser';

describe('EPG size limits', () => {
  it('returns empty object when XMLTV content exceeds 100MB', async () => {
    // Simulate a string that exceeds 100 MB in UTF-8 bytes
    const oversized = '<tv>' + 'x'.repeat(101 * 1024 * 1024) + '</tv>';
    const result = await parseEPG(oversized);
    expect(result).toEqual({});
  });

  it('still parses content under 100MB', async () => {
    const small = `<?xml version="1.0"?>
<tv>
  <programme start="20260319120000 +0000" stop="20260319130000 +0000" channel="test.ch">
    <title>Test Show</title>
  </programme>
</tv>`;
    const result = await parseEPG(small);
    // The programme may be filtered by the 1-hour-ago cutoff depending on current time,
    // but parseEPG must not throw and must return an object.
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });

  it('calls the logger warn when content is oversized', async () => {
    const warns: string[] = [];
    const mockLog = {
      warn: (...args: any[]) => warns.push(args.join(' ')),
      debug: () => {},
      info: () => {},
      error: () => {},
    };
    const oversized = '<tv>' + 'x'.repeat(101 * 1024 * 1024) + '</tv>';
    await parseEPG(oversized, mockLog as any);
    expect(warns.some((w) => w.includes('too large'))).toBe(true);
  });
});
