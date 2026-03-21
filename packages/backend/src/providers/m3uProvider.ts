'use strict';

import crypto from 'crypto';
import { parseM3U } from '../parsers/m3uParser';
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

    await validatePublicUrl(m3uUrl.trim());

    const conditionalHeaders: Record<string, string> = {};
    if (addonInstance.m3uEtag) {
        conditionalHeaders['If-None-Match'] = addonInstance.m3uEtag;
    } else if (addonInstance.m3uLastModified) {
        conditionalHeaders['If-Modified-Since'] = addonInstance.m3uLastModified;
    }

    const resp = await withTimeout(m3uUrl.trim(), { headers: conditionalHeaders }, env.FETCH_TIMEOUT_MS);

    if (resp.status === 304) {
        addonInstance.log?.debug('M3U 304 Not Modified — skipping parse');
        return;
    }
    if (!resp.ok) throw new Error(`M3U playlist fetch failed: HTTP ${resp.status}`);

    addonInstance.m3uEtag = resp.headers.get('etag') ?? null;
    addonInstance.m3uLastModified = resp.headers.get('last-modified') ?? null;

    addonInstance.channels = [];
    addonInstance.epgData = {};

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
            const now = Date.now();
            const epgStale = !addonInstance.lastEpgUpdate ||
                (now - addonInstance.lastEpgUpdate > env.EPG_UPDATE_INTERVAL_MS);

            if (epgStale) {
                try {
                    await validatePublicUrl(epgSource);
                    const epgResp = await withTimeout(epgSource, {}, env.EPG_FETCH_TIMEOUT_MS);
                    if (epgResp.ok) {
                        const contentLength = parseInt(epgResp.headers.get('content-length') ?? '0', 10);
                        if (contentLength > env.EPG_MAX_BYTES) {
                            const sizeMb = (contentLength / 1024 / 1024).toFixed(1);
                            addonInstance.log?.warn(`[EPG] Content-Length too large (${sizeMb} MB), skipping download`);
                        } else {
                            const epgContent = await epgResp.text();
                            addonInstance.epgData = await parseEPG(epgContent, addonInstance.log);
                            addonInstance.lastEpgUpdate = Date.now();
                        }
                    }
                } catch {
                    // EPG is optional — continue without it
                }
            } else {
                addonInstance.log?.debug('EPG skip (interval not elapsed)', {
                    ms: now - (addonInstance.lastEpgUpdate ?? 0)
                });
            }
        }
    }
}
