import { BoxGeometry, Group, Mesh, MeshBasicMaterial, OctahedronGeometry, OrthographicCamera, Scene, SphereGeometry, TorusGeometry } from 'three'
import type { AboutPageState } from '../pageStates'
import type { PageSceneModule, SceneContext, SceneRenderContext, VisualState } from '../../runtime/types'
import { disposeSceneResources } from '../sceneResources'

type AboutSection = AboutPageState['activeSection']

export class AboutScene implements PageSceneModule<AboutPageState> {
  readonly id = 'about' as const
  private readonly scene = new Scene()
  private readonly camera = new OrthographicCamera(-5, 5, 5, -5, 0.1, 100)
  private readonly sections = new Map<AboutSection, Group>()
  private activeSection: AboutSection = 'approach'
  private disposed = false
  private anchors: SceneContext['anchors'] | null = null

  mount(context: SceneContext): void {
    this.disposed = false
    this.anchors = context.anchors
    this.camera.position.z = 18

    const approach = new Group()
    const core = new Mesh(new OctahedronGeometry(0.54, 1), new MeshBasicMaterial({ color: 0xd5a448, transparent: true, opacity: 0.55, wireframe: true }))
    approach.add(core)
    const orbit = new Mesh(new TorusGeometry(1.15, 0.018, 5, 80), new MeshBasicMaterial({ color: 0x377f9d, transparent: true, opacity: 0.42 }))
    orbit.rotation.x = 0.45
    orbit.rotation.y = 0.28
    approach.add(orbit)
    for (let index = 0; index < 3; index += 1) {
      const angle = index / 3 * Math.PI * 2 - Math.PI / 2
      const node = new Mesh(new SphereGeometry(0.13, 12, 10), new MeshBasicMaterial({ color: index === 1 ? 0x377f9d : 0x54889b, transparent: true, opacity: 0.68 }))
      node.position.set(Math.cos(angle) * 1.15, Math.sin(angle) * 1.15, 0.08)
      approach.add(node)
    }
    this.sections.set('approach', approach)

    const practice = new Group()
    const columnColors = [0x377f9d, 0x54889b, 0xd5a448]
    for (let index = 0; index < 3; index += 1) {
      const height = 1.55 + (index % 2) * 0.54
      const column = new Mesh(new BoxGeometry(0.22, height, 0.16), new MeshBasicMaterial({ color: columnColors[index], transparent: true, opacity: 0.62 }))
      column.position.set((index - 1) * 0.82, -0.1 + height / 2, 0)
      practice.add(column)
      const cap = new Mesh(new OctahedronGeometry(0.19, 0), new MeshBasicMaterial({ color: columnColors[index], transparent: true, opacity: 0.78 }))
      cap.position.set(column.position.x, column.position.y + height / 2 + 0.22, 0.08)
      practice.add(cap)
    }
    const bridge = new Mesh(new BoxGeometry(2.55, 0.035, 0.08), new MeshBasicMaterial({ color: 0x4f7484, transparent: true, opacity: 0.5 }))
    bridge.position.set(0, 0.28, 0.04)
    practice.add(bridge)
    this.sections.set('practice', practice)

    const now = new Group()
    for (let index = 0; index < 5; index += 1) {
      const bar = new Mesh(new BoxGeometry(0.16, 0.5 + ((index * 3) % 5) * 0.32, 0.08), new MeshBasicMaterial({ color: index === 2 ? 0xd5a448 : 0x377f9d, transparent: true, opacity: 0.56 }))
      bar.position.set((index - 2) * 0.46, 0, 0)
      now.add(bar)
    }
    for (let index = 0; index < 3; index += 1) {
      const ring = new Mesh(new TorusGeometry(0.55 + index * 0.38, 0.014, 5, 72), new MeshBasicMaterial({ color: index === 0 ? 0xd5a448 : 0x54889b, transparent: true, opacity: 0.36 - index * 0.08 }))
      ring.position.z = -0.08 - index * 0.01
      now.add(ring)
    }
    this.sections.set('now', now)
    this.sections.forEach((group, section) => {
      group.visible = section === this.activeSection
      this.scene.add(group)
    })
  }

  enter(): void {}
  leave(): void {}

  update(visualState: Readonly<VisualState>, pageState: Readonly<AboutPageState>): void {
    if (this.disposed) return
    const active = pageState?.activeSection
    this.activeSection = active === 'approach' || active === 'practice' || active === 'now' ? active : 'approach'
    this.sections.forEach((group, section) => { group.visible = section === this.activeSection })
    const activeGroup = this.sections.get(this.activeSection)!
    activeGroup.rotation.y = visualState.pointerX * 0.06
    activeGroup.rotation.x = visualState.pointerY * 0.045
    const anchor = this.anchors?.get(`about-${this.activeSection}`)
    if (anchor && visualState.viewportWidth > 0 && visualState.viewportHeight > 0) {
      activeGroup.position.x = ((anchor.left + anchor.width / 2) / visualState.viewportWidth) * 10 - 5
      activeGroup.position.y = 5 - ((anchor.top + anchor.height / 2) / visualState.viewportHeight) * 10
    }
  }

  resize(): void {}
  render(context: SceneRenderContext): void { if (!this.disposed) context.renderer.render(this.scene, this.camera) }
  dispose(): void {
    if (this.disposed) return
    disposeSceneResources(this.scene)
    this.sections.clear()
    this.anchors = null
    this.disposed = true
    this.activeSection = 'approach'
  }
  getComposition(): AboutSection { return this.activeSection }
}
