import { describe, expect, it } from 'vitest'
import { PageTransitionCoordinator } from './PageTransitionCoordinator'
import { createVisualState } from './VisualState'
import type { PageSceneModule, SceneContext } from './types'

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

  it('updates the active module for page state without rebuilding it', () => {
    const updates: unknown[] = []
    const module: PageSceneModule = { ...moduleFor('home'), update: (_visual, pageState) => updates.push(pageState) }
    const coordinator = new PageTransitionCoordinator({ context, preload: async () => module })
    coordinator.setTarget({ routeName: 'Home', pageId: 'home', params: {} })
    return coordinator.preloadTarget().then(() => coordinator.afterEnter()).then(() => {
      coordinator.setVisualState(createVisualState())
      coordinator.updatePageState('home', { paused: true })
      expect(updates).toEqual([{ paused: true }])
    })
  })
})
