'use strict';

/**
 * Escape special regex metacharacters in a string.
 */
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract a named attribute value from an #EXTINF or #EXTM3U line.
 * Handles both quoted and unquoted values:
 *   tvg-id="CNN"  or  tvg-id=CNN
 */
function extractAttr(line, attr) {
    const escaped = escapeRegExp(attr);
    const quotedRe = new RegExp(`${escaped}="([^"]*)"`, 'i');
    const quotedMatch = line.match(quotedRe);
    if (quotedMatch) return quotedMatch[1];
    const unquotedRe = new RegExp(`${escaped}=([^\\s,]*)`, 'i');
    const unquotedMatch = line.match(unquotedRe);
    if (unquotedMatch) return unquotedMatch[1];
    return '';
}

/**
 * Extract channel display name: text after the last comma in an #EXTINF line.
 */
function extractChannelName(extinfLine) {
    const commaIdx = extinfLine.lastIndexOf(',');
    if (commaIdx === -1) return 'Unknown';
    return extinfLine.slice(commaIdx + 1).trim() || 'Unknown';
}

/**
 * Parse raw M3U / M3U_PLUS text into a structured result.
 * @param {string} text
 * @returns {{ channels: Array, epgUrl: string|null }}
 */
function parseM3U(text) {
    if (!text || !text.trim()) return { channels: [], epgUrl: null };

    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    let epgUrl = null;
    const channels = [];
    let pendingChannel = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        if (line.startsWith('#EXTM3U')) {
            // url-tvg takes priority over x-tvg-url
            const tvgUrl = extractAttr(line, 'url-tvg') || extractAttr(line, 'x-tvg-url');
            if (tvgUrl) epgUrl = tvgUrl;
            continue;
        }

        if (line.startsWith('#EXTINF:')) {
            pendingChannel = {
                tvgId:     extractAttr(line, 'tvg-id'),
                tvgName:   extractAttr(line, 'tvg-name'),
                logo:      extractAttr(line, 'tvg-logo'),
                group:     extractAttr(line, 'group-title') || 'Uncategorized',
                name:      extractChannelName(line),
                url:       null,
                userAgent: extractAttr(line, 'user-agent') || extractAttr(line, 'http-user-agent') || '',
                referrer:  extractAttr(line, 'referrer') || extractAttr(line, 'http-referrer') || '',
            };
            continue;
        }

        if (line.startsWith('#EXTVLCOPT:') && pendingChannel) {
            const opt = line.slice('#EXTVLCOPT:'.length);
            const eqIdx = opt.indexOf('=');
            if (eqIdx !== -1) {
                const key = opt.slice(0, eqIdx).trim().toLowerCase();
                const val = opt.slice(eqIdx + 1).trim();
                if (key === 'http-user-agent') pendingChannel.userAgent = val;
                if (key === 'http-referrer') pendingChannel.referrer = val;
            }
            continue;
        }

        if (line.startsWith('#')) continue; // other M3U directives

        // Non-comment line = stream URL
        if (pendingChannel) {
            pendingChannel.url = line;
            channels.push(pendingChannel);
            pendingChannel = null;
        }
    }

    return { channels, epgUrl };
}

module.exports = { parseM3U };
