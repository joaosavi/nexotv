<template>
  <form class="config-form" autocomplete="off" @submit.prevent="handleSubmit">
    <fieldset>
      <legend>Credentials</legend>
      <div class="form-group">
        <label for="xtreamUrl">Base URL <span class="req">*</span></label>
        <input type="url" id="xtreamUrl" v-model="form.xtreamUrl" required
          placeholder="http://panel.example.com:8080">
        <small class="hint">Do not include a trailing slash.</small>
      </div>
      <div class="form-group">
        <label for="xtreamUsername">Username <span class="req">*</span></label>
        <input type="text" id="xtreamUsername" v-model="form.xtreamUsername" required>
      </div>
      <div class="form-group password-group">
        <label for="xtreamPassword">Password <span class="req">*</span></label>
        <div class="pwd-wrapper">
          <input :type="showPwd ? 'text' : 'password'" id="xtreamPassword" v-model="form.xtreamPassword" required>
          <button type="button" class="btn tiny ghost" @click="showPwd = !showPwd">{{ showPwd ? 'Hide' : 'Show' }}</button>
        </div>
      </div>
    </fieldset>

    <fieldset>
      <legend>EPG Options</legend>
      <div class="form-group checkbox-line">
        <input type="checkbox" id="enableEpg" v-model="form.enableEpg">
        <label class="checkbox-label" for="enableEpg">Enable EPG</label>
      </div>

      <div v-if="form.enableEpg" class="form-group">
        <label class="group-label">EPG Source Mode</label>
        <div class="radio-group">
          <label class="checkbox-line">
            <input type="radio" name="epgMode" value="xtream" v-model="form.epgMode">
            <span class="checkbox-label">Panel XMLTV</span>
          </label>
          <label class="checkbox-line">
            <input type="radio" name="epgMode" value="custom" v-model="form.epgMode">
            <span class="checkbox-label">Custom EPG URL</span>
          </label>
        </div>
      </div>

      <div v-if="form.enableEpg && form.epgMode === 'custom'" class="form-group">
        <label for="customEpgUrl">Custom EPG XML URL</label>
        <input type="url" id="customEpgUrl" v-model="form.customEpgUrl"
          placeholder="https://example.com/epg.xml">
        <small class="hint">Used instead of panel xmltv.php when selected.</small>
      </div>

      <div class="form-group">
        <label for="epgOffsetHours">EPG Offset (hours)</label>
        <input type="number" step="0.25" id="epgOffsetHours" v-model.number="form.epgOffsetHours"
          placeholder="0">
      </div>

      <div class="form-group checkbox-line">
        <input type="checkbox" id="reformatLogos" v-model="form.reformatLogos">
        <label class="checkbox-label" for="reformatLogos">Reformat Logos
          <span class="hint">(may slow down loading)</span></label>
      </div>
    </fieldset>

    <fieldset>
      <legend>Display</legend>
      <div class="form-group">
        <label for="catalogName">Catalog Name</label>
        <input type="text" id="catalogName" v-model="form.catalogName"
          :placeholder="addonName">
        <small class="hint">Name shown in Stremio's channel list. Leave blank to use the default.</small>
      </div>
    </fieldset>

    <div class="form-actions">
      <button type="submit" class="btn primary">
        Install Addon
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14M12 5l7 7-7 7"/>
        </svg>
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { reactive, ref, inject, onMounted } from 'vue'
import { useDecodedToken } from '../composables/useDecodedToken'
import { useAddonInfo } from '../composables/useAddonInfo'
import type { XtreamConfig } from '../types/config'

const oc = inject<any>('overlayControl')!
const { info: addonInfo } = useAddonInfo()
const addonName = addonInfo.value?.name ?? 'NexoTV'

const showPwd = ref(false)
let originalPassword = ''

const form = reactive({
  xtreamUrl: '',
  xtreamUsername: '',
  xtreamPassword: '',
  enableEpg: true,
  epgMode: 'xtream',
  customEpgUrl: '',
  epgOffsetHours: 0,
  reformatLogos: false,
  catalogName: '',
})

onMounted(() => {
  const { decodedConfig } = useDecodedToken()
  if (!decodedConfig || decodedConfig.provider !== 'xtream') return
  const d = decodedConfig as XtreamConfig
  form.xtreamUrl = d.xtreamUrl || ''
  form.xtreamUsername = d.xtreamUsername || ''
  if (d.xtreamPassword) {
    form.xtreamPassword = '********'
    originalPassword = d.xtreamPassword
  }
  form.enableEpg = !!d.enableEpg
  if (d.epgUrl) {
    form.epgMode = 'custom'
    form.customEpgUrl = d.epgUrl
  }
  form.epgOffsetHours = d.epgOffsetHours ?? 0
  form.reformatLogos = !!d.reformatLogos
  form.catalogName = (decodedConfig as any).catalogName || ''
})

function validateUrl(u: string) {
  try {
    const p = new URL(u)
    return p.protocol === 'http:' || p.protocol === 'https:'
  } catch { return false }
}

function normalizeUrl(raw: string) {
  let s = raw.trim()
  if (s.endsWith('/')) s = s.slice(0, -1)
  return s
}

async function fetchTextBrowser(url: string, label: string): Promise<string> {
  if (window.location.protocol === 'https:' && /^http:\/\//i.test(url)) {
    throw new Error('Mixed content blocked (forcing server prefetch fallback)')
  }
  oc.appendDetail(`→ (Browser) Fetching ${label}: ${url}`)
  const res = await fetch(url, { method: 'GET' })
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`)
  const txt = await res.text()
  oc.appendDetail(`✔ (Browser) ${label} ${txt.length.toLocaleString()} bytes`)
  return txt
}

async function fetchTextServer(url: string, purpose: string): Promise<string> {
  oc.appendDetail(`→ (Server) Prefetch ${purpose}: ${url}`)
  const res = await fetch('/api/prefetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, purpose })
  })
  let payload: any = {}
  try { payload = await res.json() } catch {}
  if (!res.ok) {
    const msg = payload.error || `HTTP ${res.status}`
    const detail = payload.detail ? ` (${payload.detail})` : ''
    throw new Error(`Server prefetch failed ${res.status} - ${msg}${detail}`)
  }
  if (!payload.ok || !payload.content) throw new Error('Server prefetch empty content')
  oc.appendDetail(`✔ (Server) ${purpose} ${payload.bytes.toLocaleString()} bytes${payload.truncated ? ' (truncated)' : ''}`)
  if (payload.truncated) {
    throw new Error('Prefetch truncated: increase server PREFETCH_MAX_BYTES or reduce dataset')
  }
  return payload.content
}

async function robustFetch(url: string, purpose: string, browserFirst = true): Promise<string> {
  const mixed = window.location.protocol === 'https:' && /^http:\/\//i.test(url)
  if (browserFirst && !mixed) {
    try { return await fetchTextBrowser(url, purpose) } catch (e: any) {
      oc.appendDetail(`⚠ Browser fetch failed (${e.message}) → server fallback`)
    }
  }
  return await fetchTextServer(url, purpose)
}

function quickEpgStats(xml: string) {
  const prog = xml.match(/<programme\s/gi)
  const ch = xml.match(/<channel\s/gi)
  return { programmes: prog ? prog.length : 0, channels: ch ? ch.length : 0 }
}

function uuid() {
  return crypto?.randomUUID?.() ?? 'id-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

async function sha256Fragment(str: string): Promise<string> {
  try {
    const enc = new TextEncoder().encode(str)
    const digest = await crypto.subtle.digest('SHA-256', enc)
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
    return hex.slice(0, 10) + '…'
  } catch { return '(hash-unavailable)' }
}

async function handleSubmit() {
  const baseUrl = normalizeUrl(form.xtreamUrl)
  const username = form.xtreamUsername.trim()
  let password = form.xtreamPassword
  const enableEpgInitial = form.enableEpg
  const epgMode = enableEpgInitial ? form.epgMode : 'disabled'
  const customEpg = epgMode === 'custom' ? form.customEpgUrl.trim() : ''
  const epgOffset = isFinite(form.epgOffsetHours) ? form.epgOffsetHours : 0

  if (!validateUrl(baseUrl)) { alert('Invalid Xtream base URL'); return }
  if (!username || !password) { alert('Username / password required'); return }
  if (password === '********' && originalPassword) password = originalPassword
  if (epgMode === 'custom' && enableEpgInitial) {
    if (!customEpg) { alert('Custom EPG URL is empty'); return }
    if (!validateUrl(customEpg)) { alert('Invalid Custom EPG URL'); return }
  }

  oc.showOverlay(true)
  oc.setProgress(5, 'Starting')
  oc.appendDetail('== PRE-FLIGHT (XTREAM) ==')
  oc.appendDetail(`Base URL: ${baseUrl}`)
  oc.appendDetail('Mode: JSON API')
  oc.appendDetail(`EPG Mode: ${enableEpgInitial ? (epgMode === 'custom' ? 'Custom URL' : 'Panel XMLTV') : 'Disabled'}`)

  try {
    const caps = await fetch('/api/capabilities').then(r => r.json()).catch(() => ({}))
    if (!caps.encryptionEnabled) {
      oc.appendDetail('⚠ WARNING: Server has no CONFIG_SECRET set. Your Xtream password is base64-encoded (not encrypted) in the manifest URL. Do not share this link publicly.')
    }
  } catch {}

  let enableEpgFinal = enableEpgInitial
  try {
    let liveCount = 0
    const categories = new Set<string>()
    let epgStats = { programmes: 0, channels: 0 }

    const base = `${baseUrl}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`
    oc.setProgress(12, 'Fetching Live Streams')
    let liveJsonText: string
    try {
      liveJsonText = await robustFetch(`${base}&action=get_live_streams`, 'live_streams', true)
    } catch (lErr: any) {
      oc.appendDetail(`⚠ Live streams browser fetch failed: ${lErr.message}`)
      liveJsonText = await robustFetch(`${base}&action=get_live_streams`, 'live_streams', false)
    }
    let liveList: any[] = []
    try { liveList = JSON.parse(liveJsonText) } catch { throw new Error('Failed to parse live streams JSON') }
    liveCount = Array.isArray(liveList) ? liveList.length : 0
    oc.appendDetail(`✔ Live streams: ${liveCount.toLocaleString()}`)

    if (Array.isArray(liveList)) {
      for (const l of liveList) {
        const c = l.category_name || l.category || ''
        if (c) categories.add(c)
      }
    }

    if (enableEpgInitial) {
      const epgSourceUrl = epgMode === 'custom'
        ? customEpg
        : `${baseUrl}/xmltv.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`

      oc.setProgress(44, 'Fetching EPG')
      let epgTxt: string | null = null
      try {
        try {
          epgTxt = await robustFetch(epgSourceUrl, 'epg', true)
        } catch (firstEpgErr: any) {
          oc.appendDetail(`⚠ EPG browser fetch failed: ${firstEpgErr.message} → server fallback`)
          epgTxt = await robustFetch(epgSourceUrl, 'epg', false)
        }
      } catch (finalEpgErr: any) {
        oc.appendDetail(`✖ EPG fetch failed after both attempts (${finalEpgErr.message}) – continuing WITHOUT EPG`)
        enableEpgFinal = false
      }

      if (enableEpgFinal && epgTxt) {
        oc.setProgress(52, 'Scanning EPG')
        epgStats = quickEpgStats(epgTxt)
        oc.appendDetail(`✔ EPG scan: ${epgStats.programmes.toLocaleString()} programmes / ${epgStats.channels.toLocaleString()} channels`)
      }
    } else {
      oc.appendDetail('EPG disabled by user.')
    }

    oc.setProgress(60, 'Building token')
    const config: XtreamConfig = {
      provider: 'xtream',
      xtreamUrl: baseUrl,
      xtreamUsername: username,
      xtreamPassword: password,
      enableEpg: enableEpgFinal,
      reformatLogos: form.reformatLogos,
    }

    if (enableEpgFinal && epgMode === 'custom' && customEpg) config.epgUrl = customEpg
    if (isFinite(epgOffset) && epgOffset !== 0) config.epgOffsetHours = epgOffset

    config.prescan = {
      liveCount,
      categoryCount: categories.size,
      epgProgrammes: enableEpgFinal ? epgStats.programmes : 0,
      epgChannels: enableEpgFinal ? epgStats.channels : 0,
      mode: 'json',
      epgSource: enableEpgFinal ? (epgMode === 'custom' ? 'custom' : 'xtream') : 'disabled'
    }
    config.instanceId = uuid()
    if (form.catalogName.trim()) (config as any).catalogName = form.catalogName.trim()

    const passHash = await sha256Fragment(password)
    oc.appendDetail(`Password hash fragment: ${passHash}`)

    const { manifestUrl, stremioUrl } = await oc.buildUrls(config)
    oc.appendDetail('✔ Token built')
    oc.appendDetail('Manifest URL: ' + manifestUrl)
    oc.appendDetail('Stremio URL: ' + stremioUrl)

    oc.setProgress(70, 'Waiting for manifest')
    oc.appendDetail('== SERVER BUILD PHASE ==')
    oc.appendDetail('Polling server…')
    oc.startPolling(manifestUrl, stremioUrl, 70)

  } catch (err: any) {
    oc.setProgress(100, 'Pre-flight failed')
    oc.appendDetail('✖ Error: ' + (err.message || String(err)))
    oc.appendDetail('Close overlay and adjust inputs to retry.')
    oc.markError()
  }
}
</script>
