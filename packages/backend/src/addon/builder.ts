import env from '../config/env';
import { addonBuilder } from 'stremio-addon-sdk';
import crypto from 'crypto';
import { createManifest } from './manifest';
import { M3UEPGAddon, createCacheKey, buildPromiseCache, CACHE_ENABLED } from './M3UEPGAddon';
import { AddonConfig } from './M3UEPGAddon';

async function createAddon(config: AddonConfig) {
    config.instanceId = config.instanceId ||
        (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex'));

    const cacheKey = createCacheKey(config);
    const idPrefix = cacheKey.slice(0, 8);
    const manifest = createManifest(idPrefix);
    const debugFlag = !!env.DEBUG;
    if (debugFlag) {
        console.log('[DEBUG] createAddon start', { cacheKey, provider: config.provider || 'xtream' });
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
        await addonInstance.loadChannelsFromCache();
        try {
            if (!addonInstance.lastUpdate || (Date.now() - addonInstance.lastUpdate > addonInstance.updateInterval)) {
                await addonInstance.updateData(true);
            }
        } catch (e: any) {
            console.error('[ADDON] Initial update failed:', e.message);
        }
        addonInstance.buildGenresInManifest();
        if (CACHE_ENABLED) addonInstance._evictFromMemory();

        let iface: any;
        const _origBuildGenres = addonInstance.buildGenresInManifest.bind(addonInstance);
        addonInstance.buildGenresInManifest = () => {
            _origBuildGenres();
            if (iface) iface._cleanManifest = null;
        };

        builder.defineCatalogHandler(async (args) => {
            const start = Date.now();
            try {
                await addonInstance.refreshOnFirstCatalogRequest();
                addonInstance.updateData().catch(() => { });
                const catalogIds = ['iptv_channels', 'iptv_org'];
                const channels = await addonInstance.getChannelsForCatalog();
                let items = args.type === 'tv' && catalogIds.includes(args.id) ? channels : [];
                const extra = args.extra || {};
                if (extra.genre && extra.genre !== 'All Channels') {
                    items = items.filter((i: any) =>
                        (i.category && i.category === extra.genre) ||
                        (i.attributes && i.attributes['group-title'] === extra.genre)
                    );
                }
                if (extra.search) {
                    const q = extra.search.toLowerCase();
                    items = items.filter((i: any) => i.name.toLowerCase().includes(q));
                }
                const PAGE_SIZE = env.CATALOG_PAGE_SIZE;
                const skip = parseInt(extra.skip || '0', 10) || 0;
                const metas = items.slice(skip, skip + PAGE_SIZE).map((i: any) => addonInstance.generateMetaPreview(i));
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
                const streams = await addonInstance.getStreams(id);
                if (!streams || streams.length === 0) return { streams: [] };
                if (env.DEBUG) {
                    console.log('[DEBUG] Stream request', { id, count: streams.length });
                }
                return { streams };
            } catch (e) {
                console.error('[STREAM] Error', e);
                return { streams: [] };
            }
        });

        builder.defineMetaHandler(async ({ type, id }) => {
            try {
                const meta = await addonInstance.getDetailedMeta(id);
                if (env.DEBUG) {
                    console.log('[DEBUG] Meta request', { id, type });
                }
                return { meta };
            } catch (e) {
                console.error('[META] Error', e);
                return { meta: null };
            }
        });

        iface = builder.getInterface();
        iface.addonInstance = addonInstance;
        return iface;
    })();

    if (CACHE_ENABLED) buildPromiseCache.set(cacheKey, buildPromise);
    try {
        const iface = await buildPromise;
        return iface;
    } finally {
        // Keep promise cached
    }
}

export default createAddon;
