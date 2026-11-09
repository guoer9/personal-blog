import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DoubleSide,
  IcosahedronGeometry,
  LinearFilter,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  PerspectiveCamera,
  Points,
  Raycaster,
  Scene,
  Sphere,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from 'three'
import { clamp, damp, MotionEnergy, qualityProfile, resolveMotionStage, sceneMoodAt } from './motion'
import {
  flowFragmentShader,
  flowVertexShader,
  particleFragmentShader,
  particleVertexShader,
} from './shaders'
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
import type { QualityTier } from './quality'
import type { RendererAdapter } from './runtime/types'

export interface SceneInput {
  pointerX: number
  pointerY: number
  pointerPixelX?: number
  pointerPixelY?: number
  pointerVelocity: { x: number; y: number }
  scroll: number
  audio?: { bass: number; mid: number; treble: number; energy: number; active: boolean }
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

function createFacetGeometry(count: number): BufferGeometry {
  const positions: number[] = []
  const uvs: number[] = []
  for (let index = 0; index < count; index += 1) {
    const angle = index * 2.399963
    const radius = 1.55 + (index % 4) * 0.12
    const width = 0.12 + (index % 3) * 0.045
    const height = 0.16 + (index % 5) * 0.04
    const center = new Vector3(Math.cos(angle) * radius, Math.sin(angle * 1.7) * radius * 0.6, Math.sin(angle) * radius)
    const tangent = new Vector3(-Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(width)
    const lift = new Vector3(0, height, 0)
    const a = center.clone().sub(tangent)
    const b = center.clone().add(tangent)
    const c = center.clone().add(lift)
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    uvs.push(0, 0, 1, 0, 0.5, 1)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.computeBoundingSphere()
  return geometry
}

const MAX_RIPPLES = 6
const RIPPLE_LIFETIME_SECONDS = 1.8
const PRESS_DEPTH_MAX = 0.28
const PRESS_GROW_SECONDS = 0.45
const PRESS_STIFFNESS = 90
const PRESS_DAMPING = 12
const VELOCITY_DISSIPATION_PER_FRAME = 0.975
const WEIGHT_1_DISSIPATION_PER_FRAME = 0.95
const WEIGHT_2_DISSIPATION_PER_FRAME = 0.8

export function createLiquidScene(
  renderer: RendererAdapter,
  initialState: SceneInput,
  quality: SceneQuality = qualityProfile(window.innerWidth, navigator.hardwareConcurrency || 4),
): LiquidSceneController {
  const sharedRenderer = renderer as RendererAdapter & {
    setClearColor?: (color: number, alpha: number) => void
    outputColorSpace?: string
    autoClear?: boolean
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
    uAudio: { value: new Vector3() },
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

  const glassScene = new Scene()
  const blobGeometry = new IcosahedronGeometry(0.42, 2)
  const blobMaterial = new ShaderMaterial({
    vertexShader: glassBlobVertexShader,
    fragmentShader: glassBlobFragmentShader,
    uniforms: {
      uSceneTexture: { value: null },
      uBlurTexture: { value: null },
      uResolution: { value: new Vector2(1, 1) },
      uViewProjectionMatrix: { value: new Matrix4() },
      uRefractionRatio: { value: 2.4 },
      uThickness: { value: 0.3 },
      uOpacity: { value: 0 },
      uEdgeColor: { value: new Vector3(0.38, 0.78, 1.0) },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
  const glassBlob = new Mesh(blobGeometry, blobMaterial)
  glassBlob.visible = false
  glassBlob.renderOrder = 10
  glassScene.add(glassBlob)

  const facetGeometry = createFacetGeometry(16)
  const facetMaterial = new ShaderMaterial({
    vertexShader: glassFacetVertexShader,
    fragmentShader: glassFacetFragmentShader,
    uniforms: {
      uSceneTexture: { value: null },
      uResolution: { value: new Vector2(1, 1) },
      uEdgeColor: { value: new Vector3(0.78, 0.94, 0.62) },
      uOpacity: { value: 0 },
      uRefractionStrength: { value: 18 },
    },
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
  const glassFacets = new Mesh(facetGeometry, facetMaterial)
  glassFacets.visible = false
  glassFacets.renderOrder = 11
  glassScene.add(glassFacets)

  const postGeometry = new PlaneGeometry(2, 2)
  const postCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const postScene = new Scene()
  const postMesh = new Mesh(postGeometry, new ShaderMaterial({ vertexShader: glassCompositeVertexShader, fragmentShader: glassCompositeFragmentShader }))
  postMesh.frustumCulled = false
  postScene.add(postMesh)

  const createTarget = () => {
    const target = new WebGLRenderTarget(1, 1, {
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    })
    target.texture.generateMipmaps = false
    return target
  }
  const sceneTarget = createTarget()
  const blurTarget = createTarget()
  const glassTarget = createTarget()
  let velocityPrev = createTarget()
  let velocityCurr = createTarget()
  let lowPrev = createTarget()
  let lowCurr = createTarget()
  let lowBlurTarget = createTarget()
  const velocityAdvectMaterial = new ShaderMaterial({
    vertexShader: velocityAdvectVertexShader,
    fragmentShader: velocityAdvectFragmentShader,
    uniforms: {
      uPrevPaint: { value: null }, uLowPaint: { value: null }, uTexelSize: { value: new Vector2(1, 1) },
      uVelocityDissipation: { value: VELOCITY_DISSIPATION_PER_FRAME },
      uWeight1Dissipation: { value: WEIGHT_1_DISSIPATION_PER_FRAME },
      uWeight2Dissipation: { value: WEIGHT_2_DISSIPATION_PER_FRAME },
      uPushStrength: { value: 25 },
      uCurlScale: { value: 0.02 }, uCurlStrength: { value: 3 },
    },
  })
  const velocitySplatMaterial = new ShaderMaterial({
    vertexShader: velocityAdvectVertexShader,
    fragmentShader: velocitySplatFragmentShader,
    uniforms: {
      uPrevPaint: { value: null }, uPointer: { value: new Vector2() }, uPrevPointer: { value: new Vector2() },
      uVelocity: { value: new Vector2() }, uResolution: { value: new Vector2(1, 1) },
      uPrevBrushRadius: { value: 0 }, uBrushRadius: { value: 0 },
    },
  })
  const lowFieldBlurMaterial = new ShaderMaterial({
    vertexShader: glassCompositeVertexShader,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform vec2 uDelta;
      void main() {
        vec4 color = texture2D(uTexture, vUv) * 0.1633;
        vec2 delta = uDelta;
        color += texture2D(uTexture, vUv - delta) * 0.1531;
        color += texture2D(uTexture, vUv + delta) * 0.1531;
        delta += uDelta;
        color += texture2D(uTexture, vUv - delta) * 0.12245;
        color += texture2D(uTexture, vUv + delta) * 0.12245;
        delta += uDelta;
        color += texture2D(uTexture, vUv - delta) * 0.0918;
        color += texture2D(uTexture, vUv + delta) * 0.0918;
        delta += uDelta;
        color += texture2D(uTexture, vUv - delta) * 0.051;
        color += texture2D(uTexture, vUv + delta) * 0.051;
        gl_FragColor = color;
      }
    `,
    uniforms: { uTexture: { value: null }, uDelta: { value: new Vector2() } },
  })
  const paintClearMaterial = new ShaderMaterial({
    vertexShader: glassCompositeVertexShader,
    fragmentShader: /* glsl */ `
      void main() { gl_FragColor = vec4(0.5, 0.5, 0.0, 0.0); }
    `,
  })
  const blurMaterial = new ShaderMaterial({
    vertexShader: glassCompositeVertexShader,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D uTexture;
      uniform vec2 uTexelSize;
      void main() {
        vec3 color = vec3(0.0);
        color += texture2D(uTexture, vUv - uTexelSize * 2.0).rgb * 0.08;
        color += texture2D(uTexture, vUv - uTexelSize).rgb * 0.16;
        color += texture2D(uTexture, vUv).rgb * 0.52;
        color += texture2D(uTexture, vUv + uTexelSize).rgb * 0.16;
        color += texture2D(uTexture, vUv + uTexelSize * 2.0).rgb * 0.08;
        gl_FragColor = vec4(color, 1.0);
      }
    `,
    uniforms: { uTexture: { value: null }, uTexelSize: { value: new Vector2(1, 1) } },
  })
  const copyMaterial = new ShaderMaterial({
    vertexShader: glassCompositeVertexShader,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform sampler2D uTexture;
      void main() { gl_FragColor = texture2D(uTexture, vUv); }
    `,
    uniforms: { uTexture: { value: null } },
  })
  const glassCompositeMaterial = new ShaderMaterial({
    vertexShader: glassCompositeVertexShader,
    fragmentShader: glassCompositeFragmentShader,
    uniforms: {
      uTexture: { value: null }, uVelocityTexture: { value: null },
      uFieldTexelSize: { value: new Vector2(1, 1) }, uScrollOffset: { value: new Vector2(0, 0) },
      uAmount: { value: 3 }, uMultiplier: { value: 5 }, uRgbShift: { value: 0.5 },
      uColorMultiplier: { value: 10 }, uShade: { value: 1.25 }, uOpacity: { value: 1 },
    },
  })

  const target: SceneInput = {
    ...initialState,
    pointerPixelX: initialState.pointerPixelX ?? 0,
    pointerPixelY: initialState.pointerPixelY ?? 0,
    pointerVelocity: { ...initialState.pointerVelocity },
  }
  const current: SceneInput = {
    ...target,
    pointerVelocity: { ...target.pointerVelocity },
  }
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
  let fieldPointer = new Vector2(0.5, 0.5)
  let previousFieldPointer = new Vector2(0.5, 0.5)
  let fieldBrushRadius = 0
  const fieldVelocity = new Vector2()
  const pointerDelta = new Vector2()
  let hasFieldOrigin = false
  let facetCapacity = 16
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

  function renderPass(target: WebGLRenderTarget | null, passScene: Scene, passCamera: OrthographicCamera | PerspectiveCamera, clear = true) {
    if (!sharedRenderer.setRenderTarget) return
    const previousTarget = sharedRenderer.getRenderTarget?.() ?? null
    const previousAutoClear = sharedRenderer.autoClear
    sharedRenderer.setRenderTarget(target)
    if (clear) sharedRenderer.clear?.(true, true, true)
    if (!clear) sharedRenderer.autoClear = false
    sharedRenderer.render(passScene, passCamera)
    if (!clear) sharedRenderer.autoClear = previousAutoClear
    sharedRenderer.setRenderTarget(previousTarget)
  }

  function updateVelocityField(delta: number) {
    if (!sharedRenderer.setRenderTarget || viewportWidth <= 0 || viewportHeight <= 0) return
    const frameScale = delta * 60
    velocityAdvectMaterial.uniforms.uVelocityDissipation.value = Math.pow(VELOCITY_DISSIPATION_PER_FRAME, frameScale)
    velocityAdvectMaterial.uniforms.uWeight1Dissipation.value = Math.pow(WEIGHT_1_DISSIPATION_PER_FRAME, frameScale)
    velocityAdvectMaterial.uniforms.uWeight2Dissipation.value = Math.pow(WEIGHT_2_DISSIPATION_PER_FRAME, frameScale)
    const pointerX = clamp(target.pointerPixelX ?? 0, 0, viewportWidth) / viewportWidth
    const pointerY = 1 - clamp(target.pointerPixelY ?? 0, 0, viewportHeight) / viewportHeight
    if (!hasFieldOrigin) {
      fieldPointer.set(pointerX, pointerY)
      previousFieldPointer.copy(fieldPointer)
      hasFieldOrigin = true
    }
    previousFieldPointer.copy(fieldPointer)
    fieldPointer.set(pointerX, pointerY)
    const moveDistance = Math.hypot(
      (pointerX - previousFieldPointer.x) * viewportWidth,
      (pointerY - previousFieldPointer.y) * viewportHeight,
    )
    pointerDelta.set(
      (pointerX - previousFieldPointer.x) * velocityPrev.width,
      (pointerY - previousFieldPointer.y) * velocityPrev.height,
    )
    fieldVelocity.multiplyScalar(0.8).addScaledVector(pointerDelta, delta * 0.8)
    const velocityTexelSize = new Vector2(
      1 / Math.max(1, velocityPrev.width),
      1 / Math.max(1, velocityPrev.height),
    )
    velocityAdvectMaterial.uniforms.uPrevPaint.value = velocityPrev.texture
    velocityAdvectMaterial.uniforms.uLowPaint.value = lowPrev.texture
    velocityAdvectMaterial.uniforms.uTexelSize.value.copy(velocityTexelSize)
    postMesh.material = velocityAdvectMaterial
    renderPass(velocityCurr, postScene, postCamera)

    if (moveDistance > 0.5) {
      const maxRadius = Math.max(40, viewportWidth / 20)
      const brushRadiusPixels = Math.min(1, moveDistance / 100) * maxRadius * velocityCurr.height / viewportHeight
      velocitySplatMaterial.uniforms.uPrevPaint.value = velocityCurr.texture
      velocitySplatMaterial.uniforms.uPointer.value.set(pointerX, pointerY)
      velocitySplatMaterial.uniforms.uPrevPointer.value.copy(previousFieldPointer)
      velocitySplatMaterial.uniforms.uVelocity.value.copy(fieldVelocity)
      velocitySplatMaterial.uniforms.uResolution.value.set(velocityCurr.width, velocityCurr.height)
      velocitySplatMaterial.uniforms.uPrevBrushRadius.value = fieldBrushRadius
      velocitySplatMaterial.uniforms.uBrushRadius.value = brushRadiusPixels
      postMesh.material = velocitySplatMaterial
      renderPass(velocityPrev, postScene, postCamera)
      fieldBrushRadius = brushRadiusPixels
    } else {
      const swap = velocityPrev
      velocityPrev = velocityCurr
      velocityCurr = swap
      fieldBrushRadius = 0
    }

    copyMaterial.uniforms.uTexture.value = velocityPrev.texture
    postMesh.material = copyMaterial
    renderPass(lowCurr, postScene, postCamera)

    lowFieldBlurMaterial.uniforms.uTexture.value = lowCurr.texture
    lowFieldBlurMaterial.uniforms.uDelta.value.set(2 / Math.max(1, lowCurr.width), 0)
    postMesh.material = lowFieldBlurMaterial
    renderPass(lowBlurTarget, postScene, postCamera)

    lowFieldBlurMaterial.uniforms.uTexture.value = lowBlurTarget.texture
    lowFieldBlurMaterial.uniforms.uDelta.value.set(0, 2 / Math.max(1, lowBlurTarget.height))
    renderPass(lowPrev, postScene, postCamera)

    canvas.dataset.sphereVelocityWeight = Math.min(1, moveDistance / 100).toFixed(5)
    canvas.dataset.sphereVelocityDelta = delta.toFixed(5)
    canvas.dataset.sphereVelocityStroke = moveDistance > 0.5 ? '1' : '0'
  }

  function updateGlassLayers(hoverHit: Vector3 | null, hoverAmount: number, scale: number, pointerSpeed: number) {
    const hoverOpacity = clamp(hoverAmount * (0.6 + pointerSpeed * 0.12), 0, 1)
    glassBlob.visible = false
    glassFacets.visible = hoverOpacity > 0.01 && facetCapacity > 0
    if (hoverHit) {
      glassFacets.position.copy(mesh.position)
      glassFacets.rotation.copy(mesh.rotation)
      glassFacets.scale.setScalar(scale * 0.78)
      facetGeometry.setDrawRange(0, facetCapacity * 3)
    }
    facetMaterial.uniforms.uOpacity.value = hoverOpacity * 0.72
    canvas.dataset.sphereGlassBlob = 'hidden'
    canvas.dataset.sphereFacetCount = String(facetCapacity)
  }

  function renderGlassPipeline() {
    if (!sharedRenderer.setRenderTarget || viewportWidth <= 0 || viewportHeight <= 0) return false
    const previousTarget = sharedRenderer.getRenderTarget?.() ?? null
    const previousAutoClear = sharedRenderer.autoClear
    sharedRenderer.setRenderTarget(sceneTarget)
    sharedRenderer.autoClear = true
    sharedRenderer.clear?.(true, true, true)
    sharedRenderer.render(scene, camera)

    blurMaterial.uniforms.uTexture.value = sceneTarget.texture
    blurMaterial.uniforms.uTexelSize.value.set(1 / Math.max(1, sceneTarget.width), 1 / Math.max(1, sceneTarget.height))
    postMesh.material = blurMaterial
    renderPass(blurTarget, postScene, postCamera)

    copyMaterial.uniforms.uTexture.value = sceneTarget.texture
    postMesh.material = copyMaterial
    renderPass(glassTarget, postScene, postCamera)

    blobMaterial.uniforms.uSceneTexture.value = sceneTarget.texture
    blobMaterial.uniforms.uBlurTexture.value = blurTarget.texture
    camera.updateMatrixWorld(true)
    blobMaterial.uniforms.uViewProjectionMatrix.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    facetMaterial.uniforms.uSceneTexture.value = sceneTarget.texture
    sharedRenderer.setRenderTarget(glassTarget)
    sharedRenderer.autoClear = false
    sharedRenderer.render(glassScene, camera)
    sharedRenderer.autoClear = previousAutoClear
    sharedRenderer.setRenderTarget(previousTarget)

    glassCompositeMaterial.uniforms.uTexture.value = glassTarget.texture
    glassCompositeMaterial.uniforms.uVelocityTexture.value = velocityPrev.texture
    glassCompositeMaterial.uniforms.uFieldTexelSize.value.set(1 / Math.max(1, velocityPrev.width), 1 / Math.max(1, velocityPrev.height))
    glassCompositeMaterial.uniforms.uScrollOffset.value.set(0, 0)
    glassCompositeMaterial.uniforms.uOpacity.value = 1
    postMesh.material = glassCompositeMaterial
    renderPass(null, postScene, postCamera)
    canvas.dataset.glassPass = 'composite'
    return true
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
    facetCapacity = tier === 'high' ? 16 : tier === 'balanced' ? 10 : 5
    facetGeometry.setDrawRange(0, facetCapacity * 3)
    particleGeometry.setDrawRange(0, particleCount)
    particleMaterial.uniforms.uPixelRatio.value = pixelRatio
    canvas.dataset.sphereCompositeSamples = '9'
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
      hasFieldOrigin = false
      fieldBrushRadius = 0
      fieldVelocity.set(0, 0)
      applyQualityTier(currentQualityTier)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      const renderWidth = Math.max(1, Math.round(width * rawDpr))
      const renderHeight = Math.max(1, Math.round(height * rawDpr))
      sceneTarget.setSize(renderWidth, renderHeight)
      blurTarget.setSize(renderWidth, renderHeight)
      glassTarget.setSize(renderWidth, renderHeight)
      velocityPrev.setSize(Math.max(1, Math.round(renderWidth / 4)), Math.max(1, Math.round(renderHeight / 4)))
      velocityCurr.setSize(velocityPrev.width, velocityPrev.height)
      lowPrev.setSize(Math.max(1, Math.round(renderWidth / 8)), Math.max(1, Math.round(renderHeight / 8)))
      lowCurr.setSize(lowPrev.width, lowPrev.height)
      lowBlurTarget.setSize(lowPrev.width, lowPrev.height)
      velocityAdvectMaterial.uniforms.uTexelSize.value.set(1 / Math.max(1, velocityPrev.width), 1 / Math.max(1, velocityPrev.height))
      velocitySplatMaterial.uniforms.uResolution.value.set(velocityPrev.width, velocityPrev.height)
      blobMaterial.uniforms.uResolution.value.set(renderWidth, renderHeight)
      facetMaterial.uniforms.uResolution.value.set(renderWidth, renderHeight)
      postMesh.material = paintClearMaterial
      renderPass(velocityPrev, postScene, postCamera)
      renderPass(lowPrev, postScene, postCamera)
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
      target.pointerPixelX = Number.isFinite(input.pointerPixelX)
        ? Math.max(0, Number(input.pointerPixelX))
        : ((nextPointerX + 1) * 0.5) * viewportWidth
      target.pointerPixelY = Number.isFinite(input.pointerPixelY)
        ? Math.max(0, Number(input.pointerPixelY))
        : ((1 - nextPointerY) * 0.5) * viewportHeight
      target.pointerVelocity.x = clamp(input.pointerVelocity.x, -4, 4)
      target.pointerVelocity.y = clamp(input.pointerVelocity.y, -4, 4)
      target.scroll = nextScroll
      target.audio = input.audio
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
      const delta = lastTime > 0 ? clamp(seconds - lastTime, 0, 0.05) : 1 / 60
      lastTime = seconds
      current.pointerX = damp(current.pointerX, target.pointerX, 5.5, delta)
      current.pointerY = damp(current.pointerY, target.pointerY, 5.5, delta)
      current.pointerPixelX = damp(current.pointerPixelX ?? 0, target.pointerPixelX ?? 0, 5.5, delta)
      current.pointerPixelY = damp(current.pointerPixelY ?? 0, target.pointerPixelY ?? 0, 5.5, delta)
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

      const cameraTargetX = current.pointerX * 0.11
      const cameraTargetY = current.pointerY * 0.07
      camera.position.x = damp(camera.position.x, cameraTargetX, 4.5, delta)
      camera.position.y = damp(camera.position.y, cameraTargetY, 4.5, delta)
      camera.lookAt(0, 0, 0)

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
      const audio = target.audio
      const band = (value: number | undefined) => audio?.active && Number.isFinite(value) ? clamp(value!, 0, 1) : 0
      uniforms.uAudio.value.set(
        damp(uniforms.uAudio.value.x, band(audio?.bass), 10, delta),
        damp(uniforms.uAudio.value.y, band(audio?.mid), 10, delta),
        damp(uniforms.uAudio.value.z, band(audio?.treble), 10, delta),
      )
      uniforms.uEnergy.value = easedMotionEnergy + band(audio?.energy) * .35
      uniforms.uHoverActive.value = hoverHit ? 1 : 0
      uniforms.uHoverStrength.value = hoverStrength
      particleMaterial.uniforms.uPointerVelocity.value.copy(trailVelocity)
      particleMaterial.uniforms.uTrailDirection.value.copy(trailDirection)
      particleMaterial.uniforms.uTrailStrength.value = clamp(trailStrength, 0, 1)
      particleMaterial.uniforms.uImpactEnergy.value = clamp(impactEnergy, 0, 1)
      updateVelocityField(delta)
      updateGlassLayers(hoverHit, hoverStrength, scale, pointerSpeed)
      canvas.dataset.sphereHover = hoverHit ? '1' : '0'
      canvas.dataset.sphereRippleCount = String(rippleCount)
      canvas.dataset.spherePressDepth = pressDepth.toFixed(4)
      canvas.dataset.sphereTrailStrength = clamp(trailStrength, 0, 1).toFixed(4)
      canvas.dataset.sphereScale = scale.toFixed(4)
      canvas.dataset.audioEnergy = band(audio?.energy).toFixed(4)
      canvas.dataset.sphereRippleSequence = String(rippleSequence)
      if (!renderGlassPipeline()) renderer.render(scene, camera)
    },
    dispose() {
      if (disposed) return
      disposed = true
      scene.clear()
      geometry.dispose()
      wireGeometry.dispose()
      particleGeometry.dispose()
      blobGeometry.dispose()
      facetGeometry.dispose()
      postGeometry.dispose()
      sceneTarget.dispose()
      blurTarget.dispose()
      glassTarget.dispose()
      velocityPrev.dispose()
      velocityCurr.dispose()
      lowPrev.dispose()
      lowCurr.dispose()
      lowBlurTarget.dispose()
      material.dispose()
      wireMaterial.dispose()
      particleMaterial.dispose()
      blobMaterial.dispose()
      facetMaterial.dispose()
      velocityAdvectMaterial.dispose()
      velocitySplatMaterial.dispose()
      lowFieldBlurMaterial.dispose()
      paintClearMaterial.dispose()
      blurMaterial.dispose()
      copyMaterial.dispose()
      glassCompositeMaterial.dispose()
    },
  }
}
