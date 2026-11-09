import { describe, expect, it, vi } from 'vitest'
import type { ShaderMaterial, WebGLRenderTarget } from 'three'
import { PortraitFluid } from './PortraitFluid'

describe('portrait fluid projection', () => {
  it('advects, injects force, projects pressure and advects dye into independent targets', () => {
    const passes: { target: WebGLRenderTarget; name: string }[] = []
    const fluid = new PortraitFluid((target, material) => passes.push({ target, name: material.name }))
    fluid.resize(100, 160, 'high')
    fluid.step(1 / 60, { x: 0.4, y: 0.7, dx: 0.05, dy: -0.02 })
    const steps = passes.map((pass) => pass.name).filter((name) => !name.startsWith('portrait-fluid-clear'))
    expect(steps.slice(0, 3)).toEqual(['portrait-fluid-advection', 'portrait-fluid-force', 'portrait-fluid-divergence'])
    expect(steps.filter((name) => name === 'portrait-fluid-pressure')).toHaveLength(14)
    expect(steps.slice(-3)).toEqual(['portrait-fluid-gradient', 'portrait-fluid-dye-advection', 'portrait-fluid-dye-splat'])
    expect(new Set(passes.map((pass) => pass.target)).size).toBe(7)
    const dyePass = passes[passes.length - 1]!
    expect(fluid.texture).toBe(dyePass.target.texture)
    expect(fluid.texture).not.toBe(fluid.velocityTexture)
    fluid.dispose()
  })

  it('does not inject a stale pointer when the pointer leaves the portrait', () => {
    let force: ShaderMaterial | undefined
    const fluid = new PortraitFluid((_target, material) => { if (material.name === 'portrait-fluid-force') force = material })
    fluid.resize(100, 160, 'low')
    fluid.step(1 / 60, null)
    expect(force!.uniforms.uPointerActive!.value).toBe(0)
    fluid.dispose()
  })

  it('resizes and disposes every target once and stops rendering after disposal', () => {
    const targets = new Set<WebGLRenderTarget>()
    const pass = vi.fn((target: WebGLRenderTarget) => { targets.add(target) })
    const fluid = new PortraitFluid(pass)
    fluid.resize(80, 120, 'low')
    fluid.step(1 / 60, null)
    const disposeSpies = [...targets].map((target) => vi.spyOn(target, 'dispose'))
    fluid.resize(160, 240, 'high')
    expect([...targets].every((target) => target.width === 160 && target.height === 240)).toBe(true)
    fluid.dispose()
    fluid.dispose()
    pass.mockClear()
    fluid.step(1 / 60, null)
    expect(pass).not.toHaveBeenCalled()
    // Three also disposes old GPU storage on setSize; the explicit final disposal occurs once.
    expect(disposeSpies.every((spy) => spy.mock.calls.length === 2)).toBe(true)
  })
})
