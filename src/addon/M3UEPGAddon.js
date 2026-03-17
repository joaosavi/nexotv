const crypto = require('crypto');
const LRUCache = require('../utils/lruCache');
const sqliteCache = require('../utils/sqliteCache');
const { makeLogger } = require('../utils/logger');
const { parseEPG, getCurrentProgram, getUpcomingPrograms } = require('../parsers/epgParser');
const env = require('../config/env');

const CACHE_ENABLED = env.CACHE_ENABLED;
const CACHE_TTL_MS = env.CACHE_TTL_MS;
const MAX_CACHE_ENTRIES = env.MAX_CACHE_ENTRIES;

if (CACHE_ENABLED) {
    sqliteCache.init(env.SQLITE_PATH);
}

const buildPromiseCache = new LRUCache({ max: MAX_CACHE_ENTRIES, ttl: CACHE_TTL_MS });

function stableStringify(obj) {
    return JSON.stringify(obj, Object.keys(obj).sort());
}

const PROVIDER_FILE_MAP = {
    'xtream': 'xtreamProvider',
    'iptv-org': 'iptvOrgProvider',
    'm3u': 'm3uProvider'
};

function createCacheKey(config) {
    const provider = config.provider || 'xtream';
    let minimal;
    if (provider === 'iptv-org') {
        minimal = {
            provider,
            iptvOrgCountry: config.iptvOrgCountry || null,
            iptvOrgCategory: config.iptvOrgCategory || null,
        };
    } else if (provider === 'm3u') {
        minimal = {
            provider,
            m3uUrl: config.m3uUrl || null,
            enableEpg: !!config.enableEpg,
            epgUrl: config.epgUrl || null,
            epgOffsetHours: config.epgOffsetHours,
            reformatLogos: !!config.reformatLogos,
        };
    } else {
        minimal = {
            provider: 'xtream',
            epgUrl: config.epgUrl,
            enableEpg: !!config.enableEpg,
            xtreamUrl: config.xtreamUrl,
            xtreamUsername: config.xtreamUsername,
            epgOffsetHours: config.epgOffsetHours,
            reformatLogos: !!config.reformatLogos
        };
    }
    return crypto.createHash('md5').update(stableStringify(minimal)).digest('hex');
}

class M3UEPGAddon {
    constructor(config = {}, manifestRef) {
        this.providerName = config.provider || 'xtream';
        this.config = config;
        this.manifestRef = manifestRef;
        this.cacheKey = createCacheKey(config);
        this.idPrefix = this.cacheKey.slice(0, 8);
        this.updateInterval = 3600000;
        this.channels = [];
        this.channelMap = new Map();
        this.epgData = {};
        this.lastUpdate = 0;
        this.firstCatalogRefreshDone = false;
        this.firstCatalogRefreshPromise = null;
        const TTL_MAP = {
            'iptv-org': env.IPTV_ORG_CACHE_TTL_MS,
            'm3u': env.M3U_CACHE_TTL_MS,
        };
        this.cacheTtl = TTL_MAP[this.providerName] ?? CACHE_TTL_MS;
        this.log = makeLogger();

        if (typeof this.config.epgOffsetHours === 'string') {
            const n = parseFloat(this.config.epgOffsetHours);
            if (!isNaN(n)) this.config.epgOffsetHours = n;
        }
        if (typeof this.config.epgOffsetHours !== 'number' || !isFinite(this.config.epgOffsetHours))
            this.config.epgOffsetHours = 0;
        if (Math.abs(this.config.epgOffsetHours) > 48)
            this.config.epgOffsetHours = 0;

        if (this.providerName === 'iptv-org') {
            this.config.reformatLogos = true;
        }

        this.log.debug('Addon instance created', {
            provider: this.providerName,
            cacheKey: this.cacheKey,
            epgOffsetHours: this.config.epgOffsetHours
        });
    }

    async loadFromCache() {
        if (!CACHE_ENABLED) return;
        const cacheKey = 'addon:data:' + this.cacheKey;
        const cached = sqliteCache.get(cacheKey);
        if (cached) {
            this.channels = cached.channels || [];
            this.channelMap = new Map(this.channels.map(c => [c.id, c]));
            this.epgData = cached.epgData || {};
            this.lastUpdate = cached.lastUpdate || 0;
            this.log.debug('Cache hit for data', {
                channels: this.channels.length,
                lastUpdate: new Date(this.lastUpdate).toISOString()
            });
        }
    }

    async saveToCache() {
        if (!CACHE_ENABLED) return;
        const cacheKey = 'addon:data:' + this.cacheKey;
        const entry = {
            channels: this.channels,
            epgData: this.epgData,
            lastUpdate: this.lastUpdate
        };
        sqliteCache.set(cacheKey, entry, this.cacheTtl);
        this.log.debug('Saved data to cache');
    }

    buildGenresInManifest() {
        if (!this.manifestRef) return;
        const tvCatalog = this.manifestRef.catalogs.find(c => c.id === 'iptv_channels');
        if (tvCatalog) {
            const groups = [
                ...new Set(
                    this.channels
                        .map(c => c.category || c.attributes?.['group-title'])
                        .filter(Boolean)
                        .map(s => s.trim())
                )
            ].sort((a, b) => a.localeCompare(b));
            if (!groups.includes('All Channels')) groups.unshift('All Channels');
            tvCatalog.genres = groups;

            // Update genre options array so the dropdown works in Stremio
            const genreExtra = tvCatalog.extra.find(e => e.name === 'genre');
            if (genreExtra) {
                genreExtra.options = groups;
            }
        }
        this.log.debug('Catalog genres built', { tvGenres: tvCatalog?.genres?.length || 0 });
    }


    async updateData(force = false) {
        const now = Date.now();
        if (!force && CACHE_ENABLED) {
            if (this.lastUpdate && now - this.lastUpdate < this.updateInterval) {
                this.log.debug('Skip update (global interval)');
                return;
            }
            if (this.channels.length && now - this.lastUpdate < 900000) {
                this.log.debug('Skip update (recent minor interval)');
                return;
            }
        }
        try {
            const start = Date.now();
            const providerFile = PROVIDER_FILE_MAP[this.providerName] || `${this.providerName}Provider`;
            const providerModule = require(`../providers/${providerFile}.js`);
            await providerModule.fetchData(this);
            this.channelMap = new Map(this.channels.map(c => [c.id, c]));
            this.lastUpdate = Date.now();
            if (CACHE_ENABLED) await this.saveToCache();
            this.buildGenresInManifest();
            this.log.debug('Data update complete', {
                channels: this.channels.length,
                ms: Date.now() - start
            });
        } catch (e) {
            this.log.error('[UPDATE] Failed:', e.message);
            throw e;
        }
    }

    async refreshOnFirstCatalogRequest() {
        if (this.firstCatalogRefreshDone) return;
        if (this.firstCatalogRefreshPromise) {
            await this.firstCatalogRefreshPromise;
            return;
        }

        this.firstCatalogRefreshPromise = (async () => {
            if (CACHE_ENABLED) {
                sqliteCache.del('addon:data:' + this.cacheKey);
            }
            await this.updateData(true);
            this.firstCatalogRefreshDone = true;
            this.log.debug('Bootstrap catalog refresh completed', {
                cacheKey: this.cacheKey,
                channels: this.channels.length
            });
        })();

        try {
            await this.firstCatalogRefreshPromise;
        } finally {
            this.firstCatalogRefreshPromise = null;
        }
    }

    deriveFallbackLogoUrl(item) {
        let finalUrl;
        const logoAttr = item.attributes?.['tvg-logo'];
        if (logoAttr && logoAttr.trim()) {
            finalUrl = logoAttr;
        } else {
            // Text placeholder if no logo exists at all
            finalUrl = `https://placehold.co/250x375/2b2b2b/FFFFFF.png?text=${encodeURIComponent(item.name || 'TV')}`;
        }

        // Apply dark gray poster framing for all remote images
        if (this.config.reformatLogos && finalUrl.startsWith('http') && !finalUrl.includes('wsrv.nl') && !finalUrl.includes('placehold.co')) {
            // Imgur blocks wsrv.nl; route it through a generic proxy so wsrv.nl can fetch it and apply the gray poster frame
            if (finalUrl.includes('imgur.com')) {
                finalUrl = `https://proxy.duckduckgo.com/iu/?u=${encodeURIComponent(finalUrl)}`;
            }
            // fit=contain to keep logo proportions, bg=2b2b2b for the dark gray card, default output to webp
            return `https://wsrv.nl/?url=${encodeURIComponent(finalUrl)}&w=250&h=375&fit=contain&we&bg=2b2b2b`;
        }
        return finalUrl;
    }

    generateMetaPreview(item) {
        const logoUrl = this.deriveFallbackLogoUrl(item);
        return {
            id: item.id,
            type: 'tv',
            name: item.name,
            description: '📡 Live Channel',
            poster: logoUrl,
            background: logoUrl,
            posterShape: 'poster',
            genres: item.category
                ? [item.category]
                : (item.attributes?.['group-title'] ? [item.attributes['group-title']] : ['Live TV']),
            runtime: 'Live'
        };
    }

    getStreams(id) {
        const item = this.channelMap.get(id);
        if (!item) return [];

        if (item.urls && item.urls.length > 0) {
            return item.urls.map((url, index) => ({
                url: url,
                title: item.urls.length > 1 ? `${item.name} - Link ${index + 1}` : `${item.name} - Live`,
                behaviorHints: { notWebReady: true }
            }));
        }

        return [{
            url: item.url,
            title: `${item.name} - Live`,
            behaviorHints: { notWebReady: true }
        }];
    }

    getDetailedMeta(id) {
        const item = this.channelMap.get(id);
        if (!item) return null;
        const epgId = item.attributes?.['tvg-id'] || item.attributes?.['tvg-name'];
        const current = getCurrentProgram(this.epgData, epgId, this.config.epgOffsetHours);
        const upcoming = getUpcomingPrograms(this.epgData, epgId, 3, this.config.epgOffsetHours);
        let description = `📺 CHANNEL: ${item.name}`;
        if (current) {
            const start = current.startTime?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '';
            const end = current.stopTime?.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) || '';
            description += `\n\n📡 NOW: ${current.title}${start && end ? ` (${start}-${end})` : ''}`;
            if (current.description) description += `\n\n${current.description}`;
        }
        if (upcoming.length) {
            description += '\n\n📅 UPCOMING:\n';
            for (const p of upcoming) {
                description += `${p.startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${p.title}\n`;
            }
        }
        const logoUrl = this.deriveFallbackLogoUrl(item);
        return {
            id: item.id,
            type: 'tv',
            name: item.name,
            poster: logoUrl,
            background: logoUrl,
            posterShape: 'poster',
            description,
            genres: item.category
                ? [item.category]
                : (item.attributes?.['group-title'] ? [item.attributes['group-title']] : ['Live TV']),
            runtime: 'Live'
        };
    }
}

module.exports = { M3UEPGAddon, createCacheKey, buildPromiseCache, CACHE_ENABLED };
