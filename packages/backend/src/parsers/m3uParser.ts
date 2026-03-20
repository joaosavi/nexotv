'use strict';

const MAX_LINE_LENGTH = 4096;

const KNOWN_ATTR_NAMES = [
    'tvg-id', 'tvg-name', 'tvg-logo', 'tvg-country', 'tvg-language',
    'tvg-type', 'group-title', 'user-agent', 'referrer',
    'catchup', 'catchup-days', 'catchup-source', 'x-tvg-url',
];

/**
 * Escape special regex metacharacters in a string.
 */
function escapeRegExp(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pre-compiled attribute regexes to avoid per-call regex construction (ReDoS mitigation).
const ATTR_REGEX_MAP: Record<string, [RegExp, RegExp]> = {};
for (const attr of KNOWN_ATTR_NAMES) {
    const escaped = escapeRegExp(attr);
    ATTR_REGEX_MAP[attr] = [
        new RegExp(`${escaped}="([^"]{0,2048})"`, 'i'),
        new RegExp(`${escaped}=([^\\s,]{0,2048})`, 'i'),
    ];
}

/**
 * Extract a named attribute value from an #EXTINF or #EXTM3U line.
 * Returns null if the attribute is not found.
 */
function extractAttr(line: string, attr: string): string | null {
    const regs = ATTR_REGEX_MAP[attr.toLowerCase()];
    if (regs) {
        const m = regs[0].exec(line) || regs[1].exec(line);
        return m ? m[1] : null;
    }
    // Fallback dynamic regex for unknown attributes (backward compatibility).
    const escaped = escapeRegExp(attr);
    const m =
        new RegExp(`${escaped}="([^"]{0,2048})"`, 'i').exec(line) ||
        new RegExp(`${escaped}=([^\\s,]{0,2048})`, 'i').exec(line);
    return m ? m[1] : null;
}

/**
 * Strip HTTP header injection characters (CR, LF, null bytes) and truncate to 512 chars.
 */
function sanitizeHeaderValue(v: string | null | undefined): string | null {
    if (!v) return null;
    return v.replace(/[\r\n\0\x0b\x0c]/g, '').slice(0, 512) || null;
}

/**
 * Extract channel display name: text after the last comma in an #EXTINF line.
 */
function extractChannelName(extinfLine: string) {
    const commaIdx = extinfLine.lastIndexOf(',');
    if (commaIdx === -1) return 'Unknown';
    return extinfLine.slice(commaIdx + 1).trim() || 'Unknown';
}

/**
 * Parse raw M3U / M3U_PLUS text into a structured result.
 */
export function parseM3U(text: string) {
    if (!text || !text.trim()) return { channels: [], epgUrl: null };

    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    let epgUrl: string | null = null;
    const channels: any[] = [];
    let pendingChannel: any = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        if (line.length > MAX_LINE_LENGTH) continue;

        if (line.startsWith('#EXTM3U')) {
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
                userAgent: sanitizeHeaderValue(extractAttr(line, 'user-agent') || extractAttr(line, 'http-user-agent')),
                referrer:  sanitizeHeaderValue(extractAttr(line, 'referrer') || extractAttr(line, 'http-referrer')),
            };
            continue;
        }

        if (line.startsWith('#EXTVLCOPT:') && pendingChannel) {
            const opt = line.slice('#EXTVLCOPT:'.length);
            const eqIdx = opt.indexOf('=');
            if (eqIdx !== -1) {
                const key = opt.slice(0, eqIdx).trim().toLowerCase();
                const val = opt.slice(eqIdx + 1).trim();
                if (key === 'http-user-agent') pendingChannel.userAgent = sanitizeHeaderValue(val);
                if (key === 'http-referrer') pendingChannel.referrer = sanitizeHeaderValue(val);
            }
            continue;
        }

        if (line.startsWith('#')) continue;

        if (pendingChannel) {
            pendingChannel.url = line;
            channels.push(pendingChannel);
            pendingChannel = null;
        }
    }

    return { channels, epgUrl };
}
