import { BoxGeometry, Group, Mesh, MeshBasicMaterial, OrthographicCamera, Scene } from 'three'
import type { ArchivePageState } from '../pageStates'
import type { PageSceneModule, SceneContext, SceneRenderContext, VisualState } from '../../runtime/types'

const TILE_COUNT = 32

export class ArchiveScene implements PageSceneModule<ArchivePageState> {
  readonly id = 'archive' as const
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
  private readonly layout = new Group()
  private readonly tiles: Mesh<BoxGeometry, MeshBasicMaterial>[] = []
  private composition = 'archive-page-1'
  private mode: ArchivePageState['mode'] = 'archive'
  private disposed = false
  private anchors: SceneContext['anchors'] | null = null

  mount(context: SceneContext): void {
    this.disposed = false
    this.anchors = context.anchors
    this.camera.position.z = 18
    const geometry = new BoxGeometry(0.28, 0.08, 0.08)
    for (let index = 0; index < TILE_COUNT; index += 1) {
      const material = new MeshBasicMaterial({ color: 0x486d80, transparent: true, opacity: 0.48 })
      const tile = new Mesh(geometry, material)
      this.tiles.push(tile)
      this.layout.add(tile)
    }
    this.scene.add(this.layout)
  }

  enter(): void {}
  leave(): void {}

  update(visualState: Readonly<VisualState>, state: Readonly<ArchivePageState>): void {
    if (this.disposed) return
    const safeState = state || { mode: 'archive', query: '', resultCount: 0, page: 1, totalPages: 0 }
    this.mode = safeState.mode
    const anchor = this.anchors?.get(safeState.mode === 'search' ? 'search-results' : safeState.mode === 'tag' ? 'tag-results' : 'archive-list')
    if (anchor && visualState.viewportWidth > 0 && visualState.viewportHeight > 0) {
      this.layout.position.x = ((anchor.left + anchor.width / 2) / visualState.viewportWidth) * 10 - 5
      this.layout.position.y = 5 - ((anchor.top + anchor.height / 2) / visualState.viewportHeight) * 10
    }
    const visibleCount = Math.min(TILE_COUNT, Math.max(0, Math.floor(safeState.resultCount)))
    this.tiles.forEach((tile, index) => {
      tile.visible = index < visibleCount
      const row = Math.floor(index / 4)
      const column = index % 4
      if (safeState.mode === 'archive') {
        tile.position.set((column - 1.5) * 0.48, 3 - row * 0.42, 0)
      } else if (safeState.mode === 'tag') {
        const angle = (index / Math.max(1, visibleCount)) * Math.PI * 2
        tile.position.set(Math.cos(angle) * (1.4 + row * 0.08), Math.sin(angle) * (1.4 + row * 0.08), 0)
        tile.rotation.z = angle * 0.08
      } else {
        const spread = 1 + Math.min(7, safeState.query.length) * 0.045
        tile.position.set((column - 1.5) * 0.44 * spread, (3 - row * 0.4) / spread, 0)
      }
      const pageOffset = (safeState.page - 1) % TILE_COUNT
      tile.material.color.set(index === pageOffset ? 0xd5a448 : safeState.mode === 'search' ? 0x377f9d : 0x486d80)
      tile.material.opacity = index < visibleCount ? 0.3 + (index % 4) * 0.12 : 0
    })
    this.composition = `${safeState.mode}-page-${Math.max(1, safeState.page)}`
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
    this.tiles.length = 0
    this.anchors = null
    this.disposed = true
    this.composition = 'disposed'
  }
  getComposition(): string { return this.composition }
  getMode(): ArchivePageState['mode'] { return this.mode }
}
