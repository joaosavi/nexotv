import env from '../config/env';

export function createManifest(idPrefix?: string, catalogName?: string) {
    return {
        id: 'community.nexotv',
        version: '2.0.0',
        name: env.ADDON_NAME,
        description: env.ADDON_DESCRIPTION,
        resources: ['catalog', 'stream', 'meta'],
        types: ['tv'],
        catalogs: [
            {
                type: 'tv',
                id: 'iptv_channels',
                name: catalogName || env.ADDON_NAME,
                extra: [
                    { name: 'genre', isRequired: true, options: [] },
                    { name: 'search', isRequired: false },
                    { name: 'skip' }
                ],
                genres: []
            }
        ],
        idPrefixes: idPrefix ? [`xc${idPrefix}_`, `io${idPrefix}_`, `m3${idPrefix}_`] : ['xc', 'io', 'm3'],
        behaviorHints: {
            configurable: true,
            configurationRequired: true
        },
        ...(env.ADDON_LOGO_URL ? { logo: env.ADDON_LOGO_URL } : {}),
        ...(env.ADDON_BACKGROUND_URL ? { background: env.ADDON_BACKGROUND_URL } : {}),
    };
}
