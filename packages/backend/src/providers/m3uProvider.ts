'use strict';

import crypto from 'crypto';
import { parseM3U } from '../parsers/m3uParser';
import { parseEPG } from '../parsers/epgParser';
import { validatePublicUrl } from '../utils/validateUrl';

async function withTimeout(url: string, options: any, ms: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Derive a stable 12-char hex ID for a channel.
 */
function deriveBaseId(channel: any, idPrefix: string) {
    const raw = channel.tvgId && channel.tvgId.trim()
        ? channel.tvgId.trim()
        : channel.url;
    const hash = crypto.createHash('md5').update(raw).digest('hex').slice(0, 12);
    return `m3${idPrefix}_${hash}`;
}

export async function fetchData(addonInstance: any) {
    const { config } = addonInstance;
    const { m3uUrl } = config;

    if (!m3uUrl || typeof m3uUrl !== 'string' || !m3uUrl.trim()) {
        throw new Error('M3U URL is required');
    }

    addonInstance.channels = [];
    addonInstance.epgData = {};

    await validatePublicUrl(m3uUrl.trim());
    const resp = await withTimeout(m3uUrl.trim(), {}, 30000);
    if (!resp.ok) throw new Error(`M3U playlist fetch failed: HTTP ${resp.status}`);
    const text = await resp.text();

    const { channels: parsed, epgUrl: detectedEpgUrl } = parseM3U(text);

    const seenIds = new Set<string>();
    addonInstance.channels = parsed.map((ch: any) => {
        let id = deriveBaseId(ch, addonInstance.idPrefix);
        if (seenIds.has(id)) {
            let counter = 2;
            while (seenIds.has(`${id}_${counter}`)) counter++;
            id = `${id}_${counter}`;
        }
        seenIds.add(id);

        return {
            id,
            name:     ch.name,
            type:     'tv',
            url:      ch.url,
            logo:     ch.logo || '',
            category: ch.group,
            epg_channel_id: ch.tvgId || ch.tvgName || '',
            userAgent: ch.userAgent || '',
            referrer:  ch.referrer || '',
            attributes: {
                'tvg-id':      ch.tvgId,
                'tvg-name':    ch.tvgName,
                'tvg-logo':    ch.logo,
                'group-title': ch.group,
            },
        };
    });

    if (config.enableEpg) {
        const epgSource = (config.epgUrl && config.epgUrl.trim())
            ? config.epgUrl.trim()
            : detectedEpgUrl;

        if (epgSource) {
            try {
                await validatePublicUrl(epgSource);
                const epgResp = await withTimeout(epgSource, {}, 60000);
                if (epgResp.ok) {
                    const epgContent = await epgResp.text();
                    addonInstance.epgData = await parseEPG(epgContent, addonInstance.log);
                }
            } catch {
                // EPG is optional — continue without it
            }
        }
    }
}
