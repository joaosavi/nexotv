const { Router } = require('express');
const { getRouter } = require('stremio-addon-sdk');
const crypto = require('crypto');
const { tryParseConfigToken } = require('../utils/cryptoConfig');
const createAddon = require('../addon/builder');
const env = require('../config/env');
const { makeLogger } = require('../utils/logger');
const LRUCache = require('../utils/lruCache');

const log = makeLogger();
const router = Router();

const INTERFACE_TTL_MS = env.CACHE_TTL_MS;
const interfaceCache = new LRUCache({ max: parseInt(env.MAX_CACHE_ENTRIES || 100), ttl: INTERFACE_TTL_MS });
const CACHE_ENABLED = env.CACHE_ENABLED;

function maybeDecryptConfig(token) {
    return tryParseConfigToken(token);
}

function isConfigToken(token) {
    if (!token) return false;
    if (token.startsWith('enc:')) return true;
    if (token.length < 4) return false;
    return true;
}

// Token middleware
router.use('/:token', async (req, res, next) => {
    const { token } = req.params;
    if (!isConfigToken(token)) return next('route');
    if (req.path.startsWith('/configure')) return next();

    let config;
    try {
        config = maybeDecryptConfig(token);
    } catch (e) {
        log.debug('Config parse failed', token, e.message);
        return res.status(400).json({ error: 'Invalid configuration token' });
    }
    config.provider = 'xtream';

    const ifaceKey = 'iface:' + crypto.createHash('md5').update(token).digest('hex');

    let iface = CACHE_ENABLED ? interfaceCache.get(ifaceKey) : null;
    if (!iface) {
        try {
            log.debug('Building addon interface (cache miss)', ifaceKey);
            iface = await createAddon(config);
            if (CACHE_ENABLED) {
                interfaceCache.set(ifaceKey, iface);
            }
        } catch (e) {
            console.error('[SERVER] Addon build failed:', e);
            return res.status(500).json({ error: 'Addon build error' });
        }
    } else {
        log.debug('Interface cache hit', ifaceKey);
    }

    req.addonInterface = iface;
    req.configToken = token;
    next();
});

router.use(require('./logo'));

// Custom manifest route — bypasses the SDK's ~8KB frozen manifest limit
router.get('/:token/manifest.json', (req, res) => {
    const iface = req.addonInterface;
    if (!iface) return res.status(500).json({ error: 'Interface not ready' });
    const manifest = JSON.parse(JSON.stringify(iface.manifest));
    if (manifest.behaviorHints) {
        delete manifest.behaviorHints.configurationRequired;
        delete manifest.behaviorHints.configurable;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.end(JSON.stringify(manifest));
});

// Stremio router
router.use('/:token', (req, res, next) => {

    const iface = req.addonInterface;
    if (!iface) return res.status(500).json({ error: 'Interface not ready' });

    const sdkRouter = getRouter(iface);
    sdkRouter(req, res, (err) => {
        if (err) {
            console.error('[SERVER] Router error:', err);
            res.status(500).json({ error: 'Addon error' });
        } else {
            res.status(404).json({ error: 'Not found' });
        }
    });
});

module.exports = router;
