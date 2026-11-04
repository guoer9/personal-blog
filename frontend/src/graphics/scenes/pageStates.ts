import type { WorkCategory } from '@/data/works'
export interface HomePageState { paused: boolean }
export interface WorksPageState { category: 'all' | WorkCategory; itemCount: number; focusedIndex: number | null }
export interface WorkDetailPageState { category: WorkCategory | null; hasMedia: boolean; playing: boolean; playbackProgress: number }
export interface AboutPageState { activeSection: 'approach' | 'practice' | 'now' }
export interface ArticlePageState { readingProgress: number; sectionCount: number; activeSection: number | null }
export interface ArchivePageState { mode: 'archive' | 'tag' | 'search'; query: string; resultCount: number; page: number; totalPages: number }
export interface LibraryPageState { mode: 'index' | 'detail'; category: string | null; itemCount: number; page: number; readingProgress: number }
