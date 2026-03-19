import { describe, it, expect, vi } from 'vitest';

// vi.mock is hoisted to the top of the file, so variables referenced in the
// factory must be initialised with vi.hoisted() to avoid TDZ errors.
const mockEnv = vi.hoisted(() => ({
  ADDON_NAME: 'TestAddon',
  ADDON_DESCRIPTION: 'Test description',
  ADDON_LOGO_URL: 'https://example.com/logo.png',
  ADDON_BACKGROUND_URL: 'https://example.com/bg.png',
}));
vi.mock('../../src/config/env', () => ({ default: mockEnv, repoRoot: '/tmp' }));

import { createManifest } from '../../src/addon/manifest';

describe('createManifest', () => {
  it('returns required Stremio manifest fields (id, name, version, resources, types)', () => {
    const m = createManifest();
    expect(m).toHaveProperty('id');
    expect(m).toHaveProperty('name');
    expect(m).toHaveProperty('version');
    expect(m.resources).toContain('catalog');
    expect(m.resources).toContain('stream');
    expect(m.resources).toContain('meta');
    expect(m.types).toContain('tv');
  });

  it('without idPrefix uses bare channel ID prefixes', () => {
    const m = createManifest();
    expect(m.idPrefixes).toEqual(expect.arrayContaining(['xc', 'io', 'm3']));
  });

  it('with idPrefix appends prefix to all three channel prefixes', () => {
    const m = createManifest('abc123');
    expect(m.idPrefixes).toContain('xcabc123_');
    expect(m.idPrefixes).toContain('ioabc123_');
    expect(m.idPrefixes).toContain('m3abc123_');
  });

  it('includes logo/background from env when set', () => {
    const m = createManifest();
    expect((m as any).logo).toBe('https://example.com/logo.png');
    expect((m as any).background).toBe('https://example.com/bg.png');
  });

  it('omits logo/background when env vars are empty', () => {
    const savedLogo = mockEnv.ADDON_LOGO_URL;
    const savedBg = mockEnv.ADDON_BACKGROUND_URL;
    mockEnv.ADDON_LOGO_URL = '';
    mockEnv.ADDON_BACKGROUND_URL = '';
    const m = createManifest();
    expect(m).not.toHaveProperty('logo');
    expect(m).not.toHaveProperty('background');
    mockEnv.ADDON_LOGO_URL = savedLogo;
    mockEnv.ADDON_BACKGROUND_URL = savedBg;
  });

  it('catalogs array has at least one entry', () => {
    const m = createManifest();
    expect(m.catalogs.length).toBeGreaterThan(0);
  });
});
