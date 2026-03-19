export function usePrefetch() {
  async function prefetch(url: string, purpose: string): Promise<{ ok: boolean; content: string; bytes: number; truncated: boolean }> {
    const res = await fetch('/api/prefetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, purpose })
    })
    const payload = await res.json()
    if (!res.ok) {
      const msg = payload.error || `HTTP ${res.status}`
      const detail = payload.detail ? ` (${payload.detail})` : ''
      throw new Error(`Server prefetch failed ${res.status} - ${msg}${detail}`)
    }
    return payload
  }

  return { prefetch }
}
