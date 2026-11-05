import { describe, expect, it, vi } from 'vitest'
import { PageTransitionCoordinator } from './PageTransitionCoordinator'
import { createVisualState } from './VisualState'
import type { WorksPageState } from '../scenes/pageStates'
import type { PageSceneModule, SceneContext, VisualState } from './types'

function moduleFor(id: PageSceneModule['id']): PageSceneModule {
  return { id, mount: () => {}, enter: () => {}, leave: () => {}, update: () => {}, resize: () => {}, render: () => {}, dispose: () => {} }
}
const context = {} as SceneContext

describe('PageTransitionCoordinator', () => {
  it('drops an older async preload when a newer route becomes the target', async () => {
    let resolveHome: ((module: PageSceneModule) => void) | undefined
    let resolveWorks: ((module: PageSceneModule) => void) | undefined
    const coordinator = new PageTransitionCoordinator({
      context,
      preload: (identity) => new Promise((resolve) => {
        if (identity.pageId === 'home') resolveHome = resolve
        else resolveWorks = resolve
      }),
    })
    coordinator.setTarget({ routeName: 'Home', pageId: 'home', params: {} })
    const home = coordinator.preloadTarget()
    coordinator.setTarget({ routeName: 'Works', pageId: 'works', params: {} })
    const works = coordinator.preloadTarget()
    resolveHome?.(moduleFor('home'))
    resolveWorks?.(moduleFor('works'))

    await expect(home).resolves.toBeNull()
    await expect(works).resolves.toMatchObject({ id: 'works' })
    expect(coordinator.getPreloadedPageId()).toBe('works')
  })

  it('shares an in-flight preload for repeated requests to the current route', async () => {
    const resolvers: Array<(module: PageSceneModule) => void> = []
    const preload = vi.fn(() => new Promise<PageSceneModule>((resolve) => { resolvers.push(resolve) }))
    const coordinator = new PageTransitionCoordinator({ context, preload })
    coordinator.setTarget({ routeName: 'Works', pageId: 'works', params: {} })

    const first = coordinator.preloadTarget()
    const second = coordinator.preloadTarget()
    resolvers.forEach((resolve) => resolve(moduleFor('works')))

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ id: 'works' }),
      expect.objectContaining({ id: 'works' }),
    ])
    expect(preload).toHaveBeenCalledOnce()
  })

  it('drops an async preload that finishes after the coordinator is suspended', async () => {
    let resolveHome: ((module: PageSceneModule) => void) | undefined
    const calls: string[] = []
    const coordinator = new PageTransitionCoordinator({
      context,
      preload: () => new Promise((resolve) => { resolveHome = resolve }),
    })
    coordinator.setTarget({ routeName: 'Home', pageId: 'home', params: {} })
    const pending = coordinator.preloadTarget()
    coordinator.suspend()
    resolveHome?.({
      ...moduleFor('home'),
      mount: () => calls.push('mount'),
      dispose: () => calls.push('dispose'),
    })

    await expect(pending).resolves.toBeNull()
    await coordinator.afterEnter()
    expect(calls).toEqual(['dispose'])
  })

  it('updates the active module for page state without rebuilding it', () => {
    const updates: unknown[] = []
    const module: PageSceneModule = { ...moduleFor('home'), update: (_visual, pageState) => updates.push(pageState) }
    const coordinator = new PageTransitionCoordinator({ context, preload: async () => module })
    coordinator.setTarget({ routeName: 'Home', pageId: 'home', params: {} })
    return coordinator.preloadTarget().then(() => coordinator.afterEnter()).then(() => {
      coordinator.setVisualState(createVisualState())
      coordinator.updatePageState('home', { paused: true })
      expect(updates).toEqual([{ paused: false, interaction: null }, { paused: true }])
    })
  })

  it('applies the latest viewport size to a module when it mounts after resize', async () => {
    const resize = vi.fn()
    const module = { ...moduleFor('article'), resize }
    const coordinator = new PageTransitionCoordinator({ context, preload: async () => module })
    coordinator.resize(1440, 900, 1.5)
    coordinator.setTarget({ routeName: 'PostDetail', pageId: 'article', params: {} })
    await coordinator.preloadTarget()
    await coordinator.afterEnter()

    expect(resize).toHaveBeenCalledWith(1440, 900, 1.5)
  })

  it('gives a module its typed initial page state before the first rendered frame', async () => {
    const updates: unknown[] = []
    const module = { ...moduleFor('works'), update: (_visual: Readonly<VisualState>, state: Readonly<WorksPageState>) => updates.push(state) }
    const coordinator = new PageTransitionCoordinator({ context, preload: async () => module })
    coordinator.setTarget({ routeName: 'Works', pageId: 'works', params: {} })
    await coordinator.preloadTarget()
    await coordinator.afterEnter()
    coordinator.updateFrame(createVisualState())

    expect(updates).toEqual([
      { category: 'all', itemCount: 0, focusedIndex: null },
      { category: 'all', itemCount: 0, focusedIndex: null },
    ])
  })
})
