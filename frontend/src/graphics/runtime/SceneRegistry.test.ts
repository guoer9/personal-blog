import { describe, expect, it } from 'vitest'
import { pageSceneIdForRoute, routeVisualIdentity } from './SceneRegistry'

describe('SceneRegistry route mapping', () => {
  it.each([
    ['Home', 'home'], ['Works', 'works'], ['WorkDetail', 'work-detail'], ['About', 'about'],
    ['Archive', 'archive'], ['TagPosts', 'archive'], ['Search', 'archive'],
    ['Documents', 'library'], ['DocumentDetail', 'library'],
  ] as const)('maps %s to %s', (routeName, pageId) => {
    expect(pageSceneIdForRoute(routeName)).toBe(pageId)
  })

  it.each(['Transfer', 'Register', 'AdminLogin', 'AdminDashboard', 'AdminPosts', 'NotFound', null, undefined])(
    'keeps %s outside the public scene registry', (routeName) => {
      expect(pageSceneIdForRoute(routeName)).toBeNull()
    },
  )

  it('creates route identity with params as metadata only', () => {
    expect(routeVisualIdentity('WorkDetail', { slug: 'rain-at-dawn' })).toEqual({
      routeName: 'WorkDetail', pageId: 'work-detail', params: { slug: 'rain-at-dawn' },
    })
  })
})
