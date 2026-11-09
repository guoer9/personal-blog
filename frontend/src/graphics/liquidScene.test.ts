// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { LinearFilter, Scene } from 'three'
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

function makeRenderTargetRenderer(): RendererAdapter {
  let currentTarget: unknown | null = null
  return {
    domElement: document.createElement('canvas'),
    setPixelRatio: vi.fn(),
    setSize: vi.fn(),
    setRenderTarget: vi.fn((target: unknown | null) => { currentTarget = target }),
    getRenderTarget: vi.fn(() => currentTarget),
    clear: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
  }
}

function lastRenderedScene(renderer: RendererAdapter) {
  const renderMock = renderer.render as ReturnType<typeof vi.fn>
  return renderMock.mock.calls[renderMock.mock.calls.length - 1]?.[0] as {
    children: Array<{ geometry: { drawRange: { count: number } }; material: { uniforms?: Record<string, { value: unknown }> } }>
  }
}

function sceneQuality(rippleCapacity = 3, particleCount = 100): SceneQuality {
  return { detail: 1, pixelRatioCap: 1, particleCount, rippleCapacity }
}

describe('shared liquid scene controller', () => {
  it('preserves the original sphere pose and pointer camera despite stale hero transition input', () => {
    const input = { pointerX: 0.7, pointerY: 0.4, pointerVelocity: { x: 0, y: 0 }, scroll: 0 }
    const baselineRenderer = makeRenderer()
    const renderer = makeRenderer()
    const baseline = createLiquidScene(baselineRenderer, input, sceneQuality())
    const controller = createLiquidScene(renderer, input, sceneQuality())
    baseline.resize(1200, 800, 1)
    controller.resize(1200, 800, 1)
    try {
      for (const progress of [0, 0.5, 1, 0.5, 0]) {
        // A stale caller must not resize, relocate or turn off pointer parallax.
        const staleInput = { ...input, heroProgress: progress, sphereTransition: { progress, x: 0.8, y: 0.2, diameter: 0.2 } }
        controller.setInput(staleInput)
        baseline.setInput(input)
        for (let frame = 1; frame <= 20; frame += 1) {
          const time = 1000 + (renderer.render as ReturnType<typeof vi.fn>).mock.calls.length * 16
          baseline.render(time)
          controller.render(time)
        }
        const actual = (renderer.render as ReturnType<typeof vi.fn>).mock.lastCall!
        const expected = (baselineRenderer.render as ReturnType<typeof vi.fn>).mock.lastCall!
        const sphere = (actual[0] as Scene).children[0]!
        const original = (expected[0] as Scene).children[0]!
        expect(sphere.scale.toArray()).toEqual(original.scale.toArray())
        expect(sphere.position.toArray()).toEqual(original.position.toArray())
        expect(sphere.rotation.toArray()).toEqual(original.rotation.toArray())
        expect(actual[1].position.toArray()).toEqual(expected[1].position.toArray())
        expect(sphere.position.x).toBe(0)
        expect(Math.abs(sphere.position.y)).toBeLessThanOrEqual(0.04)
        expect(sphere.scale.x).toBeGreaterThan(0.5)
        expect(actual[1].position.x).toBeGreaterThan(0)
      }
    } finally { controller.dispose(); baseline.dispose() }
  })
  it('cleans only scene-owned resources and leaves the shared renderer alive', () => {
    const renderer = makeRenderer()
    const controller = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 })
    controller.resize(800, 600, 1)
    controller.dispose()
    expect(renderer.dispose).not.toHaveBeenCalled()
  })

  it('keeps the sphere scale smooth while crossing story stages 03 to 04', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 })
    scene.resize(1200, 800, 1)
    scene.render(1000)
    const renderMock = renderer.render as ReturnType<typeof vi.fn>
    const lastRenderedScene = () => renderMock.mock.calls[renderMock.mock.calls.length - 1]?.[0]
    const readSphereScale = () => {
      const renderedScene = lastRenderedScene() as { children: Array<{ scale: { x: number } }> }
      return renderedScene.children[0]?.scale.x ?? 0
    }
    const initialScale = readSphereScale()
    expect(initialScale).toBeLessThan(0.7)
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

    scene.setInput({ pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0.779 })
    for (let frame = 0; frame < 120; frame += 1) renderFrame()
    const beforeBoundaryScale = readSphereScale()

    scene.setInput({ pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0.781 })
    for (let frame = 0; frame < 120; frame += 1) renderFrame()
    const afterBoundaryScale = readSphereScale()

    scene.setInput({ pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 1 })
    for (let frame = 0; frame < 120; frame += 1) renderFrame()
    const orbScale = readSphereScale()
    expect(orbScale).toBeGreaterThan(initialScale)
    expect(Math.abs(afterBoundaryScale - beforeBoundaryScale)).toBeLessThan(0.03)
    expect(maxScaleStep).toBeLessThan(0.02)
    expect(orbScale).toBeLessThanOrEqual(1.2)
    scene.dispose()
  })

  it('keeps the legacy full-sphere wireframe visible while glass facets remain separate', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 }, sceneQuality())
    scene.resize(800, 600, 1)
    scene.render(1000)
    const rendered = lastRenderedScene(renderer)
    expect((rendered.children[1] as unknown as { visible: boolean }).visible).toBe(true)
    scene.dispose()
  })

  it('eases sphere deformation while rapidly crossing story stage 03 to 04', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0.74 })
    scene.render(1000)
    scene.setInput({ pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0.82 })
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

  it('keeps the sphere center smooth across story boundaries after the page has been open for minutes', () => {
    for (const boundary of [0.18, 0.48, 0.78]) {
      const renderer = makeRenderer()
      const scene = createLiquidScene(renderer, {
        pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: boundary - 0.08,
      }, sceneQuality())
      scene.resize(1200, 800, 1)
      let time = 600_000
      scene.render(time)
      const readCenter = () => {
        const renderedScene = lastRenderedScene(renderer) as unknown as { children: Array<{ position: { y: number } }> }
        return renderedScene.children[0]!.position.y
      }
      let previousCenter = readCenter()
      let largestStep = 0

      for (let frame = 1; frame <= 120; frame += 1) {
        scene.setInput({
          pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 },
          scroll: boundary - 0.08 + 0.16 * frame / 120,
        })
        time += 1000 / 60
        scene.render(time)
        const center = readCenter()
        largestStep = Math.max(largestStep, Math.abs(center - previousCenter))
        previousCenter = center
      }

      expect(largestStep, `center movement near story progress ${boundary}`).toBeLessThan(0.003)
      scene.dispose()
    }
  })

  it('maps clicks outside the projected sphere to its nearest visible edge', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 }, sceneQuality())
    scene.resize(1000, 1000, 1)
    scene.render(1000)

    expect(scene.triggerRipple(0, 0)).toBe(true)
    expect(scene.triggerRipple(1, 1)).toBe(true)
    scene.render(1016)
    expect(lastRenderedScene(renderer).children[0]?.material.uniforms?.uRippleCount?.value).toBe(2)
    scene.dispose()
  })

  it('maps a touch press outside the projected sphere to the nearest visible edge', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 }, sceneQuality())
    scene.resize(390, 844, 2)
    scene.render(1000)

    expect(scene.beginPress(0, -0.92)).toBe(true)
    scene.render(1200)
    const heldDepth = Number(lastRenderedScene(renderer).children[0]?.material.uniforms?.uPressDepth?.value)
    expect(heldDepth).toBeGreaterThan(0)
    scene.endPress()
    scene.dispose()
  })

  it('renders a new ripple when the ring cursor reuses a slot after the active count drops', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 }, sceneQuality(2))
    scene.resize(1000, 1000, 1)
    scene.render(1000)
    expect(scene.triggerRipple(0, 0)).toBe(true)
    scene.render(3000)

    expect(scene.triggerRipple(0, 0)).toBe(true)
    scene.render(3016)
    const uniforms = lastRenderedScene(renderer).children[0]?.material.uniforms
    const strengths = uniforms?.uRippleStrengths?.value as Float32Array

    expect(uniforms?.uRippleCount?.value).toBe(1)
    expect(strengths[0]).toBe(0)
    expect(strengths[1]).toBeGreaterThan(0)
    scene.dispose()
  })

  it('keeps a first click queued until the first animation frame after a late scene mount', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 }, sceneQuality())
    scene.resize(1000, 800, 1)
    expect(scene.triggerRipple(0, 0)).toBe(true)
    scene.render(10000)
    expect(Number(renderer.domElement.dataset.sphereRippleCount)).toBe(1)
    scene.dispose()
  })

  it('keeps ripple events in a fixed ring buffer and rejects input after dispose', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 }, sceneQuality(2))
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
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 }, sceneQuality())
    scene.resize(1000, 1000, 1)
    scene.setInput({ pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 })
    scene.render(1000)
    expect(lastRenderedScene(renderer).children[0]?.material.uniforms?.uHoverActive?.value).toBe(1)

    scene.setInput({ pointerX: 1, pointerY: 1, pointerVelocity: { x: 0, y: 0 }, scroll: 0 })
    for (let frame = 1; frame <= 120; frame += 1) scene.render(1000 + frame * 16)
    expect(lastRenderedScene(renderer).children[0]?.material.uniforms?.uHoverActive?.value).toBe(0)
    scene.dispose()
  })

  it('grows a local press to a capped depth and springs back after release', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 }, sceneQuality())
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
    expect(scene.beginPress(1, 1)).toBe(true)
    scene.endPress()
    scene.dispose()
  })

  it('drives a bounded procedural trail from pointer velocity and lets it fade at rest', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 }, sceneQuality())
    scene.resize(1000, 1000, 1)
    scene.render(1000)
    const rendered = lastRenderedScene(renderer)
    const particles = rendered.children[2]
    const particleUniforms = particles?.material.uniforms

    scene.setInput({ pointerX: 0, pointerY: 0, pointerVelocity: { x: 2.2, y: 0.4 }, scroll: 0 })
    scene.render(1016)
    const movingStrength = Number(particleUniforms?.uTrailStrength?.value)
    expect(movingStrength).toBeGreaterThan(0)
    expect(movingStrength).toBeLessThanOrEqual(1)
    expect((particleUniforms?.uTrailDirection?.value as { x: number }).x).toBeGreaterThan(0)

    scene.setInput({ pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 })
    for (let frame = 1; frame <= 120; frame += 1) scene.render(1016 + frame * 16)
    expect(Number(particleUniforms?.uTrailStrength?.value)).toBeLessThan(movingStrength)
    scene.dispose()
  })

  it('uses a bounded decaying click impact and preserves particle resources across quality changes', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 }, sceneQuality(3, 100))
    scene.resize(1000, 1000, 1)
    scene.render(1000)
    const rendered = lastRenderedScene(renderer)
    const particles = rendered.children[2]
    const particleGeometry = particles?.geometry
    const particleUniforms = particles?.material.uniforms

    expect(scene.triggerRipple(0, 0)).toBe(true)
    scene.render(1016)
    const impact = Number(particleUniforms?.uImpactEnergy?.value)
    expect(impact).toBeGreaterThan(0)
    expect(impact).toBeLessThanOrEqual(1)
    for (let frame = 2; frame <= 120; frame += 1) scene.render(1000 + frame * 16)
    expect(Number(particleUniforms?.uImpactEnergy?.value)).toBeLessThan(impact)

    scene.setQualityTier('low')
    scene.render(3000)
    const lowQualityScene = lastRenderedScene(renderer)
    expect(lowQualityScene.children[2]).toBe(particles)
    expect(lowQualityScene.children[2]?.geometry).toBe(particleGeometry)
    expect(lowQualityScene.children[2]?.geometry.drawRange.count).toBeLessThan(100)
    scene.dispose()
  })

  it('updates the full velocity, glass, facet, and composite pipeline on a target-capable renderer', () => {
    const renderer = makeRenderTargetRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerPixelX: 40, pointerPixelY: 40, pointerVelocity: { x: 0, y: 0 }, scroll: 0 }, sceneQuality())
    scene.resize(800, 600, 1)
    const renderTargetMock = renderer.setRenderTarget as ReturnType<typeof vi.fn>
    renderTargetMock.mockClear()
    scene.render(1000)

    const countVelocityTargetBinds = () => (renderer.setRenderTarget as ReturnType<typeof vi.fn>).mock.calls.filter(([target]) => {
      const renderTarget = target as { width?: number; height?: number } | null
      return renderTarget?.width === 200 && renderTarget.height === 150
    }).length
    expect(countVelocityTargetBinds()).toBe(1)

    scene.setInput({ pointerX: 0.35, pointerY: -0.2, pointerPixelX: 540, pointerPixelY: 360, pointerVelocity: { x: 1, y: -0.2 }, scroll: 0 })
    scene.render(1016)

    expect(renderer.setRenderTarget).toHaveBeenCalled()
    expect((renderer.render as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(5)
    expect(countVelocityTargetBinds()).toBe(3)
    const targets = (renderer.setRenderTarget as ReturnType<typeof vi.fn>).mock.calls
      .map(([target]) => target as { texture?: { minFilter?: number; magFilter?: number } } | null)
      .filter((target): target is { texture: { minFilter?: number; magFilter?: number } } => Boolean(target?.texture))
    expect(targets.length).toBeGreaterThan(0)
    expect(targets.every(({ texture }) => texture.minFilter === LinearFilter && texture.magFilter === LinearFilter)).toBe(true)
    expect(renderer.domElement.dataset.glassPass).toBe('composite')
    expect(renderer.domElement.dataset.sphereCompositeSamples).toBe('9')
    expect(Number(renderer.domElement.dataset.sphereFacetCount)).toBeGreaterThan(0)

    scene.setQualityTier('low')
    scene.render(1016)
    expect(renderer.domElement.dataset.sphereCompositeSamples).toBe('9')
    scene.dispose()
  })

  it('resets the pointer field origin after a resize to avoid a false cross-screen stroke', () => {
    const renderer = makeRenderTargetRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerPixelX: 40, pointerPixelY: 40, pointerVelocity: { x: 0, y: 0 }, scroll: 0 }, sceneQuality())
    scene.resize(800, 600, 1)
    scene.render(1000)

    scene.setInput({ pointerX: 0.25, pointerY: 0, pointerPixelX: 500, pointerPixelY: 300, pointerVelocity: { x: 1, y: 0 }, scroll: 0 })
    scene.render(1016)
    expect(renderer.domElement.dataset.sphereVelocityStroke).toBe('1')

    scene.resize(1200, 800, 1)
    scene.render(1032)
    expect(renderer.domElement.dataset.sphereVelocityStroke).toBe('0')
    scene.dispose()
  })

  it('keeps the pointer-following glass blob hidden while hover facets remain available', () => {
    const renderer = makeRenderTargetRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerPixelX: 400, pointerPixelY: 300, pointerVelocity: { x: 0, y: 0 }, scroll: 0 }, sceneQuality())
    scene.resize(800, 600, 1)
    scene.render(1000)

    const renderCalls = (renderer.render as ReturnType<typeof vi.fn>).mock.calls
    const glassScene = renderCalls
      .map(([renderedScene]) => renderedScene)
      .find((renderedScene): renderedScene is Scene => renderedScene instanceof Scene && renderedScene.children.some(child => child.renderOrder === 10))

    expect(renderer.domElement.dataset.sphereGlassBlob).toBe('hidden')
    expect(glassScene?.children.find(child => child.renderOrder === 10)?.visible).toBe(false)
    expect(glassScene?.children.find(child => child.renderOrder === 11)?.visible).toBe(true)
    scene.dispose()
  })

  it('makes a held dent visible within a short hold and allows an elastic overshoot on release', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 }, sceneQuality())
    scene.resize(1000, 800, 1)
    scene.render(1000)
    scene.beginPress(0, 0)
    for (let frame = 1; frame <= 25; frame += 1) scene.render(1000 + frame * 16)
    const uniforms = lastRenderedScene(renderer).children[0]?.material.uniforms
    expect(Number(uniforms?.uPressDepth?.value)).toBeGreaterThan(0.12)
    scene.endPress()
    let minDepth = 0
    for (let frame = 1; frame <= 100; frame += 1) {
      scene.render(1400 + frame * 16)
      minDepth = Math.min(minDepth, Number(uniforms?.uPressDepth?.value))
    }
    expect(minDepth).toBeLessThan(0)
    expect(Number(uniforms?.uPressDepth?.value)).toBeCloseTo(0, 2)
    scene.dispose()
  })

  it('keeps rotation velocity continuous when fast scroll input reverses direction', () => {
    const renderer = makeRenderer()
    const scene = createLiquidScene(renderer, { pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0.3 }, sceneQuality())
    scene.resize(1000, 800, 1)
    scene.render(1000)
    const scroll = () => Number(lastRenderedScene(renderer).children[0]?.material.uniforms?.uScroll?.value)
    scene.setInput({ pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0.8 })
    let before = scroll()
    for (let frame = 1; frame <= 12; frame += 1) { before = scroll(); scene.render(1000 + frame * 16) }
    const previousStep = scroll() - before
    before = scroll()
    scene.setInput({ pointerX: 0, pointerY: 0, pointerVelocity: { x: 0, y: 0 }, scroll: 0 })
    scene.render(1208)
    expect(Math.abs((scroll() - before) - previousStep)).toBeLessThan(0.012)
    scene.dispose()
  })

})
