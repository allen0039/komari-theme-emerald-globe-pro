<script setup lang="ts">
import { formatDateTime } from '@/utils/helper'

const props = defineProps<{
  isCached: boolean
  cachedAt?: string
}>()
</script>

<template>
  <span v-if="isCached" class="shrink-0 text-[10px] text-amber-700 dark:text-amber-300">
    缓存 {{ formatDateTime(props.cachedAt, 'HH:mm') }}
  </span>
</template>
