import { describe, it, expect, vi, afterEach } from 'vitest';

// Mirror the pattern from unit/ssrf.test.ts: mock env so ALLOW_LOCAL_URLS is always
// false in these tests regardless of the local .env file.
const mockEnv = vi.hoisted(() => ({ ALLOW_LOCAL_URLS: false }));
vi.mock('../../src/config/env', () => ({ default: mockEnv, repoRoot: '/tmp' }));

import dns from 'dns';
import { validatePublicUrl } from '../../src/utils/validateUrl';
import { fetchData as m3uFetchData } from '../../src/providers/m3uProvider';
import { fetchData as xtreamFetchData } from '../../src/providers/xtreamProvider';

afterEach(() => {
  vi.restoreAllMocks();
  mockEnv.ALLOW_LOCAL_URLS = false;
});

// ---------------------------------------------------------------------------
// validatePublicUrl — unit-level tests
// ---------------------------------------------------------------------------

describe('validatePublicUrl', () => {
  it('throws for 127.0.0.1 hostname (literal private IP)', async () => {
    await expect(validatePublicUrl('http://127.0.0.1/playlist.m3u')).rejects.toThrow('Blocked host');
  });

  it('throws for 10.x.x.x hostname (literal private IP)', async () => {
    await expect(validatePublicUrl('http://10.0.0.1/playlist.m3u')).rejects.toThrow('Blocked host');
  });

  it('throws for 192.168.x.x hostname (literal private IP)', async () => {
    await expect(validatePublicUrl('http://192.168.1.1/api')).rejects.toThrow('Blocked host');
  });

  it('throws for 172.16.x.x hostname (literal private IP)', async () => {
    await expect(validatePublicUrl('http://172.16.0.1/api')).rejects.toThrow('Blocked host');
  });

  it('throws when hostname resolves to a private IP via DNS', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: '10.0.0.1', family: 4 });
    await expect(validatePublicUrl('http://internal.corp/playlist.m3u')).rejects.toThrow('Blocked host');
  });

  it('throws when hostname resolves to 127.0.0.1 via DNS', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: '127.0.0.1', family: 4 });
    await expect(validatePublicUrl('http://localhost-alias.example.com/')).rejects.toThrow('Blocked host');
  });

  it('throws for non-HTTP(S) protocols', async () => {
    await expect(validatePublicUrl('ftp://example.com/file')).rejects.toThrow('Only HTTP(S)');
  });

  it('throws for an invalid URL', async () => {
    await expect(validatePublicUrl('not-a-url')).rejects.toThrow('Invalid URL');
  });

  it('resolves without throwing for a public hostname', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: '93.184.216.34', family: 4 });
    await expect(validatePublicUrl('http://example.com/playlist.m3u')).resolves.toBeUndefined();
  });

  it('returns immediately for empty URL', async () => {
    await expect(validatePublicUrl('')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SSRF protection in m3uProvider
// ---------------------------------------------------------------------------

describe('SSRF protection in m3uProvider', () => {
  const makeAddon = (m3uUrl: string) => ({
    config: { m3uUrl, enableEpg: false },
    channels: [] as any[],
    epgData: {},
    idPrefix: 'test',
    log: { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} },
  });

  it('throws before fetching when m3uUrl has a private IP', async () => {
    await expect(m3uFetchData(makeAddon('http://10.0.0.1/playlist.m3u'))).rejects.toThrow('Blocked host');
  });

  it('throws before fetching when m3uUrl has 127.0.0.1', async () => {
    await expect(m3uFetchData(makeAddon('http://127.0.0.1/playlist.m3u'))).rejects.toThrow('Blocked host');
  });

  it('throws when m3uUrl hostname resolves to private IP', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: '192.168.1.100', family: 4 });
    await expect(m3uFetchData(makeAddon('http://private.corp/playlist.m3u'))).rejects.toThrow('Blocked host');
  });
});

// ---------------------------------------------------------------------------
// SSRF protection in xtreamProvider
// ---------------------------------------------------------------------------

describe('SSRF protection in xtreamProvider', () => {
  const makeAddon = (xtreamUrl: string) => ({
    config: {
      xtreamUrl,
      xtreamUsername: 'user',
      xtreamPassword: 'pass',
      enableEpg: false,
    },
    channels: [] as any[],
    epgData: {},
    idPrefix: 'test',
    log: { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} },
  });

  it('throws before fetching when xtreamUrl has a private IP', async () => {
    await expect(xtreamFetchData(makeAddon('http://10.0.0.1'))).rejects.toThrow('Blocked host');
  });

  it('throws before fetching when xtreamUrl has 127.0.0.1', async () => {
    await expect(xtreamFetchData(makeAddon('http://127.0.0.1'))).rejects.toThrow('Blocked host');
  });

  it('throws when xtreamUrl hostname resolves to private IP via DNS', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({ address: '172.16.0.1', family: 4 });
    await expect(xtreamFetchData(makeAddon('http://internal-xtream.corp'))).rejects.toThrow('Blocked host');
  });
});
