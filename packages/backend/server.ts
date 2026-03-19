import express from 'express';
import path from 'path';
import compression from 'compression';
import env from './src/config/env';
import { globalIpLimiter } from './src/middleware/rateLimiter';
import apiRouter from './src/routes/api';
import pagesRouter from './src/routes/pages';
import stremioRouter from './src/routes/stremio';
import * as sqliteCache from './src/utils/sqliteCache';

const app = express();
// Resolve public dir correctly in both dev (tsx) and prod (node dist/server.js)
const BACKEND_ROOT = path.basename(__dirname) === 'dist' ? path.join(__dirname, '..') : __dirname;
const staticDir = path.join(BACKEND_ROOT, 'public');

app.set('trust proxy', 1);
app.use(express.static(staticDir));
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

app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date().toISOString() }));
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(BACKEND_ROOT, 'public', 'assets', 'logo.png')));

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
