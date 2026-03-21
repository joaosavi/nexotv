<p align="center">
  <img alt="NexoTV Logo" src="https://raw.githubusercontent.com/joaosavi/nexotv/refs/heads/main/packages/frontend/public/assets/logo.svg" width="160" height="160">
</p>

<h1 align="center">NexoTV</h1>

<p align="center">
  <strong>Your IPTV. Your Stremio. Zero friction.</strong>
  <br />
  A self-hostable Stremio addon that turns any IPTV source into a fully integrated streaming experience —
  with EPG, channel search, logo proxy, and encrypted per-user tokens.
</p>

<p align="center">
  <a href="https://github.com/joaosavi/nexotv/stargazers">
    <img src="https://img.shields.io/github/stars/joaosavi/nexotv?style=for-the-badge&logo=github" alt="GitHub Stars">
  </a>
  <a href="https://github.com/joaosavi/nexotv/releases/latest">
    <img src="https://img.shields.io/github/v/release/joaosavi/nexotv?style=for-the-badge&logo=github" alt="Latest Release">
  </a>
  <a href="https://hub.docker.com/r/savibrabo/nexotv">
    <img src="https://img.shields.io/docker/pulls/savibrabo/nexotv?style=for-the-badge&logo=docker" alt="Docker Pulls">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/joaosavi/nexotv?style=for-the-badge" alt="License">
  </a>
</p>

---

## What is NexoTV?

NexoTV connects your IPTV service to Stremio in three clicks. You enter your credentials once on the setup page, get a personal manifest URL, and install it into Stremio — that's it. From that point on, your channels, EPG, and logos show up natively inside Stremio just like any other addon.

Every user gets their own encrypted token in the URL, so one NexoTV instance can serve an entire household (or a whole community) without exposing anyone else's credentials.

---

## Features

### Three IPTV Providers

| Provider | How it works |
|----------|-------------|
| **Xtream Codes** | Authenticate with your panel URL, username, and password. Categories and streams are fetched from the Xtream JSON API. |
| **M3U / M3U+** | Paste any playlist URL. EPG is auto-detected from `url-tvg` / `x-tvg-url` headers, or set manually. |
| **IPTV-org** | Browse 8 000+ free public channels. Filter by country and category with multi-select dropdowns (OR within a category, AND across categories). |

### EPG & Metadata

- XMLTV from Xtream panel, embedded playlist header, or a custom URL
- Parsed and pruned for low memory usage
- Current programme and upcoming schedule shown in Stremio meta panel

### Performance & Caching

NexoTV uses a three-layer cache so the server stays fast and lightweight even with hundreds of concurrent users:

| Layer | What it stores |
|-------|---------------|
| **SQLite** (persistent) | Channels + EPG per config; channels uncompressed, EPG gzip-compressed; TTL-based expiry |
| **LRU** (in-memory) | Deduplicates concurrent manifest builds so the same config is never fetched twice simultaneously |
| **Data TTL** | Channel and EPG data is loaded from SQLite on demand and evicted from RAM after idle timeout |

### Security

- **Encrypted tokens** — AES-256-GCM with `CONFIG_SECRET`, or Base64URL for single-user installs
- **SSRF protection** — server-side CORS proxy validates hostnames and resolves DNS before fetching
- **Rate limiting** — IP-based global limit + per-token limit on addon routes

### Additional

- **Logo proxy** — multi-source fallback, optional resize, optional cache headers
- **Paginated catalog** — configurable page size, full-text search, and category filter
- **Background refresh** — channels re-fetched on a timer independent of user traffic; no cold-start spikes
- **Health endpoint** — `/health` reports uptime, cache size, memory usage, and watchdog metrics

---

## Quick Start

```bash
git clone https://github.com/joaosavi/nexotv.git
cd nexotv
cp .env.example .env
pnpm install
pnpm dev
# Open http://localhost:7000/configure
```

### Installing in Stremio

1. Open `http://your-host/configure`
2. Pick a provider tab and fill in your credentials
3. Click **Install Addon**
4. Click **Open in Stremio** — or copy the manifest URL manually

> The manifest URL contains your personal encrypted token. Each user gets their own URL and their credentials never appear in logs.

---

## Deployment

### Docker

```bash
docker run -d \
  -e PORT=7000 \
  -e CONFIG_SECRET=your-secret-min-16-chars \
  -v ./data:/app/data \
  -p 7000:7000 \
  --name nexotv \
  savibrabo/nexotv:latest
```

### Docker Compose

```bash
cp .env.example .env   # fill in CONFIG_SECRET at minimum
docker compose up -d
```

### From Source

```bash
pnpm build
node packages/backend/dist/server.js
```

---

## Environment Variables

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `7000` | HTTP server port |
| `CONFIG_SECRET` | *(unset)* | Enables AES-256-GCM token encryption — set this on any public instance (≥ 16 chars) |
| `DEBUG_MODE` | `false` | Verbose logging |
| `ALLOW_LOCAL_URLS` | `false` | Allow localhost/private IPs (local testing only) |

### Addon Identity

| Variable | Default | Description |
|----------|---------|-------------|
| `ADDON_NAME` | `NexoTV` | Name shown in Stremio |
| `ADDON_DESCRIPTION` | `Stream your IPTV channels in Stremio` | Description shown in Stremio |
| `ADDON_LOGO_URL` | *(unset)* | URL for the addon logo |
| `ADDON_BACKGROUND_URL` | *(unset)* | URL for the addon background |

### Cache & Refresh

| Variable | Default | Description |
|----------|---------|-------------|
| `CACHE_TTL_MS` | `86400000` | Xtream cache TTL (24h) |
| `IPTV_ORG_CACHE_TTL_MS` | `86400000` | IPTV-org cache TTL (24h) |
| `M3U_CACHE_TTL_MS` | `86400000` | M3U/M3U+ cache TTL (24h) |
| `DATA_MEMORY_TTL_MS` | `300000` | How long channel/EPG data stays in RAM after last use (5m) |
| `MAX_CACHE_ENTRIES` | `300` | Max in-memory LRU addon instances |
| `UPDATE_INTERVAL_MS` | `14400000` | Background re-fetch interval (4h) |
| `EPG_UPDATE_INTERVAL_MS` | `28800000` | EPG re-fetch interval (8h) |
| `MIN_UPDATE_INTERVAL_MS` | `1800000` | Minimum time between re-fetches (30m) |
| `SQLITE_PATH` | `./data/cache.sqlite` | SQLite database path |
| `SQLITE_GC_INTERVAL_MS` | `21600000` | How often to purge expired entries (6h) |
| `SQLITE_VACUUM_INTERVAL_MS` | `604800000` | How often to VACUUM the database (7d) |

### Limits & Timeouts

| Variable | Default | Description |
|----------|---------|-------------|
| `FETCH_TIMEOUT_MS` | `30000` | Timeout for stream/playlist fetches |
| `EPG_FETCH_TIMEOUT_MS` | `60000` | Timeout for EPG/XMLTV fetches |
| `PREFETCH_TIMEOUT_MS` | `45000` | Timeout for the CORS proxy endpoint |
| `LOGO_TIMEOUT_MS` | `10000` | Timeout for logo proxy requests |
| `EPG_MAX_BYTES` | `104857600` | Max EPG file size the server will parse (100 MB) |
| `PREFETCH_MAX_BYTES` | `157286400` | Max response size from the CORS proxy (150 MB) |
| `CATALOG_PAGE_SIZE` | `100` | Channels per catalog page |

### Rate Limiting

| Variable | Default | Description |
|----------|---------|-------------|
| `IP_RATE_LIMIT_ENABLED` | `true` | Global IP-based rate limiting |
| `IP_RATE_LIMIT_WINDOW_MS` | `300000` | Window per IP (5m) |
| `IP_RATE_LIMIT_MAX` | `300` | Max requests per IP per window |
| `TOKEN_RATE_LIMIT_ENABLED` | `true` | Per-token rate limiting |
| `TOKEN_RATE_LIMIT_WINDOW_MS` | `60000` | Window per token (1m) |
| `TOKEN_RATE_LIMIT_MAX` | `60` | Max requests per token per window |

### Observability

| Variable | Default | Description |
|----------|---------|-------------|
| `METRICS_SAMPLE_INTERVAL_MS` | `30000` | How often the watchdog samples heap and CPU |
| `METRICS_WARN_HEAP_MB` | `512` | Heap size (MB) that logs a warning |
| `METRICS_CRITICAL_HEAP_MB` | `768` | Heap size (MB) that logs an error and evicts idle instances |

---

## API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/configure` | Configuration UI |
| `GET` | `/health` | Health check with metrics |
| `GET` | `/api/addon-info` | Addon name / description / logo |
| `GET` | `/api/capabilities` | `{ encryptionEnabled: bool }` |
| `POST` | `/encrypt` | Returns encrypted token |
| `POST` | `/api/prefetch` | Server-side CORS bypass fetch |
| `GET` | `/:token/manifest.json` | Stremio manifest |
| `GET` | `/:token/catalog/tv/iptv_channels.json` | Channel catalog (paginated) |
| `GET` | `/:token/stream/tv/:id.json` | Stream URL for a channel |
| `GET` | `/:token/meta/tv/:id.json` | Channel metadata + EPG |
| `GET` | `/:token/logo/:tvgId.png` | Logo proxy |
| `GET` | `/:token/configure` | Reconfigure (pre-filled from token) |

---

## Architecture

```
Browser (Config UI)
    │  validates URL / credentials via prefetch
    ▼
POST /api/prefetch  ←  SSRF guard (hostname + DNS check)
    │
    │  config JSON → token (base64url or enc:<ciphertext>)
    ▼
/:token/manifest.json  →  decrypt token  →  createAddon(config)
    │                                              │
    │                                         LRU cache
    │                                              │
    ▼                                              ▼
Stremio Client                            M3UEPGAddon instance
  catalog / stream / meta                   ├── xtreamProvider
                                            ├── iptvOrgProvider
                                            └── m3uProvider + epgParser
                                                      │
                                               SQLite cache
                                              (channels + EPG)
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Buttons never enable after saving | Manifest build failed | Check server logs; verify the provider URL is reachable |
| Channels load once but never update | Background timer stopped | Restart the container; check for crash logs |
| EPG shows nothing | EPG fetch failed or timed out | Check the EPG URL; try a custom XMLTV source |
| Logo missing | No matching logo source | Expected — a placeholder is shown |
| `401` / `403` on Xtream routes | Wrong credentials | Re-enter credentials on `/configure` |
| High memory on weak hosts | Large M3U + EPG in RAM | Lower `DATA_MEMORY_TTL_MS`, `EPG_MAX_BYTES`, and `MAX_CACHE_ENTRIES` |

---

## Legal Notice

NexoTV does not provide, host, store, or distribute any IPTV content.
You are solely responsible for ensuring the streams you use comply with applicable law and the terms of service of your provider.

---

## Credits

Developed by [joaosavi](https://github.com/joaosavi).
Based on original work by [Inside4ndroid](https://github.com/Inside4ndroid).

---

## License

MIT — see [`LICENSE`](LICENSE).
