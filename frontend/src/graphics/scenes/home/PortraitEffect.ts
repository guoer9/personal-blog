import {
  ClampToEdgeWrapping, Color, DirectionalLight, HemisphereLight, LinearFilter, Mesh, MeshStandardMaterial,
  NoColorSpace, OrthographicCamera, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, SRGBColorSpace,
  TextureLoader, Vector2, Vector4, WebGLRenderTarget, type Texture, type WebGLRenderer,
} from 'three'
import type { SceneContext, VisualState } from '../../runtime/types'
import { createVisualState } from '../../runtime/VisualState'
import { PortraitFluid, type PortraitFluidPointer } from './PortraitFluid'
import { portraitAssets, type PortraitMap, type PortraitMode } from './portraitAssets'
import { portraitBackdropOpacity, portraitFraming, portraitPointer, portraitRenderBounds, portraitResolution, portraitScrollEase, type PortraitPoint } from './portraitMath'
import { portraitCompositeFragment, portraitFullscreenVertex } from './portraitShaders'

export interface PortraitEffectController {
  update(visualState: Readonly<VisualState>, mode: PortraitMode, pointerEnabled?: boolean, exitProgress?: number): void
  resize(width: number, height: number, dpr: number): void
  render(): void
  dispose(): void
}

interface PortraitLayer {
  scene: Scene
  mesh: Mesh<PlaneGeometry, MeshStandardMaterial>
  target: WebGLRenderTarget
}
type MapBundle = Record<PortraitMap, Texture>
const modes: readonly PortraitMode[] = ['front', 'bass']
const mapNames: readonly PortraitMap[] = ['diffuse', 'alpha', 'depth', 'normal', 'roughness', 'shadow']
const canvasOwners = new WeakMap<HTMLCanvasElement, symbol>()

/** Home-owned effect using the runtime's renderer, frame clock, pointer, and DOM anchor. */
export function createPortraitEffect(context: SceneContext): PortraitEffectController {
  const renderer = context.renderer as unknown as WebGLRenderer
  const canvas = renderer.domElement
  const owner = Symbol('home-portrait')
  canvasOwners.set(canvas, owner)
  let disposed = false
  let failed = false
  let ready = false
  let resourcesDisposed = false
  let selected: PortraitMode = 'front'
  let pointerEnabled = false
  let exitProgress = 0
  let previousPointer: PortraitPoint | null = null
  let visual = createVisualState({ qualityTier: context.getQualityTier?.() ?? 'high' })
  let viewport = { width: 1, height: 1, dpr: 1 }
  let resolution = portraitResolution(1, 1, 1, visual.qualityTier)
  const ownedTextures = new Set<Texture>()
  const layers: Partial<Record<PortraitMode, PortraitLayer>> = {}
  const camera = new PerspectiveCamera(28, 1, 0.01, 20)
  const postCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const postScene = new Scene()
  const postGeometry = new PlaneGeometry(2, 2)
  const composite = new ShaderMaterial({
    name: 'portrait-composite', vertexShader: portraitFullscreenVertex, fragmentShader: portraitCompositeFragment,
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: {
      uFront: { value: null }, uBass: { value: null }, uDye: { value: null }, uVelocity: { value: null },
      uFluidTexel: { value: new Vector2(1, 1) }, uViewport: { value: new Vector2(1, 1) },
      uBounds: { value: new Vector4(0, 0, 1, 1) }, uTime: { value: 0 }, uManualBass: { value: 0 },
      uBackdropOpacity: { value: 1 }, uFilter: { value: 0 }, uHandoff: { value: 0 },
    },
  })
  const postMesh = new Mesh(postGeometry, composite)
  postMesh.frustumCulled = false
  postScene.add(postMesh)
  const fluid = new PortraitFluid((target, material) => {
    postMesh.material = material
    renderer.setRenderTarget(target)
    renderer.clear(true, true, true)
    renderer.render(postScene, postCamera)
  })
  const pose = new Vector2()

  function setState(state: 'loading' | 'ready' | 'error') {
    if (!disposed && canvasOwners.get(canvas) === owner) canvas.dataset.portraitState = state
  }

  function releaseResources() {
    if (resourcesDisposed) return
    resourcesDisposed = true
    ownedTextures.forEach((texture) => texture.dispose())
    ownedTextures.clear()
    for (const layer of Object.values(layers)) {
      layer.mesh.geometry.dispose()
      layer.mesh.material.dispose()
      layer.target.dispose()
      layer.scene.clear()
    }
    fluid.dispose()
    postGeometry.dispose()
    composite.dispose()
    postScene.clear()
  }

  function fail() {
    failed = true
    ready = false
    setState('error')
  }

  function createLayer(mode: PortraitMode, maps: MapBundle) {
    const asset = portraitAssets[mode]
    const material = new MeshStandardMaterial({
      map: maps.diffuse, alphaMap: maps.alpha, displacementMap: maps.depth,
      displacementScale: 0.045, displacementBias: -0.0225,
      normalMap: maps.normal, normalScale: new Vector2(0.85, 0.85), roughnessMap: maps.roughness,
      roughness: 0.86, metalness: 0, transparent: true, alphaTest: 0.015,
    })
    // This fixture's baked shadow is linear grayscale visibility, like its
    // normal, depth, alpha and roughness data maps. Keeping it in the standard material
    // retains normal/roughness lighting and the built-in displacement vertex pass.
    material.userData.shadowMap = maps.shadow
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uBakedShadow = { value: maps.shadow }
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uBakedShadow;')
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', /* glsl */ `
        #include <map_fragment>
        #ifdef USE_MAP
          diffuseColor.rgb *= mix(vec3(1.0), texture2D(uBakedShadow, vMapUv).rgb, 0.48);
        #endif
      `)
    }
    material.customProgramCacheKey = () => 'home-portrait-six-maps-v1'
    const mesh = new Mesh(new PlaneGeometry(asset.width / asset.height, 1, resolution.segments, resolution.segments), material)
    mesh.frustumCulled = false
    const scene = new Scene()
    scene.name = `portrait-photo-${mode}`
    const key = new DirectionalLight(0xfff3df, 1.55)
    key.position.set(-1.1, 1.1, 2.5)
    scene.add(mesh, new HemisphereLight(0xf4f7ff, 0x192227, 1.2), key)
    const target = new WebGLRenderTarget(resolution.width, resolution.height, {
      minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true, stencilBuffer: false,
    })
    target.texture.colorSpace = NoColorSpace
    target.texture.generateMipmaps = false
    target.texture.name = `portrait-photo-${mode}`
    layers[mode] = { scene, mesh, target }
  }

  setState('loading')
  canvas.dataset.portraitMode = selected
  if (typeof renderer.setRenderTarget !== 'function' || typeof renderer.getRenderTarget !== 'function') {
    fail()
    releaseResources()
  } else {
    const loader = new TextureLoader()
    // Each promise owns its late completion. Promise.all's early rejection must
    // never leave other eleven requests retaining textures after failure/disposal.
    void Promise.all(modes.map(async (mode) => {
      const maps = await Promise.all(mapNames.map(async (name) => {
        const texture = await loader.loadAsync(portraitAssets[mode].maps[name])
        if (disposed || failed) { texture.dispose(); return null }
        ownedTextures.add(texture)
        texture.colorSpace = name === 'diffuse' ? SRGBColorSpace : NoColorSpace
        texture.wrapS = texture.wrapT = ClampToEdgeWrapping
        texture.minFilter = texture.magFilter = LinearFilter
        texture.generateMipmaps = false
        texture.needsUpdate = true
        return texture
      }))
      if (disposed || failed || maps.some((texture) => !texture)) return
      const bundle = Object.fromEntries(mapNames.map((name, index) => [name, maps[index]!])) as MapBundle
      createLayer(mode, bundle)
    })).then(() => {
      if (disposed || failed) return
      ready = Boolean(layers.front && layers.bass)
      if (ready) setState('ready')
    }).catch(() => {
      if (disposed) return
      fail()
      releaseResources()
    })
  }

  function applySize(bounds: { width: number; height: number }) {
    const next = portraitResolution(bounds.width, bounds.height, viewport.dpr, visual.qualityTier)
    const geometryChanged = next.segments !== resolution.segments
    if (next.width !== resolution.width || next.height !== resolution.height || geometryChanged) {
      for (const mode of modes) {
        const layer = layers[mode]
        if (!layer) continue
        layer.target.setSize(next.width, next.height)
        if (geometryChanged) {
          layer.mesh.geometry.dispose()
          const asset = portraitAssets[mode]
          layer.mesh.geometry = new PlaneGeometry(asset.width / asset.height, 1, next.segments, next.segments)
        }
      }
    }
    resolution = next
    fluid.resize(next.fluidWidth, next.fluidHeight, visual.qualityTier)
  }

  return {
    update(state, mode, enabled = false, progress = 0) {
      if (disposed) return
      visual = { ...state, pointerVelocity: { ...state.pointerVelocity } }
      selected = mode === 'bass' ? 'bass' : 'front'
      pointerEnabled = enabled && !state.reducedMotion
      exitProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0
      if (canvasOwners.get(canvas) === owner) canvas.dataset.portraitMode = selected
      if (state.viewportWidth > 0 && state.viewportHeight > 0) {
        viewport = { width: state.viewportWidth, height: state.viewportHeight, dpr: state.dpr }
      }
    },
    resize(width, height, dpr) {
      if (disposed || failed) return
      viewport = {
        width: Number.isFinite(width) ? Math.max(1, width) : 1,
        height: Number.isFinite(height) ? Math.max(1, height) : 1,
        dpr: Number.isFinite(dpr) ? Math.max(1, dpr) : 1,
      }
      const anchorBounds = context.anchors.get('home-portrait')
      const bounds = anchorBounds && portraitRenderBounds(anchorBounds, viewport.width, viewport.height, exitProgress)
      if (bounds && bounds.width > 0 && bounds.height > 0) applySize(viewport)
      previousPointer = null
    },
    render() {
      if (disposed || failed || !ready || visual.reducedMotion) return
      const anchorBounds = context.anchors.get('home-portrait')
      const bounds = anchorBounds && portraitRenderBounds(anchorBounds, viewport.width, viewport.height, exitProgress)
      if (!bounds || ![bounds.left, bounds.top, bounds.width, bounds.height].every(Number.isFinite)
        || bounds.width <= 0 || bounds.height <= 0 || bounds.top >= viewport.height || bounds.left >= viewport.width
        || bounds.top + bounds.height <= 0 || bounds.left + bounds.width <= 0) {
        previousPointer = null
        return
      }
      canvas.dataset.portraitBounds = JSON.stringify(bounds)
      canvas.dataset.portraitProgress = exitProgress.toFixed(4)
      const handoff = portraitScrollEase((exitProgress - 0.52) / 0.44)
      // Fully transparent composition needs no fluid, photo or composite passes.
      // Keep targets/history alive so reverse scrolling can resume immediately.
      if (handoff >= 1) {
        previousPointer = null
        return
      }
      // Allocate from the viewport, never from continuously contracting bounds.
      // This preserves fluid history and GPU targets throughout scroll.
      applySize(viewport)
      const framing = portraitFraming(viewport.width, exitProgress)
      const point = pointerEnabled && framing.pointerStrength > 0 ? portraitPointer(bounds, visual.pointerPixelX, visual.pointerPixelY) : null
      const fluidPointer: PortraitFluidPointer | null = point ? {
        ...point, dx: previousPointer ? point.x - previousPointer.x : 0, dy: previousPointer ? point.y - previousPointer.y : 0,
      } : null
      previousPointer = point
      const delta = Math.min(1 / 30, Math.max(0, visual.deltaSeconds))
      const ease = 1 - Math.exp(-6 * delta)
      pose.x += ((point ? (point.x - 0.5) * 2 : 0) - pose.x) * ease
      pose.y += ((point ? (point.y - 0.5) * 2 : 0) - pose.y) * ease
      camera.aspect = bounds.width / bounds.height
      const fitHeight = framing.fitHeight
      camera.position.set(pose.x * 0.025 * framing.pointerStrength, framing.offsetY + pose.y * 0.018 * framing.pointerStrength, fitHeight / (2 * Math.tan(28 * Math.PI / 360)))
      camera.lookAt(0, 0, 0)
      camera.updateProjectionMatrix()
      for (const layer of Object.values(layers)) {
        layer.mesh.rotation.set(-pose.y * 0.04 * framing.pointerStrength, pose.x * 0.055 * framing.pointerStrength, Math.sin(visual.timeMs * 0.00023) * 0.003)
        layer.mesh.position.y = Math.sin(visual.timeMs * 0.00047) * 0.004
      }
      const previous = {
        target: renderer.getRenderTarget(), autoClear: renderer.autoClear,
        color: renderer.getClearColor(new Color()), alpha: renderer.getClearAlpha(),
        viewport: renderer.getViewport(new Vector4()), scissor: renderer.getScissor(new Vector4()), scissorTest: renderer.getScissorTest(),
      }
      try {
        renderer.autoClear = false
        renderer.setScissorTest(false)
        renderer.setClearColor(0x000000, 0)
        fluid.step(delta, fluidPointer)
        for (const mode of modes) {
          const layer = layers[mode]!
          renderer.setRenderTarget(layer.target)
          renderer.clear(true, true, true)
          renderer.render(layer.scene, camera)
        }
        composite.uniforms.uFront!.value = layers.front!.target.texture
        composite.uniforms.uBass!.value = layers.bass!.target.texture
        composite.uniforms.uDye!.value = fluid.texture
        composite.uniforms.uVelocity!.value = fluid.velocityTexture
        composite.uniforms.uFluidTexel!.value.copy(fluid.texelSize)
        composite.uniforms.uViewport!.value.set(viewport.width, viewport.height)
        composite.uniforms.uBounds!.value.set(bounds.left, bounds.top, bounds.width, bounds.height)
        composite.uniforms.uBackdropOpacity!.value = portraitBackdropOpacity(bounds)
        composite.uniforms.uTime!.value = visual.timeMs / 1000
        composite.uniforms.uManualBass!.value = selected === 'bass' ? 1 : portraitScrollEase((exitProgress - 0.18) / 0.52)
        composite.uniforms.uFilter!.value = portraitScrollEase(exitProgress)
        composite.uniforms.uHandoff!.value = handoff
        postMesh.material = composite
        renderer.setRenderTarget(previous.target)
        renderer.setViewport(previous.viewport)
        renderer.render(postScene, postCamera)
      } catch {
        fail()
      } finally {
        renderer.setRenderTarget(previous.target)
        renderer.setViewport(previous.viewport)
        renderer.setScissor(previous.scissor)
        renderer.setScissorTest(previous.scissorTest)
        renderer.setClearColor(previous.color, previous.alpha)
        renderer.autoClear = previous.autoClear
      }
      if (failed) releaseResources()
    },
    dispose() {
      if (disposed) return
      disposed = true
      releaseResources()
      if (canvasOwners.get(canvas) === owner) {
        canvasOwners.delete(canvas)
        delete canvas.dataset.portraitState
        delete canvas.dataset.portraitBounds
        delete canvas.dataset.portraitProgress
        delete canvas.dataset.portraitMode
      }
    },
  }
}
