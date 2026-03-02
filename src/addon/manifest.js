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
        ...(env.ADDON_LOGO_URL ? { logo: env.ADDON_LOGO_URL } : {}),
        stremioAddonsConfig: {
            issuer: "https://stremio-addons.net",
            signature: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..xRFUl1vjkSQB9xNaGVsLQQ.sSG6y5Ldrq1G6vd4Ba0b56pUGBoxQjgIO-v5UKyU5YLGqCtgqPC6WpLc66fllXM2sl_5YhtmB5vy6qDD1PUWDiKT-K-yTqdhf7wE75w_qOLTE9lzZa7EAHJYGfzG4elW.SzmePMUqyIUkasul_4nVzg"
        }
    };
}

module.exports = { createManifest };
