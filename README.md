# IPTV Stremio Addon

> A self-hostable, token-based, privacy-friendly IPTV addon for **Stremio**.  
> Connect your IPTV service using Xtream Codes credentials.

---

## ✨ Features

- 📺 Live TV channels via **Xtream Codes JSON API**
- 📡 EPG support: panel XMLTV or custom XMLTV URL, with timezone offset support
- 🔍 Category-based browsing + channel search
- 🔐 Config tokens: base64-encoded (plain) or AES-256-GCM encrypted (with `CONFIG_SECRET`)
- ⚡ In-memory LRU cache with configurable TTL and entry cap
- 🖼️ Channel logo proxy with multi-source fallback
- 🛡️ SSRF-protected server-side CORS bypass proxy for pre-flight validation

---

## 🚀 Quick Start (Local / Node.js)

```bash
git clone https://github.com/joaosavi/iptv-stremio-addon.git
cd iptv-stremio-addon
cp .env.example .env
npm install
npm start
# Server runs on PORT (default 7000)
open http://localhost:7000/
```

---

## 🐳 Docker

```bash
docker build -t iptv-stremio-addon .
docker run -d \
  -e PORT=7000 \
  -e DEBUG_MODE=false \
  -e CACHE_ENABLED=true \
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
    environment:
      PORT: 7000
      CACHE_ENABLED: "true"
      CACHE_TTL_MS: 21600000
      MAX_CACHE_ENTRIES: 300
      PREFETCH_ENABLED: "true"
      PREFETCH_MAX_BYTES: 150000000
      CONFIG_SECRET: "generate_a_long_random_string_here"
      DEBUG_MODE: "false"
      ADDON_NAME: "My IPTV Addon"
      ADDON_DESCRIPTION: "My personal IPTV channels"
    ports:
      - "7000:7000"
```

---

## 🎬 How to Install in Stremio

1. Open `http://your-host/configure`
2. Enter your Xtream panel URL, username, and password
3. Configure EPG options (optional)
4. Click **Install / Update (Xtream)**
5. A manifest URL is generated — click **Open in Stremio** or copy the URL

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `7000` | HTTP server port |
| `CACHE_ENABLED` | `true` | Enable/disable LRU caching |
| `CACHE_TTL_MS` | `21600000` (6h) | Cache TTL in milliseconds |
| `MAX_CACHE_ENTRIES` | `300` | LRU max entries |
| `CONFIG_SECRET` | *(unset)* | Enables AES-256-GCM encryption for tokens (must be ≥16 chars). Without this, tokens are plain base64. |
| `DEBUG_MODE` | `false` | Enable verbose debug logging |
| `PREFETCH_ENABLED` | `true` | Enable server-side CORS bypass for pre-flight |
| `PREFETCH_MAX_BYTES` | `150000000` | Max bytes for prefetch response (150 MB) |
| `ADDON_NAME` | `IPTV Stremio Addon` | Addon name shown in Stremio |
| `ADDON_DESCRIPTION` | `Stream your IPTV channels in Stremio` | Addon description shown in Stremio |
| `ADDON_LOGO_URL` | *(unset)* | URL for the addon logo in Stremio |
| `LOGO_RESIZE_ENABLED` | `true` | Wrap logos in wsrv.nl proxy to enforce 2:3 aspect ratio |
| `LOGO_CACHE_ENABLED` | `true` | Apply Cache-Control headers to logo proxy responses |

---

## 📡 HTTP Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Redirect to Xtream config page |
| GET | `/configure-xtream` | Xtream configuration form |
| GET | `/health` | Health check (`{ status: 'OK' }`) |
| POST | `/encrypt` | Returns encrypted token (requires `CONFIG_SECRET`) |
| POST | `/api/prefetch` | Server-side CORS bypass fetch |
| GET | `/api/capabilities` | Returns `{ encryptionEnabled: bool }` |
| GET | `/api/addon-info` | Returns addon name/description/logo |
| GET | `/:token/configure-xtream` | Reconfigure (pre-fills from token) |
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
server.js  ← decrypt token → createAddon(config) → LRU cache
        │
        ▼
src/addon/builder.js  ← M3UEPGAddon class → xtreamProvider → fetch channels + EPG
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

---

## 🗄️ Caching

| Layer | Contents |
|-------|----------|
| LRU (in-memory) | Channels + EPG data per config (TTL + max-size eviction) |
| Build promise cache | De-duplicates concurrent addon builds for same config |

Cache key = MD5 of normalized config (URL, username, EPG options).

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
