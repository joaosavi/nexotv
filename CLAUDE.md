# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm --filter backend dev   # Backend dev server (port 7000, tsx watch)
pnpm --filter frontend dev  # Frontend dev server (port 5173, proxies /api + /encrypt to 7000)
pnpm dev                    # Both concurrently
pnpm build                    # Build both packages (frontend then backend)
pnpm --filter frontend build  # Build Vue frontend to packages/frontend/dist/
pnpm --filter backend build   # Compile TypeScript backend to packages/backend/dist/
cp .env.example .env          # Set up environment before first run
```

Docker:
```bash
docker-compose up -d
docker build -t nexotv .
docker run -d -e PORT=7000 -v ./data:/app/data -p 7000:7000 nexotv
```

## Architecture

This is a **Stremio addon** that proxies IPTV streams from three provider types:
- **Xtream Codes** — authenticated API (username/password/URL)
- **IPTV-org** — public JSON API with country/category filters
- **M3U/M3U+** — playlist URL with optional inline or custom EPG

### Request Flow

```
/:token/manifest.json  →  decrypt token  →  createAddon(config)  →  M3UEPGAddon
/:token/catalog        →  same addon instance (from LRU cache)   →  filtered channels
/:token/stream         →  same addon instance                     →  stream URLs
/:token/meta           →  same addon instance                     →  EPG metadata
```

The token in the URL encodes the full user config. If `CONFIG_SECRET` is set, it's AES-256-GCM encrypted; otherwise base64url. Token generation happens at `/configure` — the user installs the resulting manifest URL into Stremio.

Data refresh is driven by a **per-instance background timer** (`setInterval` started lazily in `ensureDataLoaded()`, cleared in `_evictFromMemory()`). `updateData` is no longer called from catalog request handlers — the timer fires every `UPDATE_INTERVAL_MS` independently of user traffic.

### Key Source Files

| File | Role |
|------|------|
| `packages/backend/server.ts` | Express setup, middleware order, graceful shutdown; auto-serves `packages/frontend/dist/` if built |
| `packages/backend/src/addon/M3UEPGAddon.ts` | Core class: holds channels + EPG, manages cache invalidation and data refresh |
| `packages/backend/src/addon/builder.ts` | Wraps M3UEPGAddon in Stremio SDK; defines catalog/stream/meta handlers |
| `packages/backend/src/addon/manifest.ts` | Generates Stremio manifest (genres, catalogs, capabilities) |
| `packages/backend/src/providers/xtreamProvider.ts` | Fetches live streams + categories from Xtream Codes API |
| `packages/backend/src/providers/iptvOrgProvider.ts` | Fetches channels/streams/logos from iptv-org; applies multi-select filters |
| `packages/backend/src/providers/m3uProvider.ts` | Fetches + parses M3U/M3U+ playlist; deduplicates channel IDs; loads EPG |
| `packages/backend/src/parsers/m3uParser.ts` | Parses raw M3U/M3U+ text → channel list + EPG URL |
| `packages/backend/src/parsers/epgParser.ts` | Parses XMLTV → structured EPG; `getCurrentProgram` / `getUpcoming` |
| `packages/backend/src/utils/sqliteCache.ts` | Persistent cache: WAL mode, gzip-compressed values, TTL, GC, VACUUM |
| `packages/backend/src/utils/lruCache.ts` | In-memory LRU cache with TTL eviction |
| `packages/backend/src/utils/cryptoConfig.ts` | Token encrypt/decrypt (AES-256-GCM or base64url) |
| `packages/backend/src/middleware/ssrf.ts` | Blocks RFC1918 IPs via DNS resolution (used in `/api/prefetch`) |
| `packages/backend/src/utils/validateUrl.ts` | SSRF guard: validates URLs are not RFC1918/loopback; used by m3uProvider + xtreamProvider before any outbound fetch |
| `packages/backend/src/routes/stremio.ts` | `/:token/*` routes; decrypts token, calls `createAddon`, delegates to SDK |
| `packages/backend/src/routes/pages.ts` | Config page routes; serves `packages/frontend/dist/index.html` |
| `packages/frontend/src/App.vue` | Root Vue component, tab + overlay orchestration |
| `packages/frontend/src/composables/useConfigToken.ts` | Token generation (encrypt or base64url) |
| `packages/frontend/src/composables/useManifestPoll.ts` | Manifest polling loop |

### Caching (3 layers)

1. **SQLite** (`data/` directory) — persistent; two entries per config:
   - `addon:channels:{key}` — raw JSON (no compression); channels + lastUpdate
   - `addon:epg:{key}` — gzip-compressed; EPG data only (written only if EPG is enabled)
   - TTL controlled by `CACHE_TTL_MS` / `M3U_CACHE_TTL_MS` / `IPTV_ORG_CACHE_TTL_MS`
2. **Build promise cache** (in-memory LRU) — deduplicates concurrent `createAddon()` calls; instances are **lightweight** (no channel data in RAM after setup); size controlled by `MAX_CACHE_ENTRIES`
3. **Data memory TTL** — channel/EPG data loaded from SQLite on demand via `ensureDataLoaded()` / `ensureEpgLoaded()`, evicted from RAM after `DATA_MEMORY_TTL_MS` of inactivity (default 5 min)

### Multi-select Filters (IPTV-org)

Filters use **OR within a category, AND across categories** (e.g., `country=US,CA` AND `category=sports,news` returns US+CA channels that are also sports or news).

### Key Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | 7000 | |
| `CONFIG_SECRET` | (unset) | Set to enable AES-256-GCM token encryption (≥16 chars) |
| `CACHE_TTL_MS` | 86400000 | Xtream cache TTL (ms) |
| `IPTV_ORG_CACHE_TTL_MS` | 86400000 | IPTV-org cache TTL (ms) |
| `M3U_CACHE_TTL_MS` | 86400000 | M3U/M3U+ cache TTL (ms) |
| `DATA_MEMORY_TTL_MS` | 300000 | How long channel/EPG data stays in RAM after last use (ms) |
| `MAX_CACHE_ENTRIES` | 300 | In-memory LRU addon instance cache size |
| `UPDATE_INTERVAL_MS` | 14400000 | How often the addon re-fetches data from the provider (ms) |
| `EPG_UPDATE_INTERVAL_MS` | 28800000 | How often EPG/XMLTV is re-fetched (ms); defaults to 2× `UPDATE_INTERVAL_MS` |
| `MIN_UPDATE_INTERVAL_MS` | 1800000 | Minimum time between re-fetches when channels are loaded (ms) |
| `ALLOW_LOCAL_URLS` | false | Set `true` for localhost IPTV testing |
| `DEBUG_MODE` | false | Verbose logging |
| `PREFETCH_MAX_BYTES` | 150MB | Max size for CORS-bypass prefetch |
| `PREFETCH_TIMEOUT_MS` | 45000 | Timeout for the prefetch proxy endpoint (ms) |
| `FETCH_TIMEOUT_MS` | 30000 | Timeout for stream/playlist fetches (ms) |
| `EPG_FETCH_TIMEOUT_MS` | 60000 | Timeout for EPG/XMLTV fetches (ms) |
| `LOGO_TIMEOUT_MS` | 10000 | Timeout for logo proxy requests (ms) |
| `EPG_MAX_BYTES` | 104857600 | Max EPG file size the server will parse (bytes) |
| `CATALOG_PAGE_SIZE` | 100 | Number of channels per catalog page in Stremio |
| `METRICS_SAMPLE_INTERVAL_MS` | 30000 | How often (ms) the watchdog samples heap and CPU |
| `METRICS_WARN_HEAP_MB` | 512 | Heap size (MB) that logs a [WARN]; set lower on constrained hosts |
| `METRICS_CRITICAL_HEAP_MB` | 768 | Heap size (MB) that logs [ERROR] and evicts idle LRU instances |

## Testing

```bash
pnpm --filter backend test            # Run all unit tests (vitest)
pnpm --filter backend test:watch      # Watch mode
pnpm --filter backend test:coverage   # Coverage report (≥70% on pure-function layers)
pnpm --filter backend test:bench      # Performance benchmarks
```

### Test structure

```
packages/backend/tests/
  helpers/
    fixtures.ts       # SAMPLE_M3U, SAMPLE_XMLTV, generateLargeM3U(), etc.
    makeConfig.ts     # Factory helpers for AddonConfig objects
  setup.ts            # Registers tsx/cjs so runtime require() resolves .ts files
  unit/
    lruCache.test.ts          # LRU eviction, TTL, fake timers
    cryptoConfig.test.ts      # AES-256-GCM round-trip, base64url, wrong-key rejection
    ssrf.test.ts              # isPrivateIp — RFC1918 blocks and ALLOW_LOCAL_URLS bypass
    manifest.test.ts          # createManifest — required fields, idPrefix, logo env vars
    m3uParser.test.ts         # parseM3U — attributes, CRLF, 10k-channel scale test
    epgParser.test.ts         # parseEPG, parseEPGTime, getCurrentProgram, getUpcoming
    sqliteCache.test.ts       # set/get/del/cleanExpired with in-memory SQLite
    m3uEpgAddon.pures.test.ts # createCacheKey, generateMetaPreview, deriveFallbackLogoUrl
```

**Coverage scope**: routes, providers, `builder.ts`, `M3UEPGAddon.ts` async methods, and `rateLimiter.ts` are excluded from Phase 2 thresholds — they will be covered by Phase 3 integration tests.

### CI Pipeline

`.github/workflows/test.yml` runs on every push/PR to `main` and `refactor/**`:
- **`test` job**: type check + unit/integration/security tests with coverage artifact (runs on all pushes and PRs)
- **`bench` job**: performance benchmarks with `bench-results.json` artifact (runs on push to `main` only)
