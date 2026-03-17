const env = require('../config/env');

function createManifest(idPrefix) {
    return {
        id: 'org.stremio.iptv-addon',
        version: '1.2.0',
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
        idPrefixes: idPrefix ? [`xc${idPrefix}_`, `io${idPrefix}_`] : ['xc', 'io'],
        behaviorHints: {
            configurable: true,
            configurationRequired: true
        },
        ...(env.ADDON_LOGO_URL ? { logo: env.ADDON_LOGO_URL } : {}),
        stremioAddonsConfig: {
            issuer: "https://stremio-addons.net",
            signature: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..bAAYu9Z2x2hZNnFslnPZXw.7K1l8Ytr4oH3kqcKtpS0U90IrquPapWIhFFhhGjGGdIudpMDxzCydsYbVl1uM-AW5vOhbtk_eGkmHcgJDjXg4Ak7ui8YLdznuC5j6TEiQC2Wjf9CoCtjiSijy0VFzPXT.NH78pw2334jBBHDCxmgmUQ"
        }
    };
}

module.exports = { createManifest };
