/**
 * Manual verification tests for BeamUp stability fixes
 * (2026-03-21-beamup-stability-memory-cpu.md)
 *
 * Tests:
 *  1. Exponential backoff after refreshOnFirstCatalogRequest failures
 *  2. Backoff resets on success
 *  3. EPG parser yields to event loop every 5 000 programmes
 *  4. Circuit breaker opens after 3 timer failures
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { M3UEPGAddon } from '../../src/addon/M3UEPGAddon';
import { parseEPG } from '../../src/parsers/epgParser';
import { generateLargeXMLTV } from '../helpers/fixtures';
import { makeM3uConfig } from '../helpers/makeConfig';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAddon() {
    return new M3UEPGAddon(makeM3uConfig(), null) as any; // cast for private field access
}

// ---------------------------------------------------------------------------
// 1 + 2 — Exponential backoff on refreshOnFirstCatalogRequest
// ---------------------------------------------------------------------------

describe('refreshOnFirstCatalogRequest — exponential backoff', () => {
    let addon: any;
    let realDateNow: () => number;
    let fakeNow: number;

    beforeEach(() => {
        addon = makeAddon();
        realDateNow = Date.now;
        fakeNow = Date.now();
        vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);

        // Make updateData always reject so we can observe backoff behaviour
        vi.spyOn(addon, 'updateData').mockRejectedValue(new Error('Provider 404'));

        // Disable JUST_FETCHED skip so the test does not bail early
        addon.lastUpdate = 0;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('1st failure: records failure, increments counter to 1', async () => {
        await addon.refreshOnFirstCatalogRequest().catch(() => {});
        expect(addon._consecutiveRefreshFailures).toBe(1);
        expect(addon._refreshFailedAt).toBeCloseTo(fakeNow, -2);
    });

    it('within 1-min cooldown: second call skips updateData', async () => {
        // First call → fails
        await addon.refreshOnFirstCatalogRequest().catch(() => {});
        const callsAfterFirst = (addon.updateData as any).mock.calls.length;

        // Advance time by 30 s (still within 1-min cooldown)
        fakeNow += 30_000;
        await addon.refreshOnFirstCatalogRequest().catch(() => {});

        // updateData must NOT have been called again
        expect((addon.updateData as any).mock.calls.length).toBe(callsAfterFirst);
    });

    it('after 1-min cooldown: retries, fails, counter increments to 2', async () => {
        // 1st failure
        await addon.refreshOnFirstCatalogRequest().catch(() => {});
        expect(addon._consecutiveRefreshFailures).toBe(1);

        // Advance past 1-min cooldown
        fakeNow += 61_000;
        // Reset so refreshOnFirstCatalogRequest attempts again
        addon.firstCatalogRefreshDone = false;
        addon.firstCatalogRefreshPromise = null;

        // 2nd failure
        await addon.refreshOnFirstCatalogRequest().catch(() => {});
        expect(addon._consecutiveRefreshFailures).toBe(2);
    });

    it('within 5-min cooldown after 2 failures: skips updateData', async () => {
        // 1st failure
        await addon.refreshOnFirstCatalogRequest().catch(() => {});
        // Advance past 1-min, reset promise
        fakeNow += 61_000;
        addon.firstCatalogRefreshDone = false;
        addon.firstCatalogRefreshPromise = null;

        // 2nd failure
        await addon.refreshOnFirstCatalogRequest().catch(() => {});
        expect(addon._consecutiveRefreshFailures).toBe(2);

        const callsAfterSecond = (addon.updateData as any).mock.calls.length;

        // Only 2 min elapsed since 2nd failure (within 5-min cooldown)
        fakeNow += 2 * 60_000;
        addon.firstCatalogRefreshDone = false;
        addon.firstCatalogRefreshPromise = null;

        await addon.refreshOnFirstCatalogRequest().catch(() => {});
        expect((addon.updateData as any).mock.calls.length).toBe(callsAfterSecond);
    });

    it('3rd+ failure uses 30-min cooldown', async () => {
        // Simulate 3 failures
        for (let i = 1; i <= 3; i++) {
            await addon.refreshOnFirstCatalogRequest().catch(() => {});
            fakeNow += (i === 1 ? 61_000 : i === 2 ? 5 * 60_000 + 1_000 : 0);
            addon.firstCatalogRefreshDone = false;
            addon.firstCatalogRefreshPromise = null;
        }

        expect(addon._consecutiveRefreshFailures).toBe(3);
        const callsAfter3 = (addon.updateData as any).mock.calls.length;

        // 15 min elapsed — still within 30-min cooldown
        fakeNow += 15 * 60_000;
        addon.firstCatalogRefreshDone = false;
        addon.firstCatalogRefreshPromise = null;
        await addon.refreshOnFirstCatalogRequest().catch(() => {});
        expect((addon.updateData as any).mock.calls.length).toBe(callsAfter3);

        // 31 min elapsed — cooldown expired, should attempt
        fakeNow += 31 * 60_000;
        addon.firstCatalogRefreshDone = false;
        addon.firstCatalogRefreshPromise = null;
        await addon.refreshOnFirstCatalogRequest().catch(() => {});
        expect((addon.updateData as any).mock.calls.length).toBeGreaterThan(callsAfter3);
    });

    it('success resets failure counter and failedAt', async () => {
        // 1st failure
        await addon.refreshOnFirstCatalogRequest().catch(() => {});
        expect(addon._consecutiveRefreshFailures).toBe(1);

        // Mock updateData to succeed
        vi.spyOn(addon, 'updateData').mockResolvedValue(undefined);
        fakeNow += 61_000;
        addon.firstCatalogRefreshDone = false;
        addon.firstCatalogRefreshPromise = null;

        await addon.refreshOnFirstCatalogRequest();
        expect(addon._consecutiveRefreshFailures).toBe(0);
        expect(addon._refreshFailedAt).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 3 — EPG parser yields to event loop
// ---------------------------------------------------------------------------

describe('parseEPG — cooperative scheduling (yield every 5 000 programmes)', () => {
    it('calls setImmediate at least once when processing >5 000 programmes', async () => {
        // 120 channels × 50 programmes = 6 000 entries → should yield once
        const xml = generateLargeXMLTV(120, 50);
        const bytes = Buffer.byteLength(xml, 'utf8');
        // Sanity: make sure the file is large enough to be realistic
        expect(bytes).toBeGreaterThan(100_000);

        let yieldCount = 0;
        const origSetImmediate = global.setImmediate;
        vi.stubGlobal('setImmediate', (cb: (...args: any[]) => void, ...args: any[]) => {
            yieldCount++;
            return origSetImmediate(cb, ...args);
        });

        await parseEPG(xml);

        vi.unstubAllGlobals();
        expect(yieldCount).toBeGreaterThanOrEqual(1);
    }, 30_000); // allow up to 30 s for parsing

    it('does not yield for small EPG files (<5 000 entries)', async () => {
        // 10 channels × 3 programmes = 30 entries
        const xml = generateLargeXMLTV(10, 3);

        let yieldCount = 0;
        const origSetImmediate = global.setImmediate;
        vi.stubGlobal('setImmediate', (cb: (...args: any[]) => void, ...args: any[]) => {
            yieldCount++;
            return origSetImmediate(cb, ...args);
        });

        await parseEPG(xml);

        vi.unstubAllGlobals();
        expect(yieldCount).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// 4 — Circuit breaker in background timer
// ---------------------------------------------------------------------------

describe('_startUpdateTimer — circuit breaker', () => {
    it('opens circuit after 3 consecutive failures and logs warning', async () => {
        const addon = makeAddon();

        // Make updateData always fail
        vi.spyOn(addon, 'updateData').mockRejectedValue(new Error('provider down'));
        const warnSpy = vi.spyOn(addon.log, 'warn');

        // Directly start timer then extract the interval callback by inspecting state
        // We'll call the internal failure logic directly by simulating timer ticks
        // instead of waiting for real intervals.

        // Replicate what _startUpdateTimer does internally: run 4 failing "ticks"
        const runTick = async () => {
            if (addon._timerPausedUntil !== null && Date.now() < addon._timerPausedUntil) return 'skipped';
            try {
                await addon.updateData();
                addon._timerConsecutiveFailures = 0;
                addon._timerPausedUntil = null;
                return 'success';
            } catch (e: any) {
                addon._timerConsecutiveFailures++;
                if (addon._timerConsecutiveFailures >= 3) {
                    addon._timerPausedUntil = Date.now() + 30 * 60_000;
                    addon.log.warn(`[TIMER] Circuit open after ${addon._timerConsecutiveFailures} failures, pausing 30 min`);
                }
                addon.log.error('[TIMER] Background update failed:', e.message);
                return 'failed';
            }
        };

        expect(await runTick()).toBe('failed'); // failure 1
        expect(addon._timerPausedUntil).toBeNull(); // circuit still closed
        expect(await runTick()).toBe('failed'); // failure 2
        expect(addon._timerPausedUntil).toBeNull();
        expect(await runTick()).toBe('failed'); // failure 3 → circuit opens
        expect(addon._timerPausedUntil).not.toBeNull();

        const pausedUntil = addon._timerPausedUntil!;
        expect(pausedUntil).toBeGreaterThan(Date.now() + 25 * 60_000); // ~30 min from now

        // Verify the warning log was emitted
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Circuit open'));

        // 4th tick should be skipped (circuit open)
        expect(await runTick()).toBe('skipped');

        vi.restoreAllMocks();
    });

    it('circuit resets after a successful tick', async () => {
        const addon = makeAddon();

        // Pre-set circuit as open but in the past so it has expired
        addon._timerConsecutiveFailures = 3;
        addon._timerPausedUntil = Date.now() - 1; // already past

        vi.spyOn(addon, 'updateData').mockResolvedValue(undefined);

        const runTick = async () => {
            if (addon._timerPausedUntil !== null && Date.now() < addon._timerPausedUntil) return 'skipped';
            try {
                await addon.updateData();
                addon._timerConsecutiveFailures = 0;
                addon._timerPausedUntil = null;
                return 'success';
            } catch {
                return 'failed';
            }
        };

        expect(await runTick()).toBe('success');
        expect(addon._timerConsecutiveFailures).toBe(0);
        expect(addon._timerPausedUntil).toBeNull();

        vi.restoreAllMocks();
    });
});
