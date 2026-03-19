import type { AddonConfig } from '../types/config'

export function useDecodedToken() {
  function getDecodedToken(): AddonConfig | null {
    try {
      const parts = window.location.pathname.split('/').filter(Boolean)
      if (parts.length < 2) return null
      const lastPart = parts[parts.length - 1]
      if (!lastPart.startsWith('configure')) return null
      const token = parts[parts.length - 2]
      if (!token) return null
      // encrypted tokens (enc:...) cannot be decoded client-side
      if (token.startsWith('enc:')) return null
      let b64 = token.replace(/-/g, '+').replace(/_/g, '/')
      while (b64.length % 4) b64 += '='
      const json = decodeURIComponent(escape(atob(b64)))
      return JSON.parse(json)
    } catch {
      return null
    }
  }

  const decodedConfig = getDecodedToken()
  return { decodedConfig }
}
