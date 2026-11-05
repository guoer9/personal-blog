import type { PageSceneId, PageSceneModule, RouteVisualIdentity } from './types'

const ROUTE_SCENE_MAP: Readonly<Record<string, PageSceneId>> = {
  Home: 'home', Works: 'works', WorkDetail: 'work-detail', About: 'about',
  Archive: 'archive', TagPosts: 'archive', Search: 'archive', Documents: 'library', DocumentDetail: 'library',
}
export function pageSceneIdForRoute(routeName: string | null | undefined): PageSceneId | null { return routeName ? ROUTE_SCENE_MAP[routeName] ?? null : null }
export function routeVisualIdentity(routeName: string, params: Readonly<Record<string, string>> = {}): RouteVisualIdentity {
  return { routeName, pageId: pageSceneIdForRoute(routeName), params: { ...params } }
}
export type PageSceneFactory = () => PageSceneModule
export class SceneRegistry {
  private readonly factories = new Map<PageSceneId, PageSceneFactory>()
  register(id: PageSceneId, factory: PageSceneFactory): () => void {
    this.factories.set(id, factory)
    return () => { if (this.factories.get(id) === factory) this.factories.delete(id) }
  }
  create(id: PageSceneId | null): PageSceneModule | null { return id ? this.factories.get(id)?.() ?? null : null }
}
