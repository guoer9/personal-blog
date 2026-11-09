import { ClampToEdgeWrapping, LinearFilter, NoColorSpace, ShaderMaterial, Vector2, WebGLRenderTarget } from 'three'
import type { QualityTier } from '../../runtime/types'
import {
  fluidAdvectionFragment, fluidClearFragment, fluidDivergenceFragment, fluidForceFragment,
  fluidGradientFragment, fluidPressureFragment, portraitFullscreenVertex,
} from './portraitShaders'

export interface PortraitFluidPointer { x: number; y: number; dx: number; dy: number }
export type PortraitFluidPass = (target: WebGLRenderTarget, material: ShaderMaterial) => void

/** Pressure-projected velocity and advected density, independent of the liquid background. */
export class PortraitFluid {
  private readonly pass: PortraitFluidPass
  private readonly targets = Array.from({ length: 7 }, () => {
    const target = new WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter })
    target.texture.colorSpace = NoColorSpace
    target.texture.wrapS = target.texture.wrapT = ClampToEdgeWrapping
    target.texture.generateMipmaps = false
    return target
  })
  private velocityRead = this.targets[0]!
  private velocityWrite = this.targets[1]!
  private pressureRead = this.targets[2]!
  private pressureWrite = this.targets[3]!
  private readonly divergence = this.targets[4]!
  private dyeRead = this.targets[5]!
  private dyeWrite = this.targets[6]!
  private readonly texel = new Vector2(1, 1)
  private readonly size = new Vector2(1, 1)
  private readonly pointer = new Vector2(0.5, 0.5)
  private readonly force = new Vector2()
  private initialized = false
  private disposed = false
  private iterations = 14

  private material(name: string, fragmentShader: string, uniforms: ShaderMaterial['uniforms']) {
    const material = new ShaderMaterial({ vertexShader: portraitFullscreenVertex, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false })
    material.name = `portrait-fluid-${name}`
    return material
  }
  private readonly clear = this.material('clear', fluidClearFragment, { uSigned: { value: 1 } })
  private readonly advection = this.material('advection', fluidAdvectionFragment, {
    uVelocity: { value: null }, uSource: { value: null }, uTexel: { value: this.texel }, uDelta: { value: 1 / 60 },
    uDissipation: { value: 1 }, uIsDye: { value: 0 },
  })
  private readonly externalForce = this.material('force', fluidForceFragment, {
    uSource: { value: null }, uPointer: { value: this.pointer }, uForce: { value: this.force }, uSize: { value: this.size },
    uPointerActive: { value: 0 }, uRadius: { value: 0.11 }, uIsDye: { value: 0 }, uDyeAmount: { value: 0 },
  })
  private readonly divergenceMaterial = this.material('divergence', fluidDivergenceFragment, { uVelocity: { value: null }, uTexel: { value: this.texel } })
  private readonly pressure = this.material('pressure', fluidPressureFragment, {
    uPressure: { value: null }, uDivergence: { value: this.divergence.texture }, uTexel: { value: this.texel },
  })
  private readonly gradient = this.material('gradient', fluidGradientFragment, {
    uVelocity: { value: null }, uPressure: { value: null }, uTexel: { value: this.texel },
  })
  private readonly dyeAdvection = this.material('dye-advection', fluidAdvectionFragment, {
    uVelocity: { value: null }, uSource: { value: null }, uTexel: { value: this.texel }, uDelta: { value: 1 / 60 },
    uDissipation: { value: 1 }, uIsDye: { value: 1 },
  })
  private readonly dyeSplat = this.material('dye-splat', fluidForceFragment, {
    uSource: { value: null }, uPointer: { value: this.pointer }, uForce: { value: this.force }, uSize: { value: this.size },
    uPointerActive: { value: 0 }, uRadius: { value: 0.11 }, uIsDye: { value: 1 }, uDyeAmount: { value: 0 },
  })

  constructor(pass: PortraitFluidPass) { this.pass = pass }

  get texture() { return this.dyeRead.texture }
  get velocityTexture() { return this.velocityRead.texture }
  get texelSize(): Readonly<Vector2> { return this.texel }

  resize(width: number, height: number, tier: QualityTier): void {
    if (this.disposed) return
    const w = Math.max(1, Math.round(Number.isFinite(width) ? width : 1))
    const h = Math.max(1, Math.round(Number.isFinite(height) ? height : 1))
    this.iterations = tier === 'high' ? 14 : tier === 'balanced' ? 10 : 6
    if (this.size.x === w && this.size.y === h) return
    this.size.set(w, h)
    this.texel.set(1 / w, 1 / h)
    this.targets.forEach((target) => target.setSize(w, h))
    this.initialized = false
  }

  step(delta: number, pointer: PortraitFluidPointer | null): void {
    if (this.disposed) return
    const dt = Math.min(1 / 30, Math.max(0, Number.isFinite(delta) ? delta : 1 / 60))
    if (!this.initialized) {
      this.clear.uniforms.uSigned!.value = 1
      for (const target of this.targets.slice(0, 5)) this.pass(target, this.clear)
      this.clear.uniforms.uSigned!.value = 0
      this.pass(this.dyeRead, this.clear)
      this.pass(this.dyeWrite, this.clear)
      this.initialized = true
    }
    const active = pointer && [pointer.x, pointer.y, pointer.dx, pointer.dy].every(Number.isFinite)
      && pointer.x >= 0 && pointer.x <= 1 && pointer.y >= 0 && pointer.y <= 1
    this.force.set(0, 0)
    if (active) {
      this.pointer.set(pointer.x, pointer.y)
      this.force.set(pointer.dx * this.size.x * 0.65, pointer.dy * this.size.y * 0.65).clampScalar(-6, 6)
    }
    const dyeAmount = active ? Math.min(0.95, 0.24 + Math.hypot(this.force.x, this.force.y) * 0.15) : 0
    this.externalForce.uniforms.uPointerActive!.value = active ? 1 : 0
    this.dyeSplat.uniforms.uPointerActive!.value = active ? 1 : 0
    this.dyeSplat.uniforms.uDyeAmount!.value = dyeAmount

    this.advection.uniforms.uVelocity!.value = this.velocityRead.texture
    this.advection.uniforms.uSource!.value = this.velocityRead.texture
    this.advection.uniforms.uDelta!.value = dt
    this.advection.uniforms.uDissipation!.value = Math.exp(-1.7 * dt)
    this.pass(this.velocityWrite, this.advection)
    this.swapVelocity()
    this.externalForce.uniforms.uSource!.value = this.velocityRead.texture
    this.pass(this.velocityWrite, this.externalForce)
    this.swapVelocity()
    this.divergenceMaterial.uniforms.uVelocity!.value = this.velocityRead.texture
    this.pass(this.divergence, this.divergenceMaterial)
    this.clear.uniforms.uSigned!.value = 1
    this.pass(this.pressureRead, this.clear)
    for (let index = 0; index < this.iterations; index += 1) {
      this.pressure.uniforms.uPressure!.value = this.pressureRead.texture
      this.pass(this.pressureWrite, this.pressure)
      ;[this.pressureRead, this.pressureWrite] = [this.pressureWrite, this.pressureRead]
    }
    this.gradient.uniforms.uVelocity!.value = this.velocityRead.texture
    this.gradient.uniforms.uPressure!.value = this.pressureRead.texture
    this.pass(this.velocityWrite, this.gradient)
    this.swapVelocity()
    this.dyeAdvection.uniforms.uVelocity!.value = this.velocityRead.texture
    this.dyeAdvection.uniforms.uSource!.value = this.dyeRead.texture
    this.dyeAdvection.uniforms.uDelta!.value = dt
    this.dyeAdvection.uniforms.uDissipation!.value = Math.exp(-1.9 * dt)
    this.pass(this.dyeWrite, this.dyeAdvection)
    this.swapDye()
    this.dyeSplat.uniforms.uSource!.value = this.dyeRead.texture
    this.pass(this.dyeWrite, this.dyeSplat)
    this.swapDye()
  }

  private swapVelocity() { [this.velocityRead, this.velocityWrite] = [this.velocityWrite, this.velocityRead] }
  private swapDye() { [this.dyeRead, this.dyeWrite] = [this.dyeWrite, this.dyeRead] }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.targets.forEach((target) => target.dispose())
    ;[this.clear, this.advection, this.externalForce, this.divergenceMaterial, this.pressure, this.gradient, this.dyeAdvection, this.dyeSplat].forEach((material) => material.dispose())
  }
}
