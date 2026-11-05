import { Group, Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, BoxGeometry } from 'three'
import type { LibraryPageState } from '../pageStates'
import type { PageSceneModule, SceneContext, SceneRenderContext, VisualState } from '../../runtime/types'

export class LibraryScene implements PageSceneModule<LibraryPageState> {
  readonly id = 'library' as const
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
  private readonly indexGroup = new Group()
  private readonly detailGroup = new Group()
  private readonly cards: Mesh<BoxGeometry, MeshBasicMaterial>[] = []
  private progress: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null
  private composition = 'index'
  private disposed = false
  private anchors: SceneContext['anchors'] | null = null

  mount(context: SceneContext): void {
    this.disposed = false
    this.anchors = context.anchors
    this.camera.position.z = 18
    const shelfMaterial = new MeshBasicMaterial({ color: 0x4f7484, transparent: true, opacity: 0.34 })
    const shelfGeometry = new BoxGeometry(5.3, 0.045, 0.08)
    for (let row = 0; row < 4; row += 1) {
      const shelf = new Mesh(shelfGeometry, shelfMaterial)
      shelf.position.set(0, 2.5 - row * 1.5, 0)
      this.indexGroup.add(shelf)
    }
    const cardGeometry = new BoxGeometry(0.36, 0.72, 0.11)
    for (let index = 0; index < 16; index += 1) {
      const card = new Mesh(cardGeometry, new MeshBasicMaterial({ color: index % 3 === 0 ? 0xd5a448 : 0x54889b, transparent: true, opacity: 0.68 }))
      const row = Math.floor(index / 4)
      card.position.set(-2 + (index % 4) * 1.28, 2.95 - row * 1.5, 0.12)
      this.cards.push(card)
      this.indexGroup.add(card)
    }

    const page = new Mesh(new PlaneGeometry(3.6, 5), new MeshBasicMaterial({ color: 0x486d80, transparent: true, opacity: 0.12, side: 2 }))
    page.position.z = 0.05
    this.detailGroup.add(page)
    for (let index = 0; index < 11; index += 1) {
      const line = new Mesh(new PlaneGeometry(2.5 - (index % 3) * 0.22, 0.018), new MeshBasicMaterial({ color: 0x4f7484, transparent: true, opacity: 0.42 }))
      line.position.set(-0.1, 1.8 - index * 0.3, 0.15)
      this.detailGroup.add(line)
    }
    this.progress = new Mesh(new PlaneGeometry(2.5, 0.045), new MeshBasicMaterial({ color: 0xd5a448, transparent: true, opacity: 0.9 }))
    this.progress.position.set(-0.1, -2.1, 0.2)
    this.progress.scale.x = 0
    this.detailGroup.add(this.progress)
    this.scene.add(this.indexGroup, this.detailGroup)
    this.detailGroup.visible = false
  }

  enter(): void {}
  leave(): void {}

  update(visualState: Readonly<VisualState>, state: Readonly<LibraryPageState>): void {
    if (this.disposed || !this.progress) return
    const safeState = state || { mode: 'index', category: null, itemCount: 0, page: 1, readingProgress: 0 }
    this.indexGroup.visible = safeState.mode === 'index'
    this.detailGroup.visible = safeState.mode === 'detail'
    const anchor = this.anchors?.get(safeState.mode === 'detail' ? 'library-document-content' : 'library-index')
    if (anchor && visualState.viewportWidth > 0 && visualState.viewportHeight > 0) {
      const group = safeState.mode === 'detail' ? this.detailGroup : this.indexGroup
      group.position.x = ((anchor.left + anchor.width / 2) / visualState.viewportWidth) * 10 - 5
      group.position.y = 5 - ((anchor.top + anchor.height / 2) / visualState.viewportHeight) * 10
    }
    this.cards.forEach((card, index) => {
      card.visible = index < Math.min(this.cards.length, Math.max(0, safeState.itemCount))
      card.position.x = -2 + (index % 4) * 1.28 + ((safeState.page - 1) % 3) * 0.08
      card.material.color.set(safeState.category && index % 3 === 0 ? 0xd5a448 : 0x54889b)
    })
    const progress = Math.min(100, Math.max(0, Number(safeState.readingProgress) || 0))
    this.progress.scale.x = progress / 100
    this.progress.position.x = -1.35 + progress / 100 * 1.25
    this.composition = safeState.mode
  }

  resize(): void {}
  render(context: SceneRenderContext): void {
    if (!this.disposed) context.renderer.render(this.scene, this.camera)
  }
  dispose(): void {
    this.scene.traverse((object) => {
      if (!(object instanceof Mesh)) return
      object.geometry.dispose()
      object.material.dispose()
    })
    this.scene.clear()
    this.cards.length = 0
    this.progress = null
    this.anchors = null
    this.disposed = true
    this.composition = 'disposed'
  }
  getComposition(): string { return this.composition }
}
