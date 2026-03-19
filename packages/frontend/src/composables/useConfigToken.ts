import type { AddonConfig } from '../types/config'

function encodeConfigBase64Url(config: AddonConfig): string {
  const json = JSON.stringify(config)
  let b64 = btoa(unescape(encodeURIComponent(json)))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function useConfigToken(appendDetail: (line: string) => void) {
  async function buildUrls(config: AddonConfig): Promise<{ token: string; manifestUrl: string; stremioUrl: string }> {
    let token = ''
    try {
      const res = await fetch('/encrypt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })
      if (res.ok) {
        const data = await res.json()
        token = data.token
        appendDetail('✔ Config securely encrypted')
      } else {
        appendDetail(`⚠ Encryption unavailable (HTTP ${res.status}). Falling back to Base64 (Not Secure).`)
        token = encodeConfigBase64Url(config)
      }
    } catch (e: any) {
      appendDetail(`⚠ Encryption error (${e.message}). Falling back to Base64.`)
      token = encodeConfigBase64Url(config)
    }

    // In dev mode the frontend runs on a different port (5173) from the backend (7000).
    // Manifest and Stremio URLs must point to the backend, not the Vite dev server.
    const backendOrigin = import.meta.env.DEV
      ? `${window.location.protocol}//${window.location.hostname}:7000`
      : window.location.origin
    const manifestUrl = `${backendOrigin}/${token}/manifest.json`
    const hostPart = backendOrigin.replace(/^https?:\/\//, '')
    const stremioUrl = `stremio://${hostPart}/${token}/manifest.json`
    return { token, manifestUrl, stremioUrl }
  }

  return { buildUrls }
}
