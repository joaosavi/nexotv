const env = require('../config/env');

const IPTV_ORG_BASE = 'https://iptv-org.github.io/api';

async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`iptv-org fetch failed: ${url} (${res.status})`);
    return res.json();
}

async function fetchData(addonInstance) {
    const { config } = addonInstance;

    const filterCountry = config.iptvOrgCountry ? config.iptvOrgCountry.toUpperCase() : null;
    const filterCategory = config.iptvOrgCategory ? config.iptvOrgCategory.toLowerCase() : null;

    addonInstance.channels = [];
    addonInstance.epgData = {};

    addonInstance.log.debug('[iptvOrg] Fetching channels + streams in parallel…');

    const [channelsRaw, streamsRaw] = await Promise.all([
        fetchJson(`${IPTV_ORG_BASE}/channels.json`),
        fetchJson(`${IPTV_ORG_BASE}/streams.json`),
    ]);

    const streamMap = {};
    for (const s of streamsRaw) {
        if (!s || !s.channel || !s.url) continue;
        if (!streamMap[s.channel]) streamMap[s.channel] = [];
        streamMap[s.channel].push(s.url);
    }

    const channels = [];
    for (const ch of channelsRaw) {
        const urls = streamMap[ch.id];
        if (!urls || urls.length === 0) continue;

        if (filterCountry && ch.country !== filterCountry) continue;

        if (filterCategory) {
            const cats = Array.isArray(ch.categories)
                ? ch.categories.map(c => c.toLowerCase())
                : [];
            if (!cats.includes(filterCategory)) continue;
        }

        const category = ch.categories?.[0] || 'Live TV';
        const logo = ch.logo || '';

        for (let i = 0; i < urls.length; i++) {
            channels.push({
                id: `iptvorg_${ch.id}_${i}`,
                name: i === 0 ? ch.name : `${ch.name} [${i + 1}]`,
                type: 'tv',
                url: urls[i],
                logo,
                category,
                epg_channel_id: null,
                attributes: {
                    'tvg-logo': logo,
                    'tvg-id': ch.id,
                    'group-title': category
                }
            });
        }
    }

    addonInstance.channels = channels;
    addonInstance.log.debug(`[iptvOrg] Done — ${channels.length} channel entries (with streams)`);
}

module.exports = { fetchData };
