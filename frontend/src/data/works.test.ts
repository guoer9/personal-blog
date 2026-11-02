import { describe, expect, it } from 'vitest'
import { formatDuration, parseCategory } from './works'
import seed from './initial-works.json'

describe('public works and explicit import data', () => {
  it('uses a bounded URL category and formats measured durations', () => {
    expect(parseCategory('film')).toBe('film')
    expect(parseCategory(['music', 'code'])).toBe('all')
    expect(parseCategory('unknown')).toBe('all')
    expect(formatDuration(194.416667)).toBe('3:14')
  })
  it('keeps eight real works as explicit import input with no raw original paths', () => {
    expect(seed.items).toHaveLength(8)
    expect(new Set(seed.items.map((work) => work.slug)).size).toBe(8)
    expect(seed.items.filter((work) => work.category === 'code')).toHaveLength(4)
    expect(JSON.stringify(seed)).not.toMatch(/user\/self|\.mov|\/Volumes\//)
  })
})
