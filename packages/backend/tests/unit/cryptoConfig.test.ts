/**
 * cryptoConfig unit tests.
 *
 * CONFIG_SECRET is destructured at module-load time in cryptoConfig.ts, so each
 * describe block reloads the module via vi.resetModules() + vi.doMock() +
 * dynamic import to isolate different secret values.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// ─── with CONFIG_SECRET enabled ─────────────────────────────────────────────

describe('cryptoConfig with CONFIG_SECRET enabled', () => {
  let encryptConfig: (s: string) => string | null;
  let decryptConfig: (s: string) => any;
  let tryParseConfigToken: (s: string) => any;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('../../src/config/env', () => ({
      default: { CONFIG_SECRET: 'test-secret-32-chars-long!!' },
      repoRoot: '/tmp',
    }));
    const mod = await import('../../src/utils/cryptoConfig');
    encryptConfig = mod.encryptConfig;
    decryptConfig = mod.decryptConfig;
    tryParseConfigToken = mod.tryParseConfigToken;
  });

  afterAll(() => {
    vi.resetModules();
    vi.doUnmock('../../src/config/env');
  });

  describe('encryptConfig / decryptConfig', () => {
    it('round-trips a JSON string when CONFIG_SECRET is set', () => {
      const original = '{"provider":"m3u","url":"http://example.com"}';
      const token = encryptConfig(original)!;
      expect(token).toMatch(/^enc:/);
      expect(decryptConfig(token)).toEqual(JSON.parse(original));
    });

    it('different calls produce different ciphertexts (random IV)', () => {
      const json = '{"test":1}';
      const t1 = encryptConfig(json);
      const t2 = encryptConfig(json);
      expect(t1).not.toBe(t2);
    });

    it('throws when ciphertext is tampered (auth tag failure)', () => {
      const token = encryptConfig('{"data":"secret"}')!;
      const b64part = token.slice(4);
      const buf = Buffer.from(b64part, 'base64url');
      // Flip a byte in the ciphertext portion (after 12-byte IV + 16-byte tag = offset 28)
      if (buf.length > 28) buf[28] ^= 0xff;
      const tampered = 'enc:' + buf.toString('base64url');
      expect(() => decryptConfig(tampered)).toThrow();
    });
  });

  describe('tryParseConfigToken', () => {
    it('parses plain base64url token', () => {
      const obj = { provider: 'xtream', url: 'http://example.com' };
      const token = Buffer.from(JSON.stringify(obj)).toString('base64url');
      expect(tryParseConfigToken(token)).toEqual(obj);
    });

    it('parses base64url with URL-safe chars (- and _)', () => {
      // base64url never contains + or / — verify the round-trip still works
      const obj = { a: 1, b: 2, c: 3, d: 4, e: 5 };
      const token = Buffer.from(JSON.stringify(obj)).toString('base64url');
      expect(token).not.toMatch(/[+/]/);
      expect(tryParseConfigToken(token)).toEqual(obj);
    });

    it('decrypts enc: token when CONFIG_SECRET matches', () => {
      const obj = { provider: 'm3u', m3uUrl: 'http://example.com/list.m3u' };
      const token = encryptConfig(JSON.stringify(obj))!;
      expect(tryParseConfigToken(token)).toEqual(obj);
    });

    it('throws on malformed base64', () => {
      expect(() => tryParseConfigToken('!!!!!')).toThrow();
    });

    it('throws on valid base64 but invalid JSON', () => {
      const token = Buffer.from('this is not json').toString('base64');
      expect(() => tryParseConfigToken(token)).toThrow('Invalid JSON config');
    });
  });

  describe('base64url edge cases', () => {
    it('handles padding remainder 0, 1, 2', () => {
      // Payloads of varying lengths produce different padding in base64
      const objs = [{ a: 1 }, { ab: 12 }, { abc: 123 }];
      for (const obj of objs) {
        const token = Buffer.from(JSON.stringify(obj)).toString('base64url');
        expect(tryParseConfigToken(token)).toEqual(obj);
      }
    });
  });
});

// ─── without CONFIG_SECRET ──────────────────────────────────────────────────

describe('cryptoConfig without CONFIG_SECRET', () => {
  let encryptConfig: (s: string) => string | null;
  let decryptConfig: (s: string) => any;

  beforeAll(async () => {
    vi.resetModules();
    vi.doMock('../../src/config/env', () => ({
      default: { CONFIG_SECRET: null },
      repoRoot: '/tmp',
    }));
    const mod = await import('../../src/utils/cryptoConfig');
    encryptConfig = mod.encryptConfig;
    decryptConfig = mod.decryptConfig;
  });

  afterAll(() => {
    vi.resetModules();
    vi.doUnmock('../../src/config/env');
  });

  it('returns null from encryptConfig when no CONFIG_SECRET', () => {
    expect(encryptConfig('{"foo":"bar"}')).toBeNull();
  });

  it('throws when decryptConfig receives enc: token without CONFIG_SECRET', () => {
    expect(() => decryptConfig('enc:somepayload')).toThrow('Encryption disabled');
  });
});

// ─── wrong key decryption ────────────────────────────────────────────────────

describe('cryptoConfig wrong key decryption', () => {
  let encryptedToken: string;
  let tryParseWithWrongKey: (s: string) => any;

  beforeAll(async () => {
    // Encrypt a token with key1
    vi.resetModules();
    vi.doMock('../../src/config/env', () => ({
      default: { CONFIG_SECRET: 'test-secret-key-number-one!!!!' },
      repoRoot: '/tmp',
    }));
    const mod1 = await import('../../src/utils/cryptoConfig');
    encryptedToken = mod1.encryptConfig('{"data":"secret"}')!;

    // Reload module with a completely different key
    vi.resetModules();
    vi.doMock('../../src/config/env', () => ({
      default: { CONFIG_SECRET: 'completely-different-secret-!!' },
      repoRoot: '/tmp',
    }));
    const mod2 = await import('../../src/utils/cryptoConfig');
    tryParseWithWrongKey = mod2.tryParseConfigToken;
  });

  afterAll(() => {
    vi.resetModules();
    vi.doUnmock('../../src/config/env');
  });

  it('throws on enc: token with wrong key', () => {
    expect(() => tryParseWithWrongKey(encryptedToken)).toThrow();
  });
});
