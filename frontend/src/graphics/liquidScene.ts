import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  IcosahedronGeometry,
  Mesh,
  PerspectiveCamera,
  Points,
  Raycaster,
  Scene,
  Sphere,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three'
import { clamp, damp, MotionEnergy, qualityProfile, resolveMotionStage, sceneMoodAt } from './motion'
import {
  flowFragmentShader,
  flowVertexShader,
  particleFragmentShader,
  particleVertexShader,
  pointerWakeVertexShader,
  pointerWakeFragmentShader,
} from './shaders'
import type { QualityTier } from './quality'
import type { RendererAdapter } from './runtime/types'

export interface SceneInput {
  pointerX: number
  pointerY: number
  pointerVelocity: { x: number; y: number }
  scroll: number
}

export interface SceneQuality {
  detail: number
  pixelRatioCap: number
  particleCount: number
  rippleCapacity?: number
}

export interface LiquidSceneController {
  resize(width: number, height: number, dpr: number): void
  setInput(input: Readonly<SceneInput>): void
  setQualityTier(tier: QualityTier): void
  triggerRipple(ndcX: number, ndcY: number): boolean
  beginPress(ndcX: number, ndcY: number): boolean
  endPress(): void
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

const MAX_RIPPLES = 6
const RIPPLE_LIFETIME_SECONDS = 1.8
const WAKE_CAPACITY = 32
const WAKE_LIFETIME_SECONDS = 0.85
const PRESS_DEPTH_MAX = 0.28
const PRESS_GROW_SECONDS = 0.45
const PRESS_STIFFNESS = 90
const PRESS_DAMPING = 12

export function createLiquidScene(
  renderer: RendererAdapter,
  initialState: SceneInput,
  quality: SceneQuality = qualityProfile(window.innerWidth, navigator.hardwareConcurrency || 4),
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
  const raycaster = new Raycaster()
  const raycastNdc = new Vector2()
  const worldSphere = new Sphere()
  const surfacePoint = new Vector3()
  const pressNdc = new Vector2()
  const wakeNdc = new Vector2(initialState.pointerX, initialState.pointerY)
  const configuredRippleCapacity = clamp(Math.floor(quality.rippleCapacity ?? 4), 1, MAX_RIPPLES)
  let activeRippleCapacity = configuredRippleCapacity
  const rippleDirections = Array.from({ length: MAX_RIPPLES }, () => new Vector3(0, 0, 1))
  const rippleAges = new Float32Array(MAX_RIPPLES)
  const rippleStrengths = new Float32Array(MAX_RIPPLES)
  const rippleSlots = Array.from({ length: MAX_RIPPLES }, () => ({ startedAt: null as number | null, active: false }))
  const hoverDirection = new Vector3(0, 0, 1)
  const pressDirection = new Vector3(0, 0, 1)
  const trailDirection = new Vector2(1, 0)
  const trailVelocity = new Vector2()

  const uniforms = {
    uTime: { value: 0 },
    uPointerX: { value: 0 },
    uPointerY: { value: 0 },
    uScroll: { value: 0 },
    uEnergy: { value: 0 },
    uRippleDirections: { value: rippleDirections },
    uRippleAges: { value: rippleAges },
    uRippleStrengths: { value: rippleStrengths },
    uRippleCount: { value: 0 },
    uRippleCapacity: { value: activeRippleCapacity },
    uHoverDirection: { value: hoverDirection },
    uHoverActive: { value: 0 },
    uHoverStrength: { value: 0 },
    uPressDirection: { value: pressDirection },
    uPressDepth: { value: 0 },
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
      uPointerVelocity: { value: new Vector2() },
      uTrailDirection: { value: new Vector2(1, 0) },
      uTrailStrength: { value: 0 },
      uImpactEnergy: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const particles = new Points(particleGeometry, particleMaterial)
  scene.add(particles)

  // A separate bounded point pool places expanding water rings on the actual cursor path.
  const wakePositions = new Float32Array(WAKE_CAPACITY * 3)
  const wakeBirths = new Float32Array(WAKE_CAPACITY).fill(-100)
  const wakeGeometry = new BufferGeometry()
  const wakePositionAttribute = new BufferAttribute(wakePositions, 3).setUsage(DynamicDrawUsage)
  const wakeBirthAttribute = new BufferAttribute(wakeBirths, 1).setUsage(DynamicDrawUsage)
  wakeGeometry.setAttribute('position', wakePositionAttribute)
  wakeGeometry.setAttribute('aBornAt', wakeBirthAttribute)
  const wakeMaterial = new ShaderMaterial({
    vertexShader: pointerWakeVertexShader,
    fragmentShader: pointerWakeFragmentShader,
    uniforms: { uTime: uniforms.uTime, uPixelRatio: particleMaterial.uniforms.uPixelRatio },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const wake = new Points(wakeGeometry, wakeMaterial)
  wake.frustumCulled = false
  wake.renderOrder = 2
  scene.add(wake)

  const target: SceneInput = { ...initialState, pointerVelocity: { ...initialState.pointerVelocity } }
  const current: SceneInput = { ...initialState, pointerVelocity: { ...initialState.pointerVelocity } }
  const motionEnergy = new MotionEnergy()
  let lastInputTime = performance.now()
  const deviceDprCap = quality.pixelRatioCap
  const maxParticleCount = quality.particleCount
  let viewportWidth = 0
  let viewportHeight = 0
  let rawDpr = 1
  let currentQualityTier: QualityTier = 'high'
  let lastTime = 0
  let floatPhase = 0
  let easedMotionEnergy = 0
  let rippleCursor = 0
  let rippleCount = 0
  let rippleSequence = 0
  let hoverStrength = 0
  let trailStrength = 0
  let impactEnergy = 0
  let pressDepth = 0
  let pressVelocity = 0
  let pressStartedAt: number | null = null
  let pressActive = false
  let disposed = false
  let scrollVelocity = 0
  let wakeCursor = 0
  let wakeCapacity = WAKE_CAPACITY
  let hasWakeOrigin = false
  let previousStage = resolveMotionStage(initialState.scroll)

  function hitSphere(ndcX: number, ndcY: number): Vector3 | null {
    if (disposed) return null
    raycastNdc.set(clamp(ndcX, -1, 1), clamp(ndcY, -1, 1))
    camera.updateMatrixWorld()
    mesh.updateMatrixWorld(true)
    raycaster.setFromCamera(raycastNdc, camera)
    worldSphere.center.setFromMatrixPosition(mesh.matrixWorld)
    worldSphere.radius = 1.48 * mesh.scale.x
    // GPU vertex displacement is unavailable to CPU raycasting; use its base sphere.
    if (!raycaster.ray.intersectSphere(worldSphere, surfacePoint)) return null
    return mesh.worldToLocal(surfacePoint).normalize()
  }

  function resolveInteractionDirection(ndcX: number, ndcY: number): Vector3 | null {
    const directHit = hitSphere(ndcX, ndcY)
    if (directHit || disposed) return directHit
    const depth = (worldSphere.center.z - raycaster.ray.origin.z) / raycaster.ray.direction.z
    raycaster.ray.at(depth, surfacePoint).sub(worldSphere.center)
    surfacePoint.z = 0
    // Keep the fallback on the visible hemisphere so off-sphere taps remain legible.
    surfacePoint.setLength(worldSphere.radius * 0.84)
    surfacePoint.z = Math.sqrt(Math.max(0, worldSphere.radius ** 2 - surfacePoint.lengthSq()))
    surfacePoint.add(worldSphere.center)
    return mesh.worldToLocal(surfacePoint).normalize()
  }

  function updateWake(seconds: number) {
    const distance = Math.hypot((target.pointerX - wakeNdc.x) * viewportWidth / 2, (target.pointerY - wakeNdc.y) * viewportHeight / 2)
    if (hasWakeOrigin && distance >= 10 && viewportWidth > 0 && viewportHeight > 0) {
      const samples = Math.min(8, Math.ceil(distance / 18))
      for (let sample = 1; sample <= samples; sample += 1) {
        const fraction = sample / samples
        raycastNdc.set(wakeNdc.x + (target.pointerX - wakeNdc.x) * fraction, wakeNdc.y + (target.pointerY - wakeNdc.y) * fraction)
        raycaster.setFromCamera(raycastNdc, camera)
        raycaster.ray.at((2 - raycaster.ray.origin.z) / raycaster.ray.direction.z, surfacePoint)
        surfacePoint.toArray(wakePositions, wakeCursor * 3)
        wakeBirths[wakeCursor] = seconds - (1 - fraction) * 0.04
        wakeCursor = (wakeCursor + 1) % wakeCapacity
      }
      wakeNdc.set(target.pointerX, target.pointerY)
      wakePositionAttribute.needsUpdate = true
      wakeBirthAttribute.needsUpdate = true
    }
    let count = 0
    for (let index = 0; index < wakeCapacity; index += 1) {
      if (seconds - wakeBirths[index] < WAKE_LIFETIME_SECONDS) count += 1
    }
    canvas.dataset.sphereWakeCount = String(count)
  }

  function updateRippleUniforms(seconds: number) {
    let nextCount = 0
    for (let index = 0; index < MAX_RIPPLES; index += 1) {
      const slot = rippleSlots[index]
      const active = index < activeRippleCapacity && slot.active
      if (active && slot.startedAt === null) slot.startedAt = seconds
      const age = active ? Math.max(0, seconds - (slot.startedAt ?? seconds)) : 0
      if (active && age <= RIPPLE_LIFETIME_SECONDS) {
        rippleAges[index] = age
        rippleStrengths[index] = Math.min(1, Math.max(0, 1 - age / RIPPLE_LIFETIME_SECONDS))
        nextCount += 1
      } else {
        slot.active = false
        rippleAges[index] = 0
        rippleStrengths[index] = 0
      }
    }
    rippleCount = nextCount
    uniforms.uRippleCount.value = rippleCount
  }

  function updatePress(delta: number, seconds: number) {
    if (pressActive) {
      const direction = resolveInteractionDirection(pressNdc.x, pressNdc.y)
      if (direction) pressDirection.copy(direction)
    }
    if (pressActive && pressStartedAt === null) pressStartedAt = seconds
    const targetDepth = pressActive
      ? PRESS_DEPTH_MAX * (0.3 + 0.7 * clamp((seconds - (pressStartedAt ?? seconds)) / PRESS_GROW_SECONDS, 0, 1))
      : 0
    // Small integration steps keep the underdamped release stable on slower devices.
    const steps = Math.max(1, Math.ceil(delta * 120))
    const step = delta / steps
    for (let index = 0; index < steps; index += 1) {
      const acceleration = (targetDepth - pressDepth) * PRESS_STIFFNESS - pressVelocity * PRESS_DAMPING
      pressVelocity += acceleration * step
      pressDepth = clamp(pressDepth + pressVelocity * step, -0.045, PRESS_DEPTH_MAX)
    }
    if (!pressActive && Math.abs(pressDepth) < 0.0001 && Math.abs(pressVelocity) < 0.001) {
      pressDepth = 0
      pressVelocity = 0
    }
    uniforms.uPressDepth.value = pressDepth
  }

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
    activeRippleCapacity = tier === 'high'
      ? configuredRippleCapacity
      : tier === 'balanced'
        ? Math.max(1, configuredRippleCapacity - 1)
        : 1
    uniforms.uRippleCapacity.value = activeRippleCapacity
    wakeCapacity = tier === 'high' ? WAKE_CAPACITY : tier === 'balanced' ? 24 : 12
    wakeGeometry.setDrawRange(0, wakeCapacity)
    wakeCursor %= wakeCapacity
    for (let index = wakeCapacity; index < WAKE_CAPACITY; index += 1) wakeBirths[index] = -100
    wakeBirthAttribute.needsUpdate = true
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
      if (!hasWakeOrigin && (nextPointerX !== target.pointerX || nextPointerY !== target.pointerY)) {
        wakeNdc.set(nextPointerX, nextPointerY)
        hasWakeOrigin = true
      }
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
      target.pointerVelocity.x = clamp(input.pointerVelocity.x, -4, 4)
      target.pointerVelocity.y = clamp(input.pointerVelocity.y, -4, 4)
      target.scroll = nextScroll
    },
    setQualityTier(tier) {
      if (disposed || tier === currentQualityTier) return
      applyQualityTier(tier)
    },
    triggerRipple(ndcX, ndcY) {
      const direction = resolveInteractionDirection(ndcX, ndcY)
      if (!direction) return false
      const slotIndex = rippleCursor % activeRippleCapacity
      rippleDirections[slotIndex].copy(direction)
      rippleSlots[slotIndex].startedAt = lastTime > 0 ? lastTime : null
      rippleSlots[slotIndex].active = true
      rippleStrengths[slotIndex] = 1
      rippleCursor = (slotIndex + 1) % activeRippleCapacity
      rippleCount = Math.min(activeRippleCapacity, rippleCount + 1)
      rippleSequence += 1
      uniforms.uRippleCount.value = rippleCount
      impactEnergy = clamp(impactEnergy + 0.85, 0, 1)
      return true
    },
    beginPress(ndcX, ndcY) {
      const direction = resolveInteractionDirection(ndcX, ndcY)
      if (!direction) return false
      pressDirection.copy(direction)
      pressNdc.set(ndcX, ndcY)
      pressStartedAt = lastTime > 0 ? lastTime : null
      pressActive = true
      return true
    },
    endPress() {
      pressActive = false
    },
    render(time) {
      if (disposed) return
      const seconds = time / 1000
      if (lastTime > 0 && seconds - lastTime > 0.25) {
        wakeNdc.set(target.pointerX, target.pointerY)
        hasWakeOrigin = false
        wakeBirths.fill(-100)
        wakeBirthAttribute.needsUpdate = true
      }
      const delta = lastTime > 0 ? clamp(seconds - lastTime, 0, 0.05) : 1 / 60
      lastTime = seconds
      current.pointerX = damp(current.pointerX, target.pointerX, 5.5, delta)
      current.pointerY = damp(current.pointerY, target.pointerY, 5.5, delta)
      current.pointerVelocity.x = damp(current.pointerVelocity.x, target.pointerVelocity.x, 8, delta)
      current.pointerVelocity.y = damp(current.pointerVelocity.y, target.pointerVelocity.y, 8, delta)
      // Exact critically damped integration preserves velocity across abrupt scroll reversals.
      const scrollOffset = current.scroll - target.scroll
      const scrollStep = (scrollVelocity + 7 * scrollOffset) * delta
      const scrollDecay = Math.exp(-7 * delta)
      current.scroll = clamp(target.scroll + (scrollOffset + scrollStep) * scrollDecay, 0, 1)
      scrollVelocity = (scrollVelocity - 7 * scrollStep) * scrollDecay

      const stage = resolveMotionStage(current.scroll)
      const mood = sceneMoodAt(current.scroll)
      if (stage !== previousStage) {
        previousStage = stage
        canvas.dataset.motionStage = stage
      }
      const rotationX = -0.06 + current.pointerY * 0.18 + current.scroll * (0.9 + mood.rotationSpeed)
      const rotationY = 0.25 + current.pointerX * 0.23 - current.scroll * (0.65 + mood.rotationSpeed)
      const rotationZ = -0.04 + current.scroll * (0.8 + mood.rotationSpeed)
      const viewportScale = Math.min(1, camera.aspect)
      const moodScale = 1 + (mood.scale - 1) * 0.12
      const scale = (0.58 + Math.sin(seconds * 0.55) * 0.008 + current.scroll * 0.04) * moodScale * viewportScale
      // Integrate the changing speed so scroll never rewrites the accumulated phase.
      floatPhase = (floatPhase + delta * 0.45 * (0.4 + mood.rotationSpeed)) % (Math.PI * 2)
      const offsetY = Math.sin(floatPhase) * 0.04

      mesh.rotation.set(rotationX, rotationY, rotationZ)
      wireMesh.rotation.set(rotationX, rotationY, rotationZ)
      mesh.position.y = offsetY
      wireMesh.position.y = offsetY
      mesh.scale.setScalar(scale)
      wireMesh.scale.setScalar(scale * 1.008)

      const hoverHit = hitSphere(current.pointerX, current.pointerY)
      if (hoverHit) hoverDirection.copy(hoverHit)
      const hoverTarget = hoverHit ? 1 : 0
      hoverStrength = damp(hoverStrength, hoverTarget, 9, delta)
      updateRippleUniforms(seconds)
      updatePress(delta, seconds)
      updateWake(seconds)
      const pointerSpeed = clamp(Math.hypot(current.pointerVelocity.x, current.pointerVelocity.y), 0, 4)
      if (pointerSpeed > 0.0001) trailDirection.set(current.pointerVelocity.x, current.pointerVelocity.y).normalize()
      trailVelocity.set(current.pointerVelocity.x, current.pointerVelocity.y)
      const trailTarget = clamp(pointerSpeed / 2.4 + impactEnergy * 0.35, 0, 1)
      trailStrength = damp(trailStrength, trailTarget, 8, delta)
      impactEnergy = damp(impactEnergy, 0, 4.5, delta)

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
      uniforms.uHoverActive.value = hoverHit ? 1 : 0
      uniforms.uHoverStrength.value = hoverStrength
      particleMaterial.uniforms.uPointerVelocity.value.copy(trailVelocity)
      particleMaterial.uniforms.uTrailDirection.value.copy(trailDirection)
      particleMaterial.uniforms.uTrailStrength.value = clamp(trailStrength, 0, 1)
      particleMaterial.uniforms.uImpactEnergy.value = clamp(impactEnergy, 0, 1)
      canvas.dataset.sphereHover = hoverHit ? '1' : '0'
      canvas.dataset.sphereRippleCount = String(rippleCount)
      canvas.dataset.spherePressDepth = pressDepth.toFixed(4)
      canvas.dataset.sphereTrailStrength = clamp(trailStrength, 0, 1).toFixed(4)
      canvas.dataset.sphereScale = scale.toFixed(4)
      canvas.dataset.sphereRippleSequence = String(rippleSequence)
      renderer.render(scene, camera)
    },
    dispose() {
      if (disposed) return
      disposed = true
      scene.clear()
      geometry.dispose()
      wireGeometry.dispose()
      particleGeometry.dispose()
      wakeGeometry.dispose()
      material.dispose()
      wireMaterial.dispose()
      particleMaterial.dispose()
      wakeMaterial.dispose()
    },
  }
}
