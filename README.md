<p align="center">
  <img alt="NexoTV Logo" src="https://raw.githubusercontent.com/joaosavi/nexotv/refs/heads/main/packages/frontend/public/assets/logo.svg" width="160" height="160">
</p>

<h1 align="center">NexoTV</h1>

<p align="center">
  <strong>Your IPTV. Your Stremio. Zero friction.</strong>
  <br />
  A self-hostable Stremio addon that turns any IPTV source into a fully integrated streaming experience.
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

## ✨ What is NexoTV?

NexoTV connects your IPTV service to Stremio in minutes. Enter your credentials on the setup page, get a personal manifest URL, and install it into Stremio — that's it. Your channels, EPG, and logos show up natively inside Stremio just like any other addon.

Every user gets their own encrypted token in the URL, so a single NexoTV instance can serve an entire household — or a whole community — without exposing anyone's credentials.

---

## 🚀 Getting Started

### 1. Deploy NexoTV

**Docker (recommended)**

```bash
docker run -d \
  -e CONFIG_SECRET=your-secret-min-16-chars \
  -v ./data:/app/data \
  -p 7000:7000 \
  --name nexotv \
  savibrabo/nexotv:latest
```

**Docker Compose**

```bash
cp .env.example .env   # set CONFIG_SECRET at minimum
docker compose up -d
```

**From Source**

```bash
git clone https://github.com/joaosavi/nexotv.git
cd nexotv
cp .env.example .env
pnpm install && pnpm build
node packages/backend/dist/server.js
```

### 2. Configure Your Addon

1. Open `http://your-host:7000/configure`
2. Pick a provider tab and fill in your credentials
3. Optionally set a custom catalog name

### 3. Install in Stremio

Click **Install Addon** → **Open in Stremio**.

> The manifest URL contains your personal encrypted token. Credentials never appear in logs or shared URLs.

---

## 🎯 Features

### Three IPTV Providers

| Provider         | Description                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| **Xtream Codes** | Connect with your panel URL, username, and password. Categories and streams fetched from the Xtream API. |
| **M3U / M3U+**   | Paste any playlist URL. EPG is auto-detected from the playlist header or set manually.                   |
| **IPTV-org**     | 8,000+ free public channels. Filter by country and category with multi-select dropdowns.                 |

### EPG & Metadata

- XMLTV from Xtream panel, embedded playlist header, or a custom URL
- Current programme and upcoming schedule shown in Stremio's meta panel

### Custom Catalog Name

Each user can set their own catalog name (e.g. "My IPTV" or "Casa") shown in Stremio's channel list — independent of the server's addon name.

### Global User-Agent (M3U)

Set a fallback User-Agent for all stream requests when the playlist doesn't declare one per channel. Choose from common IPTV player presets (TiviMate, Smarters, GSE, VLC, Kodi) or enter a custom value. Per-channel user-agents always take priority.

### Performance & Caching

NexoTV uses a three-layer cache to stay fast with hundreds of concurrent users:

- **SQLite** — persistent on disk; channels + EPG per config with TTL-based expiry
- **LRU** — in-memory deduplication for concurrent requests
- **Data TTL** — channel/EPG data loaded on demand, evicted from RAM after idle

### Security

- **Encrypted tokens** — AES-256-GCM with `CONFIG_SECRET`, or Base64URL for single-user installs
- **SSRF protection** — validates hostnames and resolves DNS before any outbound fetch
- **Rate limiting** — IP-based global limit + per-token limit on addon routes

### Other

- **Logo proxy** — multi-source fallback with optional resize
- **Paginated catalog** — configurable page size, full-text search, and category filter
- **Background refresh** — channels re-fetched on a timer, independent of user traffic
- **Health endpoint** — `/health` reports uptime, cache size, and memory usage

---

## ⚙️ Environment Variables

### Core

| Variable           | Default   | Description                                                                         |
| ------------------ | --------- | ----------------------------------------------------------------------------------- |
| `PORT`             | `7000`    | HTTP server port                                                                    |
| `CONFIG_SECRET`    | _(unset)_ | Enables AES-256-GCM token encryption — set this on any public instance (≥ 16 chars) |
| `DEBUG_MODE`       | `false`   | Verbose logging                                                                     |
| `ALLOW_LOCAL_URLS` | `false`   | Allow localhost/private IPs (local testing only)                                    |

### Addon Identity

| Variable               | Default                                | Description                  |
| ---------------------- | -------------------------------------- | ---------------------------- |
| `ADDON_NAME`           | `NexoTV`                               | Name shown in Stremio        |
| `ADDON_DESCRIPTION`    | `Stream your IPTV channels in Stremio` | Description shown in Stremio |
| `ADDON_LOGO_URL`       | _(unset)_                              | URL for the addon logo       |
| `ADDON_BACKGROUND_URL` | _(unset)_                              | URL for the addon background |

### Cache & Refresh

| Variable                 | Default    | Description                                                |
| ------------------------ | ---------- | ---------------------------------------------------------- |
| `CACHE_TTL_MS`           | `86400000` | Xtream cache TTL (24h)                                     |
| `IPTV_ORG_CACHE_TTL_MS`  | `86400000` | IPTV-org cache TTL (24h)                                   |
| `M3U_CACHE_TTL_MS`       | `86400000` | M3U/M3U+ cache TTL (24h)                                   |
| `DATA_MEMORY_TTL_MS`     | `300000`   | How long channel/EPG data stays in RAM after last use (5m) |
| `MAX_CACHE_ENTRIES`      | `300`      | Max in-memory LRU addon instances                          |
| `UPDATE_INTERVAL_MS`     | `14400000` | Background re-fetch interval (4h)                          |
| `EPG_UPDATE_INTERVAL_MS` | `28800000` | EPG re-fetch interval (8h)                                 |
| `MIN_UPDATE_INTERVAL_MS` | `1800000`  | Minimum time between re-fetches (30m)                      |

### Limits & Timeouts

| Variable               | Default     | Description                         |
| ---------------------- | ----------- | ----------------------------------- |
| `FETCH_TIMEOUT_MS`     | `30000`     | Timeout for stream/playlist fetches |
| `EPG_FETCH_TIMEOUT_MS` | `60000`     | Timeout for EPG/XMLTV fetches       |
| `LOGO_TIMEOUT_MS`      | `10000`     | Timeout for logo proxy requests     |
| `EPG_MAX_BYTES`        | `104857600` | Max EPG file size to parse (100 MB) |
| `CATALOG_PAGE_SIZE`    | `100`       | Channels per catalog page           |

### Rate Limiting

| Variable                   | Default | Description                             |
| -------------------------- | ------- | --------------------------------------- |
| `IP_RATE_LIMIT_ENABLED`    | `true`  | Global IP-based rate limiting           |
| `IP_RATE_LIMIT_MAX`        | `300`   | Max requests per IP per 5-minute window |
| `TOKEN_RATE_LIMIT_ENABLED` | `true`  | Per-token rate limiting                 |
| `TOKEN_RATE_LIMIT_MAX`     | `60`    | Max requests per token per minute       |

---

## 🔧 Troubleshooting

| Symptom                             | Likely cause                  | Fix                                                                  |
| ----------------------------------- | ----------------------------- | -------------------------------------------------------------------- |
| Buttons never enable after saving   | Manifest build failed         | Check server logs; verify the provider URL is reachable              |
| Channels load once but never update | Background timer stopped      | Restart the container                                                |
| EPG shows nothing                   | EPG fetch failed or timed out | Check the EPG URL; try a custom XMLTV source                         |
| `401` / `403` on Xtream routes      | Wrong credentials             | Re-enter credentials on `/configure`                                 |
| High memory on weak hosts           | Large M3U + EPG in RAM        | Lower `DATA_MEMORY_TTL_MS`, `EPG_MAX_BYTES`, and `MAX_CACHE_ENTRIES` |

---

## ❤️ Support the Project

NexoTV is free and open source. If you find it useful:

- ⭐ **Star this repository** on [GitHub](https://github.com/joaosavi/nexotv)
- 🐛 **Report issues** or suggest features via [GitHub Issues](https://github.com/joaosavi/nexotv/issues)
- 🤝 **Contribute** — pull requests are welcome

---

<h2 align="center">⭐ Star History</h2>

<p align="center">
  <a href="https://www.star-history.com/#joaosavi/nexotv&Date">
    <img src="https://api.star-history.com/svg?repos=joaosavi/nexotv&type=Date" alt="Star History Chart" width="600" />
  </a>
</p>

---

## ⚠️ Legal Notice

NexoTV does not provide, host, store, or distribute any IPTV content. You are solely responsible for ensuring the streams you use comply with applicable law and the terms of service of your provider.

---

## 🙏 Credits

Developed by [joaosavi](https://github.com/joaosavi). Originally inspired by [Inside4ndroid](https://github.com/Inside4ndroid).

---

## License

MIT — see [`LICENSE`](LICENSE).
