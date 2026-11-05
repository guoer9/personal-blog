// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { createLiquidScene } from './liquidScene'
import type { RendererAdapter } from './runtime/types'

describe('shared liquid scene controller', () => {
  it('cleans only scene-owned resources and leaves the shared renderer alive', () => {
    const renderer: RendererAdapter = {
      domElement: document.createElement('canvas'),
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    }
    const controller = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, scroll: 0 })
    controller.resize(800, 600, 1)
    controller.dispose()
    expect(renderer.dispose).not.toHaveBeenCalled()
  })

  it('keeps the sphere scale smooth while crossing story stages 03 to 04', () => {
    const renderer: RendererAdapter = {
      domElement: document.createElement('canvas'),
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    }
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
    const renderer: RendererAdapter = {
      domElement: document.createElement('canvas'),
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    }
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

})
