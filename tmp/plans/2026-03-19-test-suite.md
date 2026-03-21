# Test Suite Implementation Plan

## Overview

Implementar uma bateria completa de testes para o backend do `iptv-stremio-addon`: unit tests de funções puras, testes de integração das rotas Express, testes de segurança com correção das vulnerabilidades identificadas, benchmarks de performance para listas grandes, e pipeline GitHub Actions que roda em todo PR.

## Motivation & Context

O projeto não tem nenhum teste hoje. As principais motivações para criar a bateria agora:

1. **Segurança**: a análise do código identificou vulnerabilidades reais — ReDoS em `m3uParser`, SSRF nos providers, credential exposure, header injection e token leak em logs. Sem testes, corrigir uma e quebrar outra é trivial.
2. **Confiança em refatorações**: o monorepo está em `refactor/monorepo` e mudanças são frequentes. Testes evitam regressões silenciosas.
3. **Performance com datasets reais**: playlists M3U de 10k–50k canais são comuns; sem benchmarks automatizados, não há como saber se uma mudança causa pico de memória.

## Current State Analysis

| Arquivo | Linhas relevantes | Observação |
|---------|------------------|------------|
| `packages/backend/src/utils/lruCache.ts` | 1–54 | Funções puras, Map-based, zero deps externas |
| `packages/backend/src/utils/cryptoConfig.ts` | 1–83 | AES-256-GCM, base64url, round-trip testável |
| `packages/backend/src/middleware/ssrf.ts` | 1–13 | Função pura, apenas regex |
| `packages/backend/src/addon/manifest.ts` | 1–32 | Pura, determinística |
| `packages/backend/src/parsers/m3uParser.ts` | 1–~90 | **ReDoS**: regex dinâmica nas linhas 15, 18 |
| `packages/backend/src/parsers/epgParser.ts` | 1–~130 | Sem limite de tamanho no XMLTV |
| `packages/backend/src/utils/sqliteCache.ts` | 1–146 | compress/decompress puros; TTL, fallback in-memory |
| `packages/backend/src/providers/m3uProvider.ts` | 39, 75 | **SSRF**: `m3uUrl`/`epgUrl` sem validação de hostname |
| `packages/backend/src/providers/xtreamProvider.ts` | 28 | **SSRF** + **credential exposure**: credentials em query string |
| `packages/backend/src/routes/stremio.ts` | 42 | **Token leak**: `log.debug('Config parse failed', token, ...)` loga token bruto |
| `packages/backend/src/parsers/m3uParser.ts` | 57–64 | **Header injection**: User-Agent/Referer extraídos sem sanitização |

**Nenhum arquivo de teste existe hoje.** Sem `vitest.config.ts`, `jest.config`, ou qualquer `.test.ts`.

## Desired End State

- `pnpm --filter backend test` passa completamente em CI
- `pnpm --filter backend test:coverage` reporta ≥70% de linhas/funções nas camadas críticas
- `pnpm --filter backend test:bench` finaliza com resultados dentro dos thresholds definidos
- Todas as 5 vulnerabilidades de segurança identificadas têm testes que as comprovam **e** código corrigido que faz esses testes passarem
- GitHub Actions roda os jobs `test` e `bench` em todo push/PR para `main` e `refactor/*`

## What We're NOT Doing

- Testes do frontend (Vue composables, componentes) — fora de escopo deste plano
- Testes do Docker ou docker-compose
- Testes de carga/stress (soaktest com múltiplos usuários simultâneos)
- Mocks completos do Stremio SDK — as rotas SDK são testadas via integração superficial
- Testes end-to-end com Stremio real
- Correção de vulnerabilidades que não têm teste associado (ex: credential exposure em query string no Xtream — é um problema de design de protocolo, não corrigível sem breaking change no provider)

## Documentation Impact

| Arquivo | O que muda |
|---------|-----------|
| `packages/backend/package.json` | Adicionar scripts `test`, `test:coverage`, `test:watch`, `test:bench`; adicionar devDependencies |
| `packages/backend/vitest.config.ts` | Novo arquivo — configuração de cobertura e thresholds |
| `CLAUDE.md` | Adicionar seção de comandos de teste e descrever estrutura `tests/` |
| `.github/workflows/test.yml` | Novo arquivo — pipeline CI |
| `.gitignore` | Adicionar `coverage/`, `.vitest-cache/` |

---

## Phase 1: Infraestrutura de Testes

### Overview

Instalar Vitest, Supertest e configurar o runner antes de escrever qualquer teste. O objetivo é `pnpm --filter backend test` executar (mesmo sem encontrar testes), cobertura configurada, e helpers de fixture prontos.

### Motivation for this phase

Sem scaffolding funcionando primeiro, os autores dos testes ficam bloqueados em configuração. Separar infra de testes reais também facilita review de PR.

### Changes Required

#### 1. Dependências — `packages/backend/package.json`

**File**: `packages/backend/package.json`

Adicionar em `devDependencies`:

```json
"vitest": "^2.1.0",
"@vitest/coverage-v8": "^2.1.0",
"supertest": "^7.0.0",
"@types/supertest": "^6.0.2"
```

Adicionar em `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage",
"test:bench": "vitest bench"
```

#### 2. Configuração Vitest — `packages/backend/vitest.config.ts`

**File**: `packages/backend/vitest.config.ts` _(novo)_

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.bench.ts', 'dist/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/types/**', 'dist/**'],
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
      },
    },
  },
});
```

#### 3. Helper: factory de configs — `packages/backend/tests/helpers/makeConfig.ts`

**File**: `packages/backend/tests/helpers/makeConfig.ts` _(novo)_

```typescript
import type { AddonConfig } from '../../src/addon/M3UEPGAddon';

export function makeM3uConfig(overrides: Partial<AddonConfig> = {}): AddonConfig {
  return {
    provider: 'm3u',
    m3uUrl: 'http://example.com/playlist.m3u',
    epgUrl: '',
    epgOffsetHours: 0,
    ...overrides,
  };
}

export function makeXtreamConfig(overrides: Partial<AddonConfig> = {}): AddonConfig {
  return {
    provider: 'xtream',
    xtreamUrl: 'http://example.com',
    xtreamUsername: 'user',
    xtreamPassword: 'pass',
    ...overrides,
  };
}

export function makeIptvOrgConfig(overrides: Partial<AddonConfig> = {}): AddonConfig {
  return {
    provider: 'iptv-org',
    iptvOrgCountry: 'US',
    iptvOrgCategory: 'sports',
    ...overrides,
  };
}
```

#### 4. Helper: fixtures de conteúdo — `packages/backend/tests/helpers/fixtures.ts`

**File**: `packages/backend/tests/helpers/fixtures.ts` _(novo)_

```typescript
export const SAMPLE_M3U = `#EXTM3U x-tvg-url="http://epg.example.com/guide.xml"
#EXTINF:-1 tvg-id="cnn.us" tvg-name="CNN" tvg-logo="http://logo.example.com/cnn.png" group-title="News",CNN
http://stream.example.com/cnn
#EXTINF:-1 tvg-id="espn.us" tvg-name="ESPN" group-title="Sports" user-agent="VLC/3.0",ESPN
http://stream.example.com/espn
#EXTINF:-1 tvg-id="hbo.us" tvg-name="HBO" group-title="Movies",HBO
http://stream.example.com/hbo
`;

export const MALFORMED_M3U = `#EXTM3U
#EXTINF:-1,No URL channel
#EXTINF:-1 tvg-id="noid",Missing stream URL
http://valid.example.com/stream
`;

export const SAMPLE_XMLTV = `<?xml version="1.0" encoding="UTF-8"?>
<tv>
  <channel id="cnn.us"><display-name>CNN</display-name></channel>
  <programme start="20260319120000 +0000" stop="20260319130000 +0000" channel="cnn.us">
    <title>CNN Newsroom</title>
    <desc>Live news coverage</desc>
  </programme>
  <programme start="20260319130000 +0000" stop="20260319140000 +0000" channel="cnn.us">
    <title>The Situation Room</title>
  </programme>
</tv>`;

/** Gera playlist M3U com N canais para benchmarks */
export function generateLargeM3U(channelCount: number): string {
  const lines = ['#EXTM3U'];
  for (let i = 0; i < channelCount; i++) {
    lines.push(
      `#EXTINF:-1 tvg-id="ch${i}.test" tvg-name="Channel ${i}" group-title="Group${i % 50}",Channel ${i}`,
      `http://stream.example.com/ch${i}`
    );
  }
  return lines.join('\n');
}

/** Gera XMLTV com N programas por canal */
export function generateLargeXMLTV(channels: number, programsPerChannel: number): string {
  const now = new Date('2026-03-19T12:00:00Z');
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<tv>\n';

  for (let c = 0; c < channels; c++) {
    xml += `  <channel id="ch${c}.test"><display-name>Channel ${c}</display-name></channel>\n`;
  }
  for (let c = 0; c < channels; c++) {
    for (let p = 0; p < programsPerChannel; p++) {
      const start = new Date(now.getTime() + p * 3600000);
      const stop = new Date(start.getTime() + 3600000);
      const fmt = (d: Date) =>
        d.toISOString().replace(/[-T:]/g, '').slice(0, 14) + ' +0000';
      xml += `  <programme start="${fmt(start)}" stop="${fmt(stop)}" channel="ch${c}.test">`;
      xml += `<title>Show ${p}</title></programme>\n`;
    }
  }
  xml += '</tv>';
  return xml;
}
```

#### 5. Gitignore — adicionar entradas

**File**: `.gitignore`

```
# Test coverage
packages/backend/coverage/
packages/backend/.vitest-cache/
```

### Documentation Updates for This Phase

- [ ] `packages/backend/package.json` — scripts e devDependencies adicionados

### Commit for This Phase

**Message**: `test: add Vitest infrastructure, coverage config, and test helpers`

**Why commit here**: O runner está configurado e funcionando. Phases seguintes adicionam testes reais; poder reverter apenas a infra é útil se houver conflito de build.

### Success Criteria

#### Automated Verification

- [ ] `pnpm --filter backend install` instala sem erros
- [ ] `pnpm --filter backend test` executa e reporta "0 tests" sem crash
- [ ] `pnpm --filter backend test:coverage` gera `packages/backend/coverage/`

#### Manual Verification

- [ ] `vitest.config.ts` presente em `packages/backend/`
- [ ] `tests/helpers/` contém os 2 helpers

---

## Phase 2: Unit Tests — Funções Puras

### Overview

Cobrir todas as funções sem I/O externo. São as mais rápidas de rodar e fornecem a base de confiança para as fases seguintes. Sem mocks de módulo complexos — apenas input/output direto.

### Motivation for this phase

Funções puras testadas isoladamente garantem que bugs introduzidos em refatorações sejam detectados imediatamente, antes de chegarem nas camadas de integração.

### Changes Required

#### 1. `tests/unit/lruCache.test.ts`

**File**: `packages/backend/tests/unit/lruCache.test.ts` _(novo)_

Cenários a cobrir:

```typescript
describe('LRUCache', () => {
  // get/set básico
  it('returns undefined for missing key')
  it('returns stored value')
  it('returns undefined after TTL expires')
  it('does NOT evict before TTL expires')

  // LRU eviction
  it('evicts oldest entry when max is exceeded')
  it('promotes accessed key to most-recent position')
  it('evicts the correct key after promotion')

  // Edge cases
  it('handles max=1 correctly')
  it('has() promotes key like get()')
  it('delete() removes a key')
  it('clear() empties the cache')

  // TTL com clock fake
  it('expires entries using fake timers')
})
```

Usar `vi.useFakeTimers()` e `vi.advanceTimersByTime()` para os testes de TTL.

#### 2. `tests/unit/cryptoConfig.test.ts`

**File**: `packages/backend/tests/unit/cryptoConfig.test.ts` _(novo)_

```typescript
describe('cryptoConfig', () => {
  describe('encryptConfig / decryptConfig', () => {
    it('round-trips a JSON string when CONFIG_SECRET is set')
    it('different calls produce different ciphertexts (random IV)')
    it('returns null from encryptConfig when no CONFIG_SECRET')
    it('throws when decryptConfig receives enc: token without CONFIG_SECRET')
    it('throws when ciphertext is tampered (auth tag failure)')
  })

  describe('tryParseConfigToken', () => {
    it('parses plain base64url token')
    it('parses base64url with URL-safe chars (- and _)')
    it('decrypts enc: token when CONFIG_SECRET matches')
    it('throws on malformed base64')
    it('throws on valid base64 but invalid JSON')
    it('throws on enc: token with wrong key')
  })

  describe('base64url edge cases', () => {
    it('handles padding remainder 0, 1, 2')
  })
})
```

Estratégia de mock: `vi.mock('../../src/config/env', () => ({ default: { CONFIG_SECRET: 'test-secret-32-chars-long!!' } }))` nos testes que precisam de criptografia ativa.

#### 3. `tests/unit/ssrf.test.ts`

**File**: `packages/backend/tests/unit/ssrf.test.ts` _(novo)_

```typescript
describe('isPrivateIp', () => {
  // Devem ser bloqueados
  it.each(['127.0.0.1', '::1', '0.0.0.0',
           '10.0.0.1', '10.255.255.255',
           '192.168.0.1', '192.168.255.255',
           '172.16.0.1', '172.31.255.255',
           '169.254.1.1'])(
    'blocks private IP %s', (ip) => expect(isPrivateIp(ip)).toBe(true)
  )

  // Devem passar
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.0.1'])(
    'allows public IP %s', (ip) => expect(isPrivateIp(ip)).toBe(false)
  )

  // ALLOW_LOCAL_URLS bypass
  it('returns false for all IPs when ALLOW_LOCAL_URLS=true')
})
```

#### 4. `tests/unit/manifest.test.ts`

**File**: `packages/backend/tests/unit/manifest.test.ts` _(novo)_

```typescript
describe('createManifest', () => {
  it('returns required Stremio manifest fields (id, name, version, resources, types)')
  it('without idPrefix uses bare channel ID prefixes')
  it('with idPrefix appends prefix to all three channel prefixes')
  it('includes logo/background from env when set')
  it('omits logo/background when env vars are empty')
  it('catalogs array has at least one entry')
})
```

#### 5. `tests/unit/m3uParser.test.ts`

**File**: `packages/backend/tests/unit/m3uParser.test.ts` _(novo)_

```typescript
describe('parseM3U', () => {
  it('returns empty array for empty string')
  it('returns empty array for non-M3U content')
  it('parses basic channel with name and URL')
  it('extracts tvg-id, tvg-name, tvg-logo, group-title')
  it('extracts x-tvg-url from EXTM3U header')
  it('deduplicates channels with same tvg-id')
  it('falls back to URL hash as ID when tvg-id absent')
  it('handles CRLF line endings')
  it('skips #EXTINF lines without a following URL')
  it('parses user-agent and referrer attributes')
  it('handles quoted and unquoted attribute values')
  it('handles 10,000 channels without error')
})
```

#### 6. `tests/unit/epgParser.test.ts`

**File**: `packages/backend/tests/unit/epgParser.test.ts` _(novo)_

```typescript
describe('parseEPG', () => {
  it('parses valid XMLTV and returns structured epgData map')
  it('returns empty object on invalid XML')
  it('returns empty object on empty string')
  it('handles multiple channels and programs')
})

describe('parseEPGTime', () => {
  it('parses YYYYMMDDHHmmss +0000 format')
  it('parses YYYYMMDDHHmmss +0300 with offset')
  it('applies epgOffsetHours correctly')
  it('returns NaN for completely invalid string')
})

describe('getCurrentProgram', () => {
  it('returns current program for known channel at given time')
  it('returns null when no program active at given time')
  it('returns null for unknown channel')
})

describe('getUpcomingPrograms', () => {
  it('returns N upcoming programs in order')
  it('returns empty array when no future programs')
  it('respects the limit parameter')
})
```

#### 7. `tests/unit/sqliteCache.test.ts`

**File**: `packages/backend/tests/unit/sqliteCache.test.ts` _(novo)_

```typescript
describe('sqliteCache', () => {
  // Usar init(null) para in-memory em todos os testes de unit
  beforeEach(() => init(null))
  afterEach(() => close())

  describe('set / get', () => {
    it('stores and retrieves a value')
    it('returns null for missing key')
    it('returns null after TTL expires')
    it('compresses with gzip and decompresses transparently')
  })

  describe('setRaw / getRaw', () => {
    it('stores and retrieves raw JSON without compression')
    it('returns null after TTL expires')
  })

  describe('del', () => {
    it('removes an existing key')
    it('is a no-op for missing key')
  })

  describe('cleanExpired', () => {
    it('deletes expired entries and returns count')
    it('does not delete entries within TTL')
  })

  describe('fallback to in-memory', () => {
    it('init(null) returns a working in-memory database')
  })
})
```

#### 8. `tests/unit/m3uEpgAddon.pures.test.ts`

**File**: `packages/backend/tests/unit/m3uEpgAddon.pures.test.ts` _(novo)_

```typescript
describe('createCacheKey', () => {
  it('produces the same key for configs with different key order')
  it('produces different keys for different providers')
  it('strips non-essential fields (e.g., name, description)')
})

describe('generateMetaPreview', () => {
  it('maps channel to Stremio meta preview shape')
  it('includes id, type=tv, name, poster')
})

describe('deriveFallbackLogoUrl', () => {
  it('returns original URL for standard image')
  it('proxies imgur URLs through wsrv.nl when reformatLogos=true')
})
```

### Documentation Updates for This Phase

- [ ] `CLAUDE.md` — Adicionar seção "Testing" com `pnpm --filter backend test`

### Commit for This Phase

**Message**: `test: add unit tests for pure functions (lruCache, cryptoConfig, parsers, ssrf, manifest)`

**Why commit here**: Os testes unitários não dependem de nada externo. Estável para commit e fornece a base de confiança para as próximas fases.

### Success Criteria

#### Automated Verification

- [ ] `pnpm --filter backend test` passa — todos os unit tests verdes
- [ ] `pnpm --filter backend test:coverage` reporta >70% lines/functions

#### Manual Verification

- [ ] Nenhum teste usa `fetch`, `fs`, ou `better-sqlite3` real (exceto sqliteCache com `:memory:`)
- [ ] Sem `setTimeout` reais nos testes (usar `vi.useFakeTimers()`)

---

## Phase 3: Integration Tests — Rotas Express

### Overview

Testar as rotas Express com Supertest, montando a app real mas mockando `createAddon` (builder) e `sqliteCache` para evitar I/O externo.

### Motivation for this phase

As rotas têm lógica crítica: parsing de token, middleware de rate limit, resposta de erro, CORS headers. Testá-las em isolamento valida o pipeline HTTP sem depender de providers reais.

### Changes Required

#### 1. Helper: app de teste — `packages/backend/tests/helpers/testApp.ts`

**File**: `packages/backend/tests/helpers/testApp.ts` _(novo)_

```typescript
import express from 'express';
import compression from 'compression';
import { globalIpLimiter } from '../../src/middleware/rateLimiter';
import apiRouter from '../../src/routes/api';
import stremioRouter from '../../src/routes/stremio';

export function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '512kb' }));
  app.use(compression());
  app.use(globalIpLimiter);
  app.use(apiRouter);
  app.use(stremioRouter);
  return app;
}
```

#### 2. `tests/integration/api.test.ts`

**File**: `packages/backend/tests/integration/api.test.ts` _(novo)_

```typescript
describe('POST /encrypt', () => {
  it('returns 400 when CONFIG_SECRET not set')
  it('returns token when CONFIG_SECRET is set and body is valid JSON')
  it('returns 400 for malformed body')
})

describe('GET /api/capabilities', () => {
  it('returns encryptionEnabled: false when no CONFIG_SECRET')
  it('returns encryptionEnabled: true when CONFIG_SECRET set')
})

describe('GET /api/addon-info', () => {
  it('returns name, description, logoUrl')
  it('sets Cache-Control: no-store')
})

describe('GET /api/public-playlists', () => {
  it('returns [] when file not found')
  it('returns [] for non-array JSON')
})

describe('POST /api/prefetch', () => {
  it('returns 403 when PREFETCH_ENABLED=false')
  it('returns 400 for missing url')
  it('returns 400 for non-http URL (file://, ftp://)')
  it('returns 400 for RFC 1918 IP in URL')
  it('returns 400 for localhost URL')
})
```

#### 3. `tests/integration/stremio.test.ts`

**File**: `packages/backend/tests/integration/stremio.test.ts` _(novo)_

```typescript
// vi.mock('../../src/addon/builder') para evitar fetch real
describe('/:token/manifest.json', () => {
  it('returns 400 for invalid base64 token')
  it('returns 400 for static prefix token (css, js, logo...)')
  it('returns 200 and manifest JSON for valid base64url token')
  it('returns 200 with configureUrl set in behaviorHints')
  it('sets Access-Control-Allow-Origin: *')
  it('sets Cache-Control: no-store')
})

describe('/:token routes — error paths', () => {
  it('returns 500 when addon build throws')
  it('returns 400 when enc: token used without CONFIG_SECRET')
})
```

#### 4. `tests/integration/prefetch.test.ts`

**File**: `packages/backend/tests/integration/prefetch.test.ts` _(novo)_

Testa SSRF via HTTP real com `vi.spyOn(global, 'fetch')` mockado:

```typescript
describe('SSRF protection in /api/prefetch', () => {
  it('blocks 10.0.0.1')
  it('blocks 192.168.1.1')
  it('blocks 172.16.0.1 through 172.31.255.255')
  it('blocks 127.0.0.1')
  it('blocks 169.254.0.0/16')
  it('blocks URL that DNS-resolves to private IP')
  it('allows public IP after DNS validation')
})
```

### Documentation Updates for This Phase

- [ ] Nenhuma documentação adicional necessária nesta fase

### Commit for This Phase

**Message**: `test: add integration tests for Express routes (api, stremio, prefetch)`

**Why commit here**: Cobertura de integração completa das rotas. Próxima fase modifica código fonte — ter testes de integração verde antes é a rede de segurança.

### Success Criteria

#### Automated Verification

- [ ] `pnpm --filter backend test` — todos os testes de integração passam
- [ ] Nenhum teste faz fetch HTTP real (todos mockados)

#### Manual Verification

- [ ] Testes de token inválido retornam 400, não 500
- [ ] Headers CORS presentes nas respostas de manifest

---

## Phase 4: Security Tests + Fixes

### Overview

Para cada vulnerabilidade identificada: escrever o teste que **demonstra** o problema, corrigir o código, validar que o teste passa. Ordem: ReDoS → SSRF nos providers → Header injection → Memory exhaustion → Token logging.

### Motivation for this phase

Vulnerabilidades sem teste podem ser reintroduzidas em qualquer PR. A sequência "teste que falha → fix → teste que passa" cria evidência auditável de que o problema foi resolvido.

### Changes Required

---

#### Vulnerabilidade 1: ReDoS em `m3uParser.ts`

**Problema**: `extractAttr` em `m3uParser.ts:15,18` compila regex dinamicamente por chamada, sem pre-compilação e sem limite de tamanho de linha. Um atacante que controle o conteúdo de uma playlist pode causar backtracking catastrófico.

**Teste**: `packages/backend/tests/security/redos.test.ts`

```typescript
describe('ReDoS protection in m3uParser', () => {
  it('completes parseM3U with 4096-char attr value in <100ms', () => {
    const evil = 'a'.repeat(4096);
    const m3u = `#EXTM3U\n#EXTINF:-1 tvg-id="${evil}",Test\nhttp://x.com\n`;
    const start = Date.now();
    parseM3U(m3u);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it('truncates or ignores lines longer than MAX_LINE_LENGTH', () => {
    const longLine = '#EXTINF:-1 ' + 'x='.repeat(500) + ',Name';
    const m3u = `#EXTM3U\n${longLine}\nhttp://x.com\n`;
    expect(() => parseM3U(m3u)).not.toThrow();
  });
})
```

**Fix**: `packages/backend/src/parsers/m3uParser.ts`

1. Pre-compilar regexes para os atributos conhecidos no topo do módulo (evita compilação por chamada):

```typescript
const MAX_LINE_LENGTH = 4096;

const KNOWN_ATTR_NAMES = [
  'tvg-id', 'tvg-name', 'tvg-logo', 'tvg-country', 'tvg-language',
  'tvg-type', 'group-title', 'user-agent', 'referrer',
  'catchup', 'catchup-days', 'catchup-source', 'x-tvg-url',
];

// Pre-compilado: { 'tvg-id': [regexQuoted, regexUnquoted], ... }
const ATTR_REGEX_MAP: Record<string, [RegExp, RegExp]> = {};
for (const attr of KNOWN_ATTR_NAMES) {
  const escaped = escapeRegExp(attr);
  ATTR_REGEX_MAP[attr] = [
    new RegExp(`${escaped}="([^"]{0,2048})"`, 'i'),
    new RegExp(`${escaped}=([^\\s,]{0,2048})`, 'i'),
  ];
}
```

2. No início do loop de parsing, pular linhas muito longas:

```typescript
if (line.length > MAX_LINE_LENGTH) continue;
```

3. Atualizar `extractAttr` para usar o mapa pre-compilado quando o atributo for conhecido:

```typescript
function extractAttr(line: string, attr: string): string | null {
  const regs = ATTR_REGEX_MAP[attr.toLowerCase()];
  if (regs) {
    const m = regs[0].exec(line) || regs[1].exec(line);
    return m ? m[1] : null;
  }
  // fallback dinâmico para atributos desconhecidos (compatibilidade)
  const escaped = escapeRegExp(attr);
  const m =
    new RegExp(`${escaped}="([^"]{0,2048})"`, 'i').exec(line) ||
    new RegExp(`${escaped}=([^\\s,]{0,2048})`, 'i').exec(line);
  return m ? m[1] : null;
}
```

---

#### Vulnerabilidade 2: SSRF em `m3uProvider.ts` e `xtreamProvider.ts`

**Problema**: URLs fornecidas pelo usuário (`m3uUrl`, `epgUrl`, `xtreamUrl`) são buscadas sem validação de hostname. Um atacante pode usar tokens válidos para fazer o servidor buscar recursos em redes internas (AWS metadata, Redis, banco interno).

**Nota**: A rota `/api/prefetch` **já tem** proteção SSRF (DNS resolution + `isPrivateIp`). A mesma lógica precisa ser aplicada nos providers.

**Teste**: `packages/backend/tests/security/ssrf.test.ts`

```typescript
describe('SSRF protection in providers', () => {
  describe('m3uProvider', () => {
    it('throws when m3uUrl resolves to private IP')
    it('throws when epgUrl resolves to private IP')
    it('throws for m3uUrl with 127.0.0.1 hostname')
    it('throws for m3uUrl with 10.x.x.x hostname')
    it('allows public m3uUrl hostname')
  })

  describe('xtreamProvider', () => {
    it('throws when xtreamUrl hostname resolves to private IP')
    it('allows public xtreamUrl hostname')
  })
})
```

**Fix**: criar `packages/backend/src/utils/validateUrl.ts`:

```typescript
import dns from 'dns';
import { isPrivateIp } from '../middleware/ssrf';

/**
 * Valida que uma URL não aponta para uma rede privada.
 * Lança erro se o hostname resolve para IP RFC 1918 ou similar.
 */
export async function validatePublicUrl(url: string): Promise<void> {
  if (!url) return;

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (!['http:', 'https:'].includes(u.protocol)) {
    throw new Error(`Only HTTP(S) URLs are allowed`);
  }

  // Hostname check direto (sem DNS) — cobre literais como 127.0.0.1
  const host = u.hostname;
  if (isPrivateIp(host)) {
    throw new Error(`Blocked host: ${host}`);
  }

  // DNS resolution — cobre hostnames que resolvem para IPs privados
  try {
    const { address } = await dns.promises.lookup(host);
    if (isPrivateIp(address)) {
      throw new Error(`Blocked host: ${host} resolves to private IP ${address}`);
    }
  } catch (e: any) {
    if (e.message?.startsWith('Blocked host')) throw e;
    throw new Error(`Cannot resolve host: ${host}`);
  }
}
```

Aplicar em `m3uProvider.ts` antes dos dois `fetch` (linhas 39 e 75):

```typescript
import { validatePublicUrl } from '../utils/validateUrl';

// Antes do fetch do M3U (linha ~39):
await validatePublicUrl(config.m3uUrl);

// Antes do fetch do EPG (linha ~75):
if (epgUrl) await validatePublicUrl(epgUrl);
```

Aplicar em `xtreamProvider.ts` antes dos fetches (linha ~28):

```typescript
import { validatePublicUrl } from '../utils/validateUrl';

await validatePublicUrl(config.xtreamUrl);
```

---

#### Vulnerabilidade 3: Header Injection via User-Agent/Referer extraídos do M3U

**Problema**: `m3uParser.ts:57-64` extrai `user-agent` e `referrer` de linhas `#EXTINF` sem sanitização. Esses valores são usados como HTTP headers em `M3UEPGAddon.getStreams()`. Um M3U malicioso pode injetar `\r\n` para criar headers HTTP extras (CRLF injection).

**Teste**: `packages/backend/tests/security/headerInjection.test.ts`

```typescript
describe('Header injection protection in m3uParser', () => {
  it('strips CR and LF from extracted user-agent', () => {
    const m3u = `#EXTM3U\n#EXTINF:-1 user-agent="VLC\\r\\nX-Injected: evil",Test\nhttp://x.com\n`;
    const channels = parseM3U(m3u);
    expect(channels[0].userAgent).not.toContain('\r');
    expect(channels[0].userAgent).not.toContain('\n');
  });

  it('strips null bytes from extracted referrer', () => {
    const m3u = `#EXTM3U\n#EXTINF:-1 referrer="http://x.com\\x00evil",Test\nhttp://x.com\n`;
    const channels = parseM3U(m3u);
    expect(channels[0].referrer).not.toContain('\x00');
  });

  it('truncates values longer than 512 chars', () => {
    const long = 'a'.repeat(1000);
    const m3u = `#EXTM3U\n#EXTINF:-1 user-agent="${long}",Test\nhttp://x.com\n`;
    const channels = parseM3U(m3u);
    expect(channels[0].userAgent!.length).toBeLessThanOrEqual(512);
  });
})
```

**Fix**: adicionar função de sanitização em `m3uParser.ts`:

```typescript
function sanitizeHeaderValue(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.replace(/[\r\n\0\x0b\x0c]/g, '').slice(0, 512);
}
```

Aplicar ao extrair `user-agent` e `referrer`:

```typescript
channel.userAgent = sanitizeHeaderValue(extractAttr(extinfLine, 'user-agent'));
channel.referrer  = sanitizeHeaderValue(extractAttr(extinfLine, 'referrer'));
```

---

#### Vulnerabilidade 4: Memory Exhaustion no EPG Parser

**Problema**: `epgParser.ts:16` passa o conteúdo inteiro do XMLTV para `xml2js.parseStringPromise()` sem verificar tamanho. Um arquivo XMLTV de 1GB pode esgotar a memória do servidor.

**Teste**: `packages/backend/tests/security/memoryLimits.test.ts`

```typescript
describe('EPG size limits', () => {
  it('throws or returns empty when XMLTV content exceeds 100MB', async () => {
    // Simula string de 101MB
    const oversized = '<tv>' + 'x'.repeat(101 * 1024 * 1024) + '</tv>';
    const result = await parseEPG(oversized, console);
    // Deve retornar {} sem crash (ou lançar erro controlado)
    expect(result).toEqual({});
  });
})
```

**Fix**: adicionar verificação no início de `parseEPG` em `epgParser.ts`:

```typescript
const MAX_EPG_BYTES = 100 * 1024 * 1024; // 100 MB

export async function parseEPG(content: string, log: any): Promise<EpgData> {
  if (Buffer.byteLength(content, 'utf8') > MAX_EPG_BYTES) {
    log.warn(`[EPG] Content too large (${(Buffer.byteLength(content) / 1024 / 1024).toFixed(1)} MB), skipping`);
    return {};
  }
  // ... resto da função
```

---

#### Vulnerabilidade 5: Token Leak em Logs

**Problema**: `stremio.ts:42` loga o token bruto quando o parsing falha:

```typescript
log.debug('Config parse failed', token, e.message);
```

Para tokens base64url, o token **é** a config em texto plano (contém credenciais). Para tokens `enc:`, expõe o ciphertext.

**Teste**: `packages/backend/tests/security/tokenLeak.test.ts`

```typescript
describe('Token leak in logs', () => {
  it('does not log the raw token on parse failure', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // ...fazer request com token inválido
    const loggedArgs = spy.mock.calls.flat().join(' ');
    expect(loggedArgs).not.toContain(invalidToken);
    spy.mockRestore();
  });
})
```

**Fix**: substituir em `stremio.ts:42`:

```typescript
// ANTES:
log.debug('Config parse failed', token, e.message);

// DEPOIS:
const tokenHash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 8);
log.debug('Config parse failed', `[token:${tokenHash}…]`, e.message);
```

---

### Documentation Updates for This Phase

- [ ] `CLAUDE.md` — Adicionar nota na tabela de arquivos-chave sobre `validateUrl.ts`
- [ ] `.env.example` — Não há novas variáveis, mas validar que `ALLOW_LOCAL_URLS` tem comentário claro sobre bypass de SSRF

### Commit for This Phase

**Message**: `fix(security): patch ReDoS, SSRF, header injection, EPG size limit, token log leak`

**Why commit here**: Cada fix é acompanhado de teste que prova o problema e a solução. Um commit atômico de segurança é mais fácil de cherry-pick para hotfix.

### Success Criteria

#### Automated Verification

- [ ] `pnpm --filter backend test` — todos os testes de segurança passam
- [ ] Os testes ReDoS terminam em <100ms
- [ ] Os testes SSRF verificam que providers rejeitam URLs privadas

#### Manual Verification

- [ ] Confirmar que `m3uParser.ts` não compila regex nova em todo `extractAttr` call para atributos conhecidos
- [ ] Confirmar que logs de falha de token mostram hash, não o token

---

## Phase 5: Performance Benchmarks

### Overview

Usar `vitest bench` para medir tempo de execução e permitir detecção de regressão. Os thresholds são definidos como comentários nos benchmarks (Vitest bench não suporta thresholds automáticos ainda); o CI falha se o tempo médio for >2× o baseline registrado.

### Motivation for this phase

Playlists M3U de 50k canais são comuns. Sem benchmark, uma mudança no parser pode triplicar o tempo de CPU ou usar 3× mais memória sem ninguém perceber.

### Changes Required

#### 1. `tests/bench/m3uParser.bench.ts`

**File**: `packages/backend/tests/bench/m3uParser.bench.ts` _(novo)_

```typescript
import { bench, describe } from 'vitest';
import { parseM3U } from '../../src/parsers/m3uParser';
import { generateLargeM3U } from '../helpers/fixtures';

const m3u_1k   = generateLargeM3U(1_000);
const m3u_10k  = generateLargeM3U(10_000);
const m3u_50k  = generateLargeM3U(50_000);

describe('parseM3U performance', () => {
  bench('1k channels',  () => parseM3U(m3u_1k));
  bench('10k channels', () => parseM3U(m3u_10k));
  bench('50k channels', () => parseM3U(m3u_50k));
});
```

**Baseline esperado** (a ser medido na primeira execução e documentado):
- 1k: <20ms
- 10k: <150ms
- 50k: <800ms

Para monitorar memória, adicionar um teste de memória separado (não bench):

```typescript
it('parseM3U with 50k channels does not exceed 200MB heap increase', () => {
  const before = process.memoryUsage().heapUsed;
  parseM3U(m3u_50k);
  const after = process.memoryUsage().heapUsed;
  const deltaMB = (after - before) / 1024 / 1024;
  expect(deltaMB).toBeLessThan(200);
});
```

#### 2. `tests/bench/epgParser.bench.ts`

**File**: `packages/backend/tests/bench/epgParser.bench.ts` _(novo)_

```typescript
import { bench, describe, it, expect } from 'vitest';
import { parseEPG } from '../../src/parsers/epgParser';
import { generateLargeXMLTV } from '../helpers/fixtures';

const xml_small  = generateLargeXMLTV(10, 50);   // ~500 programs
const xml_medium = generateLargeXMLTV(100, 100);  // ~10k programs
const xml_large  = generateLargeXMLTV(500, 200);  // ~100k programs

describe('parseEPG performance', () => {
  bench('500 programs',  async () => { await parseEPG(xml_small,  console); });
  bench('10k programs',  async () => { await parseEPG(xml_medium, console); });
  bench('100k programs', async () => { await parseEPG(xml_large,  console); });
});

// Teste de memória
it('parseEPG with 100k programs does not exceed 500MB heap increase', async () => {
  const before = process.memoryUsage().heapUsed;
  await parseEPG(xml_large, console);
  const after = process.memoryUsage().heapUsed;
  const deltaMB = (after - before) / 1024 / 1024;
  expect(deltaMB).toBeLessThan(500);
});
```

#### 3. `tests/bench/lruCache.bench.ts`

**File**: `packages/backend/tests/bench/lruCache.bench.ts` _(novo)_

```typescript
import { bench, describe } from 'vitest';
import LRUCache from '../../src/utils/lruCache';

describe('LRUCache performance', () => {
  bench('10k sequential set+get', () => {
    const cache = new LRUCache({ max: 1000, ttl: 60000 });
    for (let i = 0; i < 10_000; i++) {
      cache.set(`key${i}`, i);
      cache.get(`key${i % 500}`);
    }
  });

  bench('LRU eviction under max', () => {
    const cache = new LRUCache({ max: 100, ttl: 60000 });
    for (let i = 0; i < 10_000; i++) {
      cache.set(`key${i}`, i);
    }
  });
});
```

#### 4. `tests/bench/sqliteCache.bench.ts`

**File**: `packages/backend/tests/bench/sqliteCache.bench.ts` _(novo)_

```typescript
import { bench, describe, beforeAll, afterAll } from 'vitest';
import { init, set, get, close } from '../../src/utils/sqliteCache';

beforeAll(() => init(null)); // in-memory
afterAll(() => close());

describe('sqliteCache performance', () => {
  bench('1k set (compressed)', () => {
    for (let i = 0; i < 1000; i++) {
      set(`key:${i}`, { data: 'x'.repeat(1000), i }, 60000);
    }
  });

  bench('1k get', () => {
    for (let i = 0; i < 1000; i++) {
      get(`key:${i}`);
    }
  });
});
```

#### 5. Atualizar `vitest.config.ts` para incluir bench

**File**: `packages/backend/vitest.config.ts`

Adicionar `bench` include:

```typescript
benchmark: {
  include: ['tests/**/*.bench.ts'],
  outputFile: './bench-results.json',
},
```

### Documentation Updates for This Phase

- [ ] `CLAUDE.md` — Documentar thresholds baseline após primeira execução bem-sucedida

### Commit for This Phase

**Message**: `test: add performance benchmarks for m3uParser, epgParser, lruCache, sqliteCache`

**Why commit here**: Benchmarks são independentes dos testes de segurança e correm no job separado no CI.

### Success Criteria

#### Automated Verification

- [ ] `pnpm --filter backend test:bench` executa sem erro
- [ ] Testes de memória (`it(...)` com `process.memoryUsage()`) passam dentro dos limites definidos

#### Manual Verification

- [ ] Registrar os tempos médios da primeira execução nos comentários do arquivo bench como baseline
- [ ] Verificar manualmente que 50k channels não satura CPU (>80%) por mais de 2s

---

## Phase 6: GitHub Actions CI

### Overview

Pipeline que roda em todo push e PR para `main` e `refactor/*`. Dois jobs: `test` (unit + integration + security, com cobertura) e `bench` (benchmarks, com artifact de resultados).

### Motivation for this phase

Sem CI, os testes existem mas não são executados automaticamente. O pipeline transforma os testes em gate de qualidade real.

### Changes Required

#### 1. `.github/workflows/test.yml` _(novo)_

**File**: `.github/workflows/test.yml`

```yaml
name: Test

on:
  push:
    branches: [main, 'refactor/**']
  pull_request:
    branches: [main, 'refactor/**']

jobs:
  test:
    name: Unit + Integration + Security
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Type check
        run: pnpm --filter backend build:check

      - name: Run tests with coverage
        run: pnpm --filter backend test:coverage

      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-report
          path: packages/backend/coverage/
          retention-days: 14

  bench:
    name: Performance Benchmarks
    runs-on: ubuntu-latest
    # Roda apenas em push para main (não em PRs para evitar custo de tempo)
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run benchmarks
        run: pnpm --filter backend test:bench

      - name: Upload bench results
        uses: actions/upload-artifact@v4
        with:
          name: bench-results
          path: packages/backend/bench-results.json
          retention-days: 30
```

#### 2. Atualizar `vitest.config.ts` — separar bench do test:coverage

O job `test:coverage` usa `vitest run --coverage`, que inclui apenas `tests/**/*.test.ts`. Os arquivos `*.bench.ts` ficam excluídos do coverage por estarem no pattern de `benchmark.include`, não de `test.include`. Confirmar que `vitest.config.ts` já está separando corretamente (Phase 5).

### Documentation Updates for This Phase

- [ ] `README.md` — Adicionar badge de status do CI (após primeiro push bem-sucedido):
  ```markdown
  ![Tests](https://github.com/<owner>/<repo>/actions/workflows/test.yml/badge.svg)
  ```
- [ ] `CLAUDE.md` — Adicionar referência ao workflow de CI na seção de comandos

### Commit for This Phase

**Message**: `ci: add GitHub Actions workflow for test and bench jobs`

**Why commit here**: CI independente dos arquivos de teste. Pode ser commitado e ativado antes mesmo de todos os testes estarem escritos.

### Success Criteria

#### Automated Verification

- [ ] Push para `refactor/monorepo` dispara o workflow
- [ ] Job `test` passa (verde) com coverage report como artifact
- [ ] Job `bench` roda apenas em push para `main`

#### Manual Verification

- [ ] Verificar na aba Actions do GitHub que ambos os jobs aparecem e passam
- [ ] Download do artifact `coverage-report` e verificar HTML gerado

---

## Testing Strategy (Resumo)

### Manual Testing Steps

1. `pnpm --filter backend install` — verificar que novas devDependencies instalam
2. `pnpm --filter backend test` — todos os testes passam localmente
3. `pnpm --filter backend test:coverage` — cobertura ≥70% em linhas/funções
4. `pnpm --filter backend test:bench` — benchmarks executam e resultados aparecem no terminal
5. Push para branch de feature — confirmar que Actions dispara e passa

### Edge Cases to Verify

- Token com credenciais em texto plano (base64url) — não aparece em logs
- M3U com linha de 5000 chars — não trava o processo
- XMLTV de 150MB — rejeitado com log de warning, não crash
- URL `http://192.168.1.1/playlist.m3u` no token — provider rejeita com erro claro
- 50k canais na mesma playlist — parsing em <1s na máquina de CI

---

## Performance Considerations

- Os benchmarks rodam em processo único Node.js; `process.memoryUsage()` mede heap do processo inteiro, não apenas do teste
- SQLite in-memory (`:memory:`) usado nos testes é significativamente mais rápido que disco; os benchmarks refletem isso — é esperado
- `vitest bench` usa múltiplas iterações e reporta ops/sec; os comentários de "baseline esperado" são para orientação, não para quebrar CI automaticamente

## Migration Notes

- As correções de segurança (Phase 4) são **breaking changes de comportamento** para usuários que usavam URLs RFC 1918 intencionalmente (ex: IPTV server local). O flag `ALLOW_LOCAL_URLS=true` no `.env` faz bypass de todas as verificações SSRF — documentar isso claramente
- A pre-compilação de regexes no m3uParser mantém API pública idêntica; sem breaking change

## Rollback Plan

Cada fase tem commit próprio. Para reverter:
- **Phase 6 only** (CI com falso positivo): `git revert <commit-sha-phase6>`
- **Phase 4 fixes** (se fix de SSRF quebrou provider legítimo): `git revert <commit-sha-phase4>` e re-avaliar com `ALLOW_LOCAL_URLS=true`
- **Phase 1–3** (infra + unit tests): reversão limpa, zero impacto em produção

## References

- Análise de código realizada em: 2026-03-19
- ReDoS reference: OWASP ReDoS — https://owasp.org/www-community/attacks/ReDoS
- SSRF reference: `packages/backend/src/routes/prefetch.ts` — implementação de referência já existente no projeto
- Vitest bench docs: https://vitest.dev/guide/features.html#benchmarking
- Vulnerabilidades confirmadas via análise estática dos arquivos listados acima
