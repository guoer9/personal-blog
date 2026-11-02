export type WorkCategory = 'code' | 'film' | 'music'
export interface Work {
  slug: string
  title: string
  category: WorkCategory
  caption: string
  description: string
  tags: string[]
  accent: 'lime' | 'blue' | 'paper'
  repository?: string | null
  cover?: string | null
  video?: string | null
  audio?: string | null
  duration?: number | null
  externalWatch?: string | null
  notes: string[]
  featured?: boolean
  sort_order?: number
}

export const workCategories = [
  { id: 'all', label: '全部', caption: 'All work' },
  { id: 'code', label: '代码', caption: 'Code' },
  { id: 'film', label: '影像', caption: 'Film' },
  { id: 'music', label: '音乐', caption: 'Music' },
] as const
export function parseCategory(value: unknown): 'all' | WorkCategory {
  return typeof value === 'string' && ['code', 'film', 'music'].includes(value) ? value as WorkCategory : 'all'
}
export const categoryLabel = (category: WorkCategory) => workCategories.find((item) => item.id === category)!.label
export const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
