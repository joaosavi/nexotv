import LRUCache from './lruCache';
import { makeLogger } from './logger';
import env from '../config/env';

const log = makeLogger('METRICS');

interface Sample {
    heapMb: number;
    heapTotalMb: number;
    rssMb: number;
    cpuPercent: number;
    ts: number; // Date.now()
}

export interface MetricsSnapshot {
    heapMb: number;
    heapTotalMb: number;
    rssMb: number;
    cpuPercent: number;
    uptimeSec: number;
    lruSize: number;
    lruMax: number;
    spikeFlagged: boolean;
    lastEvictionAt: string | null;
    samplesCollected: number;
}

const BUFFER_SIZE = 5;
const SPIKE_THRESHOLD_MB = 40;

const buffer: Sample[] = [];
let spikeFlagged = false;
let lastEvictionAt: string | null = null;
let lastSpikeLogAt = 0;   // wall-clock ms — cooldown for spike log spam
let lastEvictionTs = 0;   // wall-clock ms — cooldown for repeated evictions

// CPU accounting — reset in startWatchdog() just before the first tick
let prevCpuUsage = process.cpuUsage();
let prevSampleTime = Date.now();

function takeSample(): Sample {
    const mem = process.memoryUsage();
    const now = Date.now();
    const elapsed = now - prevSampleTime;
    // Capture once — use same snapshot for delta AND as new baseline (avoids double syscall + drift)
    const cpuNow = process.cpuUsage();
    const cpuDelta = { user: cpuNow.user - prevCpuUsage.user, system: cpuNow.system - prevCpuUsage.system };
    const cpuPercent = elapsed > 0
        ? ((cpuDelta.user + cpuDelta.system) / (elapsed * 1000)) * 100
        : 0;

    prevCpuUsage = cpuNow;
    prevSampleTime = now;

    return {
        heapMb: mem.heapUsed / 1048576,
        heapTotalMb: mem.heapTotal / 1048576,
        rssMb: mem.rss / 1048576,
        cpuPercent: Math.round(cpuPercent * 10) / 10,
        ts: now,
    };
}

function pushSample(sample: Sample): void {
    buffer.push(sample);
    if (buffer.length > BUFFER_SIZE) buffer.shift();
}

function checkSpike(): boolean {
    if (buffer.length < 3) return false;
    const oldest3 = buffer[buffer.length - 3];
    const newest  = buffer[buffer.length - 1];
    return (newest.heapMb - oldest3.heapMb) > SPIKE_THRESHOLD_MB;
}

function runWatchdog(cache: LRUCache): void {
    let sample: Sample;
    try {
        sample = takeSample();
    } catch (e: any) {
        log.warn('sample failed:', e.message);
        return;
    }

    pushSample(sample);
    const now = sample.ts;
    const intervalMs = env.METRICS_SAMPLE_INTERVAL_MS;
    const warnMb = env.METRICS_WARN_HEAP_MB;
    const criticalMb = env.METRICS_CRITICAL_HEAP_MB;

    // --- WARN threshold ---
    if (sample.heapMb > warnMb) {
        log.warn(
            `heap ${sample.heapMb.toFixed(1)}MB exceeds warn threshold (${warnMb}MB)` +
            ` | rss ${sample.rssMb.toFixed(1)}MB | cpu ${sample.cpuPercent}%`
        );
    }

    // --- Spike detection ---
    const spikeDetected = checkSpike();
    if (spikeDetected) {
        spikeFlagged = true;
        if (now - lastSpikeLogAt > intervalMs * 3) {
            const oldest3 = buffer[buffer.length - 3];
            const newest  = buffer[buffer.length - 1];
            log.warn(
                `heap spike: ${oldest3.heapMb.toFixed(1)}MB → ${newest.heapMb.toFixed(1)}MB` +
                ` in ${Math.round((newest.ts - oldest3.ts) / 1000)}s`
            );
            lastSpikeLogAt = now;
        }
    } else if (sample.heapMb < warnMb) {
        spikeFlagged = false;
        lastSpikeLogAt = 0; // reset cooldown so next spike episode gets its own log
    }

    // --- CRITICAL threshold + auto-eviction ---
    if (sample.heapMb > criticalMb) {
        const evictionCooldown = intervalMs * 3;
        if (now - lastEvictionTs > evictionCooldown) {
            const cacheSize = cache.getSize();
            if (cacheSize > 0) {
                const n = Math.ceil(cacheSize / 2);
                const evicted = cache.evictLeastRecentlyUsed(n);
                lastEvictionAt = new Date(now).toISOString();
                lastEvictionTs = now;
                log.error(
                    `heap critical ${sample.heapMb.toFixed(1)}MB (>${criticalMb}MB)` +
                    ` — evicted ${evicted} idle LRU entries`
                );
            } else {
                log.error(
                    `heap critical ${sample.heapMb.toFixed(1)}MB (>${criticalMb}MB)` +
                    ` — LRU cache is empty, no entries to evict`
                );
            }
        } else {
            log.error(
                `heap critical ${sample.heapMb.toFixed(1)}MB — eviction on cooldown,` +
                ` next eligible in ${Math.round((evictionCooldown - (now - lastEvictionTs)) / 1000)}s`
            );
        }
    }
}

export function startWatchdog(cache: LRUCache): void {
    const interval = env.METRICS_SAMPLE_INTERVAL_MS;
    // Reset CPU baseline here so the first sample measures only since watchdog start,
    // not since module import (which could be much earlier during server boot).
    prevCpuUsage = process.cpuUsage();
    prevSampleTime = Date.now();
    log.info(`watchdog started (interval=${interval}ms, warn=${env.METRICS_WARN_HEAP_MB}MB, critical=${env.METRICS_CRITICAL_HEAP_MB}MB)`);
    setInterval(() => runWatchdog(cache), interval).unref();
}

export function getSnapshot(cache: LRUCache): MetricsSnapshot {
    const latest = buffer[buffer.length - 1];
    return {
        heapMb:           latest ? Math.round(latest.heapMb * 10) / 10 : 0,
        heapTotalMb:      latest ? Math.round(latest.heapTotalMb * 10) / 10 : 0,
        rssMb:            latest ? Math.round(latest.rssMb * 10) / 10 : 0,
        cpuPercent:       latest ? latest.cpuPercent : 0,
        uptimeSec:        Math.floor(process.uptime()),
        lruSize:          cache.getSize(),   // always live — never zero-defaulted
        lruMax:           cache.max,
        spikeFlagged,
        lastEvictionAt,
        samplesCollected: buffer.length,
    };
}
