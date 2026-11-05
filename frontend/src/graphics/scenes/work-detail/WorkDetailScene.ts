import { BoxGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, SphereGeometry, TorusGeometry } from 'three'
import type { WorkDetailPageState } from '../pageStates'
import type { PageSceneModule, SceneContext, SceneRenderContext, VisualState } from '../../runtime/types'
import { disposeSceneResources } from '../sceneResources'

type DetailComposition = 'code' | 'film' | 'music' | 'neutral'

export class WorkDetailScene implements PageSceneModule<WorkDetailPageState> {
  readonly id = 'work-detail' as const
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
  private readonly compositions = new Map<DetailComposition, Group>()
  private progress: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null
  private composition: DetailComposition = 'neutral'
  private disposed = false

  mount(_context: SceneContext): void {
    this.disposed = false
    this.camera.position.z = 18
    const code = new Group()
    for (let index = 0; index < 7; index += 1) {
      const width = [1.25, 0.82, 1.58, 0.96][index % 4]!
      const line = new Mesh(new BoxGeometry(width, 0.055, 0.05), new MeshBasicMaterial({ color: index % 3 === 0 ? 0x377f9d : 0x4f7484, transparent: true, opacity: 0.52 }))
      line.position.set(-0.2 + (index % 3) * 0.2, 1.1 - index * 0.38, index * 0.012)
      code.add(line)
    }
    for (let index = 0; index < 3; index += 1) {
      const node = new Mesh(new SphereGeometry(0.095, 10, 8), new MeshBasicMaterial({ color: 0xd5a448, transparent: true, opacity: 0.8 }))
      node.position.set(-1.25 + index * 1.22, -1.9, 0.1)
      code.add(node)
    }
    this.compositions.set('code', code)

    const film = new Group()
    const frameMaterial = new MeshBasicMaterial({ color: 0x4f7484, transparent: true, opacity: 0.55 })
    film.add(new Mesh(new PlaneGeometry(3.15, 1.8), new MeshBasicMaterial({ color: 0x377f9d, transparent: true, opacity: 0.13, side: 2 })))
    for (const [x, y, width, height] of [[0, 0.91, 3.3, 0.055], [0, -0.91, 3.3, 0.055], [-1.62, 0, 0.055, 1.85], [1.62, 0, 0.055, 1.85]] as const) {
      const rail = new Mesh(new BoxGeometry(width, height, 0.08), frameMaterial)
      rail.position.set(x, y, 0.12)
      film.add(rail)
    }
    for (const x of [-1.23, -0.78, -0.33, 0.33, 0.78, 1.23]) {
      const perforation = new Mesh(new BoxGeometry(0.18, 0.075, 0.04), new MeshBasicMaterial({ color: 0xd5a448, transparent: true, opacity: 0.72 }))
      perforation.position.set(x, 0.91, 0.2)
      film.add(perforation)
      const lower = perforation.clone()
      lower.position.y = -0.91
      film.add(lower)
    }
    const focusFrame = new Mesh(new BoxGeometry(1.8, 1.05, 0.045), new MeshBasicMaterial({ color: 0xd5a448, wireframe: true, transparent: true, opacity: 0.75 }))
    focusFrame.position.z = 0.18
    film.add(focusFrame)
    this.compositions.set('film', film)

    const music = new Group()
    for (let index = 0; index < 13; index += 1) {
      const height = 0.25 + ((index * 7) % 9) * 0.12
      const bar = new Mesh(new BoxGeometry(0.13, height, 0.06), new MeshBasicMaterial({ color: index % 4 === 0 ? 0xd5a448 : 0x54889b, transparent: true, opacity: 0.68 }))
      bar.position.set((index - 6) * 0.27, -0.2 + height / 2, 0)
      music.add(bar)
    }
    for (let index = 0; index < 3; index += 1) {
      const ring = new Mesh(new TorusGeometry(0.78 + index * 0.28, 0.012, 5, 64), new MeshBasicMaterial({ color: 0x377f9d, transparent: true, opacity: 0.32 - index * 0.07 }))
      ring.position.z = -0.1 - index * 0.01
      music.add(ring)
    }
    this.progress = new Mesh(new PlaneGeometry(2.9, 0.045), new MeshBasicMaterial({ color: 0xd5a448, transparent: true, opacity: 0.9 }))
    this.progress.position.set(-1.45, -1.45, 0.15)
    music.add(this.progress)
    this.compositions.set('music', music)

    const neutral = new Group()
    neutral.add(new Mesh(new TorusGeometry(0.6, 0.018, 5, 48), new MeshBasicMaterial({ color: 0x54889b, transparent: true, opacity: 0.22 })))
    this.compositions.set('neutral', neutral)
    this.compositions.forEach((group, kind) => {
      group.visible = kind === 'neutral'
      this.scene.add(group)
    })
  }

  enter(): void {}
  leave(): void {}

  update(visualState: Readonly<VisualState>, pageState: Readonly<WorkDetailPageState>): void {
    if (this.disposed) return
    const category = pageState?.category
    this.composition = category === 'code' || category === 'film' || category === 'music' ? category : 'neutral'
    this.compositions.forEach((group, kind) => { group.visible = kind === this.composition })
    const music = this.compositions.get('music')!
    music.rotation.z = pageState?.playing ? Math.sin(visualState.timeMs * 0.0003) * 0.04 : 0
    if (this.progress) {
      const progress = Math.min(1, Math.max(0, Number(pageState?.playbackProgress) || 0))
      this.progress.scale.x = pageState?.hasMedia ? progress : 0
      this.progress.position.x = -1.45 + progress * 1.45
    }
    const code = this.compositions.get('code')!
    code.rotation.y = visualState.pointerX * 0.045
    const film = this.compositions.get('film')!
    film.rotation.x = visualState.pointerY * 0.04
  }

  resize(): void {}
  render(context: SceneRenderContext): void { if (!this.disposed) context.renderer.render(this.scene, this.camera) }
  dispose(): void {
    if (this.disposed) return
    disposeSceneResources(this.scene)
    this.compositions.clear()
    this.progress = null
    this.disposed = true
    this.composition = 'neutral'
  }
  getComposition(): DetailComposition { return this.composition }
}
