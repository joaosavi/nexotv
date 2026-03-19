# NexoTV

> A self-hostable, token-based, privacy-friendly IPTV addon for **Stremio**.
> Connect via **Xtream Codes**, load any **M3U/M3U+ playlist**, or browse the free **IPTV-org public channel list**.

---

## Features

- **Three Providers:** Xtream Codes JSON API, any M3U/M3U+ playlist URL, or the IPTV-org public repository
- **Unified Config UI:** Responsive, tabbed setup page for all providers
- **EPG Support:** XMLTV from Xtream panel, embedded playlist header (`url-tvg`/`x-tvg-url`), or a custom XMLTV URL — pruned and optimized for low memory usage
- **Filtering & Search:** Category browsing, full-text search, and multi-select Country/Category filtering for IPTV-org (OR within category, AND across categories)
- **Encrypted Tokens:** Base64URL (plain) or AES-256-GCM (with `CONFIG_SECRET`)
- **Persistent Cache:** SQLite with split channels/EPG entries (channels uncompressed, EPG gzip), configurable TTL, and automatic garbage collection; channel/EPG data evicted from RAM after idle timeout and reloaded on demand
- **Logo Proxy:** Multi-source fallback, optional per-user resize, and optional caching
- **SSRF Protection:** Server-side CORS bypass proxy with hostname + DNS validation
- **Rate Limiting:** Global IP-based and per-token limits to prevent abuse

---

## Quick Start

```bash
git clone https://github.com/joaosavi/nexotv.git
cd nexotv
cp .env.example .env
npm install
npm start
# Open http://localhost:7000/configure
```

---

## Docker

```bash
docker build -t nexotv .
docker run -d \
  -e PORT=7000 \
  -v ./data:/app/data \
  -p 7000:7000 \
  --name nexotv \
  nexotv
```

### Docker Compose

```bash
cp .env.example .env
docker compose up -d
```

---

## Installing in Stremio

1. Open `http://your-host/configure`
2. Pick a provider tab:
   - **Xtream API** — enter your panel URL, username, and password
   - **IPTV-org** — select Country and Category from the searchable dropdowns
   - **M3U/M3U+** — paste a playlist URL; EPG is auto-detected or can be set manually
3. Click **Install Addon**
4. Click **Open in Stremio** or copy the manifest URL

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `7000` | HTTP server port |
| `ADDON_NAME` | `NexoTV` | Addon name shown in Stremio |
| `ADDON_DESCRIPTION` | `Stream your IPTV channels in Stremio` | Addon description |
| `ADDON_LOGO_URL` | *(unset)* | URL for the addon logo in Stremio |
| `CONFIG_SECRET` | *(unset)* | Enables AES-256-GCM token encryption (must be ≥16 chars) |
| `CACHE_ENABLED` | `true` | Enable persistent SQLite caching |
| `CACHE_TTL_MS` | `21600000` | Xtream cache TTL in ms (default 6h) |
| `IPTV_ORG_CACHE_TTL_MS` | `21600000` | IPTV-org cache TTL in ms |
| `M3U_CACHE_TTL_MS` | `21600000` | M3U/M3U+ cache TTL in ms |
| `DATA_MEMORY_TTL_MS` | `300000` | How long channel/EPG data stays in RAM after last use (5m) |
| `MAX_CACHE_ENTRIES` | `300` | Max in-memory addon instances (lightweight, data loaded on demand) |
| `SQLITE_PATH` | `./data/cache.sqlite` | SQLite database path |
| `SQLITE_GC_INTERVAL_MS` | `21600000` | How often to purge expired cache entries (6h) |
| `SQLITE_VACUUM_INTERVAL_MS` | `604800000` | How often to run VACUUM (7d) |
| `PREFETCH_ENABLED` | `true` | Enable server-side CORS bypass proxy |
| `PREFETCH_MAX_BYTES` | `150000000` | Max bytes per prefetch response (150 MB) |
| `LOGO_CACHE_ENABLED` | `true` | Cache-Control headers on logo proxy responses |
| `IP_RATE_LIMIT_ENABLED` | `true` | Global IP-based rate limiting |
| `IP_RATE_LIMIT_WINDOW_MS` | `300000` | IP rate limit window in ms (5m) |
| `IP_RATE_LIMIT_MAX` | `300` | Max requests per window per IP |
| `TOKEN_RATE_LIMIT_ENABLED` | `true` | Per-token rate limiting on addon routes |
| `TOKEN_RATE_LIMIT_WINDOW_MS` | `60000` | Token rate limit window in ms (1m) |
| `TOKEN_RATE_LIMIT_MAX` | `60` | Max requests per window per token |
| `DEBUG_MODE` | `false` | Verbose debug logging |
| `ALLOW_LOCAL_URLS` | `false` | Allow localhost/private IPs (for local testing) |

> Set `CONFIG_SECRET` whenever the instance is publicly accessible.

---

## API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/configure` | Configuration UI |
| GET | `/health` | Health check |
| GET | `/api/addon-info` | Addon name / description / logo |
| GET | `/api/capabilities` | `{ encryptionEnabled: bool }` |
| POST | `/encrypt` | Returns encrypted token |
| POST | `/api/prefetch` | Server-side CORS bypass fetch |
| GET | `/:token/manifest.json` | Stremio manifest |
| GET | `/:token/catalog/tv/iptv_channels.json` | Channel catalog |
| GET | `/:token/stream/tv/:id.json` | Stream URL |
| GET | `/:token/meta/tv/:id.json` | Channel metadata + EPG |
| GET | `/:token/logo/:tvgId.png` | Logo proxy |
| GET | `/:token/configure` | Reconfigure (pre-filled from token) |

---

## Token Format

| Type | Format | When |
|------|--------|------|
| Plain | Base64URL-encoded JSON | No `CONFIG_SECRET` set |
| Encrypted | `enc:<ciphertext>` | `CONFIG_SECRET` is set |

---

## Architecture

```
Browser (Config UI)
    │ preflight: validate URL / credentials
    ▼
POST /api/prefetch  ← SSRF-guarded (hostname + DNS check)
    │ config JSON → token (base64url or enc:)
    ▼
server.js  → decrypt token → createAddon(config) → SQLite cache
    │
    ▼
src/addon/builder.js  (M3UEPGAddon)
    ├── xtreamProvider   → Xtream Codes API
    ├── iptvOrgProvider  → iptv-org JSON API
    └── m3uProvider      → M3U/M3U+ playlist + EPG
    │
    ▼
Stremio Client  (catalog / stream / meta)
```

### Caching (3 layers)

| Layer | Contents |
|-------|----------|
| SQLite (persistent) | Two entries per config: `addon:channels:{key}` (raw JSON) and `addon:epg:{key}` (gzip); TTL-based expiry |
| Build promise cache (LRU) | Deduplicates concurrent `createAddon()` calls; instances are lightweight (no channel data in RAM) |
| Data memory TTL | Channel/EPG loaded on demand, evicted from RAM after `DATA_MEMORY_TTL_MS` idle (default 5 min) |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Buttons never enable | Manifest build failed | Check server logs; verify provider is reachable |
| WARNING in install log | `CONFIG_SECRET` not set | Set it in `.env` if sharing publicly |
| EPG shows nothing | EPG fetch failed | Check EPG URL; try a custom XMLTV source |
| Logo missing | No matching logo source | Expected — placeholder is shown |

---

## Legal Notice

NexoTV does not provide any IPTV content.
You are solely responsible for ensuring the streams you use are legal in your jurisdiction.

---

## Credits

Developed by [joaosavi](https://github.com/joaosavi).
Based on original work by [Inside4ndroid](https://github.com/Inside4ndroid).

---

## License

MIT — see `LICENSE`.
