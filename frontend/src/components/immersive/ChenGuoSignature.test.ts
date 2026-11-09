// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChenGuoSignature from './ChenGuoSignature.vue'

describe('ChenGuoSignature', () => {
  it('exposes a responsive, accessible path drawing that starts hidden and finishes complete', async () => {
    const wrapper = mount(ChenGuoSignature, { props: { progress: 0 } })
    try {
      expect(wrapper.attributes('role')).toBe('img')
      expect(wrapper.attributes('aria-label')).toBe('陈果签名')
      expect(wrapper.attributes('viewBox')).toBe('-18 60 1470 600')
      expect(wrapper.find('.signature-ink').attributes('fill-rule')).toBe('evenodd')
      expect(wrapper.find('.signature-ink').attributes('mask')).toMatch(/^url\(#signature-ink-/)
      const strokes = wrapper.findAll('.signature-pen')
      expect(strokes.length).toBeGreaterThan(2)
      for (const stroke of strokes) {
        expect(stroke.attributes('stroke-dashoffset')).toBe('1')
        expect(stroke.attributes('opacity')).toBe('0')
      }
      await wrapper.setProps({ progress: 1 })
      for (const stroke of strokes) {
        expect(stroke.attributes('stroke-dashoffset')).toBe('0')
        expect(stroke.attributes('opacity')).toBe('1')
      }
    } finally { wrapper.unmount() }
  })

  it('draws successive strokes continuously and returns to the same shape when progress reverses', async () => {
    const wrapper = mount(ChenGuoSignature, { props: { progress: 0.25 } })
    const offsets = () => wrapper.findAll('.signature-pen').map((path) => Number(path.attributes('stroke-dashoffset')))
    try {
      const quarter = offsets()
      expect(quarter[0]).toBe(0)
      expect(quarter[quarter.length - 1]).toBe(1)
      const drawingIndex = quarter.findIndex((offset) => offset > 0 && offset < 1)
      expect(drawingIndex).toBeGreaterThan(0)

      await wrapper.setProps({ progress: 0.251 })
      expect(offsets()[drawingIndex]).toBeLessThan(quarter[drawingIndex]!)
      expect(offsets()[drawingIndex]).toBeGreaterThan(0)

      await wrapper.setProps({ progress: 0.8 })
      expect(offsets().every((offset, index) => offset <= quarter[index]!)).toBe(true)
      await wrapper.setProps({ progress: 0.25 })
      expect(offsets()).toEqual(quarter)
      await wrapper.setProps({ progress: 0 })
      expect(offsets().every((offset) => offset === 1)).toBe(true)
    } finally { wrapper.unmount() }
  })

  it.each([
    [-0.2, 1], [1.2, 0], [Number.NaN, 1],
  ])('bounds progress %s to a valid drawing state', (progress, expectedOffset) => {
    const wrapper = mount(ChenGuoSignature, { props: { progress } })
    try {
      expect(wrapper.findAll('.signature-pen').every((path) => Number(path.attributes('stroke-dashoffset')) === expectedOffset)).toBe(true)
    } finally { wrapper.unmount() }
  })
})
