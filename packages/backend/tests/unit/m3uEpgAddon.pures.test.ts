import { describe, it, expect, vi } from 'vitest';

// Mock all side-effectful dependencies before importing M3UEPGAddon.
// CACHE_ENABLED=false prevents the module-level sqliteCache.init() call.
vi.mock('../../src/config/env', () => ({
  default: {
    DEBUG: false,
    CACHE_ENABLED: false,
    CACHE_TTL_MS: 21600000,
    MAX_CACHE_ENTRIES: 300,
    IPTV_ORG_CACHE_TTL_MS: 21600000,
    M3U_CACHE_TTL_MS: 21600000,
    DATA_MEMORY_TTL_MS: 300000,
    SQLITE_PATH: null,
  },
  repoRoot: '/tmp',
}));

vi.mock('../../src/utils/sqliteCache', () => ({
  init: vi.fn(),
  get: vi.fn(() => null),
  set: vi.fn(),
  setRaw: vi.fn(),
  getRaw: vi.fn(() => null),
  del: vi.fn(),
  close: vi.fn(),
}));

vi.mock('../../src/providers/xtreamProvider', () => ({ fetchData: vi.fn() }));
vi.mock('../../src/providers/iptvOrgProvider', () => ({ fetchData: vi.fn() }));
vi.mock('../../src/providers/m3uProvider', () => ({ fetchData: vi.fn() }));

vi.mock('../../src/parsers/epgParser', () => ({
  parseEPG: vi.fn(),
  getCurrentProgram: vi.fn(),
  getUpcomingPrograms: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  makeLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { createCacheKey, M3UEPGAddon } from '../../src/addon/M3UEPGAddon';

// ─── createCacheKey ──────────────────────────────────────────────────────────

describe('createCacheKey', () => {
  it('produces the same key for configs with different key order', () => {
    const key1 = createCacheKey({
      provider: 'xtream',
      xtreamUrl: 'http://a.com',
      xtreamUsername: 'user',
      enableEpg: false,
      reformatLogos: false,
    });
    const key2 = createCacheKey({
      xtreamUsername: 'user',
      provider: 'xtream',
      enableEpg: false,
      xtreamUrl: 'http://a.com',
      reformatLogos: false,
    });
    expect(key1).toBe(key2);
  });

  it('produces different keys for different providers', () => {
    const key1 = createCacheKey({ provider: 'xtream', xtreamUrl: 'http://a.com' });
    const key2 = createCacheKey({ provider: 'm3u', m3uUrl: 'http://a.com' });
    expect(key1).not.toBe(key2);
  });

  it('strips non-essential fields (e.g., instanceId)', () => {
    const key1 = createCacheKey({
      provider: 'iptv-org',
      iptvOrgCountry: 'US',
      iptvOrgCategory: 'sports',
    });
    // instanceId is not part of the canonical minimal config for iptv-org
    const key2 = createCacheKey({
      provider: 'iptv-org',
      iptvOrgCountry: 'US',
      iptvOrgCategory: 'sports',
      instanceId: 'some-unique-id',
    });
    expect(key1).toBe(key2);
  });
});

// ─── generateMetaPreview ─────────────────────────────────────────────────────

describe('generateMetaPreview', () => {
  it('maps channel to Stremio meta preview shape', () => {
    const addon = new M3UEPGAddon({ provider: 'xtream', reformatLogos: false });
    const item = {
      id: 'xc_123',
      name: 'Test Channel',
      logo: 'http://logo.example.com/test.png',
      category: 'Sports',
    };
    const meta = addon.generateMetaPreview(item);
    expect(meta.id).toBe('xc_123');
    expect(meta.type).toBe('tv');
    expect(meta.name).toBe('Test Channel');
    expect(meta).toHaveProperty('poster');
  });

  it('includes id, type=tv, name, poster', () => {
    const addon = new M3UEPGAddon({ provider: 'xtream', reformatLogos: false });
    const item = { id: 'xc_456', name: 'Movie Channel', logo: '', category: 'Movies' };
    const meta = addon.generateMetaPreview(item);
    expect(meta).toMatchObject({ id: 'xc_456', type: 'tv', name: 'Movie Channel' });
    expect(typeof meta.poster).toBe('string');
    expect(meta.poster.length).toBeGreaterThan(0);
  });
});

// ─── deriveFallbackLogoUrl ───────────────────────────────────────────────────

describe('deriveFallbackLogoUrl', () => {
  it('returns original URL for standard image', () => {
    const addon = new M3UEPGAddon({ provider: 'xtream', reformatLogos: false });
    const item = { name: 'Test', logo: 'http://example.com/logo.png' };
    expect(addon.deriveFallbackLogoUrl(item)).toBe('http://example.com/logo.png');
  });

  it('proxies imgur URLs through wsrv.nl when reformatLogos=true', () => {
    // For xtream provider, reformatLogos is not forced to true by the constructor
    const addon = new M3UEPGAddon({ provider: 'xtream' });
    addon.config.reformatLogos = true;
    const item = { name: 'Test', logo: 'https://i.imgur.com/abc123.png' };
    const url = addon.deriveFallbackLogoUrl(item);
    expect(url).toContain('wsrv.nl');
  });
});
