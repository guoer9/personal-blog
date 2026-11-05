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

    scene.update({ ...createVisualState(), qualityTier: 'low' }, { paused: false })

    expect(controller.setQualityTier).toHaveBeenCalledWith('low')
    scene.dispose()
  })

})
