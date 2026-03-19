'use strict';

// Provider name → filename mapping (used for dynamic require in M3UEPGAddon)
const PROVIDER_FILE_MAP = {
    'xtream':   'xtreamProvider',
    'iptv-org': 'iptvOrgProvider',
    'm3u':      'm3uProvider',
};

// How often the addon re-fetches data from the provider (ms)
const UPDATE_INTERVAL_MS = 3600000; // 1 hour

module.exports = { PROVIDER_FILE_MAP, UPDATE_INTERVAL_MS };
