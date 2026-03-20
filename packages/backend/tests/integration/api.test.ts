/**
 * Integration tests for Express API routes (/encrypt, /api/capabilities,
 * /api/addon-info, /api/public-playlists, /api/prefetch).
 *
 * Each describe block reloads modules via vi.resetModules() + vi.doMock() to
 * isolate different env configurations, following the pattern in
 * tests/unit/cryptoConfig.test.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import fs from 'fs';

// ─── Shared base env ─────────────────────────────────────────────────────────

const baseEnv = {
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
};

// ─── Without CONFIG_SECRET ────────────────────────────────────────────────────

describe('API routes (without CONFIG_SECRET)', () => {
  let app: Express;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('../../src/config/env', () => ({
      default: { ...baseEnv, CONFIG_SECRET: null },
      repoRoot: '/tmp',
    }));
    const expressModule = await import('express');
    app = expressModule.default();
    app.use(expressModule.default.json({ limit: '512kb' }));
    const { default: apiRouter } = await import('../../src/routes/api');
    app.use(apiRouter);
  });

  afterAll(() => {
    vi.resetModules();
    vi.doUnmock('../../src/config/env');
  });

  describe('POST /encrypt', () => {
    it('returns 400 when CONFIG_SECRET not set', async () => {
      const res = await request(app).post('/encrypt').send({ test: 1 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Encryption not enabled/i);
    });
  });

  describe('GET /api/capabilities', () => {
    it('returns encryptionEnabled: false when no CONFIG_SECRET', async () => {
      const res = await request(app).get('/api/capabilities');
      expect(res.status).toBe(200);
      expect(res.body.encryptionEnabled).toBe(false);
    });
  });

  describe('GET /api/addon-info', () => {
    it('returns name, description, logoUrl', async () => {
      const res = await request(app).get('/api/addon-info');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('name');
      expect(res.body).toHaveProperty('description');
      expect(res.body).toHaveProperty('logoUrl');
    });

    it('sets Cache-Control: no-store', async () => {
      const res = await request(app).get('/api/addon-info');
      expect(res.headers['cache-control']).toMatch(/no-store/);
    });
  });

  describe('GET /api/public-playlists', () => {
    it('returns [] when file not found', async () => {
      vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      const res = await request(app).get('/api/public-playlists');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      vi.restoreAllMocks();
    });

    it('returns [] for non-array JSON', async () => {
      vi.spyOn(fs, 'readFileSync').mockReturnValueOnce('{"not":"an array"}' as any);
      const res = await request(app).get('/api/public-playlists');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      vi.restoreAllMocks();
    });
  });

  describe('POST /api/prefetch', () => {
    it('returns 400 for missing url', async () => {
      const res = await request(app).post('/api/prefetch').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Missing url/i);
    });

    it('returns 400 for non-http URL (file://)', async () => {
      const res = await request(app)
        .post('/api/prefetch')
        .send({ url: 'file:///etc/passwd' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Only http/i);
    });

    it('returns 400 for non-http URL (ftp://)', async () => {
      const res = await request(app)
        .post('/api/prefetch')
        .send({ url: 'ftp://example.com/file' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Only http/i);
    });

    it('returns 400 for RFC 1918 IP in URL (10.x.x.x)', async () => {
      const res = await request(app)
        .post('/api/prefetch')
        .send({ url: 'http://10.0.0.1/list.m3u' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Blocked host/i);
    });

    it('returns 400 for localhost URL', async () => {
      const res = await request(app)
        .post('/api/prefetch')
        .send({ url: 'http://localhost/test' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Blocked host/i);
    });
  });
});

// ─── With CONFIG_SECRET ───────────────────────────────────────────────────────

describe('API routes (with CONFIG_SECRET)', () => {
  let app: Express;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('../../src/config/env', () => ({
      default: { ...baseEnv, CONFIG_SECRET: 'test-secret-32-chars-long!!' },
      repoRoot: '/tmp',
    }));
    const expressModule = await import('express');
    app = expressModule.default();
    app.use(expressModule.default.json({ limit: '512kb' }));
    const { default: apiRouter } = await import('../../src/routes/api');
    app.use(apiRouter);
  });

  afterAll(() => {
    vi.resetModules();
    vi.doUnmock('../../src/config/env');
  });

  it('POST /encrypt returns token when CONFIG_SECRET is set and body is valid JSON', async () => {
    const res = await request(app)
      .post('/encrypt')
      .send({ provider: 'm3u', m3uUrl: 'http://example.com/list.m3u' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.token).toMatch(/^enc:/);
  });

  it('POST /encrypt returns 400 for malformed body', async () => {
    const res = await request(app)
      .post('/encrypt')
      .set('Content-Type', 'application/json')
      .send('not-valid-json');
    expect(res.status).toBe(400);
  });

  it('GET /api/capabilities returns encryptionEnabled: true when CONFIG_SECRET set', async () => {
    const res = await request(app).get('/api/capabilities');
    expect(res.status).toBe(200);
    expect(res.body.encryptionEnabled).toBe(true);
  });
});
