# Monorepo + TypeScript + Vue 3 Refactor — Implementation Plan

## Overview

Refactor the NexoTV codebase from a flat single-package JavaScript project into a pnpm monorepo with two packages: a TypeScript Express backend and a TypeScript Vue 3 + Vite frontend. The public-facing behavior stays identical — users still visit `/configure`, configure their provider, and install a Stremio manifest URL. Only the internal structure and tooling change.

## Motivation & Context

The current codebase is entirely JavaScript with no build step, no type safety, and no component model. The frontend is a 390-line vanilla HTML file and 4 plain JS files sharing state through `window.ConfigureCommon`. As the project grows, this is increasingly painful to maintain — there's no autocomplete on internal APIs, no compile-time checks, and adding any new frontend feature means more global-state spaghetti.

The goals:
- **TypeScript**: catch bugs at write-time; better IDE DX for future work
- **Monorepo (pnpm workspaces)**: clean, explicit boundary between backend and frontend — each package owns its deps and build step
- **Vue 3 + Vite**: replace the growing vanilla JS with component-based architecture; aligns with the broader Stremio addon ecosystem; Vite gives an instant dev server and fast builds

## Current State Analysis

- `server.js` — Express entry at repo root; serves `./public` as static files (`server.js:9`)
- `src/` at repo root — all backend logic (15 files)
- `public/` at repo root — vanilla HTML/CSS/JS frontend (1 HTML page, 4 JS files, 1 CSS file)
- Single `package.json` at root with all deps — no workspace concept (`package.json:1`)
- `Dockerfile` does `COPY server.js`, `COPY src/`, `COPY public/` — flat structure assumed (`Dockerfile:12-14`)
- `better-sqlite3` is a native module — needs `python3 build-base` at compile time (`Dockerfile:5`)
- `stremio-addon-sdk` has no TypeScript types — needs a local `.d.ts` declaration
- Dynamic provider require in `M3UEPGAddon.js:181`: `require('../providers/${providerFile}.js')` — must be converted to a typed import map
- Frontend calls these backend endpoints: `GET /api/addon-info`, `GET /api/capabilities`, `GET /api/public-playlists`, `POST /encrypt`, `POST /api/prefetch`, `GET /{token}/manifest.json`
- Config page is served from `pages.js` at routes `/`, `/configure`, `/:token/configure` etc — all send the same HTML file

## Desired End State

```
iptv-stremio-addon/
├── packages/
│   ├── backend/                 ← TypeScript Express app
│   │   ├── src/                 ← all current src/ contents, renamed to .ts
│   │   ├── server.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── frontend/                ← Vue 3 + Vite + TypeScript
│       ├── src/
│       │   ├── App.vue
│       │   ├── main.ts
│       │   ├── components/      ← XtreamConfig, IptvOrgConfig, M3uConfig, TheHeader, TheOverlay
│       │   ├── composables/     ← useAddonInfo, useConfigToken, useManifestPoll, usePrefetch, useDecodedToken, usePublicPlaylists
│       │   └── types/
│       ├── public/logo/         ← addon-logo.png, favicon.svg
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
├── pnpm-workspace.yaml
├── package.json                 ← workspace root (no code, dev scripts only)
├── .env / .env.example
├── Dockerfile
├── docker-compose.yml
└── config/
```

**Dev workflow:**
- `pnpm --filter backend dev` → backend on port 7000 (tsx watch)
- `pnpm --filter frontend dev` → Vite dev server on port 5173, proxies `/api`, `/encrypt` to port 7000
- `pnpm dev` → both concurrently

**Production/Docker:**
- Frontend builds to `packages/frontend/dist/`
- Backend compiles TypeScript to `packages/backend/dist/`
- Single Docker image: install deps → build frontend → build backend → run backend
- Backend auto-detects `packages/frontend/dist/` at startup and serves it as static files

### Key Discoveries

- `stremio-addon-sdk` exports `addonBuilder` class and `getRouter` function — no types; needs `declare module` (`src/addon/builder.js:2`)
- `M3UEPGAddon.js:181` uses `require(\`../providers/${providerFile}\`)` — must convert to explicit typed import map to preserve type safety
- `server.js:6` uses `path.join(__dirname, 'public')` for static serving — in compiled TS, `__dirname` points to `dist/`; path to `packages/frontend/dist/` must account for the extra `dist/` level: `path.join(__dirname, '..', '..', 'frontend', 'dist')`
- `pages.js` sends the HTML file directly — in Vue version, it sends `packages/frontend/dist/index.html` instead
- `configure-common.js` exposes `window.ConfigureCommon` (overlay, polling, token encoding) — becomes composables in Vue
- All 4 frontend JS files share state via `window.ConfigureCommon` — Vue refactor replaces this with Composition API + composables
- The frontend's logo assets (`public/logo/`) move to `packages/frontend/public/logo/` — Vite copies them to `dist/` automatically
- `better-sqlite3` native module requires Python + build-base during `npm install` — this must happen BEFORE build tools are removed in Docker

## What We're NOT Doing

- No new features, no new API endpoints, no UI redesign
- No ESM migration — backend stays CommonJS output (`"module": "CommonJS"` in tsconfig) to avoid native module compatibility issues
- No Vue Router — it's a single-page app, no client-side routing needed
- No state management library (Pinia/Vuex) — composables are sufficient for this scope
- No test setup — out of scope for this refactor
- No strict TypeScript mode — `strict: false`, `noImplicitAny: false` to keep the migration pragmatic
- No separate frontend deployment / CDN — backend serves the Vite dist in production

## Documentation Impact

| File | What changes |
|------|-------------|
| `CLAUDE.md` | Update key source files table, commands section, architecture diagram, caching section |
| `README.md` | Update installation commands, dev workflow, Docker instructions |
| `.env.example` | No changes to env vars; add comment about frontend dev server port |
| `Dockerfile` | Full rewrite for pnpm monorepo + frontend build step |
| `docker-compose.yml` | No structural changes; volume mounts remain `./data:/app/data` and `./config:/app/config` |
| `.gitignore` | Add `packages/*/dist`, `packages/*/node_modules` |
| `.dockerignore` | Add `packages/*/dist`, `packages/frontend/node_modules` |
| `.npmrc` | Create with `shamefully-hoist=true` if pnpm strict hoisting causes issues with `stremio-addon-sdk` or `better-sqlite3` |

---

## Phase 1: Monorepo Scaffold (JavaScript — no TypeScript yet)

### Overview

Restructure the repo into a pnpm monorepo without changing any code logic. Backend moves to `packages/backend/`, frontend assets move to `packages/backend/public/` temporarily. After this phase the server runs identically to today, just from a new location.

### Motivation for this phase

Doing the restructure and the TypeScript migration in the same commit would make the diff unreadable and much harder to roll back. Phase 1 is pure file movement with no logic changes, making it easy to verify nothing broke.

### Changes Required

#### 1. Root workspace config

**File**: `pnpm-workspace.yaml` _(new)_

```yaml
packages:
  - 'packages/*'
```

**File**: `package.json` _(replace contents)_

```json
{
  "name": "nexotv-monorepo",
  "private": true,
  "scripts": {
    "dev": "concurrently \"pnpm --filter backend dev\" \"pnpm --filter frontend dev\"",
    "build": "pnpm --filter frontend build && pnpm --filter backend build",
    "start": "pnpm --filter backend start"
  },
  "devDependencies": {
    "concurrently": "^8.0.0"
  }
}
```

#### 2. Backend package

**Directory**: `packages/backend/` _(create)_

Move all current backend files into `packages/backend/`:
- `server.js` → `packages/backend/server.js`
- `src/` → `packages/backend/src/`
- `public/` → `packages/backend/public/` _(temporary — moves to frontend package in Phase 3)_

**File**: `packages/backend/package.json` _(new — copy from root package.json, adjust name)_

```json
{
  "name": "@nexotv/backend",
  "version": "2.0.0",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "better-sqlite3": "^12.6.2",
    "compression": "^1.8.1",
    "dotenv": "^17.2.1",
    "express": "^4.18.2",
    "express-rate-limit": "^8.2.1",
    "stremio-addon-sdk": "^1.6.10",
    "xml2js": "^0.4.23"
  },
  "devDependencies": {
    "nodemon": "^2.0.22"
  }
}
```

No code changes — all `require()` paths remain the same since `__dirname` is now `packages/backend/`.

#### 3. Update Dockerfile

**File**: `Dockerfile` _(update)_

```dockerfile
FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache python3 build-base
RUN npm install -g pnpm@latest

# Install backend dependencies (needs build-base for better-sqlite3)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/
RUN pnpm install --filter @nexotv/backend --prod

RUN apk del python3 build-base

COPY packages/backend/server.js ./packages/backend/
COPY packages/backend/src/ ./packages/backend/src/
COPY packages/backend/public/ ./packages/backend/public/
COPY config/ ./config/

RUN mkdir -p /app/data

EXPOSE 7000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:7000/health || exit 1

CMD ["node", "packages/backend/server.js"]
```

#### 4. Update .gitignore and .dockerignore

Add:
```
packages/*/node_modules
packages/*/dist
```

#### 5. Verify pnpm hoisting (.npmrc)

After running `pnpm install` in `packages/backend/`, verify that `stremio-addon-sdk` and `better-sqlite3` resolve correctly. If pnpm strict hoisting causes "Cannot find module" errors, create `.npmrc` at the repo root:

```
shamefully-hoist=true
```

This is a common friction point with pnpm and legacy packages that assume flat `node_modules`. Check this early in Phase 1 before proceeding.

### Documentation Updates for This Phase

- [ ] `.gitignore` — add `packages/*/node_modules`, `packages/*/dist`
- [ ] `.dockerignore` — add `packages/*/dist`, `packages/frontend/node_modules`

### Commit for This Phase

**Message**: `refactor: restructure into pnpm monorepo (packages/backend, JS unchanged)`
**Why commit here**: Server behavior is identical to before — just file locations changed. Safe rollback point before TypeScript migration begins.

### Success Criteria

#### Automated Verification

- [ ] `cd packages/backend && node server.js` starts without error
- [ ] `curl http://localhost:7000/health` returns `{"status":"OK",...}`
- [ ] `curl http://localhost:7000/configure` returns HTML

#### Manual Verification

- [ ] Navigate to `http://localhost:7000/configure` — config page loads
- [ ] All three provider tabs functional
- [ ] No regressions from moving files

---

## Phase 2: TypeScript — Backend Migration

### Overview

Convert all `packages/backend/` JavaScript files to TypeScript. The runtime behavior doesn't change — TypeScript compiles to CommonJS identical to the original JS. Dev uses `tsx` (no separate compile step); production uses `tsc`.

### Motivation for this phase

TypeScript migration before Vue frontend means we get typed backend APIs that the frontend composables can reference. Also, a clean TS backend is a prerequisite for writing the shared config types that both packages will use.

### Changes Required

#### 1. Install TypeScript toolchain

**File**: `packages/backend/package.json` _(update scripts and devDeps)_

```json
{
  "scripts": {
    "start": "node dist/server.js",
    "dev": "tsx watch server.ts",
    "build": "tsc",
    "build:check": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/compression": "^1.7.5",
    "@types/express": "^4.17.21",
    "@types/node": "^20.0.0",
    "@types/xml2js": "^0.4.14",
    "tsx": "^4.19.0",
    "typescript": "^5.4.0"
  }
}
```

Remove `"nodemon"` from devDependencies — `tsx watch` replaces it entirely.
```

#### 2. Create tsconfig.json

**File**: `packages/backend/tsconfig.json` _(new)_

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "outDir": "./dist",
    "rootDir": ".",
    "strict": false,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noImplicitAny": false
  },
  "include": ["./**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

#### 3. Create stremio-addon-sdk type declarations

**File**: `packages/backend/src/types/stremio-addon-sdk.d.ts` _(new)_

```typescript
declare module 'stremio-addon-sdk' {
  export class addonBuilder {
    manifest: Record<string, any>;
    constructor(manifest: Record<string, any>);
    defineCatalogHandler(handler: (args: any) => Promise<{ metas: any[] }>): void;
    defineStreamHandler(handler: (args: any) => Promise<{ streams: any[] }>): void;
    defineMetaHandler(handler: (args: any) => Promise<{ meta: any }>): void;
    getInterface(): AddonInterface;
  }
  export interface AddonInterface {
    manifest: Record<string, any>;
    _cleanManifest?: Record<string, any> | null;
    addonInstance?: any;
    [key: string]: any;
  }
  export function getRouter(iface: AddonInterface): any;
}
```

#### 4. Rename all .js files to .ts

Rename every file in `packages/backend/`:
- `server.js` → `server.ts`
- `src/addon/M3UEPGAddon.js` → `src/addon/M3UEPGAddon.ts`
- `src/addon/builder.js` → `src/addon/builder.ts`
- `src/addon/manifest.js` → `src/addon/manifest.ts`
- `src/config/env.js` → `src/config/env.ts`
- `src/config/constants.js` → `src/config/constants.ts`
- `src/middleware/rateLimiter.js` → `src/middleware/rateLimiter.ts`
- `src/middleware/ssrf.js` → `src/middleware/ssrf.ts`
- `src/parsers/epgParser.js` → `src/parsers/epgParser.ts`
- `src/parsers/m3uParser.js` → `src/parsers/m3uParser.ts`
- `src/providers/xtreamProvider.js` → `src/providers/xtreamProvider.ts`
- `src/providers/iptvOrgProvider.js` → `src/providers/iptvOrgProvider.ts`
- `src/providers/m3uProvider.js` → `src/providers/m3uProvider.ts`
- `src/routes/api.js` → `src/routes/api.ts`
- `src/routes/logo.js` → `src/routes/logo.ts`
- `src/routes/pages.js` → `src/routes/pages.ts`
- `src/routes/prefetch.js` → `src/routes/prefetch.ts`
- `src/routes/stremio.js` → `src/routes/stremio.ts`
- `src/utils/cryptoConfig.js` → `src/utils/cryptoConfig.ts`
- `src/utils/logger.js` → `src/utils/logger.ts`
- `src/utils/lruCache.js` → `src/utils/lruCache.ts`
- `src/utils/sqliteCache.js` → `src/utils/sqliteCache.ts`

#### 5. Key TypeScript fixes during rename

**`src/addon/M3UEPGAddon.ts`** — Convert dynamic require to typed import map:

```typescript
// Replace the dynamic require pattern (line ~181):
// const providerModule = require(`../providers/${providerFile}.js`);

// With a typed import map:
import * as xtreamProvider from '../providers/xtreamProvider';
import * as iptvOrgProvider from '../providers/iptvOrgProvider';
import * as m3uProvider from '../providers/m3uProvider';

const PROVIDER_MAP: Record<string, { fetchData: (addon: M3UEPGAddon) => Promise<void> }> = {
  'xtream': xtreamProvider,
  'iptv-org': iptvOrgProvider,
  'm3u': m3uProvider,
};

// In updateData():
const providerModule = PROVIDER_MAP[this.providerName];
if (!providerModule) throw new Error(`Unknown provider: ${this.providerName}`);
await providerModule.fetchData(this);
```

Also add the `Config` interface and type the class properties:

```typescript
interface AddonConfig {
  provider?: string;
  xtreamUrl?: string;
  xtreamUsername?: string;
  xtreamPassword?: string;
  m3uUrl?: string;
  epgUrl?: string;
  enableEpg?: boolean;
  epgOffsetHours?: number | string;
  reformatLogos?: boolean;
  iptvOrgCountry?: string;
  iptvOrgCategory?: string;
  instanceId?: string;
}
```

**`src/config/env.ts`** — Use `export default` (single object) to avoid updating 15+ import sites:

```typescript
import dotenv from 'dotenv';
dotenv.config();

const env = {
  PORT: parseInt(process.env.PORT || '7000', 10),
  // ... all fields unchanged
};

export default env;
```

All other files that do `const env = require('../config/env')` become `import env from '../config/env'` — a one-line change each. Do NOT use named exports for `env.ts`; that would require destructuring at every import site.

**`src/config/constants.ts`** — After adding the typed `PROVIDER_MAP` directly in `M3UEPGAddon.ts`, the `PROVIDER_FILE_MAP` export in `constants.ts` becomes dead code. Remove it; only `UPDATE_INTERVAL_MS` remains. Also remove the `PROVIDER_FILE_MAP` import from `M3UEPGAddon.ts`.

All other files: `require()` calls become `import` statements, `module.exports` becomes `export`. TypeScript will surface any type errors — fix them with minimal annotations (parameter types on function signatures, return types on exported functions).

#### 6. Update Dockerfile for TypeScript build

**File**: `Dockerfile` _(full file — replaces Phase 1 version)_

```dockerfile
FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache python3 build-base
RUN npm install -g pnpm@latest

# Install backend deps — ALL deps (devDeps needed for tsc compilation)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/
RUN pnpm install --filter @nexotv/backend

RUN apk del python3 build-base

COPY packages/backend/ ./packages/backend/
COPY config/ ./config/

RUN pnpm --filter @nexotv/backend build

RUN mkdir -p /app/data

EXPOSE 7000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:7000/health || exit 1

CMD ["node", "packages/backend/dist/server.js"]
```

Note: `packages/backend/public/` still exists at this phase — `pages.ts` continues to serve the original vanilla HTML from `public/html/xtream-config.html`. The TypeScript rename changes nothing about this behavior. The `public/` directory and serving are only replaced in Phases 3 and 4.

### Documentation Updates for This Phase

- [ ] `CLAUDE.md` — update "Key Source Files" table to use `.ts` extensions; update `npm start` command to `node packages/backend/dist/server.js`

### Commit for This Phase

**Message**: `refactor(backend): migrate all source files from JavaScript to TypeScript`
**Why commit here**: Backend compiles and runs correctly with TypeScript. Frontend is untouched. Safe rollback point before Vue frontend work begins.

### Success Criteria

#### Automated Verification

- [ ] `cd packages/backend && pnpm build` exits 0 with no TypeScript errors
- [ ] `cd packages/backend && pnpm dev` starts server on port 7000
- [ ] `curl http://localhost:7000/health` returns OK
- [ ] `curl http://localhost:7000/api/capabilities` returns valid JSON

#### Manual Verification

- [ ] Navigate to `http://localhost:7000/configure` — config page still loads
- [ ] Submit a test Xtream or M3U config — manifest URL generates correctly
- [ ] No `[ERROR]` output in terminal from the TypeScript-compiled code

---

## Phase 3: Vue 3 + Vite Frontend

### Overview

Create `packages/frontend/` as a Vue 3 + Vite + TypeScript package. Migrate the entire vanilla JS frontend (4 JS files, 1 HTML, 1 CSS) into typed Vue components and composables. The compiled output goes to `packages/frontend/dist/` — backend will serve it in Phase 4.

### Motivation for this phase

The vanilla JS frontend has grown to the point where shared state (`window.ConfigureCommon`) makes it hard to follow the data flow. Vue's Composition API makes the relationships between overlay state, provider tabs, token generation, and manifest polling explicit and testable. Each provider form becomes an isolated component with its own state — much easier to extend in the future.

### Changes Required

#### 1. Create packages/frontend/ package structure

**File**: `packages/frontend/package.json` _(new)_

```json
{
  "name": "@nexotv/frontend",
  "version": "2.0.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "vue": "^3.4.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vue-tsc": "^2.0.0"
  }
}
```

**File**: `packages/frontend/tsconfig.json` _(new)_

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": false,
    "jsx": "preserve",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "noImplicitAny": false
  },
  "include": ["src/**/*.ts", "src/**/*.vue"],
  "exclude": ["node_modules", "dist"]
}
```

**File**: `packages/frontend/vite.config.ts` _(new)_

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:7000',
      '/encrypt': 'http://localhost:7000',
      // Vite proxy uses string prefix matching — it cannot proxy /:token/* dynamically.
      // Token-based routes (/manifest.json, /catalog, /stream) are handled via
      // the import.meta.env.DEV workaround in useManifestPoll.ts (see below).
      // The config form itself works fine — all API calls go through /api or /encrypt.
    }
  },
  build: {
    outDir: 'dist',
  }
})
```

> **Dev note — manifest polling**: During Vite dev, `useManifestPoll.ts` must use an absolute URL to reach the backend, since Vite cannot proxy dynamic `/:token/*` routes. Use `import.meta.env.DEV` to switch:

```typescript
// In useManifestPoll.ts
const pollUrl = import.meta.env.DEV
  ? `http://localhost:7000/${token}/manifest.json`
  : `/${token}/manifest.json`;
```

In production (served from the backend), `window.location.origin` is the backend itself, so the relative URL works correctly. This is the only place a dev/prod URL distinction is needed.
```

**File**: `packages/frontend/index.html` _(new — replaces public/html/xtream-config.html as entry)_

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Configure — NexoTV</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <link rel="icon" type="image/svg+xml" href="/logo/favicon.svg">
  <link rel="icon" type="image/png" href="/logo/addon-logo.png">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

#### 2. Logo assets

Copy `packages/backend/public/logo/` → `packages/frontend/public/logo/`
Vite automatically copies `public/` contents to `dist/` verbatim.

#### 3. Types

**File**: `packages/frontend/src/types/config.ts` _(new)_

```typescript
export type Provider = 'xtream' | 'iptv-org' | 'm3u';

export interface XtreamConfig {
  provider: 'xtream';
  xtreamUrl: string;
  xtreamUsername: string;
  xtreamPassword: string;
  enableEpg: boolean;
  epgUrl?: string;
  epgOffsetHours: number;
  reformatLogos: boolean;
}

export interface IptvOrgConfig {
  provider: 'iptv-org';
  iptvOrgCountry: string;
  iptvOrgCategory: string;
}

export interface M3uConfig {
  provider: 'm3u';
  m3uUrl: string;
  enableEpg: boolean;
  epgUrl?: string;
  epgOffsetHours: number;
  reformatLogos: boolean;
}

export type AddonConfig = XtreamConfig | IptvOrgConfig | M3uConfig;

export interface AddonInfo {
  name: string;
  description: string;
  logoUrl: string;
  encryptionEnabled: boolean;  // from GET /api/capabilities
}

export interface PublicPlaylist {
  label: string;   // display name shown as chip text
  note?: string;   // optional subtitle/description
  url: string;     // M3U playlist URL
}
```

#### 4. Composables

**`packages/frontend/src/composables/useAddonInfo.ts`**
Fetches `GET /api/addon-info` and `GET /api/capabilities`. Returns `{ name, description, logoUrl, encryptionEnabled }`.

**`packages/frontend/src/composables/useConfigToken.ts`**
Handles token generation: tries `POST /encrypt`, falls back to base64url encoding. Returns `buildUrls(config): Promise<{ token, manifestUrl, stremioUrl }>`. Migrated from `configure-common.js:188-220`.

**`packages/frontend/src/composables/useManifestPoll.ts`**
Handles manifest polling loop. Returns `{ progress, message, isReady, startPolling(manifestUrl), stopPolling }`. Migrated from `configure-common.js:93-151`.

**`packages/frontend/src/composables/usePrefetch.ts`**
Wraps `POST /api/prefetch`. Returns `{ prefetch(url, purpose): Promise<{ ok, content, bytes, truncated }> }`.

**`packages/frontend/src/composables/usePublicPlaylists.ts`**
Fetches `GET /api/public-playlists`. Returns `{ playlists: PublicPlaylist[] }`. Used by `M3uConfig.vue` for the playlist chip picker.

**`packages/frontend/src/composables/useDecodedToken.ts`**
Parses the current URL path to extract and decode the config token for reconfiguration. Returns `{ decodedConfig: AddonConfig | null }`. Logic migrated from `configure-common.js:223-245` (`getDecodedToken`) and `configure-common.js:247-319` (`prefillIfReconfigure`). Each config component (`XtreamConfig.vue`, `IptvOrgConfig.vue`, `M3uConfig.vue`) calls this in `onMounted` to pre-fill its form fields when reconfiguring. Handles both base64url tokens and encrypted `enc:` tokens (encrypted tokens cannot be decoded client-side — pre-fill is skipped).

#### 5. Components

**`packages/frontend/src/components/TheHeader.vue`**
Shows addon logo, name, description. Skeleton while loading. Uses `useAddonInfo`.

**`packages/frontend/src/components/TheOverlay.vue`**
Loading overlay with progress bar, status messages, copy/open buttons. Props: `visible`, `progress`, `message`, `details`, `manifestUrl`, `stremioUrl`, `isReady`. Emits: `close`. Copy and Open buttons are hidden until `isReady` is true — replaces the imperative `disableActionButtons`/`enableActionButtons` pattern from `configure-common.js`. The "Close" button on success is shown via `v-if="isReady"` — replaces the DOM-injection pattern at `configure-common.js:113-125`.

**`packages/frontend/src/components/XtreamConfig.vue`**
Form for Xtream Codes provider. Contains URL, username, password fields, EPG options (auto/custom), logo reformat toggle. Emits `submit(config: XtreamConfig)`. Has prefill-from-token logic for reconfiguration. Migrated from `xtream-config.js`.

**`packages/frontend/src/components/IptvOrgConfig.vue`**
Form for IPTV-org provider. Multi-select country and category filters. Fetches available countries and categories from the **external** iptv-org API: `https://iptv-org.github.io/api/countries.json` and `https://iptv-org.github.io/api/categories.json`. These are direct browser fetch calls — NOT proxied through the backend, NOT from `/api/public-playlists` (which is unrelated — it serves M3U playlist chips). The Vite proxy does not need to handle these URLs. Migrated from `iptv-org-config.js`.

**`packages/frontend/src/components/M3uConfig.vue`**
Form for M3U provider. URL input, public playlist chips, EPG options. Uses `usePrefetch` for URL validation. Migrated from `m3u-config.js`.

**`packages/frontend/src/App.vue`**
Root component. Owns:
- Provider tab state (`activeTab: Provider`)
- Overlay state (wired to `useManifestPoll` and `useConfigToken`)
- Handles `submit` events from each config component: calls `buildUrls`, starts polling, shows overlay
- **Reconfiguration tab-switching**: on mount, calls `useDecodedToken()` and if a decoded config is present, sets `activeTab` to `decodedConfig.provider`. This is where the tab-switch happens — not inside the individual config components. Each config component only handles its own form pre-fill via `useDecodedToken`; `App.vue` handles the tab selection. This matches `configure-common.js:252-265` where `prefillIfReconfigure` activates the correct tab panel.

#### 6. CSS

Move `packages/backend/public/css/styles.css` → `packages/frontend/src/assets/styles.css`
Import in `packages/frontend/src/main.ts`:
```typescript
import './assets/styles.css'
```

#### 7. Entry point

**`packages/frontend/src/main.ts`** _(new)_

```typescript
import { createApp } from 'vue'
import App from './App.vue'
import './assets/styles.css'

createApp(App).mount('#app')
```

#### 8. DO NOT delete packages/backend/public/ in this phase

`packages/backend/public/` must remain until Phase 4 wires up the Vue dist serving. If you delete it here, the Phase 3 commit will break `http://localhost:7000/configure` (the backend still serves from `public/` until Phase 4 updates `pages.ts`). The deletion happens at the **start of Phase 4**, after the new static serving is in place.

### Documentation Updates for This Phase

- [ ] `CLAUDE.md` — add `packages/frontend/` to key files table; add `pnpm --filter frontend dev` to commands
- [ ] `.gitignore` — already covers `packages/*/dist`

### Commit for This Phase

**Message**: `feat(frontend): migrate vanilla JS config page to Vue 3 + Vite + TypeScript`
**Why commit here**: Frontend builds and runs on Vite dev server (port 5173) with backend proxied. This is independently usable and verifiable before wiring into the backend serving.

### Success Criteria

#### Automated Verification

- [ ] `cd packages/frontend && pnpm build` exits 0 — `dist/` directory created
- [ ] `cd packages/frontend && pnpm dev` starts Vite dev server on port 5173
- [ ] Backend must be running on port 7000 for the proxy to work

#### Manual Verification

- [ ] Navigate to `http://localhost:5173` — config page loads with correct addon info (name, logo from API)
- [ ] All three provider tabs render with correct form fields
- [ ] Xtream Codes: fill in credentials, submit — overlay appears, manifest URL generated, polling works
- [ ] M3U: public playlist chips work, URL prefetch validates
- [ ] IPTV-org: country/category filters work
- [ ] Reconfiguration: navigate to `/{token}/configure` — form pre-fills from token
- [ ] Copy manifest URL button works
- [ ] "Open in Stremio" button generates correct `stremio://` URL

---

## Phase 4: Backend Serves Frontend + Docker

### Overview

Wire the compiled frontend into the backend for production serving. Update the Dockerfile to build both packages in one image. After this phase, `docker-compose up` gives a fully working deployment.

### Motivation for this phase

Phases 2 and 3 kept backend and frontend independently verifiable. This phase connects them. Separating it from Phase 3 means if there's a Docker or path issue, we haven't lost the clean frontend commit.

### Changes Required

#### 1. Delete packages/backend/public/

Now that the Vue frontend dist will be served instead, remove the old vanilla assets:
- Delete `packages/backend/public/` entirely (HTML, CSS, JS, logo assets are all replaced by the Vue build)

The logo assets moved to `packages/frontend/public/logo/` in Phase 3 and are now in `packages/frontend/dist/logo/`.

#### 3. Update server.ts to auto-serve frontend dist

**File**: `packages/backend/server.ts`

Replace the old `public/` static serving with auto-detection of the Vue dist:

```typescript
import fs from 'fs';
import path from 'path';

// __dirname in compiled output = packages/backend/dist/
// path to frontend dist: packages/frontend/dist/
const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  console.log(`[STATIC] Serving frontend from ${frontendDist}`);
}
```

This auto-detects: in dev (dist not built), it skips static serving — the Vite dev server handles it. In production (dist exists), it serves the built Vue app.

Also update the `favicon.ico` route — after `packages/backend/public/` is removed in Phase 3, the current hardcoded path breaks:

```typescript
// Replace this (references deleted public/ directory):
// app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public', 'logo', 'addon-logo.png')));

// With this — delegates to the static middleware above, which serves logo/addon-logo.png from dist/:
app.get('/favicon.ico', (req, res) => {
  if (fs.existsSync(frontendDist)) {
    res.sendFile(path.join(frontendDist, 'logo', 'addon-logo.png'));
  } else {
    res.status(404).end();
  }
});
```

#### 4. Update pages.ts to serve Vue index.html

**File**: `packages/backend/src/routes/pages.ts`

Replace `res.sendFile(path.join(publicDir, 'html', 'xtream-config.html'))` with:

```typescript
const frontendDist = path.join(__dirname, '..', '..', '..', 'frontend', 'dist');
const indexHtml = path.join(frontendDist, 'index.html');

// Each configure route:
router.get('/configure', (req, res) => {
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.status(503).send('Frontend not built. Run: pnpm --filter frontend build');
  }
});
```

Apply to these routes (all currently send the HTML file):
- `GET /` → send `index.html`
- `GET /configure` → send `index.html`
- `GET /configure-iptv-org` → send `index.html`
- `GET /:token/configure` → send `index.html`
- `GET /:token/configure-iptv-org` → send `index.html`

These routes remain **unchanged** (they are redirects or JSON, not HTML):
- `GET /configure-xtream` → 301 redirect to `/configure` — no change
- `GET /:token/configure-xtream` → 301 redirect — no change
- `GET /manifest.json` → returns JSON from `createManifest()` — no change

#### 5. Update Dockerfile for full monorepo build

**File**: `Dockerfile` _(full rewrite)_

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 build-base

# Install pnpm
RUN npm install -g pnpm@latest

# Install ALL workspace deps (backend native modules + frontend Vue toolchain)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
RUN pnpm install

# Remove build tools after native compilation
RUN apk del python3 build-base

# Build frontend (Vue + Vite)
COPY packages/frontend/ ./packages/frontend/
RUN pnpm --filter @nexotv/frontend build

# Build backend (TypeScript)
COPY packages/backend/ ./packages/backend/
RUN pnpm --filter @nexotv/backend build

# Copy runtime config and create data dir
COPY config/ ./config/
RUN mkdir -p /app/data

EXPOSE 7000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:7000/health || exit 1

CMD ["node", "packages/backend/dist/server.js"]
```

#### 6. Update docker-compose.yml

**File**: `docker-compose.yml` _(minor update — volume paths unchanged)_

No structural changes needed. The `./data:/app/data` and `./config:/app/config` mounts still work since both are at repo root.

#### 7. Add root dev script with concurrently

Root `package.json` scripts are already defined in Phase 1. Verify `pnpm dev` (at root) starts both backend and frontend dev servers.

### Documentation Updates for This Phase

- [ ] `README.md` — update Quick Start section: replace `npm start` with Docker instructions; add dev workflow section showing `pnpm --filter backend dev` and `pnpm --filter frontend dev`
- [ ] `CLAUDE.md` — update Commands section with new pnpm commands; update Architecture section and Docker section

### Commit for This Phase

**Message**: `feat: wire frontend dist to backend serving and update Dockerfile for monorepo`
**Why commit here**: Full production deployment works via `docker-compose up`. This is a complete, deployable state.

### Success Criteria

#### Automated Verification

- [ ] `docker-compose build` completes without error
- [ ] `docker-compose up -d` starts container
- [ ] `curl http://localhost:7000/health` returns OK
- [ ] `curl http://localhost:7000/configure` returns Vue `index.html` (not the old vanilla HTML)
- [ ] `curl http://localhost:7000/api/addon-info` returns JSON

#### Manual Verification

- [ ] Navigate to `http://localhost:7000/configure` in browser — Vue app loads (check browser DevTools: page uses Vue)
- [ ] Configure an Xtream or M3U provider — manifest URL generated, opens in Stremio
- [ ] Navigate to `http://localhost:7000/{token}/configure` — reconfiguration works, form pre-fills

---

## Phase 5: Documentation + Finalization

### Overview

Update all documentation to reflect the new monorepo structure, TypeScript backend, and Vue frontend. Clean up any leftover artifacts.

### Changes Required

#### 1. Update CLAUDE.md

Replace the current content with updated sections:

**Commands:**
```bash
# Development
pnpm --filter backend dev    # Backend on port 7000 (tsx watch)
pnpm --filter frontend dev   # Frontend on port 5173 (Vite, proxies API to 7000)
pnpm dev                     # Both concurrently

# Production build
pnpm build                   # Build frontend then backend

# Docker
docker-compose up -d
docker build -t nexotv .
```

**Architecture section** — update file paths to `packages/backend/src/...`

**Key Source Files table** — update paths and add frontend entries:

| File | Role |
|------|------|
| `packages/backend/server.ts` | Express setup, static serving, graceful shutdown |
| `packages/backend/src/addon/M3UEPGAddon.ts` | Core addon class |
| `packages/frontend/src/App.vue` | Root Vue component, tab + overlay orchestration |
| `packages/frontend/src/composables/useConfigToken.ts` | Token generation (encrypt or base64url) |
| `packages/frontend/src/composables/useManifestPoll.ts` | Manifest polling loop |

#### 2. Update README.md

- Update Quick Start to use `pnpm` commands
- Add "Development" section explaining the two-package dev workflow
- Update Docker section

#### 3. Cleanup

- Remove `packages/backend/public/` if not already removed in Phase 3
- Verify `data/` directory is not committed (should be in `.gitignore`)
- Verify `packages/*/node_modules` is in `.gitignore`

### Commit for This Phase

**Message**: `docs: update CLAUDE.md and README for monorepo + TypeScript + Vue architecture`
**Why commit here**: Documentation matches the actual code. Project is fully migrated and documented.

### Success Criteria

#### Automated Verification

- [ ] `pnpm dev` (from root) starts both backend (7000) and frontend dev (5173)
- [ ] `pnpm build` (from root) builds both packages cleanly
- [ ] `docker-compose up` deploys full production stack

#### Manual Verification

- [ ] CLAUDE.md commands are accurate and runnable
- [ ] A fresh clone + `pnpm install` + `pnpm dev` works end-to-end
- [ ] Docker image size is reasonable (no massive bloat from devDependencies left in image)

---

## Testing Strategy

### Manual Testing Steps

1. Start backend: `pnpm --filter backend dev`
2. Start frontend dev: `pnpm --filter frontend dev`
3. Open `http://localhost:5173` — config page loads with addon name and logo
4. **Xtream tab**: enter credentials, click Install — overlay shows, progress bar animates, manifest URL generated
5. **M3U tab**: paste an M3U URL, click prefetch — URL validates; click Install — manifest URL generated
6. **IPTV-org tab**: select a country filter, click Install — manifest URL generated
7. Open `http://localhost:7000/{token}/configure` — correct tab opens with form pre-filled
8. Build frontend: `pnpm --filter frontend build`
9. Start backend only: `pnpm --filter backend dev`
10. Open `http://localhost:7000/configure` — Vue app served from dist, same functionality

### Edge Cases to Verify

- Token with encryption disabled: base64url fallback works, warning shown in overlay
- Token with encryption enabled: `enc:` prefix, form pre-fill does NOT expose password (reads `decoded.xtreamPassword`)
- Manifest polling timeout (90s): timeout message shown, copy/open buttons still enabled
- No internet access: EPG fetch fails gracefully, manifest still generated without EPG

## Performance Considerations

No performance changes introduced. The Vite build produces a small bundle (~50-100KB for a single-page config form). TypeScript compilation adds ~1-2 seconds to Docker build time. Backend behavior is unchanged.

## Migration Notes

- SQLite `data/cache.sqlite` requires no changes — cache key format is unchanged
- Existing installed manifest URLs continue to work — token format is unchanged
- The `data/` and `config/` volume mounts in docker-compose.yml remain at repo root — no migration needed for existing Docker deployments
- Old bookmarks to `http://host/configure` continue to work — route is preserved in `pages.ts`

## Rollback Plan

Each phase has its own commit. To roll back:
- **Phase 5 only**: `git revert HEAD` — docs-only, no functional impact
- **Phase 4 only**: `git revert HEAD~1` — reverts Docker + serving wiring; frontend still at `packages/frontend/`
- **Phase 3 only**: `git revert HEAD~2` — removes Vue frontend; backend still TypeScript
- **Phase 2 only**: `git revert HEAD~3` — reverts TypeScript; monorepo structure intact
- **All phases**: `git revert HEAD~4..HEAD` — returns to original flat JS structure

The original `server.js`, `src/`, and `public/` are gone after Phase 1 — but the content is identical to `packages/backend/server.ts`, `packages/backend/src/`, and `packages/backend/public/` (Phase 1 is a pure move).

## References

- Brainstorming session: chose pnpm workspaces (Approach 1) on 2026-03-18
- stremio-addon-sdk: no official types — needs local `.d.ts` (`packages/backend/src/types/stremio-addon-sdk.d.ts`)
- Dynamic require pattern to fix: `src/addon/M3UEPGAddon.ts:181`
- Frontend proxy config: `packages/frontend/vite.config.ts` — proxies `/api` and `/encrypt` to `http://localhost:7000`
- Vue 3 Composition API docs: https://vuejs.org/guide/reusability/composables
