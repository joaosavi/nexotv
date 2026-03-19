import type { AddonConfig } from '../../src/addon/M3UEPGAddon';

export function makeM3uConfig(overrides: Partial<AddonConfig> = {}): AddonConfig {
  return {
    provider: 'm3u',
    m3uUrl: 'http://example.com/playlist.m3u',
    epgUrl: '',
    epgOffsetHours: 0,
    ...overrides,
  };
}

export function makeXtreamConfig(overrides: Partial<AddonConfig> = {}): AddonConfig {
  return {
    provider: 'xtream',
    xtreamUrl: 'http://example.com',
    xtreamUsername: 'user',
    xtreamPassword: 'pass',
    ...overrides,
  };
}

export function makeIptvOrgConfig(overrides: Partial<AddonConfig> = {}): AddonConfig {
  return {
    provider: 'iptv-org',
    iptvOrgCountry: 'US',
    iptvOrgCategory: 'sports',
    ...overrides,
  };
}
