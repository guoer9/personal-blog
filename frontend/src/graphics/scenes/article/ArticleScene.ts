import { CircleGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, BufferGeometry, Float32BufferAttribute } from 'three'
import type { ArticlePageState } from '../pageStates'
import type { PageSceneModule, SceneContext, SceneRenderContext, VisualState } from '../../runtime/types'

const MAX_MARKERS = 8

export class ArticleScene implements PageSceneModule<ArticlePageState> {
  readonly id = 'article' as const
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
  private readonly structure = new Group()
  private readonly markers: Mesh<CircleGeometry, MeshBasicMaterial>[] = []
  private anchors: SceneContext['anchors'] | null = null
  private progress: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null
  private composition = 'reading'
  private disposed = false

  mount(context: SceneContext): void {
    this.disposed = false
    this.anchors = context.anchors
    this.camera.position.z = 20
    const guide = new BufferGeometry()
    guide.setAttribute('position', new Float32BufferAttribute([-2.5, -3.5, 0, -2.5, 3.5, 0, 2.5, -3.5, 0, 2.5, 3.5, 0], 3))
    this.structure.add(new LineSegments(guide, new LineBasicMaterial({ color: 0x547c91, transparent: true, opacity: 0.22 })))
    const rail = new Mesh(new PlaneGeometry(0.035, 6.6), new MeshBasicMaterial({ color: 0x547c91, transparent: true, opacity: 0.26 }))
    rail.position.set(-2.5, 0, 0.1)
    this.structure.add(rail)
    this.progress = new Mesh(new PlaneGeometry(0.055, 6.6), new MeshBasicMaterial({ color: 0x46a8c7, transparent: true, opacity: 0.86 }))
    this.progress.position.set(-2.5, -3.3, 0.2)
    this.progress.scale.y = 0
    this.structure.add(this.progress)
    for (let index = 0; index < MAX_MARKERS; index += 1) {
      const marker = new Mesh(new CircleGeometry(0.085, 20), new MeshBasicMaterial({ color: 0x547c91, transparent: true, opacity: 0.4 }))
      marker.position.set(-2.5, 3.1 - index * 0.88, 0.3)
      this.markers.push(marker)
      this.structure.add(marker)
    }
    const measure = new Mesh(new PlaneGeometry(0.85, 0.012), new MeshBasicMaterial({ color: 0x547c91, transparent: true, opacity: 0.16 }))
    measure.position.set(0.2, 2.9, 0)
    this.structure.add(measure)
    this.scene.add(this.structure)
  }

  enter(): void {}
  leave(): void {}

  update(visualState: Readonly<VisualState>, state: Readonly<ArticlePageState>): void {
    if (this.disposed || !this.progress) return
    const progress = clamp(state?.readingProgress ?? 0, 0, 100)
    const count = clamp(Math.floor(state?.sectionCount ?? 0), 0, MAX_MARKERS)
    const active = state?.activeSection ?? -1
    this.progress.scale.y = progress / 100
    this.progress.position.y = -3.3 + (6.6 * progress) / 200
    this.markers.forEach((marker, index) => {
      marker.visible = index < count
      const anchor = this.anchors?.get(`article-section-${index}`)
      if (anchor && visualState.viewportWidth > 0 && visualState.viewportHeight > 0) {
        marker.position.x = ((anchor.left + anchor.width / 2) / visualState.viewportWidth) * 10 - 5
        marker.position.y = 5 - ((anchor.top + anchor.height / 2) / visualState.viewportHeight) * 10
      }
      marker.material.color.set(index === active ? 0xd5a448 : index < active ? 0x46a8c7 : 0x547c91)
      marker.material.opacity = index === active ? 0.96 : index < active ? 0.68 : 0.28
      marker.scale.setScalar(index === active ? 1.35 : 1)
    })
    this.composition = active >= 0 ? `section-${active}` : 'reading'
  }

  resize(): void {}
  render(context: SceneRenderContext): void {
    if (!this.disposed) context.renderer.render(this.scene, this.camera)
  }
  dispose(): void {
    this.disposeOwnedResources()
    this.disposed = true
    this.composition = 'disposed'
  }
  getComposition(): string { return this.composition }

  private disposeOwnedResources(): void {
    this.scene.traverse((object) => {
      if (!(object instanceof Mesh || object instanceof LineSegments)) return
      object.geometry.dispose()
      const material = object.material
      if (Array.isArray(material)) material.forEach((item) => item.dispose())
      else material.dispose()
    })
    this.scene.clear()
    this.markers.length = 0
    this.progress = null
    this.anchors = null
  }
}

function clamp(value: number, min: number, max: number): number { return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min }
