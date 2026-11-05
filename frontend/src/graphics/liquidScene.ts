import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  IcosahedronGeometry,
  Mesh,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
} from 'three'
import { clamp, damp, MotionEnergy, qualityProfile, resolveMotionStage, sceneMoodAt } from './motion'
import {
  flowFragmentShader,
  flowVertexShader,
  particleFragmentShader,
  particleVertexShader,
} from './shaders'
import type { QualityTier } from './quality'
import type { RendererAdapter } from './runtime/types'

export interface SceneInput {
  pointerX: number
  pointerY: number
  scroll: number
}

export interface SceneQuality {
  width: number
  hardwareConcurrency?: number
}

export interface LiquidSceneController {
  resize(width: number, height: number, dpr: number): void
  setInput(input: Readonly<SceneInput>): void
  setQualityTier(tier: QualityTier): void
  triggerRipple?(ndcX: number, ndcY: number): boolean
  beginPress?(ndcX: number, ndcY: number): boolean
  endPress?(): void
  render(time: number): void
  dispose(): void
}

function createParticles(count: number) {
  const geometry = new BufferGeometry()
  const positions = new Float32Array(count * 3)
  const seeds = new Float32Array(count)
  const sizes = new Float32Array(count)
  for (let index = 0; index < count; index += 1) {
    const angle = index * 2.399963
    const radius = 1.55 + (index % 11) * 0.075
    positions[index * 3] = Math.cos(angle) * radius
    positions[index * 3 + 1] = ((index * 13) % 97) / 97 * 2.7 - 1.35
    positions[index * 3 + 2] = Math.sin(angle) * radius
    seeds[index] = (index * 0.61803398875) % 1
    sizes[index] = 0.55 + seeds[index] * 1.2
  }
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1))
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1))
  return geometry
}

export function createLiquidScene(
  renderer: RendererAdapter,
  initialState: SceneInput,
  quality = qualityProfile(window.innerWidth, navigator.hardwareConcurrency || 4),
): LiquidSceneController {
  const sharedRenderer = renderer as RendererAdapter & {
    setClearColor?: (color: number, alpha: number) => void
    outputColorSpace?: string
  }
  sharedRenderer.setClearColor?.(0x000000, 0)
  sharedRenderer.outputColorSpace = 'srgb'
  const canvas = renderer.domElement

  const scene = new Scene()
  const camera = new PerspectiveCamera(38, 1, 0.1, 100)
  camera.position.set(0, 0, 5.15)

  const uniforms = {
    uTime: { value: 0 },
    uPointerX: { value: 0 },
    uPointerY: { value: 0 },
    uScroll: { value: 0 },
    uEnergy: { value: 0 },
  }
  const geometry = new IcosahedronGeometry(1.48, quality.detail)
  const material = new ShaderMaterial({
    vertexShader: flowVertexShader,
    fragmentShader: flowFragmentShader,
    uniforms,
    transparent: true,
  })
  const mesh = new Mesh(geometry, material)
  scene.add(mesh)

  const wireGeometry = new BufferGeometry()
  wireGeometry.setAttribute('position', geometry.getAttribute('position').clone())
  wireGeometry.setIndex(geometry.getIndex()?.clone() ?? null)
  const wireMaterial = new ShaderMaterial({
    vertexShader: flowVertexShader,
    fragmentShader: 'void main(){ gl_FragColor = vec4(0.015, 0.02, 0.025, 0.16); }',
    wireframe: true,
    transparent: true,
    depthWrite: false,
    uniforms,
  })
  const wireMesh = new Mesh(wireGeometry, wireMaterial)
  scene.add(wireMesh)

  const particleGeometry = createParticles(quality.particleCount)
  const particleMaterial = new ShaderMaterial({
    vertexShader: particleVertexShader,
    fragmentShader: particleFragmentShader,
    uniforms: {
      uTime: uniforms.uTime,
      uScroll: uniforms.uScroll,
      uEnergy: uniforms.uEnergy,
      uPixelRatio: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const particles = new Points(particleGeometry, particleMaterial)
  scene.add(particles)

  const target: SceneInput = { ...initialState }
  const current: SceneInput = { ...initialState }
  const motionEnergy = new MotionEnergy()
  let lastInputTime = performance.now()
  const deviceDprCap = quality.pixelRatioCap
  const maxParticleCount = quality.particleCount
  let viewportWidth = 0
  let viewportHeight = 0
  let rawDpr = 1
  let currentQualityTier: QualityTier = 'high'
  let lastTime = 0
  let easedMotionEnergy = 0
  let disposed = false
  let previousStage = resolveMotionStage(initialState.scroll)

  function applyQualityTier(tier: QualityTier) {
    currentQualityTier = tier
    const particleCount = tier === 'high'
      ? maxParticleCount
      : tier === 'balanced'
        ? Math.min(maxParticleCount, Math.max(42, Math.round(maxParticleCount * 0.75)))
        : Math.min(maxParticleCount, 42)
    const tierDprCap = tier === 'high' ? deviceDprCap : tier === 'balanced' ? 1.4 : 1.15
    const dprCap = Math.max(1, Math.min(deviceDprCap, tierDprCap, rawDpr))
    const pixelRatio = clamp(rawDpr, 1, dprCap)
    particleGeometry.setDrawRange(0, particleCount)
    particleMaterial.uniforms.uPixelRatio.value = pixelRatio
    if (viewportWidth <= 0 || viewportHeight <= 0 || disposed) return
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(viewportWidth, viewportHeight, false)
  }

  applyQualityTier('high')

  return {
    resize(width, height, dpr) {
      if (width <= 0 || height <= 0 || disposed) return
      viewportWidth = width
      viewportHeight = height
      rawDpr = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
      applyQualityTier(currentQualityTier)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    },
    setInput(input) {
      const nextPointerX = clamp(input.pointerX, -1, 1)
      const nextPointerY = clamp(input.pointerY, -1, 1)
      const nextScroll = clamp(input.scroll, 0, 1)
      const now = performance.now()
      const elapsedSeconds = (now - lastInputTime) / 1000
      if (elapsedSeconds > 0) {
        const pointerDistance = Math.hypot(nextPointerX - target.pointerX, nextPointerY - target.pointerY)
        const scrollDistance = Math.abs(nextScroll - target.scroll)
        motionEnergy.pulse(pointerDistance, elapsedSeconds, 2.4)
        motionEnergy.pulse(scrollDistance, elapsedSeconds, 1.5)
      }
      lastInputTime = now
      target.pointerX = nextPointerX
      target.pointerY = nextPointerY
      target.scroll = nextScroll
    },
    setQualityTier(tier) {
      if (disposed || tier === currentQualityTier) return
      applyQualityTier(tier)
    },
    render(time) {
      if (disposed) return
      const seconds = time / 1000
      const delta = lastTime > 0 ? clamp(seconds - lastTime, 0, 0.05) : 1 / 60
      lastTime = seconds
      current.pointerX = damp(current.pointerX, target.pointerX, 5.5, delta)
      current.pointerY = damp(current.pointerY, target.pointerY, 5.5, delta)
      current.scroll = damp(current.scroll, target.scroll, 4.2, delta)

      const stage = resolveMotionStage(current.scroll)
      const mood = sceneMoodAt(current.scroll)
      if (stage !== previousStage) {
        previousStage = stage
        canvas.dataset.motionStage = stage
      }
      const rotationX = -0.06 + current.pointerY * 0.18 + current.scroll * (0.9 + mood.rotationSpeed)
      const rotationY = 0.25 + current.pointerX * 0.23 - current.scroll * (0.65 + mood.rotationSpeed)
      const rotationZ = -0.04 + current.scroll * (0.8 + mood.rotationSpeed)
      const viewportScale = window.innerWidth < 760 ? 0.82 : 1
      const moodScale = 1 + (mood.scale - 1) * 0.12
      const scale = (0.94 + Math.sin(seconds * 0.55) * 0.018 + current.scroll * 0.16) * moodScale * viewportScale
      const offsetY = Math.sin(seconds * 0.45 * (0.4 + mood.rotationSpeed)) * 0.04

      mesh.rotation.set(rotationX, rotationY, rotationZ)
      wireMesh.rotation.set(rotationX, rotationY, rotationZ)
      mesh.position.y = offsetY
      wireMesh.position.y = offsetY
      mesh.scale.setScalar(scale)
      wireMesh.scale.setScalar(scale * 1.008)

      particles.rotation.set(rotationX * 0.35, -rotationY * 0.3 + seconds * 0.018, rotationZ * 0.24)
      particles.position.y = offsetY * 0.8 + mood.particleLift * 0.1
      material.opacity = mood.lightness

      const targetMotionEnergy = motionEnergy.advance(time)
      easedMotionEnergy = damp(easedMotionEnergy, targetMotionEnergy, 4.8, delta)
      uniforms.uTime.value = seconds
      uniforms.uPointerX.value = current.pointerX
      uniforms.uPointerY.value = current.pointerY
      uniforms.uScroll.value = current.scroll
      uniforms.uEnergy.value = easedMotionEnergy
      renderer.render(scene, camera)
    },
    dispose() {
      if (disposed) return
      disposed = true
      scene.clear()
      geometry.dispose()
      wireGeometry.dispose()
      particleGeometry.dispose()
      material.dispose()
      wireMaterial.dispose()
      particleMaterial.dispose()
    },
  }
}
