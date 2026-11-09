import type { Work } from './works'
import type { InjectionKey, ShallowRef } from 'vue'

/** The visible detail owns stage identity, independently of playback selection. */
export const displayedStageWorkKey: InjectionKey<ShallowRef<Work | null>> = Symbol('displayed-stage-work')

/** Replace personal media here; published tracks still come exclusively from the API. */
export const stageIdentity = { name: '陈果', alias: 'GUOER', role: '音乐人 / MUSIC & EXPERIMENTS' }
export const stageAssets = {
  artistPortrait: null as string | null,
  featuredTrackSlug: 'rain-at-dawn',
  workArt: {
    'rain-at-dawn': '/stage/cover-rain.svg',
    'i-want-to-drop-out': '/stage/cover-freestyle.svg',
  } as Record<string, string>,
}
export function getStageArtwork(work?: Pick<Work, 'slug' | 'cover' | 'category'> | null): string {
  return (work && (stageAssets.workArt[work.slug] || work.cover)) || '/stage/cover-rain.svg'
}
export function selectStageTrack(works: Work[]): Work | undefined {
  const playable = works.filter(work => work.category === 'music' && Boolean(work.audio))
  return playable.find(work => work.slug === stageAssets.featuredTrackSlug) || playable[0]
}
