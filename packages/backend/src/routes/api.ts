import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import env from '../config/env';
import { encryptConfig } from '../utils/cryptoConfig';

const router = Router();

router.post('/encrypt', (req, res) => {
    if (!env.CONFIG_SECRET) {
        return res.status(400).json({ error: 'Encryption not enabled on server (CONFIG_SECRET missing)' });
    }
    try {
        const jsonStr = JSON.stringify(req.body || {});
        const token = encryptConfig(jsonStr);
        if (!token) return res.status(500).json({ error: 'Encrypt failed' });
        res.json({ token });
    } catch {
        res.status(400).json({ error: 'Invalid config payload' });
    }
});

router.get('/api/addon-info', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({
        name: env.ADDON_NAME,
        description: env.ADDON_DESCRIPTION,
        logoUrl: env.ADDON_LOGO_URL
    });
});

router.get('/api/capabilities', (req, res) => {
    res.json({ encryptionEnabled: !!env.CONFIG_SECRET });
});

// Resolve correctly in both dev (src/routes) and prod (dist/src/routes)
const isDist = __dirname.split(path.sep).includes('dist');
const PUBLIC_PLAYLISTS_PATH = isDist
    ? path.join(__dirname, '..', '..', '..', '..', '..', 'config', 'public-playlists.json')
    : path.join(__dirname, '..', '..', '..', '..', 'config', 'public-playlists.json');

router.get('/api/public-playlists', (req, res) => {
    try {
        const raw = fs.readFileSync(PUBLIC_PLAYLISTS_PATH, 'utf8');
        const playlists = JSON.parse(raw);
        if (!Array.isArray(playlists)) return res.json([]);
        res.json(playlists);
    } catch {
        res.json([]);
    }
});

import * as sqliteCache from '../utils/sqliteCache';
import { buildPromiseCache } from '../addon/M3UEPGAddon';

router.post('/api/admin/clear-cache', (req, res) => {
    if (!env.ADMIN_SECRET) {
        return res.status(404).json({ error: 'Not found' });
    }
    const secret = req.headers['x-admin-secret'] || req.query.secret;
    if (secret !== env.ADMIN_SECRET) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    try {
        // Evict all in-memory addon instances first so their timers are stopped
        const lruSize = buildPromiseCache.getSize();
        buildPromiseCache.evictLeastRecentlyUsed(lruSize);
        // Clear and vacuum SQLite
        const deleted = sqliteCache.cleanExpired();
        sqliteCache.vacuum();
        res.json({ ok: true, lruEvicted: lruSize, sqliteExpiredDeleted: deleted });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

import prefetchRouter from './prefetch';
router.use(prefetchRouter);

export default router;
