import { describe, it, expect } from 'vitest';
import { parseM3U } from '../../src/parsers/m3uParser';
import { SAMPLE_M3U, MALFORMED_M3U, generateLargeM3U } from '../helpers/fixtures';

describe('parseM3U', () => {
  it('returns empty array for empty string', () => {
    const { channels, epgUrl } = parseM3U('');
    expect(channels).toEqual([]);
    expect(epgUrl).toBeNull();
  });

  it('returns empty array for non-M3U content', () => {
    const { channels } = parseM3U('just some text without m3u headers');
    expect(channels).toEqual([]);
  });

  it('parses basic channel with name and URL', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1,My Channel\nhttp://stream.example.com/live';
    const { channels } = parseM3U(m3u);
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe('My Channel');
    expect(channels[0].url).toBe('http://stream.example.com/live');
  });

  it('extracts tvg-id, tvg-name, tvg-logo, group-title', () => {
    const { channels } = parseM3U(SAMPLE_M3U);
    const cnn = channels.find((c: any) => c.tvgId === 'cnn.us');
    expect(cnn).toBeDefined();
    expect(cnn!.tvgName).toBe('CNN');
    expect(cnn!.logo).toBe('http://logo.example.com/cnn.png');
    expect(cnn!.group).toBe('News');
  });

  it('extracts x-tvg-url from EXTM3U header', () => {
    const { epgUrl } = parseM3U(SAMPLE_M3U);
    expect(epgUrl).toBe('http://epg.example.com/guide.xml');
  });

  it('parses multiple channels correctly', () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="ch1",Channel One',
      'http://stream.example.com/ch1',
      '#EXTINF:-1 tvg-id="ch2",Channel Two',
      'http://stream.example.com/ch2',
    ].join('\n');
    const { channels } = parseM3U(m3u);
    expect(channels).toHaveLength(2);
    expect(channels[0].tvgId).toBe('ch1');
    expect(channels[1].tvgId).toBe('ch2');
  });

  it('falls back to null tvg-id when tvg-id attribute absent', () => {
    const m3u = '#EXTM3U\n#EXTINF:-1 tvg-name="No ID",No ID Channel\nhttp://stream.example.com/noid';
    const { channels } = parseM3U(m3u);
    expect(channels[0].tvgId).toBeNull();
  });

  it('handles CRLF line endings', () => {
    const m3u = '#EXTM3U\r\n#EXTINF:-1,CRLF Channel\r\nhttp://stream.example.com/crlf\r\n';
    const { channels } = parseM3U(m3u);
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe('CRLF Channel');
  });

  it('skips #EXTINF lines without a following URL', () => {
    const { channels } = parseM3U(MALFORMED_M3U);
    // MALFORMED_M3U has two #EXTINF but only one has a URL on the next line
    expect(channels).toHaveLength(1);
  });

  it('parses user-agent and referrer attributes', () => {
    const { channels } = parseM3U(SAMPLE_M3U);
    const espn = channels.find((c: any) => c.tvgId === 'espn.us');
    expect(espn).toBeDefined();
    expect(espn!.userAgent).toBe('VLC/3.0');
  });

  it('handles quoted and unquoted attribute values', () => {
    const m3u = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id=unquoted tvg-name="Quoted Name",Channel',
      'http://stream.example.com/ch',
    ].join('\n');
    const { channels } = parseM3U(m3u);
    expect(channels[0].tvgId).toBe('unquoted');
    expect(channels[0].tvgName).toBe('Quoted Name');
  });

  it('handles 10,000 channels without error', () => {
    const large = generateLargeM3U(10000);
    const { channels } = parseM3U(large);
    expect(channels).toHaveLength(10000);
  });
});
