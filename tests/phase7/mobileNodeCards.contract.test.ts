import { readFileSync } from 'node:fs'

const homeViewSource = readFileSync(new URL('../../src/views/HomeView.vue', import.meta.url), 'utf8')
const nodeCardSource = readFileSync(new URL('../../src/components/NodeCard.vue', import.meta.url), 'utf8')
const mainStyleSource = readFileSync(new URL('../../src/styles/main.css', import.meta.url), 'utf8')

describe('mobile node card rendering contract', () => {
  it('applies viewport skipping to each keyed card wrapper, not the transition group', () => {
    const transitionGroup = homeViewSource.match(/<TransitionGroup[\s\S]*?<\/TransitionGroup>/)?.[0] ?? ''

    expect(transitionGroup).toContain('class="gap-3 grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]"')
    expect(transitionGroup).toContain('class="node-card-viewport-skip min-w-0"')
    expect(transitionGroup).toContain(':key="getNodeItemTransitionKey(node)"')
    expect(transitionGroup).toContain(':style="getNodeItemTransitionStyle(index)"')
  })

  it('limits viewport skipping to narrow screens with a stable card size estimate', () => {
    expect(mainStyleSource).toContain('@media (max-width: 639px)')
    expect(mainStyleSource).toContain('.node-card-viewport-skip')
    expect(mainStyleSource).toContain('content-visibility: auto')
    expect(mainStyleSource).toContain('contain: layout paint style')
    expect(mainStyleSource).toContain('contain-intrinsic-size: auto 360px')
  })

  it('uses compact mobile spacing while restoring desktop card sizing', () => {
    expect(nodeCardSource).toContain('content-class="p-3 sm:p-4"')
    expect(nodeCardSource).toContain('header-class="gap-1.5 px-3 py-2 sm:gap-2 sm:px-4 sm:py-3"')
    expect(nodeCardSource).toContain('class="flex flex-col gap-2.5 sm:gap-3"')
    expect(nodeCardSource).toContain('class="gap-x-2.5 gap-y-1 grid grid-cols-2 sm:gap-x-3"')
  })

  it('retains all node-card metric and interaction regions', () => {
    for (const region of ['CPU', '内存', '硬盘', '流量', '速率', '在线', '费用', '三网', '丢包']) {
      expect(nodeCardSource).toContain(region)
    }
    expect(nodeCardSource).toContain('getCustomTags')
    expect(nodeCardSource).toContain('emit(\'click\')')
    expect(nodeCardSource).toContain('emit(\'pingClick\', props.node)')
  })
})
