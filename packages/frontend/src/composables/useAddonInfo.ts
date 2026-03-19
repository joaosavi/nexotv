import { ref, onMounted } from 'vue'
import type { AddonInfo } from '../types/config'

export function useAddonInfo() {
  const info = ref<AddonInfo | null>(null)
  const loading = ref(true)

  onMounted(async () => {
    try {
      const [infoData, capsData] = await Promise.all([
        fetch(`/api/addon-info?_t=${Date.now()}`).then(r => r.json()),
        fetch('/api/capabilities').then(r => r.json()).catch(() => ({ encryptionEnabled: false }))
      ])
      info.value = {
        name: infoData.name || 'NexoTV',
        description: infoData.description || '',
        logoUrl: infoData.logoUrl || '',
        encryptionEnabled: capsData.encryptionEnabled ?? false
      }
    } catch {
      info.value = { name: 'NexoTV', description: '', logoUrl: '', encryptionEnabled: false }
    } finally {
      loading.value = false
    }
  })

  return { info, loading }
}
