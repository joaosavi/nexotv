const env = require('../config/env');
const { addonBuilder } = require("stremio-addon-sdk");
const crypto = require("crypto");
const { createManifest } = require('./manifest');
const { M3UEPGAddon, createCacheKey, buildPromiseCache, CACHE_ENABLED } = require('./M3UEPGAddon');

async function createAddon(config) {
    const manifest = createManifest();

    config.instanceId = config.instanceId ||
        (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex'));

    const cacheKey = createCacheKey(config);
    const debugFlag = !!env.DEBUG;
    if (debugFlag) {
        console.log('[DEBUG] createAddon start', { cacheKey, provider: 'xtream' });
    } else {
        console.log(`[ADDON] Cache ${CACHE_ENABLED ? 'ENABLED' : 'DISABLED'} for config ${cacheKey}`);
    }

    if (CACHE_ENABLED && buildPromiseCache.has(cacheKey)) {
        if (debugFlag) console.log('[DEBUG] Reusing build promise', cacheKey);
        return buildPromiseCache.get(cacheKey);
    }

    const buildPromise = (async () => {
        const builder = new addonBuilder(manifest);
        const addonInstance = new M3UEPGAddon(config, manifest);
        await addonInstance.loadFromCache();
        try {
            if (!addonInstance.lastUpdate || (Date.now() - addonInstance.lastUpdate > addonInstance.updateInterval)) {
                await addonInstance.updateData(true);
            }
        } catch (e) {
            console.error('[ADDON] Initial update failed:', e.message);
        }
        addonInstance.buildGenresInManifest();

        builder.defineCatalogHandler(async (args) => {
            const start = Date.now();
            try {
                addonInstance.updateData().catch(() => { });
                let items = args.type === 'tv' && args.id === 'iptv_channels' ? addonInstance.channels : [];
                const extra = args.extra || {};
                if (extra.genre && extra.genre !== 'All Channels') {
                    items = items.filter(i =>
                        (i.category && i.category === extra.genre) ||
                        (i.attributes && i.attributes['group-title'] === extra.genre)
                    );
                }
                if (extra.search) {
                    const q = extra.search.toLowerCase();
                    items = items.filter(i => i.name.toLowerCase().includes(q));
                }
                const PAGE_SIZE = 100;
                const skip = parseInt(extra.skip || '0', 10) || 0;
                const metas = items.slice(skip, skip + PAGE_SIZE).map(i => addonInstance.generateMetaPreview(i));
                if (env.DEBUG) {
                    console.log('[DEBUG] Catalog handler', {
                        type: args.type,
                        id: args.id,
                        totalItems: items.length,
                        returned: metas.length,
                        ms: Date.now() - start
                    });
                }
                return { metas };
            } catch (e) {
                console.error('[CATALOG] Error', e);
                return { metas: [] };
            }
        });

        builder.defineStreamHandler(async ({ type, id }) => {
            try {
                const stream = addonInstance.getStream(id);
                if (!stream) return { streams: [] };
                if (env.DEBUG) {
                    console.log('[DEBUG] Stream request', { id, url: stream.url });
                }
                return { streams: [stream] };
            } catch (e) {
                console.error('[STREAM] Error', e);
                return { streams: [] };
            }
        });

        builder.defineMetaHandler(async ({ type, id }) => {
            try {
                const meta = addonInstance.getDetailedMeta(id);
                if (env.DEBUG) {
                    console.log('[DEBUG] Meta request', { id, type });
                }
                return { meta };
            } catch (e) {
                console.error('[META] Error', e);
                return { meta: null };
            }
        });

        return builder.getInterface();
    })();

    if (CACHE_ENABLED) buildPromiseCache.set(cacheKey, buildPromise);
    try {
        const iface = await buildPromise;
        return iface;
    } finally {
        // Keep promise cached
    }
}

module.exports = createAddon;
