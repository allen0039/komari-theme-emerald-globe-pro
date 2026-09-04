<script setup lang="ts">
import { Button } from '@/components/ui/button'

const props = withDefaults(defineProps<{
  modelValue?: boolean
}>(), {
  modelValue: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

function setMode(showDetails: boolean): void {
  if (showDetails !== props.modelValue)
    emit('update:modelValue', showDetails)
}
</script>

<template>
  <div class="inline-flex h-11 items-center rounded-md bg-muted/60 p-0 md:h-8" aria-label="三网显示模式">
    <Button
      type="button"
      variant="ghost"
      size="xs"
      class="h-11 min-w-12 rounded-sm px-2 text-[11px] md:h-7"
      :class="!modelValue ? 'bg-background text-emerald-700 shadow-xs hover:bg-background dark:text-emerald-400' : 'text-muted-foreground'"
      aria-label="显示三网摘要"
      :aria-pressed="!modelValue"
      @click="setMode(false)"
    >
      摘要
    </Button>
    <Button
      type="button"
      variant="ghost"
      size="xs"
      class="h-11 min-w-12 rounded-sm px-2 text-[11px] md:h-7"
      :class="modelValue ? 'bg-background text-emerald-700 shadow-xs hover:bg-background dark:text-emerald-400' : 'text-muted-foreground'"
      aria-label="显示三网明细"
      :aria-pressed="modelValue"
      @click="setMode(true)"
    >
      明细
    </Button>
  </div>
</template>
