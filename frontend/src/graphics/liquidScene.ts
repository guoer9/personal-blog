import {
  BufferGeometry,
  IcosahedronGeometry,
  Mesh,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  WebGLRenderer,
} from 'three'
import { clamp, damp } from './motion'
import { flowFragmentShader, flowVertexShader } from './shaders'

export interface SceneInput {
  pointerX: number
  pointerY: number
  scroll: number
}

export interface LiquidSceneController {
  resize(width: number, height: number, dpr: number): void
  setInput(input: Readonly<SceneInput>): void
  render(time: number): void
  dispose(): void
}

export function createLiquidScene(canvas: HTMLCanvasElement, initialState: SceneInput): LiquidSceneController {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = 'srgb'

  const scene = new Scene()
  const camera = new PerspectiveCamera(38, 1, 0.1, 100)
  camera.position.set(0, 0, 4.8)

  const uniforms = {
    uTime: { value: 0 },
    uPointerX: { value: 0 },
    uPointerY: { value: 0 },
    uScroll: { value: 0 },
  }
  const geometry = new IcosahedronGeometry(1.52, 5)
  const material = new ShaderMaterial({
    vertexShader: flowVertexShader,
    fragmentShader: flowFragmentShader,
    uniforms,
  })
  const mesh = new Mesh(geometry, material)
  scene.add(mesh)

  const wireGeometry = new BufferGeometry()
  wireGeometry.setAttribute('position', geometry.getAttribute('position').clone())
  wireGeometry.setIndex(geometry.getIndex()?.clone() ?? null)
  const wireMaterial = new ShaderMaterial({
    vertexShader: flowVertexShader,
    fragmentShader: 'void main(){ gl_FragColor = vec4(0.015, 0.02, 0.025, 0.22); }',
    wireframe: true,
    transparent: true,
    uniforms,
  })
  const wireMesh = new Mesh(wireGeometry, wireMaterial)
  scene.add(wireMesh)

  const target: SceneInput = { ...initialState }
  const current: SceneInput = { ...initialState }
  let lastTime = 0
  let disposed = false

  return {
    resize(width, height, dpr) {
      if (width <= 0 || height <= 0 || disposed) return
      renderer.setPixelRatio(clamp(dpr, 1, 1.75))
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    },
    setInput(input) {
      target.pointerX = clamp(input.pointerX, -1, 1)
      target.pointerY = clamp(input.pointerY, -1, 1)
      target.scroll = clamp(input.scroll, 0, 1.5)
    },
    render(time) {
      if (disposed) return
      const seconds = time / 1000
      const delta = lastTime > 0 ? clamp(seconds - lastTime, 0, 0.05) : 1 / 60
      lastTime = seconds
      current.pointerX = damp(current.pointerX, target.pointerX, 6, delta)
      current.pointerY = damp(current.pointerY, target.pointerY, 6, delta)
      current.scroll = damp(current.scroll, target.scroll, 5, delta)

      const rotationX = -0.1 + current.pointerY * 0.24 + current.scroll * 0.75
      const rotationY = 0.35 + current.pointerX * 0.32 + current.scroll * 0.5
      const rotationZ = -0.08 + current.scroll * 0.3
      const scale = 0.94 + Math.sin(seconds * 0.58) * 0.025
      const offsetY = Math.sin(seconds * 0.5) * 0.06

      for (const object of [mesh, wireMesh]) {
        object.rotation.set(rotationX, rotationY, rotationZ)
        object.position.y = offsetY
      }
      mesh.scale.setScalar(scale)
      wireMesh.scale.setScalar(scale * 1.012)

      uniforms.uTime.value = seconds
      uniforms.uPointerX.value = current.pointerX
      uniforms.uPointerY.value = current.pointerY
      uniforms.uScroll.value = current.scroll
      renderer.render(scene, camera)
    },
    dispose() {
      if (disposed) return
      disposed = true
      scene.clear()
      geometry.dispose()
      wireGeometry.dispose()
      material.dispose()
      wireMaterial.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
}
