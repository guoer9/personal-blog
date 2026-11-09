// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Color, Mesh, MeshStandardMaterial, NoColorSpace, Scene, ShaderMaterial, SRGBColorSpace, Texture, TextureLoader, Vector4, WebGLRenderTarget } from 'three'
import type { SceneContext } from '../../runtime/types'
import { createVisualState } from '../../runtime/VisualState'
import { createPortraitEffect } from './PortraitEffect'
import { PortraitFluid } from './PortraitFluid'

function context() {
  let target: WebGLRenderTarget | null = new WebGLRenderTarget(7, 9)
  let clearColor = new Color(0x123456)
  let clearAlpha = 0.6
  let viewport = new Vector4(3, 5, 1100, 800)
  let scissor = new Vector4(7, 8, 900, 700)
  let scissorTest = true
  const calls: { target: WebGLRenderTarget | null; scene: Scene; material?: ShaderMaterial; autoClear: boolean }[] = []
  const renderer = {
    domElement: document.createElement('canvas'), autoClear: true,
    setPixelRatio: vi.fn(), setSize: vi.fn(), dispose: vi.fn(),
    getRenderTarget: () => target, setRenderTarget: (value: WebGLRenderTarget | null) => { target = value },
    clear: vi.fn(),
    getClearColor: (out: Color) => out.copy(clearColor), getClearAlpha: () => clearAlpha,
    setClearColor: (value: Color | number, alpha: number) => { clearColor = new Color(value); clearAlpha = alpha },
    getViewport: (out: Vector4) => out.copy(viewport), setViewport: (value: Vector4) => { viewport = value.clone() },
    getScissor: (out: Vector4) => out.copy(scissor), setScissor: (value: Vector4) => { scissor = value.clone() },
    getScissorTest: () => scissorTest, setScissorTest: (value: boolean) => { scissorTest = value },
    render(scene: Scene) {
      calls.push({ target, scene, material: scene.children.find((child) => child instanceof Mesh)?.material as ShaderMaterial, autoClear: this.autoClear })
    },
  }
  const bounds = { x: 600, y: 120, left: 600, top: 120, right: 1000, bottom: 720, width: 400, height: 600 }
  const sceneContext = { renderer, anchors: { get: () => bounds }, effects: { register: vi.fn(), unregister: vi.fn() }, getQualityTier: () => 'high', isReducedMotion: () => false } as unknown as SceneContext
  return { renderer, calls, bounds, sceneContext }
}

async function flush() { for (let index = 0; index < 12; index += 1) await Promise.resolve() }
afterEach(() => vi.restoreAllMocks())

describe('portrait effect lifecycle', () => {
  it('renders two six-map displaced portraits before the transparent reveal, restoring renderer state', async () => {
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new Texture())
    const { sceneContext, renderer, calls } = context()
    const initialTarget = renderer.getRenderTarget()
    const effect = createPortraitEffect(sceneContext)
    expect(renderer.domElement.dataset.portraitState).toBe('loading')
    effect.resize(1200, 900, 2)
    effect.update(createVisualState({ viewportWidth: 1200, viewportHeight: 900, pointerPixelX: 800, pointerPixelY: 400, dpr: 2 }), 'bass', true)
    await flush()
    effect.render()
    expect(renderer.domElement.dataset.portraitState).toBe('ready')
    expect(renderer.domElement.dataset.portraitMode).toBe('bass')
    const portraitCalls = calls.filter(({ scene }) => scene.name.startsWith('portrait-photo-'))
    expect(portraitCalls).toHaveLength(2)
    expect(portraitCalls[0]!.target).not.toBe(portraitCalls[1]!.target)
    expect(portraitCalls.every(({ target }) => target!.width === 1600 && target!.height === 1200)).toBe(true)
    for (const { scene } of portraitCalls) {
      const mesh = scene.children.find((child) => child instanceof Mesh) as Mesh
      const material = mesh.material as MeshStandardMaterial
      expect(mesh.geometry.getAttribute('position').count).toBe(16641)
      expect([material.map, material.alphaMap, material.displacementMap, material.normalMap, material.roughnessMap].every(Boolean)).toBe(true)
      expect(material.userData.shadowMap).toBeInstanceOf(Texture)
      expect(material.map!.colorSpace).toBe(SRGBColorSpace)
      expect(material.userData.shadowMap.colorSpace).toBe(NoColorSpace)
    }
    const finalCall = calls[calls.length - 1]!
    expect(finalCall.material!.name).toBe('portrait-composite')
    expect(finalCall.material!.uniforms.uManualBass!.value).toBe(1)
    expect(finalCall.autoClear).toBe(false)
    expect(renderer.getRenderTarget()).toBe(initialTarget)
    expect(renderer.autoClear).toBe(true)
    expect(renderer.getClearColor(new Color()).getHex()).toBe(0x123456)
    expect(renderer.getClearAlpha()).toBe(0.6)
    expect(renderer.getViewport(new Vector4()).toArray()).toEqual([3, 5, 1100, 800])
    expect(renderer.getScissor(new Vector4()).toArray()).toEqual([7, 8, 900, 700])
    expect(renderer.getScissorTest()).toBe(true)
    expect(renderer.setSize).not.toHaveBeenCalled()
    effect.dispose()
  })

  it('resizes both photo targets with quality and rejects outside pointer injection', async () => {
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new Texture())
    const { sceneContext, renderer, calls } = context()
    const effect = createPortraitEffect(sceneContext)
    effect.resize(1200, 900, 2)
    const visual = createVisualState({ viewportWidth: 1200, viewportHeight: 900, dpr: 2, pointerPixelX: 599, pointerPixelY: 400, qualityTier: 'low' })
    effect.update(visual, 'front', true)
    await flush()
    effect.render()
    const portraits = calls.filter(({ scene }) => scene.name.startsWith('portrait-photo-'))
    expect(portraits.every(({ target }) => target!.width === 900 && target!.height === 675)).toBe(true)
    const mesh = portraits[0]!.scene.children.find((child) => child instanceof Mesh) as Mesh
    expect(mesh.geometry.getAttribute('position').count).toBe(4225)
    const force = calls.find(({ material }) => material?.name === 'portrait-fluid-force')!.material!
    expect(force.uniforms.uPointerActive!.value).toBe(0)
    const count = calls.length
    effect.update({ ...visual, reducedMotion: true }, 'bass', false)
    effect.render()
    expect(calls).toHaveLength(count)
    expect(renderer.domElement.dataset.portraitMode).toBe('bass')
    effect.dispose()
  })

  it('keeps texture allocations and fluid history stable through contraction and reverse scroll', async () => {
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new Texture())
    const { sceneContext, bounds, calls } = context()
    Object.assign(bounds, { left: 0, top: 0, width: 1440, height: 1000 })
    const effect = createPortraitEffect(sceneContext)
    const visual = createVisualState({ viewportWidth: 1440, viewportHeight: 1000, deltaSeconds: 1 / 60 })
    effect.update(visual, 'front', true, 0)
    await flush()
    effect.render()
    const resize = vi.spyOn(WebGLRenderTarget.prototype, 'setSize')
    calls.length = 0
    for (const progress of [0.1, 0.3, 0.6, 1, 0.6, 0.3, 0]) {
      effect.update(visual, 'front', true, progress)
      effect.render()
    }
    expect(resize).not.toHaveBeenCalled()
    // Only the per-frame pressure reset remains; no seven-target history reset.
    expect(calls.filter(({ material }) => material?.name === 'portrait-fluid-clear')).toHaveLength(6)
    expect(calls[calls.length - 1]!.material!.uniforms.uBounds!.value.toArray()).toEqual([0, 0, 1440, 1000])
    expect(calls[calls.length - 1]!.material!.uniforms.uManualBass!.value).toBe(0)
    effect.update(visual, 'front', false, 0.8)
    effect.render()
    expect(calls[calls.length - 1]!.material!.uniforms.uManualBass!.value).toBe(1)
    effect.dispose()
  })

  it('keeps the framebuffer untouched without a usable scene anchor', async () => {
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new Texture())
    const { sceneContext, bounds, calls } = context()
    bounds.width = 0
    const effect = createPortraitEffect(sceneContext)
    await flush()
    effect.resize(1200, 900, 1)
    effect.render()
    expect(calls).toHaveLength(0)
    effect.dispose()
  })

  it('stops all GPU passes at complete handoff and resumes on reverse without reallocating resources', async () => {
    const load = vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new Texture())
    const { sceneContext, bounds, calls, renderer } = context()
    Object.assign(bounds, { left: 0, top: 0, width: 1440, height: 1000 })
    const effect = createPortraitEffect(sceneContext)
    const visual = createVisualState({ viewportWidth: 1440, viewportHeight: 1000, deltaSeconds: 1 / 60 })
    await flush()
    effect.update(visual, 'front', true, 0.95)
    effect.render()
    const targets = calls.filter(({ scene }) => scene.name.startsWith('portrait-photo-')).map(call => call.target)
    expect(targets).toHaveLength(2)
    expect(calls[calls.length - 1]!.material!.uniforms.uHandoff!.value).toBeLessThan(1)
    const step = vi.spyOn(PortraitFluid.prototype, 'step')
    const resize = vi.spyOn(WebGLRenderTarget.prototype, 'setSize')
    const setTarget = vi.spyOn(renderer, 'setRenderTarget')
    renderer.clear.mockClear()
    calls.length = 0
    try {
      for (const progress of [0.96, 1]) {
        effect.update(visual, 'front', true, progress)
        effect.render()
      }
      expect(calls).toHaveLength(0)
      expect(step).not.toHaveBeenCalled()
      expect(renderer.clear).not.toHaveBeenCalled()
      expect(setTarget).not.toHaveBeenCalled()
      expect(renderer.domElement.dataset.portraitProgress).toBe('1.0000')
      bounds.top = -300
      effect.render()
      expect(JSON.parse(renderer.domElement.dataset.portraitBounds!)).toMatchObject({ left: 437, top: 17, width: 566, height: 366 })
      expect(calls).toHaveLength(0)

      effect.update(visual, 'front', true, 0.95)
      effect.render()
      expect(step).toHaveBeenCalledOnce()
      expect(calls.filter(({ scene }) => scene.name.startsWith('portrait-photo-')).map(call => call.target)).toEqual(targets)
      expect(calls[calls.length - 1]!.material!.name).toBe('portrait-composite')
      expect(calls[calls.length - 1]!.material!.uniforms.uHandoff!.value).toBeLessThan(1)
      expect(resize).not.toHaveBeenCalled()
      expect(load).toHaveBeenCalledTimes(12)
    } finally { effect.dispose() }
  })

  it('stops drawing a still-visible portrait when its anchor leaves the viewport', async () => {
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new Texture())
    const { sceneContext, bounds, calls } = context()
    Object.assign(bounds, { left: 0, top: 0, width: 1440, height: 1000 })
    const effect = createPortraitEffect(sceneContext)
    effect.update(createVisualState({ viewportWidth: 1440, viewportHeight: 1000 }), 'front', false, 0.8)
    await flush()
    effect.render()
    expect(calls.length).toBeGreaterThan(0)
    calls.length = 0
    bounds.top = -1500
    effect.render()
    expect(calls).toHaveLength(0)
    effect.dispose()
  })

  it('keeps failure local and disposes textures that finish after one map fails', async () => {
    const textures: Texture[] = []
    const late: ((texture: Texture<HTMLImageElement>) => void)[] = []
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation((url) => {
      if (url.includes('/front/') && url.includes('depth')) return Promise.reject(new Error('missing depth map'))
      return new Promise((resolve) => late.push(resolve))
    })
    const { sceneContext, renderer, calls } = context()
    const effect = createPortraitEffect(sceneContext)
    await flush()
    expect(renderer.domElement.dataset.portraitState).toBe('error')
    for (const resolve of late) { const texture = new Texture<HTMLImageElement>(); vi.spyOn(texture, 'dispose'); textures.push(texture); resolve(texture) }
    await flush()
    effect.render()
    expect(calls).toHaveLength(0)
    expect(textures.every((texture) => vi.mocked(texture.dispose).mock.calls.length === 1)).toBe(true)
    effect.dispose()
  })

  it('disposes late successful loads without changing a newer scene state', async () => {
    const late: ((texture: Texture<HTMLImageElement>) => void)[] = []
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise((resolve) => late.push(resolve)))
    const { sceneContext, renderer } = context()
    const effect = createPortraitEffect(sceneContext)
    effect.dispose()
    renderer.domElement.dataset.portraitState = 'loading'
    const textures = late.map((resolve) => { const texture = new Texture<HTMLImageElement>(); vi.spyOn(texture, 'dispose'); resolve(texture); return texture })
    await flush()
    expect(renderer.domElement.dataset.portraitState).toBe('loading')
    expect(textures.every((texture) => vi.mocked(texture.dispose).mock.calls.length === 1)).toBe(true)
  })

  it('restores renderer state after a failed GPU pass and exposes a local fallback', async () => {
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new Texture())
    const { sceneContext, renderer } = context()
    const initialTarget = renderer.getRenderTarget()
    const effect = createPortraitEffect(sceneContext)
    effect.resize(1200, 900, 1)
    effect.update(createVisualState({ viewportWidth: 1200, viewportHeight: 900 }), 'front')
    await flush()
    vi.spyOn(renderer, 'render').mockImplementation(() => { throw new Error('lost GPU') })
    expect(() => effect.render()).not.toThrow()
    expect(renderer.getRenderTarget()).toBe(initialTarget)
    expect(renderer.autoClear).toBe(true)
    expect(renderer.getScissorTest()).toBe(true)
    expect(renderer.domElement.dataset.portraitState).toBe('error')
    effect.dispose()
  })
})
