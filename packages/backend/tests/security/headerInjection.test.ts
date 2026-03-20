import { describe, it, expect } from 'vitest';
import { parseM3U } from '../../src/parsers/m3uParser';

describe('Header injection protection in m3uParser', () => {
  it('strips CR from extracted user-agent', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1 user-agent="VLC\r\nX-Injected: evil",Test\nhttp://x.com\n';
    const { channels } = parseM3U(m3u);
    expect(channels[0].userAgent).not.toContain('\r');
    expect(channels[0].userAgent).not.toContain('\n');
  });

  it('strips LF from extracted user-agent', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1 user-agent="VLC\nX-Injected: evil",Test\nhttp://x.com\n';
    const { channels } = parseM3U(m3u);
    expect(channels[0].userAgent).not.toContain('\n');
  });

  it('strips null bytes from extracted referrer', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1 referrer="http://x.com\x00evil",Test\nhttp://x.com\n';
    const { channels } = parseM3U(m3u);
    expect(channels[0].referrer).not.toContain('\x00');
  });

  it('truncates user-agent values longer than 512 chars', () => {
    const long = 'a'.repeat(1000);
    const m3u = `#EXTM3U\n#EXTINF:-1 user-agent="${long}",Test\nhttp://x.com\n`;
    const { channels } = parseM3U(m3u);
    expect(channels[0].userAgent!.length).toBeLessThanOrEqual(512);
  });

  it('truncates referrer values longer than 512 chars', () => {
    const long = 'http://example.com/' + 'a'.repeat(1000);
    const m3u = `#EXTM3U\n#EXTINF:-1 referrer="${long}",Test\nhttp://x.com\n`;
    const { channels } = parseM3U(m3u);
    expect(channels[0].referrer!.length).toBeLessThanOrEqual(512);
  });

  it('sanitizes user-agent injected via #EXTVLCOPT', () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="ch",Test',
      '#EXTVLCOPT:http-user-agent=VLC\r\nX-Evil: hdr',
      'http://x.com',
    ].join('\n');
    const { channels } = parseM3U(m3u);
    expect(channels[0].userAgent).not.toContain('\r');
    expect(channels[0].userAgent).not.toContain('\n');
  });

  it('preserves clean user-agent values unchanged', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1 user-agent="Mozilla/5.0",Test\nhttp://x.com\n';
    const { channels } = parseM3U(m3u);
    expect(channels[0].userAgent).toBe('Mozilla/5.0');
  });
});
