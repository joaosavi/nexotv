import { describe, it, expect } from 'vitest';
import { parseM3U } from '../../src/parsers/m3uParser';

describe('ReDoS protection in m3uParser', () => {
  it('completes parseM3U with 4096-char attr value in <100ms', () => {
    const evil = 'a'.repeat(4096);
    const m3u = `#EXTM3U\n#EXTINF:-1 tvg-id="${evil}",Test\nhttp://x.com\n`;
    const start = Date.now();
    parseM3U(m3u);
    expect(Date.now() - start).toBeLessThan(100);
  });

  // MAX_LINE_LENGTH is 4096. '#EXTINF:-1 ' (11) + ',Name' (5) = 16 chars of overhead.
  // repeat(1100) gives 4400 chars + 16 = 4416 > 4096.
  it('truncates or ignores lines longer than MAX_LINE_LENGTH', () => {
    const longLine = '#EXTINF:-1 ' + 'x=y '.repeat(1100) + ',Name';
    const m3u = `#EXTM3U\n${longLine}\nhttp://x.com\n`;
    expect(() => parseM3U(m3u)).not.toThrow();
  });

  it('skips the long EXTINF line (channel not added without valid EXTINF)', () => {
    const longLine = '#EXTINF:-1 ' + 'x=y '.repeat(1100) + ',Name';
    const m3u = `#EXTM3U\n${longLine}\nhttp://x.com\n`;
    const { channels } = parseM3U(m3u);
    // Line > MAX_LINE_LENGTH is skipped, so no pending channel exists when URL is seen
    expect(channels).toHaveLength(0);
  });

  it('still parses normal channels before and after a long line', () => {
    const longLine = '#EXTINF:-1 ' + 'a=b '.repeat(1100) + ',Evil';
    const m3u = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="good",Good Channel',
      'http://x.com/good',
      longLine,
      'http://x.com/evil',
      '#EXTINF:-1 tvg-id="also-good",Also Good',
      'http://x.com/also',
    ].join('\n');
    const { channels } = parseM3U(m3u);
    expect(channels).toHaveLength(2);
    expect(channels[0].tvgId).toBe('good');
    expect(channels[1].tvgId).toBe('also-good');
  });
});
