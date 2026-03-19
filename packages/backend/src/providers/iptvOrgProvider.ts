import env from '../config/env';

const IPTV_ORG_BASE = 'https://iptv-org.github.io/api';

async function fetchJson(url: string) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`iptv-org fetch failed: ${url} (${res.status})`);
    return res.json();
}

export async function fetchData(addonInstance: any) {
    const { config } = addonInstance;

    const filterCountries = config.iptvOrgCountry ? config.iptvOrgCountry.split(',').map((c: string) => c.trim().toUpperCase()).filter((c: string) => c) : [];
    const filterCategories = config.iptvOrgCategory ? config.iptvOrgCategory.split(',').map((c: string) => c.trim().toLowerCase()).filter((c: string) => c) : [];

    addonInstance.channels = [];
    addonInstance.epgData = {};

    addonInstance.log.debug('[iptvOrg] Fetching channels + streams in parallel…');

    const [channelsRaw, streamsRaw, logosRaw] = await Promise.all([
        fetchJson(`${IPTV_ORG_BASE}/channels.json`),
        fetchJson(`${IPTV_ORG_BASE}/streams.json`),
        fetchJson(`${IPTV_ORG_BASE}/logos.json`),
    ]);

    const streamMap: Record<string, string[]> = {};
    for (const s of streamsRaw) {
        if (!s || !s.channel || !s.url) continue;
        if (!streamMap[s.channel]) streamMap[s.channel] = [];
        streamMap[s.channel].push(s.url);
    }

    const logoMap: Record<string, string> = {};
    for (const l of logosRaw) {
        if (!l || !l.channel || !l.url) continue;
        if (!logoMap[l.channel]) logoMap[l.channel] = l.url;
    }

    const channels: any[] = [];
    for (const ch of channelsRaw) {
        const urls = streamMap[ch.id];
        if (!urls || urls.length === 0) continue;

        if (filterCountries.length > 0 && !filterCountries.includes(ch.country)) continue;

        if (filterCategories.length > 0) {
            const cats = Array.isArray(ch.categories)
                ? ch.categories.map((c: string) => c.toLowerCase())
                : [];
            const overlap = cats.some((c: string) => filterCategories.includes(c));
            if (!overlap) continue;
        }

        const category = ch.categories?.[0] || 'Live TV';
        const logo = logoMap[ch.id] || ch.logo || '';

        channels.push({
            id: `io${addonInstance.idPrefix}_${ch.id}`,
            name: ch.name,
            type: 'tv',
            url: urls[0],
            urls,
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

    addonInstance.channels = channels;
    addonInstance.log.debug(`[iptvOrg] Done — ${channels.length} channel entries (with streams)`);
}
