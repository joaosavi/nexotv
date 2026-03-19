import { ref, onMounted } from 'vue'
import type { PublicPlaylist } from '../types/config'

export function usePublicPlaylists() {
  const playlists = ref<PublicPlaylist[]>([])

  onMounted(async () => {
    try {
      const data = await fetch('/api/public-playlists').then(r => r.json())
      if (Array.isArray(data)) playlists.value = data
    } catch {}
  })

  return { playlists }
}
