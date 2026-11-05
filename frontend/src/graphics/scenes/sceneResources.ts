import { Material, Mesh, type BufferGeometry, type Scene } from 'three'

export function disposeSceneResources(scene: Scene): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  scene.traverse((object) => {
    if (!(object instanceof Mesh)) return
    geometries.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material)
    }
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  scene.clear()
}
