import { describe, expect, it } from 'vitest'
import { flowFragmentShader, flowVertexShader, particleVertexShader } from './shaders'

describe('motion energy shaders', () => {
  it('keeps sphere deformation gradual across the 03 to 04 scroll interval', () => {
    expect(flowVertexShader).toContain('sin(uScroll * 14.0 + length(p) * 2.8)')
  })

  it('uses input energy to amplify the main form and its light response', () => {
    expect(flowVertexShader).toContain('uniform float uEnergy;')
    expect(flowVertexShader).toContain('deformation *= 1.0 + uEnergy * 0.45;')
    expect(flowFragmentShader).toContain('uniform float uEnergy;')
    expect(flowFragmentShader).toContain('* uEnergy * 0.12;')
  })

  it('spreads and brightens particles while input energy is active', () => {
    expect(particleVertexShader).toContain('uniform float uEnergy;')
    expect(particleVertexShader).toContain('uEnergy * (0.06 + aSeed * 0.1)')
    expect(particleVertexShader).toContain('(1.0 + uEnergy * 0.9)')
    expect(particleVertexShader).toContain('(0.65 + uEnergy * 0.35)')
  })

})
