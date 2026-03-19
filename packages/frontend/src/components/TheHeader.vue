<template>
  <header class="app-header">
    <div class="header-inner">
      <div v-if="loading" class="header-skeleton">
        <div class="skeleton-icon"></div>
        <div class="skeleton-lines">
          <div class="skeleton-line w-48"></div>
          <div class="skeleton-line w-32"></div>
        </div>
      </div>
      <div v-else class="header-content">
        <img
          v-if="info?.logoUrl"
          :src="info.logoUrl"
          class="addon-logo"
          alt="Addon Logo"
          @error="(e) => (e.target as HTMLImageElement).style.display = 'none'"
          style="border-radius: 22%"
        >
        <div class="header-text">
          <h1 class="app-title">{{ info?.name }}</h1>
          <p class="subtitle">{{ info?.description }}</p>
        </div>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useAddonInfo } from '../composables/useAddonInfo'

const { info, loading } = useAddonInfo()
</script>
