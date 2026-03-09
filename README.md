# IPTV Stremio Addon

> A self-hostable, token-based, privacy-friendly IPTV addon for **Stremio**.  
> Connect your IPTV service using Xtream Codes credentials, or use the free **IPTV-org public channel list**.

---

## ✨ Features

- 📺 **Dynamic Providers:** Live TV channels via **Xtream Codes JSON API** or the **IPTV-org Public Repository**
- ⚙️ **Unified Configuration:** Responsive, tabbed setup interface for both providers
- 📡 **EPG Support (Xtream):** panel XMLTV or custom XMLTV URL, pruned and optimized for low memory and CPU footprint
- 🔍 **Filtering & Search:** Category-based browsing and search, plus multi-select Country and Category filtering for IPTV-org (with intra-category OR, inter-category AND logic)
- 🔐 Config tokens: base64-encoded (plain) or AES-256-GCM encrypted (with `CONFIG_SECRET`)
- ⚡ Persistent SQLite cache with gzip compression, configurable TTL, and automatic garbage collection
- 🖼️ Configurable Channel logo proxy with multi-source fallback, per-user resize opt-in, and optional caching
- 🛡️ SSRF-protected server-side CORS bypass proxy for pre-flight validation
- 🛑 Hybrid Rate Limiting to prevent API abuse (Global IP & Token-based)

---

## 🚀 Quick Start (Local / Node.js)

```bash
git clone https://github.com/joaosavi/iptv-stremio-addon.git
cd iptv-stremio-addon
cp .env.example .env
npm install
npm start
# Server runs on PORT (default 7000)
open http://localhost:7000/configure
```

---

## 🐳 Docker

```bash
docker build -t iptv-stremio-addon .
docker run -d \
  -e PORT=7000 \
  -e DEBUG_MODE=false \
  -e CACHE_ENABLED=true \
  -v ./iptv_data:/app/data \
  -p 7000:7000 \
  --name iptv-addon \
  iptv-stremio-addon
```

### Docker Compose

```yaml
services:
  addon:
    build: .
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      - ./iptv_data:/app/data
    ports:
      - "7000:7000"
```

---

## 🎬 How to Install in Stremio

1. Open `http://your-host/configure`
2. Choose your preferred tab:
   - **IPTV-org (Free):** Select Country and Category from the searchable dropdowns.
   - **Xtream API:** Enter your panel URL, username, password, and EPG options.
3. Click **Install / Update Addon**
4. A manifest URL is generated — click **Open in Stremio** or copy the URL

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `7000` | HTTP server port |
| `CACHE_ENABLED` | `true` | Enable/disable persistent SQLite caching |
| `CACHE_TTL_MS` | `21600000` (6h) | Cache TTL in milliseconds for Xtream data |
| `IPTV_ORG_CACHE_TTL_MS` | `21600000` (6h) | Cache TTL in milliseconds for IPTV-org data |
| `MAX_CACHE_ENTRIES` | `300` | Max in-memory entries (build/interface caches) |
| `SQLITE_PATH` | `./data/cache.sqlite` | Path to the SQLite cache database file |
| `CONFIG_SECRET` | *(unset)* | Enables AES-256-GCM encryption for tokens (must be ≥16 chars). Without this, tokens are plain base64. |
| `DEBUG_MODE` | `false` | Enable verbose debug logging |
| `PREFETCH_ENABLED` | `true` | Enable server-side CORS bypass for pre-flight |
| `PREFETCH_MAX_BYTES` | `150000000` | Max bytes for prefetch response (150 MB) |
| `ADDON_NAME` | `IPTV Stremio Addon` | Addon name shown in Stremio |
| `ADDON_DESCRIPTION` | `Stream your IPTV channels in Stremio` | Addon description shown in Stremio |
| `ADDON_LOGO_URL` | *(unset)* | URL for the addon logo in Stremio |
| `LOGO_CACHE_ENABLED` | `true` | Apply Cache-Control headers to logo proxy responses |
| `IP_RATE_LIMIT_ENABLED` | `true` | Enable global IP-based rate limiting |
| `IP_RATE_LIMIT_WINDOW_MS` | `300000` (5m) | Window in ms for IP rate limit |
| `IP_RATE_LIMIT_MAX` | `300` | Max requests per window for IP rate limit |
| `TOKEN_RATE_LIMIT_ENABLED` | `true` | Enable token-based rate limiting for addon routes |
| `TOKEN_RATE_LIMIT_WINDOW_MS` | `60000` (1m) | Window in ms for token rate limit |
| `TOKEN_RATE_LIMIT_MAX` | `60` | Max requests per window for token rate limit |
| `SQLITE_GC_INTERVAL_MS` | `21600000` (6h) | How often to delete expired cache entries from SQLite |
| `SQLITE_VACUUM_INTERVAL_MS` | `604800000` (7d) | How often to run VACUUM to reclaim free disk space |
| `ALLOW_LOCAL_URLS` | `false` | Allow localhost/private IPs for testing endpoints |

---

## 📡 HTTP Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Redirect to `/configure` |
| GET | `/configure` | Unified configuration form |
| GET | `/configure-xtream` | Redirects to `/configure` (Backwards compat) |
| GET | `/configure-iptv-org` | Alias for unified configuration form |
| GET | `/health` | Health check (`{ status: 'OK' }`) |
| POST | `/encrypt` | Returns encrypted token (requires `CONFIG_SECRET`) |
| POST | `/api/prefetch` | Server-side CORS bypass fetch |
| GET | `/api/capabilities` | Returns `{ encryptionEnabled: bool }` |
| GET | `/api/addon-info` | Returns addon name/description/logo |
| GET | `/:token/configure` | Reconfigure (pre-fills from token) |
| GET | `/:token/configure-xtream` | Redirects to `/:token/configure` |
| GET | `/:token/configure-iptv-org` | Alias for unified reconfigure |
| GET | `/:token/manifest.json` | Stremio manifest |
| GET | `/:token/catalog/tv/iptv_channels.json` | Channel catalog |
| GET | `/:token/stream/tv/:id.json` | Stream URL |
| GET | `/:token/meta/tv/:id.json` | Channel meta + EPG info |
| GET | `/:token/logo/:tvgId.png` | Channel logo proxy |

---

## 🔐 Configuration Tokens

| Type | Format | Notes |
|------|--------|-------|
| Plain | Base64URL JSON (no prefix) | Anyone with the URL can decode it |
| Encrypted | `enc:<ciphertext>` | Requires `CONFIG_SECRET` on server |

> ⚠️ Always set `CONFIG_SECRET` if you're sharing your hosted instance publicly.

---

## 🧱 Architecture

```
Browser Client (Config UI)
        │ Pre-flight: validate Xtream credentials + EPG
        ▼
/api/prefetch  ← CORS bypass, SSRF-guarded (hostname + DNS check)
        │ Config JSON → base64url or enc: token
        ▼
server.js  ← decrypt token → createAddon(config) → SQLite cache
        │
        ▼
src/addon/builder.js  ← M3UEPGAddon class (Dynamic Provider) 
        ├─▶ xtreamProvider   → fetch Xtream channels + EPG
        └─▶ iptvOrgProvider  → fetch IPTV-org channels
        │ 
        │ Stremio SDK routes
        ▼
Stremio Client  (Catalog / Meta / Stream)
```

---

## 🛡️ Security

| Area | Defense |
|------|---------|
| SSRF (prefetch) | Blocks RFC1918 + loopback by hostname string AND by DNS resolution |
| Token leakage | base64 (plain) or AES-256-GCM (with `CONFIG_SECRET`) |
| Credential exposure | Warn shown in UI when `CONFIG_SECRET` is not configured |
| EPG size | `PREFETCH_MAX_BYTES` limits response size |
| API Abuse | Global IP and Token-based Rate Limiting to prevent scraping or DoS |

---

## 🗄️ Caching

| Layer | Contents |
|-------|----------|
| SQLite (persistent) | Channels + EPG data per config (gzip-compressed BLOBs with TTL) |
| Build promise cache (in-memory) | De-duplicates concurrent addon builds for same config |
| Interface cache (in-memory) | Caches built Stremio SDK interfaces per token |

Cache key = MD5 of normalized config (URL, username, EPG options).  
SQLite uses WAL mode for concurrency, with automatic garbage collection (2h) and daily VACUUM.

---

## 🐞 Troubleshooting

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| Buttons never enable | Manifest build error | Check server logs; ensure Xtream panel is reachable |
| ⚠ WARNING in config log | No `CONFIG_SECRET` | Set it in `.env` if sharing publicly |
| EPG shows nothing | EPG fetch failed | Check EPG URL; try custom XMLTV source |
| Logo missing | No matching logo source | Expected; placeholder is shown |

---

## ⚖️ Legal Notice

This project **does not provide** IPTV content.  
You are solely responsible for ensuring that the streams you use are legal in your jurisdiction.

---

## 🙏 Credits

Improved by [joaosavi](https://github.com/joaosavi).  
Based on the original work by [Inside4ndroid](https://github.com/Inside4ndroid).

---

## 📄 License

MIT License. See `LICENSE` file.
