import { describe, expect, it } from 'vitest'
import {
  glassBlobFragmentShader,
  glassBlobVertexShader,
  glassCompositeFragmentShader,
  glassCompositeVertexShader,
  glassFacetFragmentShader,
  glassFacetVertexShader,
  velocityAdvectFragmentShader,
  velocityAdvectVertexShader,
  velocitySplatFragmentShader,
} from './glassShaders'

describe('glass pointer shader contracts', () => {
  it('advects and dissipates a packed velocity and weight field', () => {
    expect(velocityAdvectVertexShader).toContain('varying vec2 vUv;')
    expect(velocityAdvectFragmentShader).toContain('uPrevPaint')
    expect(velocityAdvectFragmentShader).toContain('uLowPaint')
    expect(velocityAdvectFragmentShader).toContain('uVelocityDissipation')
    expect(velocityAdvectFragmentShader).toContain('uWeight1Dissipation')
    expect(velocityAdvectFragmentShader).toContain('uWeight2Dissipation')
    expect(velocityAdvectFragmentShader).toContain('uUseNoise')
    expect(velocityAdvectFragmentShader).toContain('uCurlScale')
    expect(velocityAdvectFragmentShader).toContain('uCurlStrength')
    expect(velocitySplatFragmentShader).toContain('uPointer')
    expect(velocitySplatFragmentShader).toContain('uPrevPointer')
    expect(velocitySplatFragmentShader).toContain('uPushStrength')
  })

  it('composites the scene with bounded directional samples and RGB dispersion', () => {
    expect(glassCompositeVertexShader).toContain('varying vec2 vUv;')
    expect(glassCompositeFragmentShader).toContain('uTexture')
    expect(glassCompositeFragmentShader).toContain('uVelocityTexture')
    expect(glassCompositeFragmentShader).toContain('uAmount')
    expect(glassCompositeFragmentShader).toContain('uMultiplier')
    expect(glassCompositeFragmentShader).toContain('uRgbShift')
    expect(glassCompositeFragmentShader).toContain('uColorMultiplier')
    expect(glassCompositeFragmentShader).toContain('uScrollOffset')
    expect(glassCompositeFragmentShader).toContain('for (int index = 0; index < 9; index += 1)')
    expect(glassCompositeFragmentShader).toContain('vec3(0.0, 2.0, 4.0)')
  })

  it('provides refractive blob and derivative-based broken-glass shaders', () => {
    expect(glassBlobVertexShader).toContain('vWorldPosition')
    expect(glassBlobFragmentShader).toContain('refract')
    expect(glassBlobFragmentShader).toContain('reflect')
    expect(glassBlobFragmentShader).toContain('fresnel')
    expect(glassBlobFragmentShader).toContain('uSceneTexture')
    expect(glassFacetVertexShader).toContain('vViewPosition')
    expect(glassFacetFragmentShader).toContain('dFdx(vViewPosition)')
    expect(glassFacetFragmentShader).toContain('dFdy(vViewPosition)')
    expect(glassFacetFragmentShader).toContain('uSceneTexture')
    expect(glassFacetFragmentShader).toContain('uEdgeColor')
  })
})
