import crypto from 'crypto';
import LRUCache from '../utils/lruCache';
import * as sqliteCache from '../utils/sqliteCache';
import { makeLogger } from '../utils/logger';
import { parseEPG, getCurrentProgram, getUpcomingPrograms } from '../parsers/epgParser';
import env from '../config/env';
import { UPDATE_INTERVAL_MS } from '../config/constants';
import * as xtreamProvider from '../providers/xtreamProvider';
import * as iptvOrgProvider from '../providers/iptvOrgProvider';
import * as m3uProvider from '../providers/m3uProvider';

const CACHE_ENABLED = env.CACHE_ENABLED;
const CACHE_TTL_MS = env.CACHE_TTL_MS;
const MAX_CACHE_ENTRIES = env.MAX_CACHE_ENTRIES;

if (CACHE_ENABLED) {
    sqliteCache.init(env.SQLITE_PATH);
}

export const buildPromiseCache = new LRUCache({ max: MAX_CACHE_ENTRIES, ttl: CACHE_TTL_MS });

const PROVIDER_MAP: Record<string, { fetchData: (addon: any) => Promise<void> }> = {
    'xtream': xtreamProvider,
    'iptv-org': iptvOrgProvider,
    'm3u': m3uProvider,
};

export interface AddonConfig {
    provider?: string;
    xtreamUrl?: string;
    xtreamUsername?: string;
    xtreamPassword?: string;
    m3uUrl?: string;
    epgUrl?: string;
    enableEpg?: boolean;
    epgOffsetHours?: number | string;
    reformatLogos?: boolean;
    iptvOrgCountry?: string;
    iptvOrgCategory?: string;
    instanceId?: string;
}

function stableStringify(obj: any) {
    return JSON.stringify(obj, Object.keys(obj).sort());
}

export function createCacheKey(config: AddonConfig) {
    const provider = config.provider || 'xtream';
    let minimal: any;
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

export class M3UEPGAddon {
    providerName: string;
    config: AddonConfig;
    manifestRef: any;
    cacheKey: string;
    idPrefix: string;
    updateInterval: number;
    channels: any[];
    channelMap: Map<string, any>;
    epgData: Record<string, any[]>;
    lastUpdate: number;
    _evictTimer: any;
    _loadPromise: any;
    firstCatalogRefreshDone: boolean;
    firstCatalogRefreshPromise: any;
    cacheTtl: number;
    log: ReturnType<typeof makeLogger>;

    constructor(config: AddonConfig = {}, manifestRef?: any) {
        this.providerName = config.provider || 'xtream';
        this.config = config;
        this.manifestRef = manifestRef;
        this.cacheKey = createCacheKey(config);
        this.idPrefix = this.cacheKey.slice(0, 8);
        this.updateInterval = UPDATE_INTERVAL_MS;
        this.channels = [];
        this.channelMap = new Map();
        this.epgData = {};
        this.lastUpdate = 0;
        this._evictTimer = null;
        this._loadPromise = null;
        this.firstCatalogRefreshDone = false;
        this.firstCatalogRefreshPromise = null;
        const TTL_MAP: Record<string, number> = {
            'iptv-org': env.IPTV_ORG_CACHE_TTL_MS,
            'm3u': env.M3U_CACHE_TTL_MS,
        };
        this.cacheTtl = TTL_MAP[this.providerName] ?? CACHE_TTL_MS;
        this.log = makeLogger();

        if (typeof this.config.epgOffsetHours === 'string') {
            const n = parseFloat(this.config.epgOffsetHours);
            if (!isNaN(n)) this.config.epgOffsetHours = n;
        }
        if (typeof this.config.epgOffsetHours !== 'number' || !isFinite(this.config.epgOffsetHours as number))
            this.config.epgOffsetHours = 0;
        if (Math.abs(this.config.epgOffsetHours as number) > 48)
            this.config.epgOffsetHours = 0;

        if (this.providerName === 'iptv-org' || this.providerName === 'm3u') {
            this.config.reformatLogos = true;
        }

        this.log.debug('Addon instance created', {
            provider: this.providerName,
            cacheKey: this.cacheKey,
            epgOffsetHours: this.config.epgOffsetHours
        });
    }

    async saveChannelsToCache() {
        if (!CACHE_ENABLED) return;
        sqliteCache.setRaw('addon:channels:' + this.cacheKey, {
            channels: this.channels,
            lastUpdate: this.lastUpdate
        }, this.cacheTtl);
        this.log.debug('Channels saved to cache', { count: this.channels.length });
    }

    async loadChannelsFromCache() {
        if (!CACHE_ENABLED) return;
        const cached = sqliteCache.getRaw('addon:channels:' + this.cacheKey);
        if (cached) {
            this.channels = cached.channels || [];
            this.channelMap = new Map(this.channels.map(c => [c.id, c]));
            this.lastUpdate = cached.lastUpdate || 0;
            this.log.debug('Channels loaded from cache', { count: this.channels.length });
        }
    }

    async saveEpgToCache() {
        if (!CACHE_ENABLED) return;
        if (!this.epgData || Object.keys(this.epgData).length === 0) return;
        sqliteCache.set('addon:epg:' + this.cacheKey, { epgData: this.epgData }, this.cacheTtl);
        this.log.debug('EPG saved to cache', { channels: Object.keys(this.epgData).length });
    }

    async loadEpgFromCache() {
        if (!CACHE_ENABLED) return;
        const cached = sqliteCache.get('addon:epg:' + this.cacheKey);
        if (cached) {
            this.epgData = cached.epgData || {};
            this.log.debug('EPG loaded from cache', { channels: Object.keys(this.epgData).length });
        }
    }

    async ensureEpgLoaded() {
        if (this.epgData && Object.keys(this.epgData).length > 0) return;
        if (!CACHE_ENABLED) return;
        await this.loadEpgFromCache();
    }

    buildGenresInManifest() {
        if (!this.manifestRef) return;
        const tvCatalog = this.manifestRef.catalogs.find((c: any) => c.id === 'iptv_channels');
        if (tvCatalog) {
            const groups = [
                ...new Set(
                    this.channels
                        .map(c => c.category || c.attributes?.['group-title'])
                        .filter(Boolean)
                        .map((s: string) => s.trim())
                )
            ].sort((a: any, b: any) => a.localeCompare(b));
            if (!groups.includes('All Channels')) groups.unshift('All Channels');
            tvCatalog.genres = groups;

            const genreExtra = tvCatalog.extra.find((e: any) => e.name === 'genre');
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
            const providerModule = PROVIDER_MAP[this.providerName];
            if (!providerModule) throw new Error(`Unknown provider: ${this.providerName}`);
            await providerModule.fetchData(this);
            this.channelMap = new Map(this.channels.map(c => [c.id, c]));
            this.lastUpdate = Date.now();
            if (CACHE_ENABLED) {
                await this.saveChannelsToCache();
                await this.saveEpgToCache();
            }
            this.buildGenresInManifest();
            this.log.debug('Data update complete', {
                channels: this.channels.length,
                ms: Date.now() - start
            });
        } catch (e: any) {
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

        const JUST_FETCHED_MS = 2 * 60 * 1000;
        if (this.lastUpdate && (Date.now() - this.lastUpdate < JUST_FETCHED_MS)) {
            this.firstCatalogRefreshDone = true;
            return;
        }

        this.firstCatalogRefreshPromise = (async () => {
            if (CACHE_ENABLED) {
                sqliteCache.del('addon:channels:' + this.cacheKey);
                sqliteCache.del('addon:epg:' + this.cacheKey);
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

    deriveFallbackLogoUrl(item: any) {
        let finalUrl: string;
        const logoAttr = item.attributes?.['tvg-logo'] || item.logo;
        if (logoAttr && logoAttr.trim()) {
            finalUrl = logoAttr;
        } else {
            finalUrl = `https://placehold.co/250x375/2b2b2b/FFFFFF.png?text=${encodeURIComponent(item.name || 'TV')}`;
        }

        if (this.config.reformatLogos && finalUrl.startsWith('http') && !finalUrl.includes('wsrv.nl') && !finalUrl.includes('placehold.co')) {
            if (finalUrl.includes('imgur.com')) {
                finalUrl = `https://proxy.duckduckgo.com/iu/?u=${encodeURIComponent(finalUrl)}`;
            }
            return `https://wsrv.nl/?url=${encodeURIComponent(finalUrl)}&w=250&h=375&fit=contain&we&bg=2b2b2b`;
        }
        return finalUrl;
    }

    generateMetaPreview(item: any) {
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

    async getStreams(id: string) {
        await this.ensureDataLoaded();
        const item = this.channelMap.get(id);
        if (!item) return [];

        const reqHeaders: Record<string, string> = {};
        if (item.userAgent) reqHeaders['User-Agent'] = item.userAgent;
        if (item.referrer)  reqHeaders['Referer']    = item.referrer;
        const behaviorHints = Object.keys(reqHeaders).length
            ? { notWebReady: true, proxyHeaders: { request: reqHeaders } }
            : { notWebReady: true };

        if (item.urls && item.urls.length > 0) {
            return item.urls.map((url: string, index: number) => ({
                url,
                title: item.urls.length > 1 ? `${item.name} - Link ${index + 1}` : `${item.name} - Live`,
                behaviorHints,
            }));
        }

        const streams = [{ url: item.url, title: `${item.name} - Live`, behaviorHints }];

        const xtreamRe = /^https?:\/\/[^/]+\/[^/]+\/[^/]+\/(\d+)$/;
        if (xtreamRe.test(item.url)) {
            streams.unshift({
                url: item.url + '.m3u8',
                title: `${item.name} - HLS`,
                behaviorHints,
            });
        }

        return streams;
    }

    async getDetailedMeta(id: string) {
        await this.ensureDataLoaded();
        await this.ensureEpgLoaded();
        const item = this.channelMap.get(id);
        if (!item) return null;
        const epgId = item.attributes?.['tvg-id'] || item.attributes?.['tvg-name'];
        const current = getCurrentProgram(this.epgData, epgId, this.config.epgOffsetHours as number);
        const upcoming = getUpcomingPrograms(this.epgData, epgId, 3, this.config.epgOffsetHours as number);
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

    _resetEvictTimer() {
        clearTimeout(this._evictTimer);
        this._evictTimer = setTimeout(() => this._evictFromMemory(), env.DATA_MEMORY_TTL_MS);
    }

    _evictFromMemory() {
        this.channels = [];
        this.channelMap = new Map();
        this.epgData = {};
        this._evictTimer = null;
        this.log.debug('Data evicted from RAM', { cacheKey: this.cacheKey });
    }

    async ensureDataLoaded() {
        if (this.channels.length > 0) {
            this._resetEvictTimer();
            return;
        }
        if (!CACHE_ENABLED) return;
        if (this._loadPromise) {
            await this._loadPromise;
            return;
        }
        this._loadPromise = this.loadChannelsFromCache().finally(() => { this._loadPromise = null; });
        await this._loadPromise;
        this._resetEvictTimer();
    }

    async getChannelsForCatalog() {
        await this.ensureDataLoaded();
        return this.channels;
    }
}

export { CACHE_ENABLED };
