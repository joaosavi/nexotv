import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Walk up from __dirname until we find pnpm-workspace.yaml (monorepo root).
// Works for both tsx (src/config/) and compiled (dist/src/config/) contexts.
function findRepoRoot(startDir: string): string {
    let dir = startDir;
    while (true) {
        if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) return startDir; // filesystem root — fallback
        dir = parent;
    }
}
const repoRoot = findRepoRoot(__dirname);
dotenv.config({ path: path.join(repoRoot, '.env') });

const env = {
    PORT: parseInt(process.env.PORT || '7000', 10),
    DEBUG: (process.env.DEBUG_MODE || '').toLowerCase() === 'true',
    CACHE_ENABLED: (process.env.CACHE_ENABLED || 'true').toLowerCase() !== 'false',
    CACHE_TTL_MS: parseInt(process.env.CACHE_TTL_MS || '86400000', 10),
    MAX_CACHE_ENTRIES: parseInt(process.env.MAX_CACHE_ENTRIES || '300', 10),
    PREFETCH_ENABLED: (process.env.PREFETCH_ENABLED || 'true').toLowerCase() !== 'false',
    PREFETCH_MAX_BYTES: parseInt(process.env.PREFETCH_MAX_BYTES || '150000000', 10),
    ADDON_NAME: process.env.ADDON_NAME || 'NexoTV',
    ADDON_DESCRIPTION: process.env.ADDON_DESCRIPTION || 'Stream your IPTV channels in Stremio',
    ADDON_LOGO_URL: process.env.ADDON_LOGO_URL || 'https://raw.githubusercontent.com/joaosavi/nexotv/refs/heads/main/packages/frontend/public/assets/logo.svg',
    ADDON_BACKGROUND_URL: process.env.ADDON_BACKGROUND_URL || 'https://raw.githubusercontent.com/joaosavi/nexotv/refs/heads/main/packages/frontend/public/assets/background.png',
    LOGO_CACHE_ENABLED: (process.env.LOGO_CACHE_ENABLED || 'true').toLowerCase() !== 'false',
    CONFIG_SECRET: process.env.CONFIG_SECRET || null,
    IP_RATE_LIMIT_ENABLED: (process.env.IP_RATE_LIMIT_ENABLED || 'true').toLowerCase() !== 'false',
    IP_RATE_LIMIT_WINDOW_MS: parseInt(process.env.IP_RATE_LIMIT_WINDOW_MS || '300000', 10),
    IP_RATE_LIMIT_MAX: parseInt(process.env.IP_RATE_LIMIT_MAX || '300', 10),
    TOKEN_RATE_LIMIT_ENABLED: (process.env.TOKEN_RATE_LIMIT_ENABLED || 'true').toLowerCase() !== 'false',
    TOKEN_RATE_LIMIT_WINDOW_MS: parseInt(process.env.TOKEN_RATE_LIMIT_WINDOW_MS || '60000', 10),
    TOKEN_RATE_LIMIT_MAX: parseInt(process.env.TOKEN_RATE_LIMIT_MAX || '60', 10),
    SQLITE_PATH: process.env.SQLITE_PATH || null,
    SQLITE_GC_INTERVAL_MS: parseInt(process.env.SQLITE_GC_INTERVAL_MS || '21600000', 10),
    SQLITE_VACUUM_INTERVAL_MS: parseInt(process.env.SQLITE_VACUUM_INTERVAL_MS || '604800000', 10),
    IPTV_ORG_CACHE_TTL_MS: parseInt(process.env.IPTV_ORG_CACHE_TTL_MS || '') || 86400000,
    M3U_CACHE_TTL_MS: parseInt(process.env.M3U_CACHE_TTL_MS || '') || 86400000,
    ALLOW_LOCAL_URLS: (process.env.ALLOW_LOCAL_URLS || 'false').toLowerCase() === 'true',
    DATA_MEMORY_TTL_MS: parseInt(process.env.DATA_MEMORY_TTL_MS || '300000', 10),
    UPDATE_INTERVAL_MS: parseInt(process.env.UPDATE_INTERVAL_MS || '14400000', 10),
    MIN_UPDATE_INTERVAL_MS: parseInt(process.env.MIN_UPDATE_INTERVAL_MS || '1800000', 10),
    EPG_UPDATE_INTERVAL_MS: parseInt(process.env.EPG_UPDATE_INTERVAL_MS || '') || 28800000,
    EPG_MAX_BYTES: parseInt(process.env.EPG_MAX_BYTES || '104857600', 10),
    CATALOG_PAGE_SIZE: parseInt(process.env.CATALOG_PAGE_SIZE || '100', 10),
    FETCH_TIMEOUT_MS: parseInt(process.env.FETCH_TIMEOUT_MS || '30000', 10),
    EPG_FETCH_TIMEOUT_MS: parseInt(process.env.EPG_FETCH_TIMEOUT_MS || '60000', 10),
    PREFETCH_TIMEOUT_MS: parseInt(process.env.PREFETCH_TIMEOUT_MS || '45000', 10),
    LOGO_TIMEOUT_MS: parseInt(process.env.LOGO_TIMEOUT_MS || '10000', 10),
    METRICS_SAMPLE_INTERVAL_MS: parseInt(process.env.METRICS_SAMPLE_INTERVAL_MS || '30000', 10),
    METRICS_WARN_HEAP_MB: parseInt(process.env.METRICS_WARN_HEAP_MB || '512', 10),
    METRICS_CRITICAL_HEAP_MB: parseInt(process.env.METRICS_CRITICAL_HEAP_MB || '768', 10),
};

export { repoRoot };
export default env;
