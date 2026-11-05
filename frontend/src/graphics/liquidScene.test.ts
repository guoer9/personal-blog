// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createLiquidScene, type SceneQuality } from './liquidScene'
import type { RendererAdapter } from './runtime/types'

function makeRenderer(): RendererAdapter {
  return {
    domElement: document.createElement('canvas'),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  }
}

function lastRenderedScene(renderer: RendererAdapter) {
  const renderMock = renderer.render as ReturnType<typeof vi.fn>
  return renderMock.mock.calls[renderMock.mock.calls.length - 1]?.[0] as {
    children: Array<{ material: { uniforms?: Record<string, { value: unknown }> } }>
  }
}

function sceneQuality(rippleCapacity = 3): SceneQuality {
  return { detail: 1, pixelRatioCap: 1, particleCount: 12, rippleCapacity }
}

describe('shared liquid scene controller', () => {
  it('cleans only scene-owned resources and leaves the shared renderer alive', () => {
    const renderer = makeRenderer()
    const controller = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, scroll: 0 })
    controller.resize(800, 600, 1)
    controller.dispose()
    expect(renderer.dispose).not.toHaveBeenCalled()
  })

  it('keeps the sphere scale smooth while crossing story stages 03 to 04', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, scroll: 0 })
    scene.resize(1200, 800, 1)
    scene.render(1000)
    const renderMock = renderer.render as ReturnType<typeof vi.fn>
    const lastRenderedScene = () => renderMock.mock.calls[renderMock.mock.calls.length - 1]?.[0]
    const readSphereScale = () => {
      const renderedScene = lastRenderedScene() as { children: Array<{ scale: { x: number } }> }
      return renderedScene.children[0]?.scale.x ?? 0
    }
    const initialScale = readSphereScale()
    let previousScale = initialScale
    let maxScaleStep = 0
    let time = 1000
    const renderFrame = () => {
      time += 16
      scene.render(time)
      const scale = readSphereScale()
      maxScaleStep = Math.max(maxScaleStep, Math.abs(scale - previousScale))
      previousScale = scale
    }

    scene.setInput({ pointerX: 0, pointerY: 0, scroll: 0.779 })
    for (let frame = 0; frame < 120; frame += 1) renderFrame()
    const beforeBoundaryScale = readSphereScale()

    scene.setInput({ pointerX: 0, pointerY: 0, scroll: 0.781 })
    for (let frame = 0; frame < 120; frame += 1) renderFrame()
    const afterBoundaryScale = readSphereScale()

    scene.setInput({ pointerX: 0, pointerY: 0, scroll: 1 })
    for (let frame = 0; frame < 120; frame += 1) renderFrame()
    const orbScale = readSphereScale()
    expect(orbScale).toBeGreaterThan(initialScale)
    expect(Math.abs(afterBoundaryScale - beforeBoundaryScale)).toBeLessThan(0.03)
    expect(maxScaleStep).toBeLessThan(0.02)
    expect(orbScale).toBeLessThanOrEqual(1.2)
    scene.dispose()
  })

  it('eases sphere deformation while rapidly crossing story stage 03 to 04', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, scroll: 0.74 })
    scene.render(1000)
    scene.setInput({ pointerX: 0, pointerY: 0, scroll: 0.82 })
    scene.render(1016)

    const renderMock = renderer.render as ReturnType<typeof vi.fn>
    const lastRenderedScene = () => renderMock.mock.calls[renderMock.mock.calls.length - 1]?.[0]
    const renderedScene = lastRenderedScene() as {
      children: Array<{ material: { uniforms?: { uEnergy?: { value: number } } } }>
    }
    const deformationEnergy = renderedScene.children[0]?.material.uniforms?.uEnergy?.value ?? 0

    expect(deformationEnergy).toBeGreaterThan(0)
    expect(deformationEnergy).toBeLessThan(0.2)
    scene.dispose()
  })

  it('registers a ripple only when the full viewport ray hits the sphere', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, scroll: 0 }, sceneQuality())
    scene.resize(1000, 1000, 1)
    scene.render(1000)

    expect(scene.triggerRipple(0, 0)).toBe(true)
    expect(scene.triggerRipple(1, 1)).toBe(false)
    scene.render(1016)
    expect(lastRenderedScene(renderer).children[0]?.material.uniforms?.uRippleCount?.value).toBe(1)
    scene.dispose()
  })

  it('keeps ripple events in a fixed ring buffer and rejects input after dispose', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, scroll: 0 }, sceneQuality(2))
    scene.resize(1000, 1000, 1)
    scene.render(1000)

    expect(scene.triggerRipple(0, 0)).toBe(true)
    expect(scene.triggerRipple(0, 0)).toBe(true)
    expect(scene.triggerRipple(0, 0)).toBe(true)
    scene.render(1016)
    const uniforms = lastRenderedScene(renderer).children[0]?.material.uniforms
    expect(uniforms?.uRippleCount?.value).toBe(2)
    expect(uniforms?.uRippleCapacity?.value).toBe(2)

    scene.dispose()
    expect(scene.triggerRipple(0, 0)).toBe(false)
    expect(scene.beginPress(0, 0)).toBe(false)
    expect(() => scene.endPress()).not.toThrow()
  })

  it('turns hover off after the smoothed pointer leaves the sphere', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, scroll: 0 }, sceneQuality())
    scene.resize(1000, 1000, 1)
    scene.setInput({ pointerX: 0, pointerY: 0, scroll: 0 })
    scene.render(1000)
    expect(lastRenderedScene(renderer).children[0]?.material.uniforms?.uHoverActive?.value).toBe(1)

    scene.setInput({ pointerX: 1, pointerY: 1, scroll: 0 })
    for (let frame = 1; frame <= 120; frame += 1) scene.render(1000 + frame * 16)
    expect(lastRenderedScene(renderer).children[0]?.material.uniforms?.uHoverActive?.value).toBe(0)
    scene.dispose()
  })

  it('grows a local press to a capped depth and springs back after release', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, scroll: 0 }, sceneQuality())
    scene.resize(1000, 1000, 1)
    scene.render(1000)
    expect(scene.beginPress(0, 0)).toBe(true)

    scene.render(1100)
    const firstDepth = Number(lastRenderedScene(renderer).children[0]?.material.uniforms?.uPressDepth?.value)
    scene.render(1600)
    const heldDepth = Number(lastRenderedScene(renderer).children[0]?.material.uniforms?.uPressDepth?.value)
    expect(heldDepth).toBeGreaterThan(firstDepth)
    expect(heldDepth).toBeLessThanOrEqual(0.2)

    scene.endPress()
    for (let frame = 1; frame <= 120; frame += 1) scene.render(1600 + frame * 16)
    const releasedDepth = Number(lastRenderedScene(renderer).children[0]?.material.uniforms?.uPressDepth?.value)
    expect(releasedDepth).toBeLessThan(heldDepth)
    expect(scene.beginPress(1, 1)).toBe(false)
    scene.dispose()
  })

})
