# Plano: Estabilidade de Memória e CPU no BeamUp

## Contexto

O addon crashava no BeamUp (host com pouca RAM/CPU) em dois cenários confirmados pelos logs de 20/03/2026:

### Crash de RAM (22:16–22:23 UTC)
- Heap cresceu para **509 MB** ao longo de ~2.4h de uptime
- Quando o provider M3U começou a retornar HTTP 404, o `refreshOnFirstCatalogRequest` não tem cooldown após falha: `firstCatalogRefreshDone` permanece `false` e `firstCatalogRefreshPromise` é nullado no `finally`, então cada nova onda de requests reinicia o ciclo imediatamente
- O Node.js sem heap limit foi consumindo RAM até o processo ser morto pelo OS (exit 137) ou o V8 abortar com SIGABRT (exit 134, "Ineffective mark-compacts near heap limit")

### Crash de CPU (11:01 e 11:31 UTC)
- Logs mostram EPG de 124.6 MB sendo processado (`[WARN] [EPG] Content too large (124.6 MB), skipping`) e `EPG parse failed Unexpected close tag`
- O parser SAX em `epgParser.ts` é síncrono e **bloqueia o event loop**, causando 97–107% CPU por vários minutos

### Distinção importante
As configurações padrão do addon (`packages/backend/src/utils/env.ts`) são para servidores robustos/privados. As configurações específicas do BeamUp ficam em `tmp/deploy_beamup/beamup-nexotv-env.ts` e já estão conservadoras:
- `MAX_CACHE_ENTRIES: 15`
- `DATA_MEMORY_TTL_MS: 60000` (1 min)
- `EPG_MAX_BYTES: 26214400` (25 MB)
- `MIN_UPDATE_INTERVAL_MS: 3600000` (1h)
- `UPDATE_INTERVAL_MS: 28800000` (8h)

**Esse plano não altera os defaults globais** — só o código de comportamento e o arquivo BeamUp.

---

## Fase 1 — Estabilidade Imediata

**Objetivo**: Eliminar o crash de RAM. PR separado, deploy o quanto antes.

### [x] 1.1 Exponential backoff após falha de `refreshOnFirstCatalogRequest`

**Arquivo**: `packages/backend/src/addon/M3UEPGAddon.ts`

**Problema**: Quando `updateData` falha (ex: HTTP 404), o `finally` nulla o `firstCatalogRefreshPromise` e `firstCatalogRefreshDone` permanece `false`. A próxima request de catalog do mesmo usuário reinicia o ciclo imediatamente, sem cooldown.

**Implementação**:

Adicionar dois campos à classe `M3UEPGAddon`:
```typescript
private _consecutiveRefreshFailures = 0;
private _refreshFailedAt: number | null = null;
```

Adicionar helper privado:
```typescript
private _getRefreshCooldownMs(): number {
  if (this._consecutiveRefreshFailures <= 0) return 0;
  if (this._consecutiveRefreshFailures === 1) return 60_000;      // 1 min
  if (this._consecutiveRefreshFailures === 2) return 5 * 60_000;  // 5 min
  return 30 * 60_000;                                              // 30 min
}
```

No início de `refreshOnFirstCatalogRequest`, ANTES do check de `firstCatalogRefreshPromise`, inserir:
```typescript
// Exponential backoff: don't hammer a failing provider
if (this._refreshFailedAt !== null) {
  const cooldown = this._getRefreshCooldownMs();
  if (Date.now() - this._refreshFailedAt < cooldown) return;
}
```

Substituir o bloco `try/finally` existente do await pelo:
```typescript
try {
  await this.firstCatalogRefreshPromise;
  this._consecutiveRefreshFailures = 0;  // reset em sucesso
  this._refreshFailedAt = null;
} catch (e) {
  this._consecutiveRefreshFailures++;
  this._refreshFailedAt = Date.now();
  throw e;
} finally {
  this.firstCatalogRefreshPromise = null;
}
```

**Comportamento**:
- 1ª falha: próxima tentativa só após 1 min
- 2ª falha: após 5 min
- 3ª+ falha: após 30 min
- Em sucesso: reseta contadores
- Estado é **por instância** (por token de usuário) — um provider quebrado não afeta outros usuários

### 1.2 Heap limit do Node.js

**Arquivo**: `tmp/deploy_beamup/beamup-nexotv-env.ts`

`NODE_OPTIONS` precisa ser setado **antes** do processo Node iniciar — não pode ser definido de dentro do JS. Adicionar comentário no arquivo BeamUp documentando que o seguinte deve ser configurado manualmente no painel BeamUp como variável de ambiente:

```
NODE_OPTIONS=--max-old-space-size=384
```

Com esse limite, o GC roda mais agressivamente antes de 384 MB e o processo falha de forma controlada ao invés de ser morto pelo OS OOM killer. Garante restart mais rápido e logs mais limpos.

**Ação no arquivo**: Adicionar seção de comentário no topo do `beamup-nexotv-env.ts` (logo após os imports) explicando a variável e por que precisa ser setada no painel.

---

## Fase 2 — Estabilidade de Longo Prazo

**Objetivo**: Eliminar o CPU spike e o padrão de retries do background timer.

### 2.1 Yield no EPG parser para liberar CPU

**Arquivo**: `packages/backend/src/parsers/epgParser.ts`

**Problema**: O parser SAX processa eventos XML de forma síncrona. Um arquivo de 25 MB (limite atual no BeamUp) pode ter centenas de milhares de eventos, bloqueando o event loop por vários minutos.

**Implementação**:

Verificar a estrutura atual do `parseEPG` para identificar onde o loop de eventos SAX é processado. Inserir yield a cada 5.000 eventos:

```typescript
let eventCount = 0;

// Dentro do callback de evento do parser SAX:
if (++eventCount % 5000 === 0) {
  await new Promise<void>(resolve => setImmediate(resolve));
}
```

Isso transforma o processamento em cooperativo — a cada 5k eventos, o event loop processa outros requests pendentes antes de continuar.

**Nota**: Verificar se `parseEPG` já é `async`. Se for síncrona hoje, precisará ser convertida para `async` e todos os call sites atualizados (checar `epgParser.ts` e `M3UEPGAddon.ts`).

### 2.2 Circuit breaker no background timer

**Arquivo**: `packages/backend/src/addon/M3UEPGAddon.ts`

**Problema**: O `setInterval` que chama `updateData()` continua tentando a cada 8h mesmo se o provider está offline. Após N falhas, o addon deveria pausar o timer por um período maior antes de retomar.

**Implementação**:

Adicionar campos à classe:
```typescript
private _timerConsecutiveFailures = 0;
private _timerPausedUntil: number | null = null;
```

No callback do `_startUpdateTimer`, envolver a chamada:
```typescript
this._updateTimer = setInterval(() => {
  // Skip if circuit is open
  if (this._timerPausedUntil !== null && Date.now() < this._timerPausedUntil) return;

  this.updateData().then(() => {
    this._timerConsecutiveFailures = 0;
    this._timerPausedUntil = null;
  }).catch((e: any) => {
    this._timerConsecutiveFailures++;
    if (this._timerConsecutiveFailures >= 3) {
      this._timerPausedUntil = Date.now() + 30 * 60_000; // pausa 30 min
      this.log.warn(`[TIMER] Circuit open after ${this._timerConsecutiveFailures} failures, pausing 30 min`);
    }
    this.log.error('[TIMER] Background update failed:', e.message);
  });
}, env.UPDATE_INTERVAL_MS);
```

---

## Arquivos Críticos

| Arquivo | Fase | Mudança |
|---------|------|---------|
| `packages/backend/src/addon/M3UEPGAddon.ts` | 1 + 2 | Backoff + circuit breaker |
| `packages/backend/src/parsers/epgParser.ts` | 2 | Yield no parser SAX |
| `tmp/deploy_beamup/beamup-nexotv-env.ts` | 1 | Comentário NODE_OPTIONS |

---

## Verificação

### Fase 1
1. Simular provider M3U retornando 404 repetidamente → logs devem mostrar cooldown crescente (1 min → 5 min → 30 min) ao invés de retries imediatos no próximo request
2. Confirmar que `NODE_OPTIONS=--max-old-space-size=384` está setado no painel BeamUp
3. `pnpm --filter backend test` — nenhum teste existente deve quebrar

### Fase 2
1. Rodar parsing de EPG com arquivo >10 MB e confirmar que outros requests são respondidos durante o parsing (event loop desbloqueado)
2. Simular 4+ falhas consecutivas no timer → verificar log `[TIMER] Circuit open` e pausa de 30 min
3. `pnpm --filter backend test` deve continuar passando
