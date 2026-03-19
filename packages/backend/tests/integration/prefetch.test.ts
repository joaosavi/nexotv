/**
 * Integration tests for SSRF protection in /api/prefetch.
 *
 * Each describe block uses vi.resetModules() + vi.doMock() to reload
 * prefetch.ts with the correct PREFETCH_ENABLED value (captured at module
 * load time). dns.promises.lookup is spied on to simulate DNS resolution
 * without making real network calls.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import dns from 'dns';

// ─── Shared base env ─────────────────────────────────────────────────────────

const baseEnv = {
  PREFETCH_ENABLED: true,
  PREFETCH_MAX_BYTES: 150000000,
  ALLOW_LOCAL_URLS: false,
  DEBUG: false,
  IP_RATE_LIMIT_ENABLED: false,
  IP_RATE_LIMIT_WINDOW_MS: 300000,
  IP_RATE_LIMIT_MAX: 300,
  CONFIG_SECRET: null,
  PORT: 7000,
};

// ─── Helper: build minimal app with a freshly loaded prefetch router ──────────

async function buildPrefetchApp(envOverrides: Record<string, unknown>): Promise<Express> {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json({ limit: '512kb' }));
  const { default: prefetchRouter } = await import('../../src/routes/prefetch');
  app.use(prefetchRouter);
  return app;
}

// ─── PREFETCH disabled ────────────────────────────────────────────────────────

describe('POST /api/prefetch (PREFETCH_ENABLED=false)', () => {
  let app: Express;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('../../src/config/env', () => ({
      default: { ...baseEnv, PREFETCH_ENABLED: false },
      repoRoot: '/tmp',
    }));
    app = await buildPrefetchApp({ PREFETCH_ENABLED: false });
  });

  afterAll(() => {
    vi.resetModules();
    vi.doUnmock('../../src/config/env');
  });

  it('returns 403 when PREFETCH_ENABLED=false', async () => {
    const res = await request(app)
      .post('/api/prefetch')
      .send({ url: 'http://example.com/list.m3u' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/disabled/i);
  });
});

// ─── SSRF protection (PREFETCH_ENABLED=true) ──────────────────────────────────

describe('SSRF protection in /api/prefetch', () => {
  let app: Express;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('../../src/config/env', () => ({
      default: { ...baseEnv, PREFETCH_ENABLED: true },
      repoRoot: '/tmp',
    }));
    app = await buildPrefetchApp({ PREFETCH_ENABLED: true });
  });

  afterAll(() => {
    vi.resetModules();
    vi.doUnmock('../../src/config/env');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Direct IP checks (blocked before DNS lookup) ──────────────────────────────

  it('blocks 10.0.0.1 (RFC 1918 class A)', async () => {
    const res = await request(app)
      .post('/api/prefetch')
      .send({ url: 'http://10.0.0.1/list.m3u' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Blocked host/i);
  });

  it('blocks 192.168.1.1 (RFC 1918 class C)', async () => {
    const res = await request(app)
      .post('/api/prefetch')
      .send({ url: 'http://192.168.1.1/list.m3u' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Blocked host/i);
  });

  it('blocks 172.16.0.1 (RFC 1918 class B lower bound)', async () => {
    const res = await request(app)
      .post('/api/prefetch')
      .send({ url: 'http://172.16.0.1/list.m3u' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Blocked host/i);
  });

  it('blocks 172.31.255.255 (RFC 1918 class B upper bound)', async () => {
    const res = await request(app)
      .post('/api/prefetch')
      .send({ url: 'http://172.31.255.255/list.m3u' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Blocked host/i);
  });

  it('blocks 127.0.0.1 (loopback)', async () => {
    const res = await request(app)
      .post('/api/prefetch')
      .send({ url: 'http://127.0.0.1/list.m3u' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Blocked host/i);
  });

  it('blocks 169.254.0.1 (link-local)', async () => {
    const res = await request(app)
      .post('/api/prefetch')
      .send({ url: 'http://169.254.0.1/list.m3u' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Blocked host/i);
  });

  // DNS-based SSRF check ──────────────────────────────────────────────────────

  it('blocks URL that DNS-resolves to private IP', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({
      address: '10.0.0.1',
      family: 4,
    } as dns.LookupAddress);

    const res = await request(app)
      .post('/api/prefetch')
      .send({ url: 'http://evil.internal.example/list.m3u' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Blocked host/i);
  });

  it('allows public IP after DNS validation (fetch is mocked)', async () => {
    vi.spyOn(dns.promises, 'lookup').mockResolvedValue({
      address: '93.184.216.34',
      family: 4,
    } as dns.LookupAddress);

    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null } as unknown as Headers,
      body: null,
    } as unknown as Response);

    const res = await request(app)
      .post('/api/prefetch')
      .send({ url: 'http://example.com/list.m3u' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
