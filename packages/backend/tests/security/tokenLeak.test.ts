import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp';

const app = createTestApp();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Token leak in logs', () => {
  it('does not log the raw token when config parse fails', async () => {
    const invalidToken = 'THIS_IS_AN_INVALID_TOKEN_WITH_SECRETS_abc123xyz';

    const logCalls: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: any[]) => {
      logCalls.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'warn').mockImplementation((...args: any[]) => {
      logCalls.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      logCalls.push(args.map(String).join(' '));
    });

    await request(app).get(`/${invalidToken}/manifest.json`);

    const allLogs = logCalls.join('\n');
    expect(allLogs).not.toContain(invalidToken);

    spy.mockRestore();
  });

  it('returns 400 for an invalid token', async () => {
    const invalidToken = 'BAD_TOKEN_THAT_CANNOT_DECODE';
    const res = await request(app).get(`/${invalidToken}/manifest.json`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('response body does not echo the token back', async () => {
    const invalidToken = 'SECRET_CREDENTIAL_TOKEN_ABCDEF';
    const res = await request(app).get(`/${invalidToken}/manifest.json`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(invalidToken);
  });
});
