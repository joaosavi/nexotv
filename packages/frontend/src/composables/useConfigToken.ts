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

    const origin = window.location.origin
    const manifestUrl = `${origin}/${token}/manifest.json`
    const hostPart = origin.replace(/^https?:\/\//, '')
    const stremioUrl = `stremio://${hostPart}/${token}/manifest.json`
    return { token, manifestUrl, stremioUrl }
  }

  return { buildUrls }
}
