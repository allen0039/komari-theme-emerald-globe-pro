<script setup lang="ts">
import type { GlobeInstance } from 'globe.gl'
import type { MeshPhongMaterial, Texture } from 'three'
import type { NodeData } from '@/stores/nodes'
import {
  useDocumentVisibility,
  useElementSize,
  useElementVisibility,
} from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { useNodesStore } from '@/stores/nodes'
import { getCoordByCode, getCountryCodeFromRegion } from '@/utils/geoHelper'
import { formatBytesPerSecondSplit } from '@/utils/helper'

const props = defineProps<{
  nodes?: NodeData[]
  compact?: boolean
}>()

const EARTH_DAY_TEXTURE = '/images/earth/earth-blue-marble.jpg'
const EARTH_NIGHT_TEXTURE = '/images/earth/earth-night.jpg'
const EARTH_BUMP_MAP = '/images/earth/earth-topology.png'
const EARTH_SPECULAR_MAP = '/images/earth/earth-water.png'
const CHINA_COORD = getCoordByCode('CN') ?? [35.8617, 104.1954]

const appStore = useAppStore()
const nodesStore = useNodesStore()
const displayNodes = computed(() => props.nodes ?? nodesStore.earthNodes)

const containerRef = ref<HTMLDivElement>()
const globeHostRef = ref<HTMLDivElement>()
const { width: containerWidth, height: containerHeight } = useElementSize(containerRef)

const documentVisibility = useDocumentVisibility()
const elementVisible = useElementVisibility(containerRef)
const shouldRender = computed(() => documentVisibility.value === 'visible' && elementVisible.value)
const shouldAutoRotate = computed(() => appStore.earthViewMode !== 'earth-stop')

let globe: GlobeInstance | null = null
let globeMaterial: MeshPhongMaterial | null = null
let waterSpecularMap: Texture | null = null
let loadingGlobe = false
let destroyed = false

interface RegionCluster {
  code: string
  coord: [number, number]
  servers: number
  onlineServers: number
}

interface RegionRate {
  up: number
  down: number
}

interface GlobeLabel {
  id: string
  lat: number
  lng: number
  code: string
  up: string
  down: string
}

interface GlobeArc {
  fromLat: number
  fromLng: number
  toLat: number
  toLng: number
}

function clusterKey(cluster: RegionCluster): string {
  return `${cluster.code}:${cluster.servers}:${cluster.onlineServers}`
}

const regionClusters = computed<RegionCluster[]>(() => {
  const map = new Map<string, RegionCluster>()
  for (const node of displayNodes.value) {
    const code = getCountryCodeFromRegion(node.region)
    if (!code)
      continue
    const coord = getCoordByCode(code)
    if (!coord)
      continue

    let entry = map.get(code)
    if (!entry) {
      entry = { code, coord, servers: 0, onlineServers: 0 }
      map.set(code, entry)
    }
    entry.servers += 1
    if (node.online)
      entry.onlineServers += 1
  }
  return Array.from(map.values()).sort((a, b) => b.servers - a.servers)
})

const regionRates = computed<Map<string, RegionRate>>(() => {
  const map = new Map<string, RegionRate>()
  for (const node of displayNodes.value) {
    if (!node.online)
      continue
    const code = getCountryCodeFromRegion(node.region)
    if (!code)
      continue
    let entry = map.get(code)
    if (!entry) {
      entry = { up: 0, down: 0 }
      map.set(code, entry)
    }
    entry.up += node.net_out || 0
    entry.down += node.net_in || 0
  }
  return map
})

const userCoord = computed<[number, number] | null>(() => {
  if (!appStore.visitorInfoCardEnabled || !appStore.visitorCountryCode)
    return null
  return getCoordByCode(appStore.visitorCountryCode)
})

function rateFor(code: string): RegionRate {
  return regionRates.value.get(code) ?? { up: 0, down: 0 }
}

function formatRate(bytesPerSec: number): string {
  const { value, unit } = formatBytesPerSecondSplit(bytesPerSec, appStore.byteDecimals)
  return `${value} ${unit}`
}

const labelsData = computed<GlobeLabel[]>(() => regionClusters.value.map((cluster) => {
  const rate = rateFor(cluster.code)
  return {
    id: cluster.code,
    lat: cluster.coord[0],
    lng: cluster.coord[1],
    code: cluster.code,
    up: formatRate(rate.up),
    down: formatRate(rate.down),
  }
}))

const arcsData = computed<GlobeArc[]>(() => {
  const visitor = userCoord.value
  if (!visitor)
    return []
  return regionClusters.value.map(cluster => ({
    fromLat: cluster.coord[0],
    fromLng: cluster.coord[1],
    toLat: visitor[0],
    toLng: visitor[1],
  }))
})

const clusterSignature = computed(() => regionClusters.value.map(clusterKey).join(','))
const rateSignature = computed(() => labelsData.value.map(label => `${label.id}:${label.up}:${label.down}`).join(','))

const totalServers = computed(() => displayNodes.value.length)
const onlineServers = computed(() => displayNodes.value.filter(node => node.online).length)
const offlineServers = computed(() => totalServers.value - onlineServers.value)

function earthTextureUrl(): string {
  return appStore.isDark ? EARTH_NIGHT_TEXTURE : EARTH_DAY_TEXTURE
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  element.className = className
  if (text != null)
    element.textContent = text
  return element
}

function createRateRow(direction: 'up' | 'down', value: string): HTMLDivElement {
  const row = createElement('div', `earth-rate-row earth-rate-${direction}`)
  const arrow = createElement('span', 'earth-rate-arrow', direction === 'up' ? '↑' : '↓')
  arrow.setAttribute('aria-hidden', 'true')
  row.append(arrow, document.createTextNode(value))
  return row
}

function createLabelElement(data: object): HTMLElement {
  const label = data as GlobeLabel
  const root = createElement('div', 'earth-label')
  root.dataset.clusterId = label.id

  const panel = createElement('div', 'earth-rate-panel')
  panel.append(createRateRow('up', label.up), createRateRow('down', label.down))

  const flag = createElement('img', 'earth-label-flag')
  flag.src = `/assets/flags/${label.code}.svg`
  flag.alt = label.code
  flag.decoding = 'async'

  root.append(panel, flag)
  return root
}

function getRenderSize() {
  const width = containerWidth.value || globeHostRef.value?.clientWidth || 320
  const height = containerHeight.value || globeHostRef.value?.clientHeight || width
  return { width, height }
}

function resizeGlobe() {
  if (!globe)
    return
  const { width, height } = getRenderSize()
  globe.width(width).height(height)
}

function resetPointOfView(transitionMs = 0) {
  globe?.pointOfView({ lat: CHINA_COORD[0], lng: CHINA_COORD[1], altitude: 1.95 }, transitionMs)
}

function applyControls() {
  if (!globe)
    return
  const controls = globe.controls()
  controls.autoRotate = shouldRender.value && shouldAutoRotate.value
  controls.autoRotateSpeed = 1.6
  controls.enableDamping = true
  controls.enableZoom = false
  controls.enablePan = false
  controls.rotateSpeed = 0.55
}

function arcColor(): string {
  return appStore.isDark ? 'rgba(96, 165, 250, 0.96)' : 'rgba(37, 99, 235, 0.94)'
}

function applyMaterialStyle() {
  if (!globe || !globeMaterial)
    return
  globe.globeImageUrl(earthTextureUrl())
  globeMaterial.bumpScale = appStore.isDark ? 0.018 : 0.03
  globeMaterial.shininess = appStore.isDark ? 7 : 14
  globeMaterial.emissive.set(appStore.isDark ? 0x142B47 : 0x244C69)
  globeMaterial.emissiveIntensity = appStore.isDark ? 0.46 : 0.26
  globeMaterial.needsUpdate = true
  globe
    .arcColor(arcColor)
    .atmosphereColor(appStore.isDark ? '#38bdf8' : '#60a5fa')
    .atmosphereAltitude(appStore.isDark ? 0.13 : 0.1)
}

function syncDataToGlobe() {
  if (!globe)
    return
  globe
    .arcsData(arcsData.value)
    .htmlElementsData(labelsData.value)
}

async function startGlobe() {
  if (globe || loadingGlobe || !globeHostRef.value)
    return

  loadingGlobe = true
  await nextTick()

  try {
    const [{ default: Globe }, THREE] = await Promise.all([
      import('globe.gl'),
      import('three'),
    ])

    if (destroyed || !globeHostRef.value)
      return

    const { width, height } = getRenderSize()
    globe = new Globe(globeHostRef.value, {
      rendererConfig: { alpha: true, antialias: true },
    })
      .width(width)
      .height(height)
      .backgroundColor('rgba(0,0,0,0)')
      .globeImageUrl(earthTextureUrl())
      .bumpImageUrl(EARTH_BUMP_MAP)
      .showAtmosphere(true)
      .arcsData(arcsData.value)
      .arcStartLat('fromLat')
      .arcStartLng('fromLng')
      .arcEndLat('toLat')
      .arcEndLng('toLng')
      .arcColor(arcColor)
      .arcAltitude(0.28)
      .arcStroke(0.55)
      .arcCurveResolution(64)
      .arcsTransitionDuration(700)
      .htmlElementsData(labelsData.value)
      .htmlLat('lat')
      .htmlLng('lng')
      .htmlAltitude(0.018)
      .htmlElement(createLabelElement)
      .htmlElementVisibilityModifier((element: HTMLElement, visible: boolean) => {
        element.style.opacity = visible ? '1' : '0'
        element.style.filter = visible ? 'blur(0)' : 'blur(16px)'
      })
      .htmlTransitionDuration(400)

    const renderer = globe.renderer()
    renderer.setClearColor(0x000000, 0)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.domElement.style.background = 'transparent'

    const material = globe.globeMaterial()
    if ('shininess' in material) {
      globeMaterial = material as MeshPhongMaterial
      waterSpecularMap = new THREE.TextureLoader().load(EARTH_SPECULAR_MAP, () => {
        if (!globeMaterial)
          return
        globeMaterial.specularMap = waterSpecularMap
        globeMaterial.needsUpdate = true
      })
      globeMaterial.specular = new THREE.Color(appStore.isDark ? 0x64748B : 0x475569)
    }

    const frontLight = new THREE.DirectionalLight(0xFFFFFF, appStore.isDark ? 0.92 : 1.08)
    frontLight.position.set(1.2, 1.1, 1.6)
    const leftFill = new THREE.DirectionalLight(0xDBEAFE, appStore.isDark ? 0.58 : 0.46)
    leftFill.position.set(-1.2, 0.2, 1.2)
    const rearFill = new THREE.DirectionalLight(0xE0F2FE, appStore.isDark ? 0.46 : 0.34)
    rearFill.position.set(-1, -0.8, -1.2)
    globe.lights([
      new THREE.AmbientLight(0xFFFFFF, appStore.isDark ? 1.7 : 1.35),
      frontLight,
      leftFill,
      rearFill,
    ])

    applyMaterialStyle()
    applyControls()
    resetPointOfView(0)
    if (!shouldRender.value)
      globe.pauseAnimation()
  }
  finally {
    loadingGlobe = false
  }
}

function stopGlobe() {
  if (!globe)
    return
  globe.pauseAnimation()
  globe._destructor()
  globe = null
  globeMaterial = null
  waterSpecularMap?.dispose()
  waterSpecularMap = null
  globeHostRef.value?.replaceChildren()
}

onMounted(() => {
  void startGlobe()
})

onBeforeUnmount(() => {
  destroyed = true
  stopGlobe()
})

watch([containerWidth, containerHeight], ([width, height]) => {
  if (width > 0 && height > 0)
    resizeGlobe()
})

watch([clusterSignature, rateSignature, userCoord], () => {
  syncDataToGlobe()
})

watch(() => appStore.isDark, () => {
  applyMaterialStyle()
})

watch(() => appStore.earthViewMode, (mode) => {
  applyControls()
  if (mode === 'earth-stop')
    resetPointOfView(300)
})

watch(shouldRender, (visible) => {
  if (!globe)
    return
  if (visible) {
    globe.resumeAnimation()
    resizeGlobe()
  }
  else {
    globe.pauseAnimation()
  }
  applyControls()
})
</script>

<template>
  <div ref="containerRef" class="relative aspect-square w-full max-w-md mx-auto -translate-y-6 md:-translate-y-12 overflow-visible">
    <div
      ref="globeHostRef"
      class="earth-globe-host absolute inset-0 w-full h-full select-none touch-none cursor-grab active:cursor-grabbing"
      :class="props.compact && 'earth-globe-host-compact'"
    />

    <div
      v-if="totalServers > 0"
      class="absolute top-6 md:top-12 left-0 text-[10px] text-muted-foreground pointer-events-none flex gap-2 items-center backdrop-blur-lg bg-background/60 rounded px-2 py-0.5"
    >
      <div v-if="onlineServers > 0" class="flex items-center gap-1">
        <span class="inline-block size-1.5 rounded-full bg-green-600 animate-pulse" />
        <span class="text-green-600">{{ onlineServers }}</span>
      </div>
      <div v-if="offlineServers > 0" class="flex items-center gap-1">
        <span class="inline-block size-1.5 rounded-full bg-yellow-600 animate-pulse" />
        <span class="text-yellow-600">{{ offlineServers }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.earth-globe-host {
  contain: layout paint;
  background: transparent;
}

.earth-globe-host :deep(canvas),
.earth-globe-host :deep(.scene-container) {
  background: transparent !important;
  outline: none;
}

.earth-globe-host :deep(.earth-label) {
  pointer-events: none;
  position: relative;
  transform: translate(-50%, -112%);
  transition:
    opacity 400ms ease,
    filter 400ms ease;
  will-change: opacity, filter;
}

.earth-globe-host :deep(.earth-rate-panel) {
  position: relative;
  z-index: 2;
  padding: 0.125rem 0.25rem;
  border: 1px solid rgb(255 255 255 / 38%);
  border-radius: 0.25rem;
  background: color-mix(in srgb, var(--background) 68%, transparent);
  box-shadow: 0 5px 18px rgb(15 23 42 / 12%);
  backdrop-filter: blur(7px);
  font-size: 0.75rem;
  line-height: 1rem;
  white-space: nowrap;
}

.earth-globe-host :deep(.earth-rate-row) {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  font-variant-numeric: tabular-nums;
}

.earth-globe-host :deep(.earth-rate-up) {
  color: #16a34a;
}

.earth-globe-host :deep(.earth-rate-down) {
  color: #2563eb;
}

.earth-globe-host :deep(.earth-rate-arrow) {
  width: 0.75rem;
  font-size: 0.8rem;
  font-weight: 700;
  line-height: 1;
  text-align: center;
}

.earth-globe-host :deep(.earth-label-flag) {
  position: absolute;
  z-index: 3;
  bottom: -0.5rem;
  left: -0.5rem;
  display: block;
  width: 1rem;
  height: 1rem;
  filter: drop-shadow(0 3px 5px rgb(15 23 42 / 22%));
}

.earth-globe-host-compact :deep(.earth-rate-panel) {
  display: none;
}

.earth-globe-host-compact :deep(.earth-label-flag) {
  width: 0.875rem;
  height: 0.875rem;
  bottom: -0.4375rem;
  left: -0.4375rem;
}
</style>
