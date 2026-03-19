<template>
  <div class="app-container">
    <TheHeader />

    <main class="main-content">
      <section class="config-section">
        <div class="card configurator-card">
          <h2>Provider</h2>

          <!-- Provider Tabs -->
          <div class="provider-tabs" role="tablist">
            <button class="tab-btn" :class="{ active: activeTab === 'iptv-org' }"
              id="tab-iptv-org" role="tab"
              :aria-selected="activeTab === 'iptv-org'"
              aria-controls="panel-iptv-org"
              @click="activeTab = 'iptv-org'">
              IPTV-org <span class="tab-badge">Free</span>
            </button>
            <button class="tab-btn" :class="{ active: activeTab === 'xtream' }"
              id="tab-xtream" role="tab"
              :aria-selected="activeTab === 'xtream'"
              aria-controls="panel-xtream"
              @click="activeTab = 'xtream'">
              Xtream API
            </button>
            <button class="tab-btn" :class="{ active: activeTab === 'm3u' }"
              id="tab-m3u" role="tab"
              :aria-selected="activeTab === 'm3u'"
              aria-controls="panel-m3u"
              @click="activeTab = 'm3u'">
              M3U / M3U+
            </button>
          </div>

          <!-- Tab Panels -->
          <div id="panel-iptv-org" class="tab-panel" :class="{ active: activeTab === 'iptv-org' }"
            role="tabpanel" aria-labelledby="tab-iptv-org">
            <IptvOrgConfig v-if="activeTab === 'iptv-org'" />
          </div>

          <div id="panel-xtream" class="tab-panel" :class="{ active: activeTab === 'xtream' }"
            role="tabpanel" aria-labelledby="tab-xtream">
            <XtreamConfig v-if="activeTab === 'xtream'" />
          </div>

          <div id="panel-m3u" class="tab-panel" :class="{ active: activeTab === 'm3u' }"
            role="tabpanel" aria-labelledby="tab-m3u">
            <M3uConfig v-if="activeTab === 'm3u'" />
          </div>
        </div>
      </section>

      <section class="about-section">
        <div class="card about-card">
          <h2>About</h2>
          <p>Connect your IPTV service to Stremio. Choose from free public channels, your Xtream Codes
            subscription, or any M3U playlist URL.</p>
          <ul class="feature-list">
            <li><strong>IPTV-org</strong> – thousands of free public channels, no credentials needed.</li>
            <li><strong>Xtream API</strong> – connects your subscription panel (live TV only).</li>
            <li><strong>M3U / M3U+</strong> – paste any playlist URL; EPG auto-detected from header.</li>
            <li><strong>EPG</strong> – panel XMLTV, custom XMLTV URL, or auto-detected.</li>
            <li><strong>EPG offset</strong> – adjusts programme times for timezone correction.</li>
          </ul>
          <div class="credits">
            <p>By <a href="https://github.com/joaosavi" target="_blank" rel="noopener">joaosavi</a></p>
            <p>Thanks to <a href="https://github.com/Inside4ndroid" target="_blank" rel="noopener">Inside4ndroid</a></p>
          </div>
        </div>
      </section>
    </main>

    <TheOverlay
      :visible="poll.visible.value"
      :progress="poll.progress.value"
      :message="poll.message.value"
      :details="poll.details.value"
      :manifestUrl="poll.manifestUrl.value"
      :stremioUrl="poll.stremioUrl.value"
      :isReady="poll.isReady.value"
      @close="poll.hideOverlay()"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, provide, onMounted } from 'vue'
import TheHeader from './components/TheHeader.vue'
import TheOverlay from './components/TheOverlay.vue'
import XtreamConfig from './components/XtreamConfig.vue'
import IptvOrgConfig from './components/IptvOrgConfig.vue'
import M3uConfig from './components/M3uConfig.vue'
import { useManifestPoll } from './composables/useManifestPoll'
import { useConfigToken } from './composables/useConfigToken'
import { useDecodedToken } from './composables/useDecodedToken'
import type { Provider } from './types/config'

const poll = useManifestPoll()
const { buildUrls } = useConfigToken(poll.appendDetail)

// Provide overlay control to all child components
provide('overlayControl', {
  showOverlay: poll.showOverlay,
  hideOverlay: poll.hideOverlay,
  appendDetail: poll.appendDetail,
  setProgress: poll.setProgress,
  startPolling: poll.startPolling,
  markError: poll.markError,
  buildUrls,
})

// Active tab state — default to iptv-org
const activeTab = ref<Provider>('iptv-org')

// Reconfiguration: switch to the correct tab based on the decoded token
onMounted(() => {
  const { decodedConfig } = useDecodedToken()
  if (decodedConfig && decodedConfig.provider) {
    activeTab.value = decodedConfig.provider as Provider
  }
})
</script>
