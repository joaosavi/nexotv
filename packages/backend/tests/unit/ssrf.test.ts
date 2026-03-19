import { describe, it, expect, vi } from 'vitest';

// vi.mock is hoisted to the top of the file, so variables referenced in the
// factory must be initialised with vi.hoisted() to avoid TDZ errors.
const mockEnv = vi.hoisted(() => ({ ALLOW_LOCAL_URLS: false }));
vi.mock('../../src/config/env', () => ({ default: mockEnv, repoRoot: '/tmp' }));

import { isPrivateIp } from '../../src/middleware/ssrf';

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1',
    '::1',
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '192.168.0.1',
    '192.168.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '169.254.1.1',
  ])('blocks private IP %s', (ip) => {
    mockEnv.ALLOW_LOCAL_URLS = false;
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.0.1'])(
    'allows public IP %s',
    (ip) => {
      mockEnv.ALLOW_LOCAL_URLS = false;
      expect(isPrivateIp(ip)).toBe(false);
    }
  );

  it('returns false for all IPs when ALLOW_LOCAL_URLS=true', () => {
    mockEnv.ALLOW_LOCAL_URLS = true;
    expect(isPrivateIp('127.0.0.1')).toBe(false);
    expect(isPrivateIp('10.0.0.1')).toBe(false);
    expect(isPrivateIp('192.168.0.1')).toBe(false);
    expect(isPrivateIp('::1')).toBe(false);
    mockEnv.ALLOW_LOCAL_URLS = false;
  });
});
