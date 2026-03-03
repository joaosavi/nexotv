const crypto = require('crypto');
const LRUCache = require('../utils/lruCache');
const { makeLogger } = require('../utils/logger');
const { parseEPG, getCurrentProgram, getUpcomingPrograms } = require('../parsers/epgParser');
const env = require('../config/env');

const CACHE_ENABLED = env.CACHE_ENABLED;
const CACHE_TTL_MS = env.CACHE_TTL_MS;
const MAX_CACHE_ENTRIES = env.MAX_CACHE_ENTRIES;

const dataCache = new LRUCache({ max: MAX_CACHE_ENTRIES, ttl: CACHE_TTL_MS });
const buildPromiseCache = new LRUCache({ max: MAX_CACHE_ENTRIES, ttl: CACHE_TTL_MS });

function stableStringify(obj) {
    return JSON.stringify(obj, Object.keys(obj).sort());
}

function createCacheKey(config) {
    const minimal = {
        provider: 'xtream',
        epgUrl: config.epgUrl,
        enableEpg: !!config.enableEpg,
        xtreamUrl: config.xtreamUrl,
        xtreamUsername: config.xtreamUsername,
        epgOffsetHours: config.epgOffsetHours
    };
    return crypto.createHash('md5').update(stableStringify(minimal)).digest('hex');
}

class M3UEPGAddon {
    constructor(config = {}, manifestRef) {
        this.providerName = 'xtream';
        this.config = config;
        this.manifestRef = manifestRef;
        this.cacheKey = createCacheKey(config);
        this.updateInterval = 3600000;
        this.channels = [];
        this.epgData = {};
        this.lastUpdate = 0;
        this.log = makeLogger();

        if (typeof this.config.epgOffsetHours === 'string') {
            const n = parseFloat(this.config.epgOffsetHours);
            if (!isNaN(n)) this.config.epgOffsetHours = n;
        }
        if (typeof this.config.epgOffsetHours !== 'number' || !isFinite(this.config.epgOffsetHours))
            this.config.epgOffsetHours = 0;
        if (Math.abs(this.config.epgOffsetHours) > 48)
            this.config.epgOffsetHours = 0;

        this.log.debug('Addon instance created', {
            provider: this.providerName,
            cacheKey: this.cacheKey,
            epgOffsetHours: this.config.epgOffsetHours
        });
    }

    async loadFromCache() {
        if (!CACHE_ENABLED) return;
        const cacheKey = 'addon:data:' + this.cacheKey;
        const cached = dataCache.get(cacheKey);
        if (cached) {
            this.channels = cached.channels || [];
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
        dataCache.set(cacheKey, entry);
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
            const providerModule = require(`../providers/${this.providerName}Provider.js`);
            await providerModule.fetchData(this);
            this.lastUpdate = Date.now();
            if (CACHE_ENABLED) await this.saveToCache();
            this.buildGenresInManifest();
            this.log.debug('Data update complete', {
                channels: this.channels.length,
                ms: Date.now() - start
            });
        } catch (e) {
            this.log.error('[UPDATE] Failed:', e.message);
        }
    }

    deriveFallbackLogoUrl(item) {
        let finalUrl;
        const logoAttr = item.attributes?.['tvg-logo'];
        if (logoAttr && logoAttr.trim()) {
            finalUrl = logoAttr;
        } else {
            const tvgId = item.attributes?.['tvg-id'] || item.attributes?.['tvg-name'];
            if (!tvgId) {
                finalUrl = `https://via.placeholder.com/250x375/333333/FFFFFF?text=${encodeURIComponent(item.name)}`;
            } else {
                finalUrl = `logo/${encodeURIComponent(tvgId)}.png`;
            }
        }

        if (env.LOGO_RESIZE_ENABLED && finalUrl.startsWith('http') && !finalUrl.includes('wsrv.nl')) {
            return `https://wsrv.nl/?url=${encodeURIComponent(finalUrl)}&w=250&h=375&fit=contain&bg=black`;
        }
        return finalUrl;
    }

    generateMetaPreview(item) {
        const epgId = item.attributes?.['tvg-id'] || item.attributes?.['tvg-name'];
        const current = getCurrentProgram(this.epgData, epgId, this.config.epgOffsetHours);
        return {
            id: item.id,
            type: 'tv',
            name: item.name,
            description: current
                ? `📡 Now: ${current.title}${current.description ? `\n${current.description}` : ''}`
                : '📡 Live Channel',
            poster: this.deriveFallbackLogoUrl(item),
            genres: item.category
                ? [item.category]
                : (item.attributes?.['group-title'] ? [item.attributes['group-title']] : ['Live TV']),
            runtime: 'Live'
        };
    }

    getStream(id) {
        const item = this.channels.find(i => i.id === id);
        if (!item) return null;
        return {
            url: item.url,
            title: `${item.name} - Live`,
            behaviorHints: { notWebReady: true }
        };
    }

    getDetailedMeta(id) {
        const item = this.channels.find(i => i.id === id);
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
        return {
            id: item.id,
            type: 'tv',
            name: item.name,
            poster: this.deriveFallbackLogoUrl(item),
            description,
            genres: item.category
                ? [item.category]
                : (item.attributes?.['group-title'] ? [item.attributes['group-title']] : ['Live TV']),
            runtime: 'Live'
        };
    }
}

module.exports = { M3UEPGAddon, createCacheKey, buildPromiseCache, CACHE_ENABLED };
