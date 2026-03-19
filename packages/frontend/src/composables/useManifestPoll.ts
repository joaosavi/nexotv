import { ref } from 'vue'

const POLL_INTERVAL_MS = 1500
const MAX_WAIT_MS = 90000
const PROGRESS_ESTIMATE_MS = 45000

export function useManifestPoll() {
  const visible = ref(false)
  const progress = ref(0)
  const message = ref('')
  const details = ref('')
  const isReady = ref(false)
  const manifestUrl = ref('')
  const stremioUrl = ref('')

  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let startTime = 0
  let baselinePct = 0
  let manualPhase = false

  function setProgress(pct: number, label?: string) {
    progress.value = Math.min(100, pct)
    if (label) message.value = label
  }

  function appendDetail(line: string) {
    details.value += (details.value ? '\n' : '') + line
  }

  function showOverlay(isManualPhase = false) {
    manualPhase = isManualPhase
    visible.value = true
    progress.value = 0
    message.value = 'Initializing…'
    details.value = ''
    isReady.value = false
  }

  function hideOverlay() {
    visible.value = false
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null }
  }

  function progressMessage(elapsed: number) {
    if (elapsed < 4000) return 'Contacting provider…'
    if (elapsed < 10000) return 'Loading channels…'
    if (elapsed < 18000) return 'Organizing categories…'
    if (elapsed < 26000) return 'Fetching EPG (if enabled)…'
    if (elapsed < 35000) return 'Parsing EPG data…'
    if (elapsed < 45000) return 'Finalizing manifest…'
    return 'Almost done…'
  }

  function scheduleNext(elapsed: number) {
    if (isReady.value) return
    if (elapsed > MAX_WAIT_MS) {
      message.value = 'Taking longer than expected.'
      appendDetail('Timeout waiting for manifest. You may retry or open later.')
      progress.value = 100
      isReady.value = true
      return
    }
    pollTimer = setTimeout(attemptPoll, POLL_INTERVAL_MS)
  }

  function attemptPoll() {
    if (manualPhase || isReady.value) return
    const elapsed = Date.now() - startTime
    if (progress.value < baselinePct + 95) {
      const synthetic = baselinePct + Math.min(95, (elapsed / PROGRESS_ESTIMATE_MS) * 95)
      setProgress(synthetic, progressMessage(elapsed))
    }
    // In dev, use absolute URL because Vite cannot proxy /:token/* dynamically
    const pollUrl = import.meta.env.DEV
      ? `http://localhost:7000${new URL(manifestUrl.value).pathname}?_=${Date.now()}`
      : `${manifestUrl.value}?_=${Date.now()}`
    fetch(pollUrl, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(json => {
        if (json && json.id) {
          isReady.value = true
          setProgress(100, 'Ready')
          appendDetail('Manifest ready.')
          return
        }
        scheduleNext(elapsed)
      })
      .catch(() => scheduleNext(elapsed))
  }

  function startPolling(mUrl: string, sUrl: string, startPct = 50) {
    manifestUrl.value = mUrl
    stremioUrl.value = sUrl
    baselinePct = startPct
    manualPhase = false
    startTime = Date.now()
    isReady.value = false
    attemptPoll()
  }

  function exitManualPhase() {
    manualPhase = false
  }

  // Mark overlay as done (error case) — shows Close button without URL buttons
  function markError() {
    isReady.value = true
  }

  return {
    visible, progress, message, details, isReady, manifestUrl, stremioUrl,
    setProgress, appendDetail, showOverlay, hideOverlay, startPolling, exitManualPhase, markError
  }
}
