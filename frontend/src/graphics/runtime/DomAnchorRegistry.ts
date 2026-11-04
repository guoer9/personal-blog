export interface DomAnchorRect { x: number; y: number; top: number; right: number; bottom: number; left: number; width: number; height: number }
type RegisteredAnchor = { element: HTMLElement; token: symbol }
function copyRect(rect: DomAnchorRect): DomAnchorRect { return { ...rect } }
function readRect(element: HTMLElement): DomAnchorRect {
  const rect = element.getBoundingClientRect()
  return { x: rect.x, y: rect.y, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height }
}
export class DomAnchorRegistry {
  private readonly registered = new Map<string, RegisteredAnchor>()
  private readonly cache = new Map<string, DomAnchorRect>()
  register(id: string, element: HTMLElement): () => void {
    const token = Symbol(id)
    this.registered.set(id, { element, token })
    this.cache.delete(id)
    return () => { if (this.registered.get(id)?.token === token) { this.registered.delete(id); this.cache.delete(id) } }
  }
  measure(): void { for (const [id, { element }] of this.registered) this.cache.set(id, readRect(element)) }
  get(id: string): DomAnchorRect | undefined { const rect = this.cache.get(id); return rect ? copyRect(rect) : undefined }
  has(id: string): boolean { return this.registered.has(id) }
  clear(): void { this.registered.clear(); this.cache.clear() }
}
