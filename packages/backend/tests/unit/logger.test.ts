import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock env before importing logger
vi.mock('../../src/config/env', () => ({
  default: { DEBUG: false },
}));

import { makeLogger } from '../../src/utils/logger';

describe('makeLogger()', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefixes output with an ISO timestamp', () => {
    const log = makeLogger();
    log.info('hello');
    const output = consoleSpy.mock.calls[0][0] as string;
    // ISO 8601: YYYY-MM-DDTHH:mm:ss.sssZ
    expect(output).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  });

  it('includes [INFO] level tag', () => {
    const log = makeLogger();
    log.info('hello');
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('[INFO]');
  });

  it('includes [COMPONENT] prefix when component is provided', () => {
    const log = makeLogger('EPG');
    log.info('parsing');
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(output).toContain('[EPG]');
  });

  it('does not include a component tag when none is provided', () => {
    const log = makeLogger();
    log.info('hello');
    const output = consoleSpy.mock.calls[0][0] as string;
    // Should not have a second bracket group like [COMPONENT]
    const bracketGroups = (output.match(/\[[A-Z]+\]/g) || []);
    expect(bracketGroups).toHaveLength(1); // only [INFO]
  });

  it('component tag appears after level tag', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = makeLogger('METRICS');
    log.warn('threshold');
    const output = (warnSpy.mock.calls[0][0]) as string;
    expect(output.indexOf('[WARN]')).toBeLessThan(output.indexOf('[METRICS]'));
  });

  it('debug is suppressed when DEBUG is false', () => {
    const log = makeLogger();
    log.debug('secret');
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
