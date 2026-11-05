import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createVisualState } from '../../runtime/VisualState'
import type { LiquidSceneController } from '../../liquidScene'
import { HomeScene } from './HomeScene'

const mocks = vi.hoisted(() => ({ createLiquidScene: vi.fn() }))
vi.mock('@/graphics/liquidScene', () => ({ createLiquidScene: mocks.createLiquidScene }))

describe('HomeScene quality adaptation', () => {
  beforeEach(() => mocks.createLiquidScene.mockReset())

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
