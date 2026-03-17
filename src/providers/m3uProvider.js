'use strict';

const crypto = require('crypto');
const { parseM3U } = require('../parsers/m3uParser');
const { parseEPG } = require('../parsers/epgParser');

async function withTimeout(url, options, ms) {
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
 * Uses tvg-id when present (stable across refreshes), otherwise hashes the URL.
 */
function deriveBaseId(channel, idPrefix) {
    const raw = channel.tvgId && channel.tvgId.trim()
        ? channel.tvgId.trim()
        : channel.url;
    const hash = crypto.createHash('md5').update(raw).digest('hex').slice(0, 12);
    return `m3${idPrefix}_${hash}`;
}

async function fetchData(addonInstance) {
    const { config } = addonInstance;
    const { m3uUrl } = config;

    if (!m3uUrl || typeof m3uUrl !== 'string' || !m3uUrl.trim()) {
        throw new Error('M3U URL is required');
    }

    addonInstance.channels = [];
    addonInstance.epgData = {};

    const resp = await withTimeout(m3uUrl.trim(), {}, 30000);
    if (!resp.ok) throw new Error(`M3U playlist fetch failed: HTTP ${resp.status}`);
    const text = await resp.text();

    const { channels: parsed, epgUrl: detectedEpgUrl } = parseM3U(text);

    // Build channels with deduplication of colliding IDs
    const seenIds = new Set();
    addonInstance.channels = parsed.map(ch => {
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
            attributes: {
                'tvg-id':      ch.tvgId,
                'tvg-name':    ch.tvgName,
                'tvg-logo':    ch.logo,
                'group-title': ch.group,
            },
        };
    });

    // EPG: prefer explicit config override, then url-tvg from playlist header
    if (config.enableEpg) {
        const epgSource = (config.epgUrl && config.epgUrl.trim())
            ? config.epgUrl.trim()
            : detectedEpgUrl;

        if (epgSource) {
            try {
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

module.exports = { fetchData };
