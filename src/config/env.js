// Central environment configuration — reads all process.env variables once.
// All other modules should require this file instead of reading process.env directly.
require('dotenv').config();

module.exports = {
    PORT: parseInt(process.env.PORT || '7000', 10),
    DEBUG: (process.env.DEBUG_MODE || '').toLowerCase() === 'true',
    CACHE_ENABLED: (process.env.CACHE_ENABLED || 'true').toLowerCase() !== 'false',
    CACHE_TTL_MS: parseInt(process.env.CACHE_TTL_MS || '21600000', 10),
    MAX_CACHE_ENTRIES: parseInt(process.env.MAX_CACHE_ENTRIES || '300', 10),
    PREFETCH_ENABLED: (process.env.PREFETCH_ENABLED || 'true').toLowerCase() !== 'false',
    PREFETCH_MAX_BYTES: parseInt(process.env.PREFETCH_MAX_BYTES || '150000000', 10),
    ADDON_NAME: process.env.ADDON_NAME || 'IPTV Stremio Addon',
    ADDON_DESCRIPTION: process.env.ADDON_DESCRIPTION || 'Stream your IPTV channels in Stremio',
    ADDON_LOGO_URL: process.env.ADDON_LOGO_URL || 'https://i.imgur.com/vN5tLuv.jpeg',
    LOGO_RESIZE_ENABLED: (process.env.LOGO_RESIZE_ENABLED || 'true').toLowerCase() !== 'false',
    LOGO_CACHE_ENABLED: (process.env.LOGO_CACHE_ENABLED || 'true').toLowerCase() !== 'false',
    CONFIG_SECRET: process.env.CONFIG_SECRET || null,
};
