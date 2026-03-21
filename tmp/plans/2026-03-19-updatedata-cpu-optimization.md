# updateData CPU Optimization Plan

## Overview

Reduce CPU spikes caused by periodic M3U/EPG re-fetching on a resource-constrained public host (BeamUp). Three independent optimizations applied in order of impact: conditional HTTP fetching, decoupled EPG refresh cadence, and background update timers decoupled from user requests.

## Motivation & Context

The host is BeamUp (always-on Docker Swarm, not serverless). CPU spikes happen because `updateData` is triggered on every catalog request (fire-and-forget, but still real work when the interval expires). Each call downloads the full M3U playlist + EPG and re-parses everything from scratch, even if nothing changed. On a weak shared host with concurrent users, this creates significant CPU pressure.

The three optimizations address different layers of the problem:
1. **ETag** — avoid download + parse entirely if the source hasn't changed
2. **Separate EPG interval** — EPG is the heaviest CPU cost (xml2js on 50-100MB) but changes less frequently than channels
3. **Background timer** — decouple updates from user requests so no user "pays" for an update at request time

## Current State Analysis

- `updateData()` called fire-and-forget on **every catalog request** — `builder.ts:52`
- No conditional HTTP headers (no ETag, no If-Modified-Since) — `m3uProvider.ts:42`
- EPG parsed on every `updateData` call, same interval as channels — `m3uProvider.ts:85-88`
- `_evictFromMemory()` clears `channels`, `channelMap`, `epgData` only — `M3UEPGAddon.ts:381-387`
- `ensureDataLoaded()` reloads from SQLite on demand — `M3UEPGAddon.ts:389-402`
- `_resetEvictTimer()` resets 5-min RAM eviction timer on each access — `M3UEPGAddon.ts:376-379`
- `saveChannelsToCache()` stores `{ channels, lastUpdate }` to SQLite — `M3UEPGAddon.ts:138-145`
- `loadChannelsFromCache()` hydrates `channels`, `channelMap`, `lastUpdate` — `M3UEPGAddon.ts:147-156`
- EPG heaviest cost: `xml2js.parseStringPromise` on files up to `EPG_MAX_BYTES` (100MB) — `epgParser.ts:18`
- `UPDATE_INTERVAL_MS` default now 14400000 (4h); `MIN_UPDATE_INTERVAL_MS` default 1800000 (30min)

## Desired End State

- M3U providers send conditional HTTP headers; skip parse on 304 responses
- EPG re-parses at a longer independent interval (default 2× channel interval)
- `updateData` no longer called from the catalog handler; a background timer runs it instead
- No ghost updates: cleared timer on eviction, restarted on next use
- All new env vars documented and exposed

## Key Discoveries

- `m3uProvider.ts` uses a plain `fetch()` with no request headers — easiest point to add ETag
- `xtreamProvider.ts` fetches structured JSON API endpoints — ETag unlikely to be supported; **exclude from Phase 1**
- `iptvOrgProvider.ts` fetches three large JSON files from GitHub CDN — ETag possible but separate effort; **exclude from Phase 1**
- `_evictFromMemory()` is called directly in `builder.ts:39` right after initial addon build — any timer started in the constructor would be immediately killed. Timer must start lazily in `ensureDataLoaded()` instead
- `clearInterval(null)` is safe in Node.js — no guard needed if `_updateTimer` is null when `_evictFromMemory` runs
- `setInterval` holds a reference to the addon instance, preventing GC if not cleared — this is the ghost-config risk

## What We're NOT Doing

- Worker threads for CPU-bound parsing
- Streaming/incremental M3U parse
- Changing the `refreshOnFirstCatalogRequest` logic (it already guards with the 2-min check)

## Documentation Impact

| File | What changes |
|------|--------------|
| `packages/backend/src/config/env.ts` | Add `EPG_UPDATE_INTERVAL_MS` default |
| `.env.example` | Add `EPG_UPDATE_INTERVAL_MS` entry with comment |
| `CLAUDE.md` | Update env vars table with new variable |

---

## Phase 1: ETag / If-Modified-Since for All Three Providers

### Overview

Add conditional HTTP request support to all three providers. On first fetch: store `ETag` and/or `Last-Modified` response headers alongside channels in SQLite. On subsequent fetches: send conditional headers. If server returns `304 Not Modified`, skip download + parse entirely.

Each provider has a different HTTP profile:
- **M3U** — single playlist URL; ETag widely supported on CDNs and nginx
- **IPTV-org** — three parallel fetches to GitHub CDN (`channels.json`, `streams.json`, `logos.json`); GitHub CDN guarantees ETag support. Strategy: use `channels.json` as the sentinel — if it returns 304, all three are considered unchanged and the full processing is skipped
- **Xtream** — two API calls (`get_live_streams` + `get_live_categories`) from a user-hosted Xtream server; ETag support depends on the server. Implemented transparently: if no ETag in response, field stays null and next call is unconditional

### Motivation for this phase

If the source hasn't changed (common for CDN-hosted M3U and IPTV-org, possible for Xtream), the entire CPU cost of `fetchData` — HTTP download, M3U regex parsing, EPG `xml2js` parse — drops to near zero. Fully backwards-compatible: servers that don't return ETags behave identically to before.

### Changes Required

#### 1. Addon instance state — `M3UEPGAddon.ts`

**File**: `packages/backend/src/addon/M3UEPGAddon.ts`

Add per-provider ETag fields:

```ts
m3uEtag: string | null;
m3uLastModified: string | null;
iptvOrgEtag: string | null;      // sentinel: channels.json ETag
xtreamEtag: string | null;       // get_live_streams ETag
```

Initialize all to `null` in the constructor.

Include in `saveChannelsToCache()`:

```ts
JSON.stringify({
    channels: this.channels,
    lastUpdate: this.lastUpdate,
    m3uEtag: this.m3uEtag ?? null,
    m3uLastModified: this.m3uLastModified ?? null,
    iptvOrgEtag: this.iptvOrgEtag ?? null,
    xtreamEtag: this.xtreamEtag ?? null,
})
```

Hydrate in `loadChannelsFromCache()`:

```ts
this.m3uEtag = data.m3uEtag ?? null;
this.m3uLastModified = data.m3uLastModified ?? null;
this.iptvOrgEtag = data.iptvOrgEtag ?? null;
this.xtreamEtag = data.xtreamEtag ?? null;
```

#### 2. M3U conditional fetch — `m3uProvider.ts`

**File**: `packages/backend/src/providers/m3uProvider.ts`

```ts
const conditionalHeaders: Record<string, string> = {};
if (addonInstance.m3uEtag) {
    conditionalHeaders['If-None-Match'] = addonInstance.m3uEtag;
} else if (addonInstance.m3uLastModified) {
    conditionalHeaders['If-Modified-Since'] = addonInstance.m3uLastModified;
}

const resp = await withTimeout(m3uUrl.trim(), { headers: conditionalHeaders }, env.FETCH_TIMEOUT_MS);

if (resp.status === 304) {
    addonInstance.log?.debug('M3U 304 Not Modified — skipping parse');
    return;
}
if (!resp.ok) throw new Error(`M3U playlist fetch failed: HTTP ${resp.status}`);

// Store for next call
addonInstance.m3uEtag = resp.headers.get('etag') ?? null;
addonInstance.m3uLastModified = resp.headers.get('last-modified') ?? null;

const text = await resp.text();
// ... rest of parse unchanged
```

On 304, `addonInstance.channels` already holds valid data (loaded from SQLite or still in RAM).

#### 3. IPTV-org conditional fetch — `iptvOrgProvider.ts`

**File**: `packages/backend/src/providers/iptvOrgProvider.ts`

Replace the `fetchJson` helper with one that supports conditional headers and 304:

```ts
async function fetchJsonConditional(url: string, etag: string | null): Promise<{ data: any | null; etag: string | null }> {
    const headers: Record<string, string> = {};
    if (etag) headers['If-None-Match'] = etag;
    const res = await fetch(url, { headers });
    if (res.status === 304) return { data: null, etag };
    if (!res.ok) throw new Error(`iptv-org fetch failed: ${url} (${res.status})`);
    return { data: await res.json(), etag: res.headers.get('etag') ?? null };
}
```

In `fetchData`, probe `channels.json` first as the sentinel:

```ts
const channelsResult = await fetchJsonConditional(
    `${IPTV_ORG_BASE}/channels.json`,
    addonInstance.iptvOrgEtag
);

if (channelsResult.data === null) {
    // 304 — channels.json unchanged, assume full dataset unchanged
    addonInstance.log.debug('[iptvOrg] 304 Not Modified — skipping update');
    return;
}

// channels.json changed — fetch streams and logos unconditionally
const [streamsRaw, logosRaw] = await Promise.all([
    fetchJson(`${IPTV_ORG_BASE}/streams.json`),
    fetchJson(`${IPTV_ORG_BASE}/logos.json`),
]);
const channelsRaw = channelsResult.data;
addonInstance.iptvOrgEtag = channelsResult.etag;

// ... rest of processing unchanged
```

Note: the original `fetchJson` (unconditional) stays in the file for the streams and logos fetches which don't need conditional logic.

#### 4. Xtream conditional fetch — `xtreamProvider.ts`

**File**: `packages/backend/src/providers/xtreamProvider.ts`

Check ETag on `get_live_streams` (the larger of the two calls):

```ts
const liveHeaders: Record<string, string> = {};
if (addonInstance.xtreamEtag) liveHeaders['If-None-Match'] = addonInstance.xtreamEtag;

const [liveResp, liveCatsResp] = await Promise.all([
    withTimeout(`${base}&action=get_live_streams`, { headers: liveHeaders }, env.FETCH_TIMEOUT_MS),
    withTimeout(`${base}&action=get_live_categories`, {}, env.FETCH_TIMEOUT_MS).catch(() => null)
]);

if (liveResp.status === 304) {
    addonInstance.log?.debug('Xtream 304 Not Modified — skipping update');
    return;
}
if (!liveResp.ok) throw new Error('Xtream live streams fetch failed');

// Store ETag for next call
addonInstance.xtreamEtag = liveResp.headers.get('etag') ?? null;

const live = await liveResp.json();
// ... rest unchanged
```

### Documentation Updates for This Phase

- [ ] No new env vars in this phase

### Commit for This Phase

**Message**: `perf: skip provider fetch+parse on HTTP 304 using ETag/If-Modified-Since (all providers)`
**Why commit here**: All three providers are updated but changes are isolated within each provider file and the ETag fields in `M3UEPGAddon.ts`. Fully backward-compatible — servers without ETag support behave identically to before.

### Success Criteria

#### Automated Verification

- [ ] `pnpm --filter backend test` passes (no regressions)
- [ ] `pnpm --filter backend build` succeeds

#### Manual Verification

- [ ] **M3U**: second `updateData` call against a CDN-hosted M3U returns 304, channels intact, no parse
- [ ] **M3U**: server without ETag support — full fetch and parse works as before
- [ ] **IPTV-org**: second call returns 304 on `channels.json`, processing skipped entirely
- [ ] **Xtream**: if server returns ETag — 304 on second call skips channel mapping
- [ ] **Xtream**: if server doesn't return ETag — `xtreamEtag` stays null, next call is unconditional
- [ ] All ETag fields persist across server restart (stored in SQLite `addon:channels:` blob)

---

## Phase 2: Separate EPG Update Interval

### Overview

Add `EPG_UPDATE_INTERVAL_MS` (default: 2× `UPDATE_INTERVAL_MS`) so EPG is re-parsed at a longer cadence than channels. Each `updateData` call still re-fetches and parses the M3U playlist, but EPG parsing only runs when its own interval has elapsed. `lastEpgUpdate` is persisted in SQLite.

### Motivation for this phase

EPG parsing is the single most CPU-intensive operation in the codebase — `xml2js.parseStringPromise` on files up to 100MB can take several seconds. Yet EPG data (program guides) changes far less frequently than channel lists. Decoupling the two intervals means most `updateData` calls skip the heaviest work entirely. The tradeoff is EPG staleness, which is acceptable for a TV guide.

### Changes Required

#### 1. New env var — `env.ts`

**File**: `packages/backend/src/config/env.ts`

```ts
EPG_UPDATE_INTERVAL_MS: parseInt(process.env.EPG_UPDATE_INTERVAL_MS || '') || (env.UPDATE_INTERVAL_MS * 2),
```

Note: because `UPDATE_INTERVAL_MS` is defined in the same object literal, use the parsed value directly:

```ts
EPG_UPDATE_INTERVAL_MS: parseInt(process.env.EPG_UPDATE_INTERVAL_MS || '') || 28800000,
```

Default is 28800000 (8h = 2× the 4h channel interval).

#### 2. Addon instance state — `M3UEPGAddon.ts`

**File**: `packages/backend/src/addon/M3UEPGAddon.ts`

Add field:

```ts
lastEpgUpdate: number | null;
```

Initialize to `null` in constructor.

Persist in `saveChannelsToCache()` (same approach as Phase 1 — add `lastEpgUpdate` to the JSON blob).

Hydrate in `loadChannelsFromCache()`:

```ts
this.lastEpgUpdate = data.lastEpgUpdate ?? null;
```

#### 3. EPG interval check — `m3uProvider.ts` and `xtreamProvider.ts`

**File**: `packages/backend/src/providers/m3uProvider.ts`

After parsing channels, check EPG interval before fetching EPG:

```ts
if (config.enableEpg) {
    const epgSource = (config.epgUrl?.trim()) || detectedEpgUrl;
    if (epgSource) {
        const now = Date.now();
        const epgStale = !addonInstance.lastEpgUpdate ||
            (now - addonInstance.lastEpgUpdate > env.EPG_UPDATE_INTERVAL_MS);

        if (epgStale) {
            try {
                await validatePublicUrl(epgSource);
                const epgResp = await withTimeout(epgSource, {}, env.EPG_FETCH_TIMEOUT_MS);
                if (epgResp.ok) {
                    const epgContent = await epgResp.text();
                    addonInstance.epgData = await parseEPG(epgContent, addonInstance.log);
                    addonInstance.lastEpgUpdate = Date.now();
                }
            } catch {
                // EPG is optional — continue without it
            }
        } else {
            addonInstance.log?.debug('EPG skip (interval not elapsed)', {
                ms: now - (addonInstance.lastEpgUpdate ?? 0)
            });
        }
    }
}
```

Apply the same pattern in `xtreamProvider.ts` around its `parseEPG` call.

`saveEpgToCache()` should only be called when EPG was actually refreshed. Currently `updateData()` always calls `saveEpgToCache()`. Add a flag or check `lastEpgUpdate` was just set — simplest: only call `saveEpgToCache()` if `addonInstance.lastEpgUpdate` was updated this cycle (compare timestamp before/after the provider call).

In `M3UEPGAddon.ts` `updateData()`:

```ts
const epgUpdateTimeBefore = this.lastEpgUpdate;
await providerModule.fetchData(this);
// ...
if (CACHE_ENABLED) {
    await this.saveChannelsToCache(); // always
    if (this.lastEpgUpdate !== epgUpdateTimeBefore) {
        await this.saveEpgToCache(); // only if EPG was refreshed this cycle
    }
}
```

### Documentation Updates for This Phase

- [ ] `.env.example` — add `EPG_UPDATE_INTERVAL_MS=28800000` with comment explaining it defaults to 2× `UPDATE_INTERVAL_MS`
- [ ] `CLAUDE.md` — add row to env vars table

### Commit for This Phase

**Message**: `perf: decouple EPG refresh from channel refresh with EPG_UPDATE_INTERVAL_MS`
**Why commit here**: EPG interval logic is entirely contained within providers and `updateData`. ETag work from Phase 1 is unaffected. Stable to deploy independently.

### Success Criteria

#### Automated Verification

- [ ] `pnpm --filter backend test` passes
- [ ] `pnpm --filter backend build` succeeds

#### Manual Verification

- [ ] First `updateData` call: EPG is fetched and parsed, `lastEpgUpdate` is set
- [ ] Second `updateData` call within EPG interval: EPG fetch is skipped, log shows "EPG skip (interval not elapsed)"
- [ ] After `EPG_UPDATE_INTERVAL_MS` elapses: EPG is re-fetched and parsed on next `updateData`
- [ ] `lastEpgUpdate` persists across server restart (stored in SQLite channels cache blob)

---

## Phase 3: Background Update Timer (Decoupled from Requests)

### Overview

Replace the fire-and-forget `addonInstance.updateData()` call in the catalog handler with a `setInterval`-based background timer managed by the addon instance itself. The timer starts lazily (when data is first loaded into memory) and is cleared when the instance is evicted from RAM. This decouples update CPU work from user requests entirely.

### Motivation for this phase

Currently, the first catalog request after `UPDATE_INTERVAL_MS` elapses triggers a full `updateData` while the user is waiting (fire-and-forget, but still competes for CPU). With a background timer, `updateData` runs proactively on a schedule, independently of whether a user is making a request at that moment. The system is more predictable and user requests never race with update work.

### Ghost Config Risk

**This is the critical correctness concern for this phase.**

A `setInterval` holds a closure reference to the addon instance. If `clearInterval` is never called when the instance should be "dead," two things happen:
1. `updateData` keeps running forever, wasting CPU on a config nobody is using
2. The addon instance is never garbage collected (the interval's closure prevents it), creating a permanent memory leak

**The safe lifecycle is:**

```
ensureDataLoaded() called
  → data loaded from SQLite
  → _startUpdateTimer() called (guard: if timer already running, no-op)
  → timer fires every UPDATE_INTERVAL_MS → updateData() (fire-and-forget)

DATA_MEMORY_TTL_MS of inactivity
  → _evictTimer fires → _evictFromMemory() called
  → clearInterval(this._updateTimer)
  → this._updateTimer = null
  → channels/EPG cleared from RAM

Next request
  → ensureDataLoaded() → reloads from SQLite → _startUpdateTimer() restarts timer
```

**Why the timer must NOT start in the constructor:** `builder.ts` calls `_evictFromMemory()` directly at line ~39, immediately after the initial addon build. If the timer started in the constructor, it would be killed before the first user request. The lazy start in `ensureDataLoaded()` is the correct entry point.

### Changes Required

#### 1. Timer fields and methods — `M3UEPGAddon.ts`

**File**: `packages/backend/src/addon/M3UEPGAddon.ts`

Add field:

```ts
private _updateTimer: ReturnType<typeof setInterval> | null = null;
```

Add method `_startUpdateTimer()`:

```ts
private _startUpdateTimer() {
    if (this._updateTimer !== null) return; // already running — guard against double-start
    this._updateTimer = setInterval(() => {
        this.updateData().catch((e) => {
            this.log.error('[TIMER] Background update failed:', e.message);
        });
    }, env.UPDATE_INTERVAL_MS);
    // unref: don't prevent Node.js process exit if this is the only active handle
    if (typeof this._updateTimer.unref === 'function') {
        this._updateTimer.unref();
    }
}
```

Update `_evictFromMemory()` to clear the timer:

```ts
_evictFromMemory() {
    clearTimeout(this._evictTimer);
    clearInterval(this._updateTimer);   // ← NEW: kill update timer
    this._updateTimer = null;           // ← NEW: allow GC and re-start check
    this.channels = [];
    this.channelMap = new Map();
    this.epgData = {};
    this.log.debug('Data evicted from RAM', { cacheKey: this.cacheKey });
}
```

Update `ensureDataLoaded()` to start the timer after loading:

```ts
async ensureDataLoaded() {
    if (this.channels.length > 0) {
        this._resetEvictTimer();
        return;
    }
    if (!CACHE_ENABLED) return;
    if (this._loadPromise) {
        await this._loadPromise;
        return;
    }
    this._loadPromise = this.loadChannelsFromCache().finally(() => { this._loadPromise = null; });
    await this._loadPromise;
    this._resetEvictTimer();
    this._startUpdateTimer();    // ← NEW: start/resume background updates
}
```

#### 2. Remove fire-and-forget from catalog handler — `builder.ts`

**File**: `packages/backend/src/addon/builder.ts`

Remove line 52:

```ts
// REMOVE THIS LINE:
addonInstance.updateData().catch(() => { });
```

The catalog handler becomes:

```ts
builder.defineCatalogHandler(async (args) => {
    const start = Date.now();
    try {
        await addonInstance.refreshOnFirstCatalogRequest();
        // updateData no longer called here — handled by background timer
        const catalogIds = ['iptv_channels', 'iptv_org'];
        const channels = await addonInstance.getChannelsForCatalog();
        // ... rest unchanged
```

### Documentation Updates for This Phase

- [x] `CLAUDE.md` — update architecture section: note that `updateData` is now driven by a background timer per addon instance, not by catalog requests

### Commit for This Phase

**Message**: `perf: replace request-triggered updateData with per-instance background timer`
**Why commit here**: Timer lifecycle is fully self-contained in `M3UEPGAddon`. The removal of the fire-and-forget line in `builder.ts` is the only external change. Rollback = revert this commit and the fire-and-forget line is back.

### Success Criteria

#### Automated Verification

- [x] `pnpm --filter backend test` passes — specifically `m3uEpgAddon` tests
- [x] New test: `_evictFromMemory()` calls `clearInterval` and sets `_updateTimer` to null ✓
- [x] New test: after eviction, no further `updateData` calls are made (spy on `updateData`, advance fake timers, assert not called)
- [x] New test: `_startUpdateTimer()` is idempotent — calling twice does not create two timers

#### Manual Verification

- [ ] Start server, trigger catalog for a config → observe `_updateTimer` is running
- [ ] Wait `DATA_MEMORY_TTL_MS` (5 min in dev, or set to 5s for testing) with no requests → `_evictFromMemory` fires → timer stops
- [ ] Make another catalog request → timer restarts, data reloaded from SQLite
- [ ] Confirm no `updateData` call happens synchronously during a catalog request (only the background timer triggers it going forward — except `refreshOnFirstCatalogRequest` on new instances)

---

## Testing Strategy

### New Tests to Add

1. **Phase 1** — `m3uProvider.test.ts` (new file or add to existing):
   - Mock `fetch` to return 304: verify channels are preserved, no parse attempted
   - Mock `fetch` to return ETag header: verify `addonInstance.m3uEtag` is set
   - Mock `fetch` to omit ETag: verify `addonInstance.m3uEtag` remains null

2. **Phase 2** — add to existing provider tests or `m3uEpgAddon.pures.test.ts`:
   - `lastEpgUpdate` null → EPG fetch runs
   - `lastEpgUpdate` recent → EPG fetch skipped
   - `lastEpgUpdate` expired → EPG fetch runs, `lastEpgUpdate` updated

3. **Phase 3** — add to `m3uEpgAddon.pures.test.ts` or new integration test:
   - `_startUpdateTimer()` idempotency: calling twice, only one interval active
   - `_evictFromMemory()`: `_updateTimer` is null after call
   - Ghost-config prevention: after eviction, `vi.advanceTimersByTime(UPDATE_INTERVAL_MS * 3)` does NOT trigger `updateData`

### Edge Cases

- Server returns ETag on first request but not on second: `addonInstance.m3uEtag` becomes null, next request is unconditional
- EPG fetch fails during an EPG-refresh cycle: `lastEpgUpdate` should NOT be updated (keeps old EPG, retries next cycle)
- `_evictFromMemory()` called while `updateData` is in flight (from timer): `updateData` completes normally, result saved to SQLite; timer is already cleared so no further calls

## Performance Considerations

- Phase 1 reduces network I/O and CPU proportionally to how often M3U sources return 304 — expected high hit rate on CDN-hosted playlists
- Phase 2 eliminates EPG parsing (heaviest operation) on most `updateData` calls
- Phase 3 ensures CPU spikes from updates are distributed uniformly over time rather than concentrated at request peaks
- `.unref()` on the interval timer ensures Node.js can exit cleanly during shutdown without waiting for the timer

## Migration Notes

- Existing SQLite cache entries lack `m3uEtag`, `m3uLastModified`, `lastEpgUpdate` fields. `loadChannelsFromCache()` uses `?? null` fallbacks — safe for existing data, no migration needed
- No token format changes; no user-facing config changes

## Rollback Plan

Each phase is independently revertable:
- Phase 1: revert `m3uProvider.ts` header logic and `M3UEPGAddon.ts` field additions
- Phase 2: revert `m3uProvider.ts` EPG check and `xtreamProvider.ts` EPG check; remove `EPG_UPDATE_INTERVAL_MS` from `env.ts` and `.env.example`
- Phase 3: re-add `addonInstance.updateData().catch(() => {})` to `builder.ts`; revert timer methods from `M3UEPGAddon.ts`

## References

- Conversation context: host is BeamUp (always-on Docker Swarm), process runs continuously
- `M3UEPGAddon.ts`: `_evictFromMemory` at line 381, `ensureDataLoaded` at line 389, `updateData` at line 203
- `builder.ts`: fire-and-forget call at line 52, initial eviction at line ~39
- `m3uProvider.ts`: fetch call at line 42, EPG fetch at lines 85-93
- Related env vars: `UPDATE_INTERVAL_MS`, `MIN_UPDATE_INTERVAL_MS`, `DATA_MEMORY_TTL_MS`, `EPG_UPDATE_INTERVAL_MS` (new)
