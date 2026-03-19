const express = require('express');
const path = require('path');
const env = require('./src/config/env');

const app = express();
const staticDir = path.join(__dirname, 'public');

app.set('trust proxy', 1);
app.use(express.static(staticDir));
app.use(express.json({ limit: '512kb' }));
app.use(require('compression')());

const { globalIpLimiter } = require('./src/middleware/rateLimiter');
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
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public', 'assets', 'logo.png')));

app.use(require('./src/routes/api'));
app.use(require('./src/routes/pages'));
app.use(require('./src/routes/stremio'));

app.use('*', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((error, req, res, next) => {
    console.error('[SERVER] Unhandled error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
});

app.listen(env.PORT, () => {
    console.log(`🚀 Server running → http://localhost:${env.PORT} (debug=${env.DEBUG}, prefetch=${env.PREFETCH_ENABLED})`);

    if (env.CACHE_ENABLED) {
        const sqliteCache = require('./src/utils/sqliteCache');
        const GC_INTERVAL_MS = env.SQLITE_GC_INTERVAL_MS;
        const VACUUM_INTERVAL_MS = env.SQLITE_VACUUM_INTERVAL_MS;

        setInterval(() => {
            try {
                const deleted = sqliteCache.cleanExpired();
                if (deleted > 0) console.log(`[CACHE-GC] Cleaned ${deleted} expired entries`);
            } catch (e) {
                console.error('[CACHE-GC] Error:', e.message);
            }
        }, GC_INTERVAL_MS);

        setInterval(() => {
            try {
                sqliteCache.vacuum();
                console.log('[CACHE-GC] VACUUM completed');
            } catch (e) {
                console.error('[CACHE-GC] VACUUM error:', e.message);
            }
        }, VACUUM_INTERVAL_MS);
    }
});


process.on('SIGTERM', () => {
    try {
        const sqliteCache = require('./src/utils/sqliteCache');
        sqliteCache.close();
    } catch (_) { }
    process.exit(0);
});
process.on('SIGINT', () => {
    try {
        const sqliteCache = require('./src/utils/sqliteCache');
        sqliteCache.close();
    } catch (_) { }
    process.exit(0);
});