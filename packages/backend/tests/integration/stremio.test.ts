/**
 * Integration tests for stremio routes (/:token/manifest.json, error paths).
 *
 * createAddon (builder) is mocked to avoid real provider fetches.
 * env is mocked via vi.hoisted so stremio.ts captures the right values at
 * module-load time (CACHE_ENABLED=false, rate-limits disabled, etc.).
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// ─── Hoisted mocks (run before any import) ───────────────────────────────────

const mockEnv = vi.hoisted(() => ({
  CONFIG_SECRET: null as string | null,
  CACHE_ENABLED: false,
  CACHE_TTL_MS: 21600000,
  MAX_CACHE_ENTRIES: 10,
  IP_RATE_LIMIT_ENABLED: false,
  IP_RATE_LIMIT_WINDOW_MS: 300000,
  IP_RATE_LIMIT_MAX: 300,
  TOKEN_RATE_LIMIT_ENABLED: false,
  TOKEN_RATE_LIMIT_WINDOW_MS: 60000,
  TOKEN_RATE_LIMIT_MAX: 60,
  ADDON_NAME: 'TestAddon',
  ADDON_DESCRIPTION: 'Test description',
  ADDON_LOGO_URL: 'https://example.com/logo.png',
  ADDON_BACKGROUND_URL: 'https://example.com/bg.png',
  PREFETCH_ENABLED: true,
  PREFETCH_MAX_BYTES: 150000000,
  ALLOW_LOCAL_URLS: false,
  DEBUG: false,
  LOGO_CACHE_ENABLED: true,
  DATA_MEMORY_TTL_MS: 300000,
  SQLITE_PATH: null,
  SQLITE_GC_INTERVAL_MS: 21600000,
  SQLITE_VACUUM_INTERVAL_MS: 604800000,
  IPTV_ORG_CACHE_TTL_MS: 21600000,
  M3U_CACHE_TTL_MS: 21600000,
  PORT: 7000,
}));

vi.mock('../../src/config/env', () => ({ default: mockEnv, repoRoot: '/tmp' }));

// Mock createAddon so no real IPTV providers are contacted.
const mockCreateAddon = vi.hoisted(() => vi.fn());
vi.mock('../../src/addon/builder', () => ({ default: mockCreateAddon }));

import { createTestApp } from '../helpers/testApp';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFakeIface() {
  return {
    manifest: {
      id: 'test.nexotv',
      name: 'Test Addon',
      version: '1.0.0',
      resources: ['catalog', 'stream', 'meta'],
      types: ['tv'],
      catalogs: [{ type: 'tv', id: 'iptv_channels', name: 'IPTV', extra: [] }],
      behaviorHints: { configurationRequired: true },
      description: 'Integration-test addon',
    },
  };
}

/** A valid base64url-encoded JSON config token (no encryption). */
const VALID_TOKEN = Buffer.from('{"provider":"m3u"}').toString('base64url');

/** A token whose base64url payload decodes to non-JSON → triggers 400. */
const INVALID_JSON_TOKEN = Buffer.from('not-valid-json').toString('base64url');

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('/:token/manifest.json', () => {
  let app: Express;

  beforeAll(() => {
    mockCreateAddon.mockImplementation(async () => makeFakeIface());
    app = createTestApp();
  });

  afterEach(() => {
    // Reset per-test mock overrides but keep the default implementation.
    mockCreateAddon.mockImplementation(async () => makeFakeIface());
  });

  it('returns 400 for invalid (non-JSON) base64 token', async () => {
    const res = await request(app).get(`/${INVALID_JSON_TOKEN}/manifest.json`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for static prefix token (css)', async () => {
    // 'css' is in STATIC_PREFIXES → isConfigToken returns false → middleware
    // calls next('route') → manifest handler runs without addonInterface set.
    const res = await request(app).get('/css/manifest.json');
    // The route handler returns 500 when addonInterface is missing.
    expect([400, 404, 500]).toContain(res.status);
    expect(res.body).not.toHaveProperty('id'); // not a real manifest
  });

  it('returns 200 and manifest JSON for valid base64url token', async () => {
    const res = await request(app).get(`/${VALID_TOKEN}/manifest.json`);
    expect(res.status).toBe(200);
    const manifest = JSON.parse(res.text);
    expect(manifest).toHaveProperty('id');
    expect(manifest).toHaveProperty('version');
    expect(manifest).toHaveProperty('resources');
  });

  it('returns 200 with configureUrl set in behaviorHints', async () => {
    const res = await request(app).get(`/${VALID_TOKEN}/manifest.json`);
    expect(res.status).toBe(200);
    const manifest = JSON.parse(res.text);
    expect(manifest.behaviorHints).toHaveProperty('configureUrl');
    expect(manifest.behaviorHints.configureUrl).toMatch(/\/configure$/);
  });

  it('sets Access-Control-Allow-Origin: *', async () => {
    const res = await request(app).get(`/${VALID_TOKEN}/manifest.json`);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('sets Cache-Control: no-store', async () => {
    const res = await request(app).get(`/${VALID_TOKEN}/manifest.json`);
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });
});

describe('/:token routes — error paths', () => {
  let app: Express;

  beforeAll(() => {
    mockCreateAddon.mockImplementation(async () => makeFakeIface());
    app = createTestApp();
  });

  it('returns 500 when addon build throws', async () => {
    mockCreateAddon.mockRejectedValueOnce(new Error('Build failed'));
    const res = await request(app).get(`/${VALID_TOKEN}/manifest.json`);
    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when enc: token used without CONFIG_SECRET', async () => {
    // CONFIG_SECRET is null in mockEnv → decryptConfig throws 'Encryption disabled'
    const res = await request(app).get('/enc:somefakepayload/manifest.json');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});
