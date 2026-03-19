<template>
  <div v-if="visible" class="overlay">
    <div class="overlay-box">
      <header class="overlay-header">
        <h2>{{ message }}</h2>
        <p class="overlay-sub">{{ Math.round(progress) }}%</p>
      </header>
      <div class="progress-track">
        <div class="progress-fill" :style="{ width: Math.min(100, progress) + '%' }"></div>
      </div>
      <pre class="status-log" ref="logRef">{{ details }}</pre>
      <div class="overlay-actions">
        <template v-if="isReady">
          <button v-if="manifestUrl" class="btn success" @click="openStremio">Open in Stremio</button>
          <button v-if="manifestUrl" class="btn secondary" @click="copyManifest">{{ copyLabel }}</button>
          <button class="btn ghost" @click="$emit('close')">Close</button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  progress: number
  message: string
  details: string
  manifestUrl: string
  stremioUrl: string
  isReady: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const copyLabel = ref('Copy URL')
const logRef = ref<HTMLPreElement>()

// Auto-scroll log to bottom when details change
watch(() => props.details, () => {
  if (logRef.value) {
    logRef.value.scrollTop = logRef.value.scrollHeight
  }
})

function copyManifest() {
  if (!props.manifestUrl) return
  navigator.clipboard.writeText(props.manifestUrl)
    .then(() => {
      copyLabel.value = 'Copied!'
      setTimeout(() => { copyLabel.value = 'Copy URL' }, 1600)
    })
    .catch(() => {
      copyLabel.value = 'Copy Failed'
      setTimeout(() => { copyLabel.value = 'Copy URL' }, 1600)
    })
}

function openStremio() {
  if (props.stremioUrl) window.location.href = props.stremioUrl
}
</script>
