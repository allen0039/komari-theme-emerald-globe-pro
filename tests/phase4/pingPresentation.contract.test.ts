import { describe, expect, test } from 'bun:test'

async function readSource(path: string): Promise<string> {
  return Bun.file(path).text()
}

describe('ping presentation reliability', () => {
  test('uses the no-valid-latency sentinel when rendering an aggregate summary', async () => {
    const displaySource = await readSource('src/composables/useNodePingDisplay.ts')

    expect(displaySource).toContain('pingStats.avgLatency.value >= 0')
    expect(displaySource).toContain('return \'--\'')
  })

  test('shares the stale cache marker across summary, detail, and list presentations', async () => {
    const [markerSource, cardSource, listSource] = await Promise.all([
      readSource('src/components/NodePingCacheMarker.vue'),
      readSource('src/components/NodeCard.vue'),
      readSource('src/components/NodePingListCell.vue'),
    ])

    expect(markerSource).toContain('v-if="isCached"')
    expect(markerSource).toContain('formatDateTime(props.cachedAt, \'HH:mm\')')
    expect(cardSource.match(/<NodePingCacheMarker/g)).toHaveLength(2)
    expect(cardSource).toContain(':is-cached="isPingCached"')
    expect(listSource).toContain('<NodePingCacheMarker')
    expect(listSource).toContain(':is-cached="isPingCached"')
  })
})
