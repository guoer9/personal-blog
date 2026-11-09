import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createVisualState } from '../../runtime/VisualState'
import type { LiquidSceneController } from '../../liquidScene'
import { HomeScene } from './HomeScene'

const mocks = vi.hoisted(() => ({ createLiquidScene: vi.fn(), createPortraitEffect: vi.fn() }))
vi.mock('@/graphics/liquidScene', () => ({ createLiquidScene: mocks.createLiquidScene }))
vi.mock('./PortraitEffect', () => ({ createPortraitEffect: mocks.createPortraitEffect }))

describe('HomeScene quality adaptation', () => {
  beforeEach(() => { mocks.createLiquidScene.mockReset(); mocks.createPortraitEffect.mockReset() })

  it('can run the performance stage without loading the demonstration portrait', () => {
    const liquid = { setInput: vi.fn(), setQualityTier: vi.fn(), dispose: vi.fn(), render: vi.fn() }
    mocks.createLiquidScene.mockReturnValue(liquid)
    const scene = new HomeScene(undefined, false)
    scene.mount({ renderer: {} } as never)
    scene.update(createVisualState(), { paused: false, interaction: null })
    scene.render({ visualState: createVisualState() } as never)
    expect(mocks.createPortraitEffect).not.toHaveBeenCalled()
    expect(liquid.render).toHaveBeenCalledOnce()
    scene.dispose()
  })

  it('reads current audio analysis from the shared frame without changing sphere framing inputs', () => {
    const liquid = { setInput: vi.fn(), setQualityTier: vi.fn(), dispose: vi.fn() }
    mocks.createLiquidScene.mockReturnValue(liquid)
    const features = { bass: .2, mid: .3, treble: .1, energy: .25, active: true }
    const scene = new HomeScene(features, false)
    scene.mount({ renderer: {} } as never)
    scene.update(createVisualState(), { paused: false, interaction: null })
    expect(liquid.setInput).toHaveBeenLastCalledWith(expect.objectContaining({ audio: features, scroll: 0 }))
    features.bass = .8
    scene.update(createVisualState(), { paused: false, interaction: null })
    expect(liquid.setInput.mock.lastCall?.[0].audio.bass).toBe(.8)
    scene.dispose()
  })

  it('uses section progress including zero and restores document progress when omitted', () => {
    const liquid = { setInput: vi.fn(), setQualityTier: vi.fn(), dispose: vi.fn() }
    mocks.createLiquidScene.mockReturnValue(liquid)
    const scene = new HomeScene()
    scene.mount({ renderer: {} } as never)
    const visual = createVisualState({ documentProgress: 0.7 })
    try {
      for (const [sceneProgress, expected] of [[0.3, 0.3], [0, 0], [1, 1], [undefined, 0.7]] as const) {
        scene.update(visual, { paused: false, interaction: null, sceneProgress })
        expect(liquid.setInput).toHaveBeenLastCalledWith(expect.objectContaining({ scroll: expected }))
      }
    } finally { scene.dispose() }
  })

  it('keeps the liquid scene inputs independent of portrait exit and obsolete writing anchors', () => {
    const liquid = { setInput: vi.fn(), setQualityTier: vi.fn(), dispose: vi.fn() }
    const portrait = { update: vi.fn(), dispose: vi.fn() }
    mocks.createLiquidScene.mockReturnValue(liquid)
    mocks.createPortraitEffect.mockReturnValue(portrait)
    const scene = new HomeScene()
    const getAnchor = vi.fn(() => ({ left: 1000, top: 300, width: 160, height: 160 }))
    const visual = createVisualState({ viewportWidth: 1200, viewportHeight: 800, pointerX: 0.3, pointerY: -0.2, documentProgress: 0.4 })
    scene.mount({ renderer: {}, anchors: { get: getAnchor } } as never)
    try {
      for (const progress of [0, 0.5, 1, 0]) {
        const pageState = { paused: false, interaction: null, heroDeparture: progress, portraitExitProgress: progress }
        scene.update(visual, pageState)
        expect(liquid.setInput).toHaveBeenLastCalledWith({
          pointerX: 0.3, pointerY: -0.2, pointerPixelX: 0, pointerPixelY: 0,
          pointerVelocity: { x: 0, y: 0 }, scroll: 0.4,
        })
        expect(portrait.update).toHaveBeenLastCalledWith(visual, 'front', false, progress)
      }
      expect(getAnchor).not.toHaveBeenCalled()
    } finally { scene.dispose() }
  })

  it('composites portraits after liquid and keeps manual selection current while paused', () => {
    const rendered: string[] = []
    const liquid = { setInput: vi.fn(), setQualityTier: vi.fn(), resize: vi.fn(), render: () => rendered.push('liquid'), dispose: vi.fn() }
    const portrait = { update: vi.fn(), resize: vi.fn(), render: () => rendered.push('portrait'), dispose: vi.fn() }
    mocks.createLiquidScene.mockReturnValue(liquid)
    mocks.createPortraitEffect.mockReturnValue(portrait)
    const scene = new HomeScene()
    const context = { renderer: {} as never } as never
    const visualState = createVisualState()
    scene.mount(context)
    scene.resize(1200, 900, 2)
    scene.update(visualState, { paused: false, interaction: null, portraitMode: 'bass', portraitPointerActive: true, portraitExitProgress: 0.4 } as never)
    scene.render({ visualState } as never)
    expect(rendered).toEqual(['liquid', 'portrait'])
    expect(portrait.update).toHaveBeenLastCalledWith(visualState, 'bass', true, 0.4)
    expect(portrait.resize).toHaveBeenCalledWith(1200, 900, 2)

    scene.update(visualState, { paused: true, interaction: null, portraitMode: 'front' } as never)
    scene.render({ visualState } as never)
    expect(rendered).toEqual(['liquid', 'portrait'])
    expect(portrait.update).toHaveBeenLastCalledWith(visualState, 'front', false, 0)
    scene.dispose()
    expect(portrait.dispose).toHaveBeenCalledOnce()
    expect(liquid.dispose).toHaveBeenCalledOnce()
  })

  it('forwards runtime quality tiers to the liquid scene controller', () => {
    const controller = { setInput: vi.fn(), setQualityTier: vi.fn(), resize: vi.fn(), render: vi.fn(), dispose: vi.fn() }
    mocks.createLiquidScene.mockReturnValue(controller as unknown as LiquidSceneController)
    const scene = new HomeScene()
    scene.mount({ renderer: {} as never } as never)

    scene.update({ ...createVisualState(), qualityTier: 'low' }, { paused: false, interaction: null })

    expect(controller.setQualityTier).toHaveBeenCalledWith('low')
    scene.dispose()
  })

  it('dispatches each sequenced sphere interaction once when motion is enabled', () => {
    const controller = {
      setInput: vi.fn(),
      setQualityTier: vi.fn(),
      triggerRipple: vi.fn(),
      beginPress: vi.fn(),
      endPress: vi.fn(),
      resize: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    }
    mocks.createLiquidScene.mockReturnValue(controller as unknown as LiquidSceneController)
    const scene = new HomeScene()
    scene.mount({ renderer: {} as never } as never)
    const visualState = { ...createVisualState(), reducedMotion: false }

    const tap = { sequence: 1, type: 'tap', ndcX: -0.2, ndcY: 0.4 }
    scene.update(visualState, { paused: false, interaction: tap } as never)
    scene.update(visualState, { paused: false, interaction: tap } as never)
    expect(controller.triggerRipple).toHaveBeenCalledTimes(1)
    expect(controller.triggerRipple).toHaveBeenCalledWith(-0.2, 0.4)

    const pressStart = { sequence: 2, type: 'press-start', ndcX: 0.1, ndcY: -0.3 }
    const pressEnd = { sequence: 3, type: 'press-end', ndcX: 0.1, ndcY: -0.3 }
    const drag = { sequence: 4, type: 'drag', ndcX: 0.2, ndcY: -0.1 }
    scene.update(visualState, { paused: false, interaction: pressStart } as never)
    scene.update(visualState, { paused: false, interaction: pressEnd } as never)
    scene.update(visualState, { paused: false, interaction: drag } as never)
    expect(controller.beginPress).toHaveBeenCalledWith(0.1, -0.3)
    expect(controller.endPress).toHaveBeenCalledTimes(1)
    expect(controller.triggerRipple).toHaveBeenCalledWith(0.2, -0.1)
    scene.dispose()
  })

  it('consumes interactions while paused or reduced motion without replaying them later', () => {
    const controller = {
      setInput: vi.fn(),
      setQualityTier: vi.fn(),
      triggerRipple: vi.fn(),
      beginPress: vi.fn(),
      endPress: vi.fn(),
      resize: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    }
    mocks.createLiquidScene.mockReturnValue(controller as unknown as LiquidSceneController)
    const scene = new HomeScene()
    scene.mount({ renderer: {} as never } as never)
    const tap = { sequence: 1, type: 'tap', ndcX: 0, ndcY: 0 }

    scene.update({ ...createVisualState(), reducedMotion: false }, { paused: true, interaction: tap } as never)
    scene.update({ ...createVisualState(), reducedMotion: true }, { paused: false, interaction: { ...tap, sequence: 2 } } as never)
    scene.update({ ...createVisualState(), reducedMotion: false }, { paused: false, interaction: { ...tap, sequence: 2 } } as never)

    expect(controller.triggerRipple).not.toHaveBeenCalled()
    expect(controller.beginPress).not.toHaveBeenCalled()
    expect(controller.endPress).not.toHaveBeenCalled()
    scene.dispose()
  })

  it('ends an active press even when reduced motion becomes enabled', () => {
    const controller = {
      setInput: vi.fn(),
      setQualityTier: vi.fn(),
      triggerRipple: vi.fn(),
      beginPress: vi.fn(),
      endPress: vi.fn(),
      resize: vi.fn(),
      render: vi.fn(),
      dispose: vi.fn(),
    }
    mocks.createLiquidScene.mockReturnValue(controller as unknown as LiquidSceneController)
    const scene = new HomeScene()
    scene.mount({ renderer: {} as never } as never)

    scene.update({ ...createVisualState(), reducedMotion: false }, {
      paused: false,
      interaction: { sequence: 1, type: 'press-start', ndcX: 0, ndcY: 0 },
    } as never)
    scene.update({ ...createVisualState(), reducedMotion: true }, {
      paused: false,
      interaction: { sequence: 2, type: 'press-end', ndcX: 0, ndcY: 0 },
    } as never)

    expect(controller.beginPress).toHaveBeenCalledOnce()
    expect(controller.endPress).toHaveBeenCalledOnce()
    scene.dispose()
  })

})
