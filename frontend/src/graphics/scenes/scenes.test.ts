// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { CircleGeometry, Mesh, Scene } from 'three'
import { AboutScene } from './about/AboutScene'
import { ArchiveScene } from './archive/ArchiveScene'
import { ArticleScene } from './article/ArticleScene'
import { LibraryScene } from './library/LibraryScene'
import { WorkDetailScene } from './work-detail/WorkDetailScene'
import { WorksScene } from './works/WorksScene'
import type { SceneContext } from '../runtime/types'
import { createVisualState } from '../runtime/VisualState'

type TestSceneContext = Omit<SceneContext, 'renderer'> & { renderer: SceneContext['renderer'] & { render: ReturnType<typeof vi.fn> } }

function context(anchorRects: Record<string, { x: number; y: number; top: number; right: number; bottom: number; left: number; width: number; height: number }> = {}): TestSceneContext {
  const renderer = { domElement: document.createElement('canvas'), setPixelRatio: vi.fn(), setSize: vi.fn(), render: vi.fn(), dispose: vi.fn() }
  const anchors = {
    register: vi.fn(), measure: vi.fn(), get: vi.fn((id: string) => anchorRects[id]),
    has: vi.fn((id: string) => Boolean(anchorRects[id])), clear: vi.fn(),
  }
  return {
    renderer,
    anchors: anchors as never,
    effects: { register: vi.fn(), unregister: vi.fn() },
    getQualityTier: () => 'high',
    isReducedMotion: () => false,
  }
}

describe('page scene modules', () => {
  it('keeps Works, WorkDetail, and About as separate modules', () => {
    const works = new WorksScene()
    const detail = new WorkDetailScene()
    const about = new AboutScene()
    expect(works.id).toBe('works')
    expect(detail.id).toBe('work-detail')
    expect(about.id).toBe('about')
    expect(works).not.toBe(detail)
    expect(detail).not.toBe(about)
  })

  it('renders distinct visible scene content for Works, WorkDetail, and About', () => {
    const sceneContext = context()
    const visualState = { ...createVisualState(), viewportWidth: 1200, viewportHeight: 900 }
    const renderContext = { renderer: sceneContext.renderer, visualState, viewportWidth: 1200, viewportHeight: 900, dpr: 1 }
    const works = new WorksScene()
    const detail = new WorkDetailScene()
    const about = new AboutScene()

    works.mount(sceneContext)
    detail.mount(sceneContext)
    about.mount(sceneContext)
    works.update(visualState, { category: 'all', itemCount: 4, focusedIndex: null })
    detail.update(visualState, { category: 'film', hasMedia: true, playing: false, playbackProgress: 0 })
    about.update(visualState, { activeSection: 'approach' })
    works.render(renderContext)
    detail.render(renderContext)
    about.render(renderContext)

    const renderedScenes = sceneContext.renderer.render.mock.calls.map(([scene]) => scene as Scene)
    expect(renderedScenes).toHaveLength(3)
    expect(new Set(renderedScenes).size).toBe(3)
    expect(renderedScenes.every((scene) => scene.children.some((child) => child.visible))).toBe(true)

    works.dispose()
    detail.dispose()
    about.dispose()
  })

  it('keeps article, archive, and library as separate stateful modules', () => {
    const article = new ArticleScene()
    const archive = new ArchiveScene()
    const library = new LibraryScene()

    expect(article.id).toBe('article')
    expect(archive.id).toBe('archive')
    expect(library.id).toBe('library')
    expect(article).not.toBe(archive)
    expect(archive).not.toBe(library)

    article.mount(context())
    archive.mount(context())
    library.mount(context())
    article.update({} as never, { readingProgress: 42, sectionCount: 3, activeSection: 2 })
    archive.update({} as never, { mode: 'search', query: 'shader', resultCount: 4, page: 2, totalPages: 3 })
    library.update({} as never, { mode: 'detail', category: '技术', itemCount: 1, page: 1, readingProgress: 68 })

    expect(article.getComposition()).toBe('section-2')
    expect(archive.getComposition()).toBe('search-page-2')
    expect(library.getComposition()).toBe('detail')
  })

  it('disposes article, archive, and library resources independently', () => {
    const article = new ArticleScene()
    const archive = new ArchiveScene()
    const library = new LibraryScene()
    article.mount(context())
    archive.mount(context())
    library.mount(context())

    article.dispose()
    archive.dispose()
    library.dispose()

    expect(article.getComposition()).toBe('disposed')
    expect(archive.getComposition()).toBe('disposed')
    expect(library.getComposition()).toBe('disposed')
  })

  it('aligns article markers to cached section anchors and renders its own Three scene', () => {
    const sceneContext = context({
      'article-section-0': { x: 100, y: 100, top: 100, right: 300, bottom: 180, left: 100, width: 200, height: 80 },
    })
    const article = new ArticleScene()
    article.mount(sceneContext as SceneContext)
    article.update({ ...createVisualState(), viewportWidth: 1000, viewportHeight: 800 }, { readingProgress: 25, sectionCount: 1, activeSection: 0 })
    article.render({ renderer: sceneContext.renderer, visualState: createVisualState(), viewportWidth: 1000, viewportHeight: 800, dpr: 1 })

    const renderedScene = sceneContext.renderer.render.mock.calls[0]![0] as Scene
    const marker = renderedScene.children[0]!.children.find((child) => child instanceof Mesh && child.geometry instanceof CircleGeometry)
    expect(marker?.position.x).toBeCloseTo(-3)
    expect(marker?.position.y).toBeCloseTo(3.25)
    expect(sceneContext.anchors.get).toHaveBeenCalledWith('article-section-0')
    article.dispose()
  })

  it('positions the archive structure from its registered result-list anchor', () => {
    const sceneContext = context({
      'search-results': { x: 90, y: 140, top: 140, right: 890, bottom: 540, left: 90, width: 800, height: 400 },
    })
    const archive = new ArchiveScene()
    archive.mount(sceneContext as SceneContext)
    archive.update({ ...createVisualState(), viewportWidth: 1000, viewportHeight: 800 }, { mode: 'search', query: 'note', resultCount: 3, page: 1, totalPages: 1 })
    archive.render({ renderer: sceneContext.renderer, visualState: createVisualState(), viewportWidth: 1000, viewportHeight: 800, dpr: 1 })

    const renderedScene = sceneContext.renderer.render.mock.calls[0]![0] as Scene
    const layout = renderedScene.children[0]!
    expect(layout.position.x).toBeCloseTo(-0.1)
    expect(layout.position.y).toBeCloseTo(0.75)
    expect(sceneContext.anchors.get).toHaveBeenCalledWith('search-results')
    archive.dispose()
  })

  it('positions the library reading sheet from its document-content anchor', () => {
    const sceneContext = context({
      'library-document-content': { x: 200, y: 250, top: 250, right: 800, bottom: 750, left: 200, width: 600, height: 500 },
    })
    const library = new LibraryScene()
    library.mount(sceneContext as SceneContext)
    library.update({ ...createVisualState(), viewportWidth: 1000, viewportHeight: 800 }, { mode: 'detail', category: '技术', itemCount: 1, page: 1, readingProgress: 35 })
    library.render({ renderer: sceneContext.renderer, visualState: createVisualState(), viewportWidth: 1000, viewportHeight: 800, dpr: 1 })

    const renderedScene = sceneContext.renderer.render.mock.calls[0]![0] as Scene
    const detail = renderedScene.children[1]!
    expect(detail.position.x).toBeCloseTo(0)
    expect(detail.position.y).toBeCloseTo(-1.25)
    expect(sceneContext.anchors.get).toHaveBeenCalledWith('library-document-content')
    library.dispose()
  })

  it('changes Works composition from explicit category state without recreating the module', () => {
    const scene = new WorksScene()
    const sceneContext = context()
    scene.mount(sceneContext)
    scene.update({} as never, { category: 'code', itemCount: 4, focusedIndex: 1 })
    expect(scene.getComposition()).toBe('code')
    scene.update({} as never, { category: 'music', itemCount: 2, focusedIndex: 0 })
    expect(scene.getComposition()).toBe('music')
    scene.dispose()
    expect(scene.getComposition()).toBe('disposed')
  })

  it('uses neutral WorkDetail composition for an invalid category and section state for About', () => {
    const detail = new WorkDetailScene()
    const about = new AboutScene()
    detail.mount(context())
    about.mount(context())
    detail.update({} as never, { category: null, hasMedia: false, playing: false, playbackProgress: 0 })
    about.update({} as never, { activeSection: 'practice' })
    expect(detail.getComposition()).toBe('neutral')
    expect(about.getComposition()).toBe('practice')
    detail.dispose()
    about.dispose()
  })
})
