import type { WorkCategory } from '@/data/works'
import type { PageSceneId } from '@/graphics/runtime/types'
export interface HomePageState { paused: boolean }
export interface WorksPageState { category: 'all' | WorkCategory; itemCount: number; focusedIndex: number | null }
export interface WorkDetailPageState { category: WorkCategory | null; hasMedia: boolean; playing: boolean; playbackProgress: number }
export interface AboutPageState { activeSection: 'approach' | 'practice' | 'now' }
export interface ArticlePageState { readingProgress: number; sectionCount: number; activeSection: number | null }
export interface ArchivePageState { mode: 'archive' | 'tag' | 'search'; query: string; resultCount: number; page: number; totalPages: number }
export interface LibraryPageState { mode: 'index' | 'detail'; category: string | null; itemCount: number; page: number; readingProgress: number }

export const initialPageSceneStates = {
  home: { paused: false },
  works: { category: 'all', itemCount: 0, focusedIndex: null },
  'work-detail': { category: null, hasMedia: false, playing: false, playbackProgress: 0 },
  about: { activeSection: 'approach' },
  article: { readingProgress: 0, sectionCount: 0, activeSection: null },
  archive: { mode: 'archive', query: '', resultCount: 0, page: 1, totalPages: 0 },
  library: { mode: 'index', category: null, itemCount: 0, page: 1, readingProgress: 0 },
} satisfies Record<PageSceneId, object>
