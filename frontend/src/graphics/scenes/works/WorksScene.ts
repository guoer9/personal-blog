import { BoxGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera, RingGeometry, Scene } from 'three'
import type { WorksPageState } from '../pageStates'
import type { PageSceneModule, SceneContext, SceneRenderContext, VisualState } from '../../runtime/types'
import { disposeSceneResources } from '../sceneResources'

const TILE_COUNT = 16
const COLORS: Record<WorksPageState['category'], number> = {
  all: 0x54889b,
  code: 0x377f9d,
  film: 0x4f7484,
  music: 0xd5a448,
}

export class WorksScene implements PageSceneModule<WorksPageState> {
  readonly id = 'works' as const
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
  private readonly gallery = new Group()
  private readonly tiles: Mesh<BoxGeometry, MeshBasicMaterial>[] = []
  private readonly focusRing = new Mesh(new RingGeometry(0.46, 0.49, 48), new MeshBasicMaterial({ color: 0xd5a448, transparent: true, opacity: 0.75, side: 2 }))
  private composition = 'neutral'
  private disposed = false
  private anchors: SceneContext['anchors'] | null = null

  mount(context: SceneContext): void {
    this.disposed = false
    this.anchors = context.anchors
    this.camera.position.z = 18
    const geometry = new BoxGeometry(0.78, 0.58, 0.08)
    for (let index = 0; index < TILE_COUNT; index += 1) {
      const tile = new Mesh(geometry, new MeshBasicMaterial({ color: COLORS.all, transparent: true, opacity: 0.22 + (index % 4) * 0.045 }))
      tile.position.set((index % 4 - 1.5) * 1.04, 1.15 - Math.floor(index / 4) * 0.9, 0)
      this.tiles.push(tile)
      this.gallery.add(tile)
    }
    this.focusRing.position.z = 0.1
    this.focusRing.visible = false
    this.gallery.add(this.focusRing)
    this.scene.add(this.gallery)
  }

  enter(): void {}
  leave(): void {}

  update(visualState: Readonly<VisualState>, pageState: Readonly<WorksPageState>): void {
    if (this.disposed) return
    const safeState = pageState || { category: 'all', itemCount: 0, focusedIndex: null }
    this.composition = safeState.category === 'all' ? 'overview' : safeState.category
    const count = Math.min(TILE_COUNT, Math.max(0, Math.floor(safeState.itemCount)))
    const categoryColor = COLORS[safeState.category] ?? COLORS.all
    this.tiles.forEach((tile, index) => {
      tile.visible = index < count
      tile.material.color.set(index === safeState.focusedIndex ? 0xd5a448 : categoryColor)
      tile.position.y = 1.15 - Math.floor(index / 4) * 0.9 + (safeState.category === 'film' ? Math.sin(index * 0.7) * 0.12 : 0)
      tile.scale.set(safeState.category === 'music' ? 0.82 : 1, safeState.category === 'code' ? 0.86 : 1, 1)
    })
    this.focusRing.visible = safeState.focusedIndex !== null && safeState.focusedIndex >= 0 && safeState.focusedIndex < count
    if (this.focusRing.visible) {
      const focused = this.tiles[safeState.focusedIndex!]
      this.focusRing.position.set(focused.position.x, focused.position.y, 0.1)
    }
    const anchor = this.anchors?.get('works-grid')
    if (anchor && visualState.viewportWidth > 0 && visualState.viewportHeight > 0) {
      this.gallery.position.x = ((anchor.left + anchor.width / 2) / visualState.viewportWidth) * 10 - 5
      this.gallery.position.y = 5 - ((anchor.top + anchor.height / 2) / visualState.viewportHeight) * 10
    }
  }

  resize(): void {}
  render(context: SceneRenderContext): void { if (!this.disposed) context.renderer.render(this.scene, this.camera) }
  dispose(): void {
    if (this.disposed) return
    disposeSceneResources(this.scene)
    this.tiles.length = 0
    this.anchors = null
    this.disposed = true
    this.composition = 'disposed'
  }
  getComposition(): string { return this.composition }
}
