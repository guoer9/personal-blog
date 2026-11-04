// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { SceneRegistry } from './SceneRegistry'
import { VisualRuntime } from './VisualRuntime'
import type { PageSceneModule, RendererAdapter, SceneContext, SceneRenderContext, VisualState } from './types'

function makeRenderer(): RendererAdapter {
  return {
    domElement: document.createElement('canvas'),
    setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn(),
  }
}

function makeModule(id: PageSceneModule['id'], calls: string[]): PageSceneModule {
  return {
    id,
    mount: () => calls.push(`${id}:mount`),
    enter: () => calls.push(`${id}:enter`),
    leave: () => calls.push(`${id}:leave`),
    update: () => calls.push(`${id}:update`),
    resize: () => calls.push(`${id}:resize`),
    render: () => calls.push(`${id}:render`),
    dispose: () => calls.push(`${id}:dispose`),
  }
}

function createHarness() {
  const calls: string[] = []
  const renderers: RendererAdapter[] = []
  const queued = new Map<number, FrameRequestCallback>()
  let nextFrame = 1
  let time = 0
  const registry = new SceneRegistry()
  for (const id of ['home', 'works'] as const) registry.register(id, () => makeModule(id, calls))
  const runtime = new VisualRuntime({
    sceneRegistry: registry,
    createRenderer: () => { const renderer = makeRenderer(); renderers.push(renderer); return renderer },
    requestFrame: (callback) => { const id = nextFrame++; queued.set(id, callback); return id },
    cancelFrame: (id) => { queued.delete(id) },
    now: () => time,
  })
  return {
    runtime, calls, renderers, queued,
    canvas: document.createElement('canvas'),
    advance(ms: number) { time += ms },
    runFrame() { const next = queued.entries().next().value as [number, FrameRequestCallback] | undefined; if (!next) return; queued.delete(next[0]); next[1](time) },
  }
}

describe('VisualRuntime', () => {
  it('creates one renderer and one RAF when start is called repeatedly', async () => {
    const harness = createHarness()
    harness.runtime.mount(harness.canvas)
    harness.runtime.setRoute({ routeName: 'Home', pageId: 'home', params: {} })
    await vi.waitFor(() => expect(harness.calls).toContain('home:enter'))

    harness.runtime.start()
    harness.runtime.start()
    expect(harness.renderers).toHaveLength(1)
    expect(harness.queued.size).toBe(1)
  })

  it('keeps the renderer while handing off from Home to Works', async () => {
    const harness = createHarness()
    harness.runtime.mount(harness.canvas)
    harness.runtime.setRoute({ routeName: 'Home', pageId: 'home', params: {} })
    await vi.waitFor(() => expect(harness.calls).toContain('home:enter'))
    harness.runtime.setRoute({ routeName: 'Works', pageId: 'works', params: {} })
    await vi.waitFor(() => expect(harness.calls).toContain('works:enter'))

    expect(harness.renderers).toHaveLength(1)
    expect(harness.calls).toEqual(expect.arrayContaining(['home:leave', 'home:dispose', 'works:mount', 'works:enter']))
  })

  it('does not continue frames while hidden, invisible, or stopped', async () => {
    const harness = createHarness()
    harness.runtime.mount(harness.canvas)
    harness.runtime.setRoute({ routeName: 'Home', pageId: 'home', params: {} })
    await vi.waitFor(() => expect(harness.calls).toContain('home:enter'))
    harness.runtime.start()
    expect(harness.queued.size).toBe(1)
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    harness.runFrame()
    expect(harness.queued.size).toBe(0)
    vi.restoreAllMocks()

    harness.runtime.setDocumentHidden(false)
    harness.runtime.setCanvasVisible(false)
    harness.runtime.start()
    expect(harness.queued.size).toBe(0)
    harness.runtime.setCanvasVisible(true)
    harness.runtime.start()
    expect(harness.queued.size).toBe(1)
    harness.runtime.stop()
    expect(harness.queued.size).toBe(0)
  })

  it('updates then renders the active module and releases everything on dispose', async () => {
    const harness = createHarness()
    harness.runtime.mount(harness.canvas)
    harness.runtime.setRoute({ routeName: 'Home', pageId: 'home', params: {} })
    await vi.waitFor(() => expect(harness.calls).toContain('home:enter'))
    harness.runtime.setPageState('home', { paused: false })
    harness.runtime.start()
    harness.runFrame()
    expect(harness.calls.indexOf('home:update')).toBeLessThan(harness.calls.indexOf('home:render'))
    harness.runtime.dispose()
    expect(harness.calls).toContain('home:dispose')
    expect(harness.renderers[0].dispose).toHaveBeenCalledTimes(1)
    harness.runtime.dispose()
    expect(harness.renderers[0].dispose).toHaveBeenCalledTimes(1)
  })
})
