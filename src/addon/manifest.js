const env = require('../config/env');

function createManifest() {
    return {
        id: 'org.stremio.iptv-addon',
        version: '1.0.0',
        name: env.ADDON_NAME,
        description: env.ADDON_DESCRIPTION,
        resources: ['catalog', 'stream', 'meta'],
        types: ['tv'],
        catalogs: [
            {
                type: 'tv',
                id: 'iptv_channels',
                name: env.ADDON_NAME,
                extra: [
                    { name: 'genre', isRequired: false, options: [] },
                    { name: 'search', isRequired: false },
                    { name: 'skip' }
                ],
                genres: []
            }
        ],
        idPrefixes: ['iptv_'],
        behaviorHints: {
            configurable: true,
            configurationRequired: true
        },
        ...(env.ADDON_LOGO_URL ? { logo: env.ADDON_LOGO_URL } : {})
    };
}

module.exports = { createManifest };
