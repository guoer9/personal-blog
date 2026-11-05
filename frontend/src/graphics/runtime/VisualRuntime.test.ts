// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { SceneRegistry } from './SceneRegistry'
import { VisualRuntime } from './VisualRuntime'
import type { PageSceneModule, RendererAdapter } from './types'

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
  let renderFailure = false
  let homePaused = false
  const registry = new SceneRegistry()
  registry.register('home', () => {
    const module = makeModule('home', calls)
    return {
      ...module,
      update: (_visualState, pageState) => {
        calls.push('home:update')
        homePaused = (pageState as { paused?: boolean })?.paused === true
      },
      shouldAnimate: () => !homePaused,
      render: () => { calls.push('home:render'); if (renderFailure) throw new Error('shader failed') },
    }
  })
  registry.register('works', () => {
    const module = makeModule('works', calls)
    return { ...module, render: () => { calls.push('works:render'); if (renderFailure) throw new Error('shader failed') } }
  })
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
    failRender(value: boolean) { renderFailure = value },
    runFrame() { const next = queued.entries().next().value as [number, FrameRequestCallback] | undefined; if (!next) return; queued.delete(next[0]); next[1](time) },
  }
}

async function activateRoute(runtime: VisualRuntime, identity: { routeName: string; pageId: 'home' | 'works'; params: Record<string, string> }): Promise<void> {
  runtime.setRoute(identity)
  await runtime.finishTransitionEnter()
}

describe('VisualRuntime', () => {
  it('creates one renderer and one RAF when start is called repeatedly', async () => {
    const harness = createHarness()
    harness.runtime.mount(harness.canvas)
    await activateRoute(harness.runtime, { routeName: 'Home', pageId: 'home', params: {} })
    await vi.waitFor(() => expect(harness.calls).toContain('home:enter'))

    harness.runtime.start()
    harness.runtime.start()
    expect(harness.renderers).toHaveLength(1)
    expect(harness.queued.size).toBe(1)
  })

  it('smooths pointer velocity for scenes and lets it decay without new input', async () => {
    const harness = createHarness()
    harness.runtime.mount(harness.canvas)
    await activateRoute(harness.runtime, { routeName: 'Home', pageId: 'home', params: {} })
    await vi.waitFor(() => expect(harness.calls).toContain('home:enter'))
    harness.runtime.start()

    harness.runtime.setPointer(0, 0)
    harness.advance(16)
    harness.runFrame()
    harness.runtime.setPointer(1, 0)
    harness.advance(16)
    harness.runFrame()
    const movingVelocity = harness.runtime.getVisualState().pointerVelocity.x
    expect(movingVelocity).toBeGreaterThan(0)

    for (let frame = 0; frame < 30; frame += 1) {
      harness.advance(16)
      harness.runFrame()
    }
    expect(harness.runtime.getVisualState().pointerVelocity.x).toBeLessThan(movingVelocity)
  })

  it('keeps the renderer while handing off from Home to Works', async () => {
    const harness = createHarness()
    harness.runtime.mount(harness.canvas)
    await activateRoute(harness.runtime, { routeName: 'Home', pageId: 'home', params: {} })
    await vi.waitFor(() => expect(harness.calls).toContain('home:enter'))
    harness.runtime.setRoute({ routeName: 'Works', pageId: 'works', params: {} })
    harness.runtime.beginTransitionLeave()
    harness.runtime.finishTransitionLeave()
    await harness.runtime.finishTransitionEnter()

    expect(harness.renderers).toHaveLength(1)
    expect(harness.calls).toEqual(expect.arrayContaining(['home:leave', 'home:dispose', 'works:mount', 'works:enter']))
  })

  it('keeps the outgoing scene active until the DOM leave transition completes', async () => {
    const harness = createHarness()
    harness.runtime.mount(harness.canvas)
    await activateRoute(harness.runtime, { routeName: 'Home', pageId: 'home', params: {} })
    await vi.waitFor(() => expect(harness.calls).toContain('home:enter'))
    harness.calls.length = 0

    harness.runtime.setRoute({ routeName: 'Works', pageId: 'works', params: {} })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(harness.runtime.getDiagnostics().activePageId).toBe('home')
    expect(harness.calls).not.toContain('home:dispose')
    harness.runtime.beginTransitionLeave()
    harness.runtime.finishTransitionLeave()
    await harness.runtime.finishTransitionEnter()
    expect(harness.runtime.getDiagnostics().activePageId).toBe('works')
    expect(harness.calls).toEqual(expect.arrayContaining(['home:leave', 'home:dispose', 'works:enter']))
    harness.runtime.dispose()
  })

  it('ignores a stale route preload failure after a newer scene becomes active', async () => {
    const calls: string[] = []
    const registry = new SceneRegistry()
    registry.register('works', () => makeModule('works', calls))
    registry.register('home', () => { throw new Error('stale home preload failed') })
    const canvas = document.createElement('canvas')
    const runtime = new VisualRuntime({ sceneRegistry: registry, createRenderer: () => makeRenderer() })
    runtime.mount(canvas)
    await activateRoute(runtime, { routeName: 'Works', pageId: 'works', params: {} })

    runtime.setRoute({ routeName: 'Home', pageId: 'home', params: {} })
    runtime.setRoute({ routeName: 'Works', pageId: 'works', params: {} })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(runtime.isFallback).toBe(false)
    expect(runtime.getDiagnostics().activePageId).toBe('works')
    expect(canvas.style.display).toBe('')
    runtime.dispose()
  })

  it('does not continue frames while hidden, invisible, or stopped', async () => {
    const harness = createHarness()
    harness.runtime.mount(harness.canvas)
    await activateRoute(harness.runtime, { routeName: 'Home', pageId: 'home', params: {} })
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
    await activateRoute(harness.runtime, { routeName: 'Home', pageId: 'home', params: {} })
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

  it('stops scheduling frames while the active page requests a manual pause', async () => {
    const harness = createHarness()
    harness.runtime.mount(harness.canvas)
    await activateRoute(harness.runtime, { routeName: 'Home', pageId: 'home', params: {} })
    await vi.waitFor(() => expect(harness.calls).toContain('home:enter'))
    harness.runtime.start()
    expect(harness.queued.size).toBe(1)

    harness.runtime.setPageState('home', { paused: true })
    expect(harness.queued.size).toBe(0)

    harness.runtime.setPageState('home', { paused: false })
    expect(harness.queued.size).toBe(1)
    harness.runtime.dispose()
  })

  it('keeps a single renderer while rebuilding the active scene after context restoration', async () => {
    const harness = createHarness()
    harness.runtime.mount(harness.canvas)
    await activateRoute(harness.runtime, { routeName: 'Home', pageId: 'home', params: {} })
    await vi.waitFor(() => expect(harness.calls).toContain('home:enter'))
    harness.runtime.start()

    const lost = new Event('webglcontextlost', { cancelable: true })
    harness.canvas.dispatchEvent(lost)
    expect(lost.defaultPrevented).toBe(true)
    expect(harness.canvas.style.display).toBe('none')
    expect(harness.queued.size).toBe(0)
    expect(harness.calls).toContain('home:dispose')

    harness.canvas.dispatchEvent(new Event('webglcontextrestored'))
    await vi.waitFor(() => expect(harness.calls.filter((call) => call === 'home:enter')).toHaveLength(2))
    expect(harness.renderers).toHaveLength(1)
    expect(harness.canvas.style.display).toBe('')
    harness.runtime.dispose()
  })

  it('keeps the DOM fallback when the scene cannot be rebuilt after context restoration', async () => {
    const calls: string[] = []
    let creations = 0
    const registry = new SceneRegistry()
    registry.register('home', () => {
      creations += 1
      if (creations > 1) throw new Error('scene restore failed')
      return makeModule('home', calls)
    })
    const canvas = document.createElement('canvas')
    const renderer = makeRenderer()
    const runtime = new VisualRuntime({ sceneRegistry: registry, createRenderer: () => renderer })
    runtime.mount(canvas)
    await activateRoute(runtime, { routeName: 'Home', pageId: 'home', params: {} })
    await vi.waitFor(() => expect(calls).toContain('home:enter'))

    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    canvas.dispatchEvent(new Event('webglcontextrestored'))
    await vi.waitFor(() => expect(creations).toBe(2))

    expect(runtime.isFallback).toBe(true)
    expect(canvas.style.display).toBe('none')
    expect(calls).toEqual(expect.arrayContaining(['home:dispose']))
    runtime.dispose()
  })

  it('keeps the visual runtime static while reduced motion is enabled', async () => {
    const harness = createHarness()
    harness.runtime.mount(harness.canvas)
    await activateRoute(harness.runtime, { routeName: 'Home', pageId: 'home', params: {} })
    await vi.waitFor(() => expect(harness.calls).toContain('home:enter'))
    harness.runtime.start()

    harness.runtime.setReducedMotion(true)
    expect(harness.queued.size).toBe(0)
    harness.runtime.start()
    expect(harness.queued.size).toBe(0)
    harness.runtime.setReducedMotion(false)
    expect(harness.queued.size).toBe(1)
    harness.runtime.dispose()
  })

  it('reduces renderer pixel ratio after sustained slow frames', async () => {
    const harness = createHarness()
    harness.runtime.mount(harness.canvas)
    harness.runtime.resize(1200, 800, 2)
    await activateRoute(harness.runtime, { routeName: 'Home', pageId: 'home', params: {} })
    await vi.waitFor(() => expect(harness.calls).toContain('home:enter'))
    harness.runtime.start()

    for (let index = 0; index < 160; index += 1) {
      harness.advance(30)
      harness.runFrame()
    }

    expect(harness.runtime.getVisualState().qualityTier).toBe('low')
    expect(harness.renderers[0]?.setPixelRatio).toHaveBeenLastCalledWith(1)
    harness.runtime.setReducedMotion(true)
    expect(harness.runtime.getVisualState().qualityTier).toBe('low')
    harness.runtime.setReducedMotion(false)
    harness.runtime.dispose()
  })

  it('switches to the DOM fallback when a scene render throws', async () => {
    const harness = createHarness()
    harness.runtime.mount(harness.canvas)
    harness.runtime.resize(800, 600, 1)
    await activateRoute(harness.runtime, { routeName: 'Home', pageId: 'home', params: {} })
    await vi.waitFor(() => expect(harness.calls).toContain('home:enter'))
    harness.runtime.start()
    harness.failRender(true)
    harness.runFrame()

    expect(harness.canvas.style.display).toBe('none')
    expect(harness.queued.size).toBe(0)
    expect(harness.calls).toContain('home:dispose')
    harness.runtime.dispose()
  })

  it('keeps the DOM fallback when renderer initialization fails', () => {
    const registry = new SceneRegistry()
    const canvas = document.createElement('canvas')
    const runtime = new VisualRuntime({ sceneRegistry: registry, createRenderer: () => { throw new Error('WebGL unavailable') } })

    expect(() => runtime.mount(canvas)).not.toThrow()
    expect(canvas.style.display).toBe('none')
    expect(runtime.isFallback).toBe(true)
    runtime.dispose()
  })
})
