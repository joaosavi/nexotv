import { parseEPG } from '../parsers/epgParser';
import { validatePublicUrl } from '../utils/validateUrl';
import env from '../config/env';

async function withTimeout(url: string, options: any, ms: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

export async function fetchData(addonInstance: any) {
    const { config } = addonInstance;
    const {
        xtreamUrl,
        xtreamUsername,
        xtreamPassword
    } = config;

    if (!xtreamUrl || !xtreamUsername || !xtreamPassword) {
        throw new Error('Xtream credentials incomplete');
    }

    await validatePublicUrl(xtreamUrl);
    const base = `${xtreamUrl}/player_api.php?username=${encodeURIComponent(xtreamUsername)}&password=${encodeURIComponent(xtreamPassword)}`;

    const liveHeaders: Record<string, string> = {};
    if (addonInstance.xtreamEtag) liveHeaders['If-None-Match'] = addonInstance.xtreamEtag;

    const [liveResp, liveCatsResp] = await Promise.all([
        withTimeout(`${base}&action=get_live_streams`, { headers: liveHeaders }, env.FETCH_TIMEOUT_MS),
        withTimeout(`${base}&action=get_live_categories`, {}, env.FETCH_TIMEOUT_MS).catch(() => null)
    ]);

    if (liveResp.status === 304) {
        addonInstance.log?.debug('Xtream 304 Not Modified — skipping update');
        return;
    }
    if (!liveResp.ok) throw new Error('Xtream live streams fetch failed');

    addonInstance.xtreamEtag = liveResp.headers.get('etag') ?? null;

    addonInstance.channels = [];
    addonInstance.epgData = {};

    const live = await liveResp.json();

    let liveCatMap: Record<string, string> = {};
    try {
        if (liveCatsResp && liveCatsResp.ok) {
            const arr = await liveCatsResp.json();
            if (Array.isArray(arr)) {
                for (const c of arr) {
                    if (c && c.category_id && c.category_name)
                        liveCatMap[c.category_id] = c.category_name;
                }
            }
        }
    } catch { /* ignore */ }

    addonInstance.channels = (Array.isArray(live) ? live : []).map((s: any) => {
        const cat = liveCatMap[s.category_id] || s.category_name || s.category_id || 'Live';
        return {
            id: `xc${addonInstance.idPrefix}_${s.stream_id}`,
            name: s.name,
            type: 'tv',
            url: `${xtreamUrl}/live/${xtreamUsername}/${xtreamPassword}/${s.stream_id}.m3u8`,
            logo: s.stream_icon,
            category: cat,
            epg_channel_id: s.epg_channel_id,
            attributes: {
                'tvg-logo': s.stream_icon,
                'tvg-id': s.epg_channel_id,
                'group-title': cat
            }
        };
    });

    if (config.enableEpg) {
        const customEpgUrl = config.epgUrl && typeof config.epgUrl === 'string' && config.epgUrl.trim() ? config.epgUrl.trim() : null;
        const epgSource = customEpgUrl
            ? customEpgUrl
            : `${xtreamUrl}/xmltv.php?username=${encodeURIComponent(xtreamUsername)}&password=${encodeURIComponent(xtreamPassword)}`;

        try {
            const epgResp = await withTimeout(epgSource, {}, env.EPG_FETCH_TIMEOUT_MS);
            if (epgResp.ok) {
                const epgContent = await epgResp.text();
                addonInstance.epgData = await parseEPG(epgContent, addonInstance.log);
            }
        } catch {
            // Ignore EPG errors
        }
    }
}
