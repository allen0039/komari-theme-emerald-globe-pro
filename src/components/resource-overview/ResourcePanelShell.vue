<script setup lang="ts">
defineProps<{
  title: string
  summary: string
  summaryVisible: boolean
  labelledBy: string
  compact?: boolean
  allowOverflow?: boolean
}>()
</script>

<template>
  <section
    class="flex h-full min-w-0 flex-col rounded-xl border border-border/80 bg-background/80 shadow-sm shadow-emerald-950/5"
    :class="[compact ? 'min-h-0' : 'min-h-72', allowOverflow ? 'overflow-visible' : 'overflow-hidden']"
    :aria-labelledby="labelledBy"
  >
    <header class="flex flex-wrap items-center gap-3 border-b border-border/70" :class="compact ? 'min-h-11 px-3 py-1.5' : 'min-h-14 px-4 py-3'">
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <span class="size-2 shrink-0 rounded-full bg-emerald-600 shadow-[0_0_0_4px] shadow-emerald-500/10" aria-hidden="true" />
        <h2 :id="labelledBy" class="truncate text-sm font-semibold text-foreground">
          {{ title }}
        </h2>
      </div>
      <div v-if="$slots.controls" class="min-w-0 shrink-0">
        <slot name="controls" />
      </div>
    </header>

    <div class="min-h-0 min-w-0 flex-1" :class="compact ? 'p-2' : 'p-4'">
      <slot />
    </div>

    <p v-if="summaryVisible" class="border-t border-border/70 bg-muted/25 text-muted-foreground" :class="compact ? 'truncate px-3 py-1 text-[10px] leading-4' : 'px-4 py-3 text-xs leading-5'" :title="compact ? summary : undefined">
      {{ summary }}
    </p>
  </section>
</template>
