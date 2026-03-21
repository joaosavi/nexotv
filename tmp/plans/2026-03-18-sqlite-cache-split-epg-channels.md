# SQLite Cache Split: EPG/Channels Separation + Remove Gzip from Channels

## Overview

Split the single SQLite blob per addon config into two separate entries — one for
channels, one for EPG — and remove gzip compression from channel data. This is a
follow-up to the lazy-load/eviction refactor (commit `17107b9` area) that freed
channels/EPG from RAM after 5 min idle. The goal is to reduce CPU cost per request
(no gunzip on catalog/stream requests) and prevent EPG data from ever entering RAM
during catalog or stream operations.

## Background / Why We're Doing This

### The problem that led here
The beamup public instance was crashing with `JavaScript heap out of memory` within
minutes of receiving public traffic. Root cause: `buildPromiseCache` held up to 300
full `M3UEPGAddon` instances in RAM simultaneously, each containing `this.channels`,
`this.channelMap`, and `this.epgData`. With many users and large IPTV playlists
(10k+ channels) + EPG (50-100MB XML → large parsed objects), the heap reached
500MB+ and OOM-killed the process.

The lazy-load/eviction refactor (already done) freed data from RAM after 5 min idle
and reduced `MAX_CACHE_ENTRIES` to 25. But every cold load (cache miss in RAM) still
requires SQLite to decompress and deserialize the **entire blob** — channels AND EPG
together — even when only channel data is needed (catalog, stream requests).

### Why gzip hurts more than helps for channels
- `gzipSync/gunzipSync` are **synchronous** → block the Node.js event loop
- For channels: JSON ~5MB → compressed ~1.5MB. The ~3.5MB disk I/O saving costs
  more in CPU than it saves on fast SSD storage
- During decompression both buffers exist simultaneously → temporary RAM peak of ~6.5MB
- After `JSON.parse` the object is ~15-25MB anyway — gzip saves nothing in RAM
- For EPG: JSON ~50MB → compressed ~5MB. Here gzip IS worth it: 45MB I/O saving
  outweighs CPU cost, and EPG is read rarely (only on `getDetailedMeta`)

### What the current code does
`M3UEPGAddon.saveToCache()` (line 116) stores one entry:
```
Key:   addon:data:{md5(config)}
Value: gzip({ channels: [...], epgData: {...}, lastUpdate: N })
```
`loadFromCache()` (line 100) always loads the full blob including EPG, even for
catalog requests that never use `epgData`.

---

## Desired End State

- Two separate SQLite entries per addon config:
  - `addon:channels:{cacheKey}` → raw JSON (no gzip), `{ channels, lastUpdate }`
  - `addon:epg:{cacheKey}` → gzip JSON, `{ epgData }`
- `ensureDataLoaded()` loads only `addon:channels:` (fast, no decompress)
- EPG is loaded from `addon:epg:` lazily, only inside `getDetailedMeta()`
- `refreshOnFirstCatalogRequest()` deletes both keys when forcing a full refresh
- Existing old `addon:data:` entries are silently ignored and expire naturally
- All doc files reflect the new cache structure and new `DATA_MEMORY_TTL_MS` variable

### Key Discoveries
- All sqliteCache calls are exclusively in `M3UEPGAddon.js` (lines 100, 121, 197) — no changes needed in providers
- `iptv-org` provider never sets `this.epgData` → `saveEpgToCache()` can be a no-op when `epgData` is empty
- The `del()` in `refreshOnFirstCatalogRequest` (line 197) currently only deletes `addon:data:` — needs to delete both new keys
- `tmp/.env-selfhost-addons.example` is unrelated (Comet/TMDB project) — do not touch

---

## What We're NOT Doing

- **No async gzip** — would require cascading async changes across all callers; separate concern
- **No per-channel SQLite rows** — would require schema change and migration; overkill
- **No worker threads** — too much complexity for the current scale
- **No migration script** — old `addon:data:` entries expire naturally via TTL; no data loss
- **No changes to providers** — they still write to `this.channels` / `this.epgData` as before
- **No changes to rate limiting, LRU, or builder.js handler logic** — already done

---

## Implementation Approach

All changes are confined to two files:
1. `src/utils/sqliteCache.js` — add `setRaw/getRaw` (no compression)
2. `src/addon/M3UEPGAddon.js` — split save/load methods, add `ensureEpgLoaded()`

Then documentation updated across all relevant files.

---

## Phase 1 — Add `setRaw/getRaw` to sqliteCache

### Overview
Add two new methods to `sqliteCache.js` that store/retrieve JSON without gzip
compression. Channel data will use these. EPG will continue using `set/get` (gzip).

### Changes Required

#### 1. `src/utils/sqliteCache.js`
**File**: `src/utils/sqliteCache.js`
**Changes**: Add `setRaw` and `getRaw` after the existing `set` and `get` functions.

```js
function setRaw(key, value, ttlMs) {
    if (!db) return;
    const raw = Buffer.from(JSON.stringify(value));
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    db.prepare(
        'INSERT OR REPLACE INTO CacheEntry (key, value, expires_at) VALUES (?, ?, ?)'
    ).run(key, raw, expiresAt);
    log.debug('Cache setRaw', { key, bytes: raw.length, expiresAt });
}

function getRaw(key) {
    if (!db) return null;
    const stmt = db.prepare('SELECT value, expires_at FROM CacheEntry WHERE key = ?');
    const row = stmt.get(key);
    if (!row) return null;
    if (row.expires_at && row.expires_at < Date.now()) {
        db.prepare('DELETE FROM CacheEntry WHERE key = ?').run(key);
        log.debug('Cache expired, deleted', { key });
        return null;
    }
    try {
        return JSON.parse(row.value.toString());
    } catch (e) {
        log.error('Cache getRaw parse error', { key, error: e.message });
        return null;
    }
}
```

Also update `module.exports`:
```js
module.exports = { init, get, set, getRaw, setRaw, del, cleanExpired, vacuum, close };
```

### Success Criteria

#### Automated Verification
- [x] `node -e "const c = require('./src/utils/sqliteCache'); c.init(); c.setRaw('test', {a:1}, 60000); console.log(JSON.stringify(c.getRaw('test')))"` prints `{"a":1}`
- [x] `node -e "const c = require('./src/utils/sqliteCache'); c.init(); c.setRaw('test', {a:1}, 60000); const row = require('better-sqlite3')('./data/cache.sqlite').prepare('SELECT length(value) as l FROM CacheEntry WHERE key=?').get('test'); console.log('raw bytes:', row.l)"` — bytes devem ser tamanho do JSON sem compressão

#### Manual Verification
- [ ] Nenhum comportamento existente quebrado — `get/set` com gzip continuam funcionando normalmente

**Commit após esta fase**: `feat(cache): add setRaw/getRaw to sqliteCache for uncompressed storage`

---

## Phase 2 — Split channels/EPG into separate SQLite entries

### Overview
Replace `saveToCache()`/`loadFromCache()` com quatro métodos granulares:
`saveChannelsToCache()`, `loadChannelsFromCache()`, `saveEpgToCache()`,
`loadEpgFromCache()`. Adiciona `ensureEpgLoaded()` para carregamento lazy de EPG
exclusivamente no `getDetailedMeta()`. Atualiza `refreshOnFirstCatalogRequest()`
para deletar ambas as novas chaves.

### Changes Required

#### 1. `src/addon/M3UEPGAddon.js` — Split cache methods

**Remove** `saveToCache()` e `loadFromCache()`. **Substituir por**:

```js
// Channels: uncompressed (setRaw/getRaw — no CPU cost per read)
async saveChannelsToCache() {
    if (!CACHE_ENABLED) return;
    sqliteCache.setRaw('addon:channels:' + this.cacheKey, {
        channels: this.channels,
        lastUpdate: this.lastUpdate
    }, this.cacheTtl);
    this.log.debug('Channels saved to cache', { count: this.channels.length });
}

async loadChannelsFromCache() {
    if (!CACHE_ENABLED) return;
    const cached = sqliteCache.getRaw('addon:channels:' + this.cacheKey);
    if (cached) {
        this.channels = cached.channels || [];
        this.channelMap = new Map(this.channels.map(c => [c.id, c]));
        this.lastUpdate = cached.lastUpdate || 0;
        this.log.debug('Channels loaded from cache', { count: this.channels.length });
    }
}

// EPG: gzip compressed (large data, read rarely)
async saveEpgToCache() {
    if (!CACHE_ENABLED) return;
    if (!this.epgData || Object.keys(this.epgData).length === 0) return;
    sqliteCache.set('addon:epg:' + this.cacheKey, { epgData: this.epgData }, this.cacheTtl);
    this.log.debug('EPG saved to cache', { channels: Object.keys(this.epgData).length });
}

async loadEpgFromCache() {
    if (!CACHE_ENABLED) return;
    const cached = sqliteCache.get('addon:epg:' + this.cacheKey);
    if (cached) {
        this.epgData = cached.epgData || {};
        this.log.debug('EPG loaded from cache', { channels: Object.keys(this.epgData).length });
    }
}
```

**Update `updateData()`** — replace `this.saveToCache()` with two separate calls:
```js
if (CACHE_ENABLED) {
    await this.saveChannelsToCache();
    await this.saveEpgToCache();
}
```

**Update `loadFromCache()` reference in `builder.js` area** — `M3UEPGAddon.js` calls
`loadFromCache()` inside `ensureDataLoaded()`. Replace with `loadChannelsFromCache()`:

```js
// In ensureDataLoaded():
this._loadPromise = this.loadChannelsFromCache().finally(() => { this._loadPromise = null; });
```

**Update `refreshOnFirstCatalogRequest()`** — delete both keys:
```js
if (CACHE_ENABLED) {
    sqliteCache.del('addon:channels:' + this.cacheKey);
    sqliteCache.del('addon:epg:' + this.cacheKey);
}
```

**Add `ensureEpgLoaded()`** — lazy load EPG, com dedup:
```js
async ensureEpgLoaded() {
    if (this.epgData && Object.keys(this.epgData).length > 0) return;
    if (!CACHE_ENABLED) return;
    await this.loadEpgFromCache();
}
```

**Update `getDetailedMeta()`** — add `ensureEpgLoaded()` call (alongside existing
`ensureDataLoaded()`):
```js
async getDetailedMeta(id) {
    await this.ensureDataLoaded();
    await this.ensureEpgLoaded();
    const item = this.channelMap.get(id);
    // ... rest unchanged
}
```

**Update `_evictFromMemory()`** — EPG eviction stays (already clears `this.epgData`),
no changes needed. EPG will be reloaded via `ensureEpgLoaded()` on next meta request.

**Remove legacy `loadFromCache()` and `saveToCache()` methods entirely** once all
references are replaced.

#### Notes on backward compatibility
- Old `addon:data:{cacheKey}` entries in SQLite will never be read again — let them
  expire naturally via their existing TTL. No migration needed.
- On first deploy after this change: all users get a cold cache → each addon instance
  fetches fresh from provider on first request. This is expected and safe.

### Success Criteria

#### Automated Verification
- [x] `npm start` inicia sem erros
- [ ] Primeira requisição de catálogo: log mostra `Channels saved to cache` e `EPG saved to cache` (se EPG habilitado)
- [ ] Segunda requisição (cold RAM, SQLite warm): log mostra `Channels loaded from cache` sem `EPG loaded from cache`
- [ ] Requisição de meta (click em canal): log mostra `EPG loaded from cache`
- [ ] `node -e "const db = require('better-sqlite3')('./data/cache.sqlite'); console.log(db.prepare('SELECT key FROM CacheEntry').all().map(r=>r.key))"` mostra chaves `addon:channels:` e `addon:epg:` (não mais `addon:data:`)

#### Manual Verification
- [ ] Catálogo carrega normalmente no Stremio após deploy
- [ ] Stream funciona (clique em canal → URL retornada)
- [ ] Informação de EPG aparece no `getDetailedMeta` (click no canal → descrição com programa atual)
- [ ] Após 5 min idle: dados descarregados da RAM; próxima requisição recarrega do SQLite sem erro
- [ ] Instância no beamup não crasheia com OOM em sessão de 30 min com múltiplos usuários

**Commit após esta fase**: `feat(cache): split channels/EPG into separate SQLite entries, EPG lazy-loaded`

---

## Phase 3 — Documentation

### Overview
Atualizar todos os arquivos de documentação, configuração e exemplo para refletir:
1. Nova variável `DATA_MEMORY_TTL_MS` (adicionada na fase anterior de RAM optimization)
2. Nova estrutura de cache SQLite (duas chaves separadas)
3. Comportamento de compressão diferenciado (canais sem gzip, EPG com gzip)
4. Descrição atualizada de `MAX_CACHE_ENTRIES` (agora instâncias leves, não blobs)

### Changes Required

#### 1. `.env.example`
**File**: `.env.example`
**Changes**:
- Adicionar `DATA_MEMORY_TTL_MS` com comentário explicativo
- Atualizar comentário de `MAX_CACHE_ENTRIES` (instâncias leves, sem dados em RAM)
- Atualizar comentário de `PREFETCH_MAX_BYTES` para refletir o novo default recomendado

```bash
# How long (ms) channel/EPG data stays in RAM after last request before being evicted.
# Data is reloaded from SQLite on demand. Lower = less RAM, more SQLite reads.
# (default: 5 minutes)
DATA_MEMORY_TTL_MS=300000

# Max in-memory addon instances (lightweight — channel data lives in SQLite, not RAM)
# Each entry holds only config metadata; actual data is loaded on demand.
MAX_CACHE_ENTRIES=100
```

#### 2. `CLAUDE.md`
**File**: `CLAUDE.md`
**Changes**: Atualizar seção "Caching (3 layers)" para refletir:
- Chaves SQLite agora são `addon:channels:{key}` (sem gzip) e `addon:epg:{key}` (gzip)
- `buildPromiseCache` agora guarda instâncias **leves** (sem dados em RAM)
- Dados carregados sob demanda via `ensureDataLoaded()` / `ensureEpgLoaded()`
- Nova variável `DATA_MEMORY_TTL_MS` na tabela de env vars

```markdown
### Caching (3 layers)

1. **SQLite** (`data/` directory) — persistent; two entries per config:
   - `addon:channels:{key}` — raw JSON (no compression); channels + lastUpdate
   - `addon:epg:{key}` — gzip-compressed; EPG data only (written only if EPG enabled)
   - TTL controlled by `CACHE_TTL_MS` / `M3U_CACHE_TTL_MS` / `IPTV_ORG_CACHE_TTL_MS`
2. **Build promise cache** (in-memory LRU) — deduplicates concurrent `createAddon()` calls;
   instances are **lightweight** (no channel data in RAM after setup)
3. **Data memory TTL** — channel/EPG data loaded from SQLite on demand, evicted from RAM
   after `DATA_MEMORY_TTL_MS` of inactivity (default 5 min)
```

Adicionar `DATA_MEMORY_TTL_MS` à tabela de variáveis:
```markdown
| `DATA_MEMORY_TTL_MS` | 300000 | How long channel data stays in RAM after last use (ms) |
```

#### 3. `README.md`
**File**: `README.md`
**Changes**: Se houver menção de caching ou variáveis de ambiente, atualizar para incluir
`DATA_MEMORY_TTL_MS` e mencionar que canais são descarregados da RAM automaticamente.

#### 4. `Dockerfile`
**File**: `Dockerfile`
**Changes**: Nenhuma. O Dockerfile não tem nenhum `ENV` hardcoded — todas as variáveis
chegam via `.env` em runtime. Verificado: só define `WORKDIR`, `EXPOSE` e `CMD`.

#### 5. `docker-compose.yml`
**File**: `docker-compose.yml`
**Changes**: Nenhuma. Usa `env_file: .env` para todas as variáveis — nenhuma variável
está hardcoded no compose. `DATA_MEMORY_TTL_MS` será lida automaticamente do `.env`.

#### 6. `.gitignore` / `.dockerignore`
**Files**: `.gitignore`, `.dockerignore`
**Changes**: `tmp/plans/` já está no `.gitignore`. Sem alterações necessárias.

### Success Criteria

#### Manual Verification
- [x] `DATA_MEMORY_TTL_MS` presente em `.env.example` com comentário claro
- [x] `CLAUDE.md` reflete a estrutura de duas chaves SQLite
- [x] `CLAUDE.md` tabela de env vars tem `DATA_MEMORY_TTL_MS`
- [x] `README.md` não menciona comportamento antigo de cache (canais permanentes em RAM)
- [x] Nenhum arquivo de exemplo referencia `addon:data:` como chave SQLite

**Commit após esta fase**: `docs: update cache architecture docs for EPG/channels split and DATA_MEMORY_TTL_MS`

---

## Testing Strategy

### Manual Testing Steps (end-to-end no beamup)

1. Deploy nova versão no beamup
2. Abrir Stremio com addon instalado → catálogo deve carregar
3. Verificar logs: `Channels saved to cache` + `EPG saved to cache` na primeira carga
4. Aguardar 5 min idle → verificar log `Data evicted from RAM`
5. Reabrir catálogo → verificar log `Channels loaded from cache` (sem EPG)
6. Clicar em canal com EPG → verificar log `EPG loaded from cache`
7. Verificar RAM do processo: deve manter-se abaixo de 100MB em idle com múltiplos usuários
8. Verificar SQLite: `SELECT key, length(value) FROM CacheEntry` — canais devem ser maiores que EPG (sem compressão vs comprimido)

### Regression Checks
- [ ] Addon sem EPG habilitado: catálogo e streams funcionam, `addon:epg:` nunca criado
- [ ] Provider `iptv-org` (sem EPG): nenhum crash, `saveEpgToCache()` é no-op
- [ ] Rate limiting ainda funciona
- [ ] Config encryption/decryption não afetada

---

## Performance Considerations

| Operação | Antes | Depois |
|---|---|---|
| Catalog cold load | gunzip + JSON.parse (channels + EPG) | JSON.parse only (channels) |
| Stream cold load | gunzip + JSON.parse (channels + EPG) | JSON.parse only (channels) |
| Meta cold load | RAM hit (já carregado) ou gunzip+parse tudo | channels JSON.parse + EPG gunzip+parse |
| RAM em idle | 0 (evicted) | 0 (evicted) — igual |
| RAM durante catálogo ativo | ~15-25MB (channels object) | ~15-25MB — igual |
| RAM durante meta ativo | ~15-25MB + ~50MB EPG | ~15-25MB + ~50MB EPG — igual |
| Event loop bloqueado por catalogo | gzip + JSON.parse | só JSON.parse (mais rápido) |

---

## Migration Notes

Nenhuma migração de dados necessária. Entradas antigas `addon:data:{key}` no SQLite:
- Nunca mais serão lidas pelo novo código
- Expirarão automaticamente pelo TTL existente (padrão 6 horas)
- Serão removidas pelo próximo ciclo de GC (`SQLITE_GC_INTERVAL_MS`, padrão 1h no beamup)
- O VACUUM semanal recuperará o espaço em disco

**Primeira execução após deploy**: todos os usuários terão cache miss → providers são
consultados na primeira requisição de cada config. Comportamento normal e esperado.

---

## References

- Contexto do OOM: logs de beamup de 2026-03-18, múltiplos crashes em <2 min após boot
- Refactor de lazy-load/eviction (já feito): `src/addon/M3UEPGAddon.js` — métodos
  `ensureDataLoaded()`, `_evictFromMemory()`, `_resetEvictTimer()`
- Variável `DATA_MEMORY_TTL_MS` já adicionada em `src/config/env.js` e `tmp/beamup-nexotv-env.js`
- Todos os usos de sqliteCache: `src/addon/M3UEPGAddon.js:100,121,197`
- Providers não fazem chamadas diretas ao SQLite: confirmado em `m3uProvider.js`,
  `xtreamProvider.js`, `iptvOrgProvider.js`
