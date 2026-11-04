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
})
