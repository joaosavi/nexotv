<template>
  <form class="config-form" autocomplete="off">
    <fieldset>
      <legend>Playlist</legend>

      <div class="info-banner">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 16v-4M12 8h.01"></path>
        </svg>
        <span>
          Paste any <strong>M3U or M3U+</strong> playlist URL. Works with Xtream Codes
          <code>type=m3u_plus</code> links and standard M3U playlists.
          Each channel's stream URL is extracted individually.
        </span>
      </div>

      <div class="form-group">
        <label for="m3uUrl">Playlist URL <span class="req">*</span></label>
        <input type="url" id="m3uUrl" v-model="form.m3uUrl"
          placeholder="http://provider.com/get.php?username=X&password=Y&type=m3u_plus"
          autocomplete="off">
      </div>

      <div class="form-group">
        <label class="group-label">
          Public Playlists
          <span class="hint"> — third-party links, not affiliated with or endorsed by this addon.</span>
        </label>
        <div class="playlist-chips">
          <button
            v-for="pl in playlists"
            :key="pl.url"
            type="button"
            class="playlist-chip"
            :title="pl.url"
            @click="form.m3uUrl = pl.url"
          >
            <span class="chip-label">{{ pl.label }}</span>
            <span class="chip-note">{{ pl.note || '' }}</span>
          </button>
        </div>
      </div>
    </fieldset>

    <fieldset>
      <legend>EPG Options</legend>

      <div class="form-group checkbox-line">
        <input type="checkbox" id="m3uEnableEpg" v-model="form.enableEpg">
        <label class="checkbox-label" for="m3uEnableEpg">Enable EPG (program guide)</label>
      </div>

      <template v-if="form.enableEpg">
        <div class="form-group">
          <label class="group-label">EPG Source Mode</label>
          <div class="radio-group">
            <label class="checkbox-line">
              <input type="radio" name="m3uEpgMode" value="auto" v-model="form.epgMode">
              <span class="checkbox-label">Auto-detect from playlist header (<code>url-tvg</code>)</span>
            </label>
            <label class="checkbox-line">
              <input type="radio" name="m3uEpgMode" value="custom" v-model="form.epgMode">
              <span class="checkbox-label">Custom XMLTV URL</span>
            </label>
          </div>
        </div>

        <div v-if="form.epgMode === 'custom'" class="form-group">
          <label for="m3uCustomEpgUrl">Custom EPG XML URL</label>
          <input type="url" id="m3uCustomEpgUrl" v-model="form.customEpgUrl"
            placeholder="https://provider.com/epg.xml">
          <small class="hint">Used instead of the playlist's url-tvg header when selected.</small>
        </div>

        <div class="form-group">
          <label for="m3uEpgOffsetHours">EPG Offset (hours)</label>
          <input type="number" step="0.25" id="m3uEpgOffsetHours" v-model.number="form.epgOffsetHours"
            min="-48" max="48">
        </div>
      </template>

      <div class="form-group checkbox-line">
        <input type="checkbox" id="m3uReformatLogos" v-model="form.reformatLogos">
        <label class="checkbox-label" for="m3uReformatLogos">Reformat Logos
          <span class="hint">(may slow down loading)</span></label>
      </div>
    </fieldset>

    <div class="form-actions">
      <button class="btn primary" type="button" @click="handleInstall">
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
import { reactive, inject, onMounted } from 'vue'
import { usePublicPlaylists } from '../composables/usePublicPlaylists'
import { useDecodedToken } from '../composables/useDecodedToken'
import type { M3uConfig } from '../types/config'

const oc = inject<any>('overlayControl')!
const { playlists } = usePublicPlaylists()

const form = reactive({
  m3uUrl: '',
  enableEpg: false,
  epgMode: 'auto',
  customEpgUrl: '',
  epgOffsetHours: 0,
  reformatLogos: false,
})

onMounted(() => {
  const { decodedConfig } = useDecodedToken()
  if (!decodedConfig || decodedConfig.provider !== 'm3u') return
  const d = decodedConfig as M3uConfig
  form.m3uUrl = d.m3uUrl || ''
  form.enableEpg = !!d.enableEpg
  if (d.epgUrl) {
    form.epgMode = 'custom'
    form.customEpgUrl = d.epgUrl
  }
  form.epgOffsetHours = d.epgOffsetHours ?? 0
  form.reformatLogos = !!d.reformatLogos
})

async function handleInstall() {
  const m3uUrl = form.m3uUrl.trim()
  if (!m3uUrl) { alert('Please enter a playlist URL.'); return }
  try { new URL(m3uUrl) } catch {
    alert('Please enter a valid URL (must start with http:// or https://).')
    return
  }

  const enableEpg = form.enableEpg
  const customEpgUrl = form.epgMode === 'custom' ? form.customEpgUrl.trim() : ''
  const epgOffsetHours = form.epgOffsetHours || 0

  const config: M3uConfig = {
    provider: 'm3u',
    m3uUrl,
    enableEpg,
    reformatLogos: form.reformatLogos,
    ...(enableEpg && epgOffsetHours !== 0 ? { epgOffsetHours } : {}),
    ...(enableEpg && customEpgUrl ? { epgUrl: customEpgUrl } : {}),
  }

  oc.showOverlay(false)
  oc.setProgress(5, 'Building M3U addon…')

  try {
    const { manifestUrl, stremioUrl } = await oc.buildUrls(config)
    oc.startPolling(manifestUrl, stremioUrl, 10)
  } catch (e: any) {
    oc.hideOverlay()
    alert('Error generating addon URL: ' + e.message)
  }
}
</script>
