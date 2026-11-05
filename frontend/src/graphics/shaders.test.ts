import { describe, expect, it } from 'vitest'
import { flowFragmentShader, flowVertexShader, particleFragmentShader, particleVertexShader } from './shaders'

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

  it('uses spherical ripple age and bounded press depth for vertex deformation', () => {
    expect(flowVertexShader).toContain('uniform vec3 uRippleDirections[MAX_RIPPLES];')
    expect(flowVertexShader).toContain('uniform float uRippleAges[MAX_RIPPLES];')
    expect(flowVertexShader).toContain('exp(-pow')
    expect(flowVertexShader).toContain('min(uPressDepth, PRESS_DEPTH_MAX)')
    expect(flowVertexShader).not.toContain('step(float(index), float(uRippleCount - 1))')
  })

  it('keeps hover and click feedback as separate bounded light responses', () => {
    expect(flowFragmentShader).toContain('varying float vRippleLight;')
    expect(flowFragmentShader).toContain('uHoverStrength * 0.12')
    expect(flowFragmentShader).toContain('vRippleLight * 0.42')
  })

  it('cycles finite trail particles along pointer direction and fades their alpha', () => {
    expect(particleVertexShader).toContain('uniform vec2 uPointerVelocity;')
    expect(particleVertexShader).toContain('uniform float uTrailStrength;')
    expect(particleVertexShader).toContain('fract(uTime *')
    expect(particleVertexShader).toContain('smoothstep(0.55, 1.0, trailAge)')
    expect(particleVertexShader).toContain('uTrailDirection')
    expect(particleVertexShader).toContain('max(smoothstep(0.08, 0.22, uScroll), smoothstep(0.02, 0.2, max(uTrailStrength, uImpactEnergy)))')
    expect(particleFragmentShader).toContain('vTrailAlpha')
  })

})
