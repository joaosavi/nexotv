import express from 'express';
import path from 'path';
import fs from 'fs';
import compression from 'compression';
import env from './src/config/env';
import { globalIpLimiter } from './src/middleware/rateLimiter';
import apiRouter from './src/routes/api';
import pagesRouter from './src/routes/pages';
import stremioRouter from './src/routes/stremio';
import * as sqliteCache from './src/utils/sqliteCache';
import { buildPromiseCache } from './src/addon/M3UEPGAddon';
import { startWatchdog, getSnapshot } from './src/utils/metrics';

const app = express();
// __dirname in compiled output = packages/backend/dist/
// path to frontend dist: packages/frontend/dist/
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');

app.set('trust proxy', 1);
if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    console.log(`[STATIC] Serving frontend from ${frontendDist}`);
}
app.use(express.json({ limit: '512kb' }));
app.use(compression());
app.use(globalIpLimiter);

app.use((req, res, next) => {
    res.setHeader('X-App', 'NexoTV');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

app.get('/health', (req, res) => {
    const snap = getSnapshot(buildPromiseCache);
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime_sec: Math.floor(process.uptime()),
        process: {
            heap_mb: snap.heapMb,
            heap_total_mb: snap.heapTotalMb,
            rss_mb: snap.rssMb,
            cpu_percent: snap.cpuPercent,
        },
        cache: {
            lru_size: snap.lruSize,
            lru_max: snap.lruMax,
        },
        watchdog: {
            spike_flagged: snap.spikeFlagged,
            last_eviction_at: snap.lastEvictionAt,
            samples_collected: snap.samplesCollected,
        },
    });
});
app.get('/favicon.ico', (req, res) => {
    if (fs.existsSync(frontendDist)) {
        res.sendFile(path.join(frontendDist, 'logo', 'addon-logo.png'));
    } else {
        res.status(404).end();
    }
});

app.use(apiRouter);
app.use(pagesRouter);
app.use(stremioRouter);

app.use('*', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((error: any, req: any, res: any, next: any) => {
    console.error('[SERVER] Unhandled error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
});

app.listen(env.PORT, () => {
    console.log(`🚀 Server running → http://localhost:${env.PORT} (debug=${env.DEBUG}, prefetch=${env.PREFETCH_ENABLED})`);

    if (process.env.CLEAR_CACHE_ON_START === 'true') {
        try {
            sqliteCache.cleanExpired();
            sqliteCache.vacuum();
            console.log('[STARTUP] CLEAR_CACHE_ON_START: SQLite cache cleared and vacuumed');
        } catch (e: any) {
            console.error('[STARTUP] CLEAR_CACHE_ON_START failed:', e.message);
        }
    }

    if (env.CACHE_ENABLED) {
        const GC_INTERVAL_MS = env.SQLITE_GC_INTERVAL_MS;
        const VACUUM_INTERVAL_MS = env.SQLITE_VACUUM_INTERVAL_MS;

        setInterval(() => {
            try {
                const deleted = sqliteCache.cleanExpired();
                if (deleted > 0) console.log(`[CACHE-GC] Cleaned ${deleted} expired entries`);
            } catch (e: any) {
                console.error('[CACHE-GC] Error:', e.message);
            }
        }, GC_INTERVAL_MS);

        setInterval(() => {
            try {
                sqliteCache.vacuum();
                console.log('[CACHE-GC] VACUUM completed');
            } catch (e: any) {
                console.error('[CACHE-GC] VACUUM error:', e.message);
            }
        }, VACUUM_INTERVAL_MS);
    }

    // When an addon is evicted from LRU (watchdog or overflow), free its in-memory data
    // and stop its background timers so GC can reclaim the memory.
    buildPromiseCache.onEvict = (_key, promise) => {
        Promise.resolve(promise).then((iface: any) => {
            iface?.addonInstance?._evictFromMemory();
        }).catch(() => {});
    };

    startWatchdog(buildPromiseCache);
});


process.on('SIGTERM', () => {
    try {
        sqliteCache.close();
    } catch (_) { }
    process.exit(0);
});
process.on('SIGINT', () => {
    try {
        sqliteCache.close();
    } catch (_) { }
    process.exit(0);
});
