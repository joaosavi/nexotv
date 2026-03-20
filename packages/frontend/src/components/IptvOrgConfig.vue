<template>
  <form class="config-form" autocomplete="off" @submit.prevent="handleSubmit">
    <fieldset>
      <legend>Channel Filter</legend>

      <div class="info-banner">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M12 16v-4M12 8h.01"></path>
        </svg>
        <span>
          Uses the free <strong>iptv-org</strong> community database (~50k channels
          from 200+ countries). No credentials needed. Use the filters below to narrow down the list.
        </span>
      </div>

      <div class="form-group">
        <label>Country</label>
        <div class="searchable-select" ref="countrySelectEl">
          <div class="selected-tags">
            <span v-for="item in selectedCountries" :key="item.value" class="tag">
              {{ item.label.split(' (')[0].trim() }}
              <span class="remove-tag" @mousedown.prevent.stop="removeCountry(item.value)">×</span>
            </span>
          </div>
          <input type="text" class="searchable-select-input" v-model="countrySearch"
            placeholder="All Countries (search to filter…)" autocomplete="off"
            @focus="countryOpen = true" @blur="onCountryBlur" @input="countryOpen = true"
            @keydown="onCountryKeydown">
          <ul v-show="countryOpen" class="searchable-select-dropdown" ref="countryListEl">
            <li v-if="filteredCountries.length === 0" class="ss-no-results">No results</li>
            <li v-for="(item, i) in filteredCountries" :key="item.value"
              :class="{ highlighted: countryHighlight === i }"
              @mousedown.prevent="selectCountry(item)">
              {{ item.label }}
            </li>
          </ul>
        </div>
        <small class="hint">Leave blank to include all countries.</small>
      </div>

      <div class="form-group">
        <label>Category</label>
        <div class="searchable-select" ref="categorySelectEl">
          <div class="selected-tags">
            <span v-for="item in selectedCategories" :key="item.value" class="tag">
              {{ item.label }}
              <span class="remove-tag" @mousedown.prevent.stop="removeCategory(item.value)">×</span>
            </span>
          </div>
          <input type="text" class="searchable-select-input" v-model="categorySearch"
            placeholder="All Categories (search to filter…)" autocomplete="off"
            @focus="categoryOpen = true" @blur="onCategoryBlur" @input="categoryOpen = true"
            @keydown="onCategoryKeydown">
          <ul v-show="categoryOpen" class="searchable-select-dropdown" ref="categoryListEl">
            <li v-if="filteredCategories.length === 0" class="ss-no-results">No results</li>
            <li v-for="(item, i) in filteredCategories" :key="item.value"
              :class="{ highlighted: categoryHighlight === i }"
              @mousedown.prevent="selectCategory(item)">
              {{ item.label }}
            </li>
          </ul>
        </div>
        <small class="hint">Leave blank to include all categories.</small>
      </div>
    </fieldset>

    <div class="form-actions">
      <button type="submit" class="btn primary" id="iptv-org-submit">
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
import { ref, computed, onMounted, inject } from 'vue'
import { useDecodedToken } from '../composables/useDecodedToken'
import type { IptvOrgConfig } from '../types/config'

const oc = inject<any>('overlayControl')!

const IPTV_ORG_BASE = 'https://iptv-org.github.io/api'

interface SelectItem { label: string; value: string }

const allCountries = ref<SelectItem[]>([])
const allCategories = ref<SelectItem[]>([])
const selectedCountries = ref<SelectItem[]>([])
const selectedCategories = ref<SelectItem[]>([])

const countrySearch = ref('')
const categorySearch = ref('')
const countryOpen = ref(false)
const categoryOpen = ref(false)
const countryHighlight = ref(-1)
const categoryHighlight = ref(-1)

const filteredCountries = computed(() => {
  const q = countrySearch.value.toLowerCase().trim()
  const available = allCountries.value.filter(i => !selectedCountries.value.some(s => s.value === i.value))
  return q ? available.filter(i => i.label.toLowerCase().includes(q)) : available
})

const filteredCategories = computed(() => {
  const q = categorySearch.value.toLowerCase().trim()
  const available = allCategories.value.filter(i => !selectedCategories.value.some(s => s.value === i.value))
  return q ? available.filter(i => i.label.toLowerCase().includes(q)) : available
})

function selectCountry(item: SelectItem) {
  if (!selectedCountries.value.some(s => s.value === item.value)) {
    selectedCountries.value.push(item)
  }
  countrySearch.value = ''
  countryOpen.value = false
  countryHighlight.value = -1
}

function selectCategory(item: SelectItem) {
  if (!selectedCategories.value.some(s => s.value === item.value)) {
    selectedCategories.value.push(item)
  }
  categorySearch.value = ''
  categoryOpen.value = false
  categoryHighlight.value = -1
}

function removeCountry(value: string) {
  selectedCountries.value = selectedCountries.value.filter(s => s.value !== value)
}

function removeCategory(value: string) {
  selectedCategories.value = selectedCategories.value.filter(s => s.value !== value)
}

function onCountryBlur() { setTimeout(() => { countryOpen.value = false }, 150) }
function onCategoryBlur() { setTimeout(() => { categoryOpen.value = false }, 150) }

function onCountryKeydown(e: KeyboardEvent) {
  const opts = filteredCountries.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    countryOpen.value = true
    countryHighlight.value = Math.min(countryHighlight.value + 1, opts.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    countryHighlight.value = Math.max(countryHighlight.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (countryHighlight.value >= 0 && opts[countryHighlight.value]) {
      selectCountry(opts[countryHighlight.value])
    }
  } else if (e.key === 'Escape') {
    countryOpen.value = false
  } else if (e.key === 'Backspace' && countrySearch.value === '' && selectedCountries.value.length > 0) {
    selectedCountries.value.pop()
  }
}

function onCategoryKeydown(e: KeyboardEvent) {
  const opts = filteredCategories.value
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    categoryOpen.value = true
    categoryHighlight.value = Math.min(categoryHighlight.value + 1, opts.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    categoryHighlight.value = Math.max(categoryHighlight.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (categoryHighlight.value >= 0 && opts[categoryHighlight.value]) {
      selectCategory(opts[categoryHighlight.value])
    }
  } else if (e.key === 'Escape') {
    categoryOpen.value = false
  } else if (e.key === 'Backspace' && categorySearch.value === '' && selectedCategories.value.length > 0) {
    selectedCategories.value.pop()
  }
}

onMounted(async () => {
  try {
    const [countriesRaw, categoriesRaw] = await Promise.all([
      fetch(`${IPTV_ORG_BASE}/countries.json`).then(r => r.json()),
      fetch(`${IPTV_ORG_BASE}/categories.json`).then(r => r.json()),
    ])

    allCountries.value = [...countriesRaw]
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
      .map((c: any) => ({ label: `${c.name} (${c.code.toUpperCase()})`, value: c.code.toUpperCase() }))

    allCategories.value = [...categoriesRaw]
      .sort((a: any, b: any) => a.name.localeCompare(b.name))
      .map((c: any) => ({
        label: c.name.charAt(0).toUpperCase() + c.name.slice(1),
        value: c.id
      }))

    // Prefill on reconfigure
    const { decodedConfig } = useDecodedToken()
    if (decodedConfig && decodedConfig.provider === 'iptv-org') {
      const d = decodedConfig as IptvOrgConfig
      if (d.iptvOrgCountry) {
        const codes = d.iptvOrgCountry.split(',').map(c => c.trim().toUpperCase())
        selectedCountries.value = codes
          .map(code => allCountries.value.find(c => c.value === code))
          .filter(Boolean) as SelectItem[]
      }
      if (d.iptvOrgCategory) {
        const cats = d.iptvOrgCategory.split(',').map(c => c.trim().toLowerCase())
        selectedCategories.value = cats
          .map(cat => allCategories.value.find(c => c.value === cat))
          .filter(Boolean) as SelectItem[]
      }
    }
  } catch (err) {
    console.error('[IPTV-ORG] Failed to load countries/categories', err)
  }
})

async function handleSubmit() {
  const country = selectedCountries.value.map(c => c.value).join(',') || null
  const category = selectedCategories.value.map(c => c.value).join(',') || null

  oc.showOverlay(true)
  oc.setProgress(5, 'Starting')
  oc.appendDetail('== PRE-FLIGHT (IPTV-ORG) ==')
  oc.appendDetail(`Country filter: ${country || '(all)'}`)
  oc.appendDetail(`Category filter: ${category || '(all)'}`)
  oc.appendDetail('Note: channel data will be fetched & cached on first access (may take a few seconds).')

  try {
    const config: IptvOrgConfig = {
      provider: 'iptv-org',
      iptvOrgCountry: country,
      iptvOrgCategory: category,
    }

    oc.setProgress(40, 'Building token')
    const { manifestUrl, stremioUrl } = await oc.buildUrls(config)
    oc.appendDetail('✔ Token built')
    oc.appendDetail('Manifest URL: ' + manifestUrl)

    oc.setProgress(70, 'Waiting for manifest')
    oc.appendDetail('== SERVER BUILD PHASE ==')
    oc.appendDetail('Polling server…')
    oc.startPolling(manifestUrl, stremioUrl, 70)
  } catch (err: any) {
    oc.setProgress(100, 'Configuration failed')
    oc.appendDetail('✖ Error: ' + (err.message || String(err)))
    oc.appendDetail('Close overlay and try again.')
    oc.markError()
  }
}
</script>
