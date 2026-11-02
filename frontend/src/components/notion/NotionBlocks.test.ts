// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import NotionBlocks from './NotionBlocks.vue'
import NotionRichText from './NotionRichText.vue'
import blockSource from './NotionBlocks.vue?raw'
import richTextSource from './NotionRichText.vue?raw'
import { compileStyle, parse } from '@vue/compiler-sfc'
import type { NotionBlock, NotionText } from '@/api/documents'
const text = (value: string, extra: Partial<NotionText> = {}): NotionText => ({ text: value, bold: false, italic: false, underline: false, strikethrough: false, code: false, color: 'default', href: null, ...extra })
describe('Notion native content', () => {
  it('preserves styles and empty paragraphs while rendering HTML-looking text literally', () => {
    const blocks: NotionBlock[] = [{ id: 'h', type: 'heading_2', text: [text('<literal>', { bold: true, underline: true, color: 'blue' })] }, { id: 'empty', type: 'paragraph', text: [] }, { id: 'p', type: 'paragraph', text: [text('正文')] }]
    const wrapper = mount(NotionBlocks, { props: { blocks } })
    expect(wrapper.get('h2').text()).toBe('<literal>')
    expect(wrapper.get('h2 span').classes()).toContain('is-bold')
    expect(wrapper.get('h2 span').classes()).toContain('is-underline')
    expect(wrapper.find('literal').exists()).toBe(false)
    expect(wrapper.findAll('p')).toHaveLength(2)
  })
  it('groups consecutive list blocks and preserves checked tasks and nested content', () => {
    const blocks: NotionBlock[] = [{ id: '1', type: 'numbered_list_item', text: [text('第一项')] }, { id: '2', type: 'numbered_list_item', text: [text('第二项')] }, { id: 't', type: 'to_do', checked: true, text: [text('已完成')], children: [{ id: 'child', type: 'paragraph', text: [text('嵌套说明')] }] }]
    const wrapper = mount(NotionBlocks, { props: { blocks } })
    expect(wrapper.findAll('ol')).toHaveLength(1)
    expect(wrapper.findAll('ol > li')).toHaveLength(2)
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.text()).toContain('嵌套说明')
  })
  it('preserves Notion table header flags without inventing a column heading', () => {
    const wrapper = mount(NotionBlocks, { props: { blocks: [{ id: 'table', type: 'table', has_column_header: false, has_row_header: true, rows: [[[text('左')], [text('右')]]] }] } })
    expect(wrapper.findAll('th[scope="row"]')).toHaveLength(1)
    expect(wrapper.findAll('th[scope="col"]')).toHaveLength(0)
    expect(wrapper.get('td').text()).toBe('右')
  })
  it('allows keyboard focus on code that requires horizontal scrolling', () => {
    const wrapper = mount(NotionBlocks, { props: { blocks: [{ id: 'code', type: 'code', language: 'text', text: [text('long '.repeat(100))] }] } })
    expect(wrapper.get('pre').attributes('tabindex')).toBe('0')
    expect(wrapper.get('pre').attributes('aria-label')).toBe('代码内容')
  })
  it('rejects active links and untrusted image URLs independently of backend validation', () => {
    const wrapper = mount(NotionBlocks, { props: { blocks: [{ id: 'p', type: 'paragraph', text: [text('恶意', { href: 'javascript:alert(1)' })] }, { id: 'img', type: 'image', url: 'https://evil.example/image.svg', caption: [] }] } })
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
  })
})

const palette = [
  ['gray', '#67645e', '#e8e7e4'],
  ['brown', '#85543c', '#eee0d7'],
  ['orange', '#9e4c15', '#fae2cf'],
  ['yellow', '#86631a', '#f9edc7'],
  ['green', '#276448', '#dbece1'],
  ['blue', '#2359a8', '#dce9f7'],
  ['purple', '#734399', '#e9dff3'],
  ['pink', '#a33a72', '#f3ddeb'],
  ['red', '#b13b35', '#f5dfdc'],
] as const

describe('Notion block colors and heading children', () => {
  let wrapper: ReturnType<typeof mount> | undefined
  const styles = document.createElement('style')
  beforeAll(() => {
    // Compile actual scoped CSS so assertions catch inheritance and specificity bugs.
    const components = [[blockSource, NotionBlocks, 'NotionBlocks.vue'], [richTextSource, NotionRichText, 'NotionRichText.vue']] as const
    styles.textContent = components.map(([source, component, filename]) => compileStyle({
      source: parse(source).descriptor.styles[0]!.content,
      id: (component as unknown as { __scopeId: string }).__scopeId,
      filename,
      scoped: true,
    }).code).join('\n')
    document.head.append(styles)
  })
  afterEach(() => { wrapper?.unmount(); wrapper = undefined })
  afterAll(() => styles.remove())
  function render(blocks: NotionBlock[]) {
    wrapper = mount(NotionBlocks, { props: { blocks }, attachTo: document.body })
    return wrapper
  }

  it.each(palette)('renders the %s block text color using the rich text palette', (color, expected) => {
    const view = render([{ id: 'p', type: 'paragraph', color, text: [text('colored')] }])
    expect(view.get('.notion-paragraph').classes()).toContain(`color-${color}`)
    expect(getComputedStyle(view.get('p span').element).color).toBe(expected)
  })

  it.each(palette)('renders the %s block background across its container', (color, _, expected) => {
    const view = render([{ id: 'p', type: 'paragraph', color: `${color}_background`, text: [text('highlighted')] }])
    expect(view.get('.notion-paragraph').classes()).toContain(`color-${color}_background`)
    expect(getComputedStyle(view.get('.notion-paragraph').element).backgroundColor).toBe(expected)
  })

  it.each(['paragraph', 'heading_1', 'heading_2', 'heading_3', 'bulleted_list_item', 'numbered_list_item', 'to_do', 'quote', 'callout', 'toggle', 'code'])('applies stored color to %s text', type => {
    const view = render([{ id: 'block', type, color: 'red', text: [text('colored text')] }])
    const colored = view.get('.color-red')
    expect(colored.text()).toContain('colored text')
    const content = type === 'code' ? view.get('code') : view.findAll('span').find(item => item.text() === 'colored text')!
    expect(getComputedStyle(content.element).color).toBe('#b13b35')
  })

  it.each(['default', 'red color-blue', 'red; background: black', '#ff0000', 'url(javascript:alert(1))', 'RED', 'red_background extra', 'red\n', 'red_background\n', undefined])('ignores nonallowlisted block color %s', color => {
    const view = render([{ id: 'p', type: 'paragraph', color, text: [text('plain')] }])
    expect(view.get('.notion-paragraph').classes()).toEqual(['notion-paragraph'])
    expect(view.find('[style]').exists()).toBe(false)
    expect(getComputedStyle(view.get('p span').element).color).toBe('#37352f')
  })

  it('inherits block color through recursive blocks while honoring explicit block and rich text colors', () => {
    const view = render([{ id: 'parent', type: 'quote', color: 'red', text: [text('parent')], children: [
      { id: 'default', type: 'paragraph', color: 'default', text: [text('inherits'), text('annotated', { color: 'blue' })] },
      { id: 'green', type: 'paragraph', color: 'green', text: [text('child override')], children: [
        { id: 'grandchild', type: 'paragraph', text: [text('grandchild')] },
      ] },
    ] }])
    const colorOf = (value: string) => getComputedStyle(view.findAll('span').find(item => item.text() === value)!.element).color
    expect(colorOf('inherits')).toBe('#b13b35')
    expect(colorOf('annotated')).toBe('#2359a8')
    expect(colorOf('child override')).toBe('#276448')
    expect(colorOf('grandchild')).toBe('#276448')
  })

  it('keeps adjacent list item colors independent', () => {
    const view = render([
      { id: 'red', type: 'bulleted_list_item', color: 'red', text: [text('red')] },
      { id: 'blue', type: 'bulleted_list_item', color: 'blue_background', text: [text('blue background')] },
      { id: 'plain', type: 'bulleted_list_item', text: [text('plain')] },
    ])
    expect(view.findAll('ul')).toHaveLength(1)
    const items = view.findAll('li')
    expect(getComputedStyle(items[0]!.element).color).toBe('#b13b35')
    expect(getComputedStyle(items[1]!.element).backgroundColor).toBe('#dce9f7')
    expect(getComputedStyle(items[2]!.element).color).toBe('#37352f')
  })

  it.each([['default', '#68645e'], ['red', '#b13b35']])('preserves checked task styling with %s block color', (color, expected) => {
    const view = render([{ id: 'task', type: 'to_do', checked: true, color, text: [text('Completed')] }])
    expect((view.get('input').element as HTMLInputElement).checked).toBe(true)
    expect(getComputedStyle(view.get('label > span').element).textDecoration).toBe('line-through')
    expect(getComputedStyle(view.get('label > span > span').element).color).toBe(expected)
  })

  it.each(['heading_1', 'heading_2', 'heading_3'])('preserves %s children without putting paragraphs inside a heading', type => {
    const view = render([{ id: 'h', type, color: 'green', text: [text('Heading')], children: [
      { id: 'child', type: 'paragraph', text: [text('Nested paragraph')] },
      { id: 'nested', type: 'heading_3', text: [text('Nested heading')], children: [{ id: 'leaf', type: 'paragraph', text: [text('Leaf')] }] },
    ] }])
    const heading = view.get(type.replace('heading_', 'h'))
    expect(heading.text()).toBe('Heading')
    expect(heading.find('p').exists()).toBe(false)
    expect(view.findAll('p').map(item => item.text())).toEqual(['Nested paragraph', 'Leaf'])
    expect(getComputedStyle(view.get('p span').element).color).toBe('#276448')
    expect(view.find('details').exists()).toBe(false)
  })

  it.each(['heading_1', 'heading_2', 'heading_3'])('renders an explicitly toggleable %s as a native disclosure with its children', async type => {
    const heading: NotionBlock = { id: 'toggle-heading', type, is_toggleable: true, color: 'yellow_background', text: [text('Expand heading')], children: [{ id: 'child', type: 'paragraph', text: [text('Hidden child')] }] }
    const view = render([heading])
    const details = view.get('details')
    expect((details.element as HTMLDetailsElement).open).toBe(false)
    expect(details.get(`summary > ${type.replace('heading_', 'h')}`).text()).toBe('Expand heading')
    expect(details.get('p').text()).toBe('Hidden child')
    expect(details.get('summary').find('p').exists()).toBe(false)
    expect(getComputedStyle(details.element).backgroundColor).toBe('#f9edc7')
    await details.get('summary').trigger('click')
    expect((details.element as HTMLDetailsElement).open).toBe(true)
    expect(details.get('p').text()).toBe('Hidden child')
    await details.get('summary').trigger('click')
    expect((details.element as HTMLDetailsElement).open).toBe(false)
    expect(details.get('p').text()).toBe('Hidden child')
  })

  it('keeps an explicitly nontoggleable heading expanded and preserves ordinary toggle children', () => {
    const heading: NotionBlock = { id: 'heading', type: 'heading_2', is_toggleable: false, text: [text('Static')], children: [{ id: 'child', type: 'paragraph', text: [text('Visible child')] }] }
    const view = render([heading, { id: 'toggle', type: 'toggle', color: 'purple', text: [text('Regular toggle')], children: [{ id: 'inside', type: 'paragraph', text: [text('Toggle child')] }] }])
    expect(view.findAll('details')).toHaveLength(1)
    expect(view.get('details > summary').text()).toBe('Regular toggle')
    expect(view.get('details p').text()).toBe('Toggle child')
    expect(view.findAll('p').map(item => item.text())).toEqual(['Visible child', 'Toggle child'])
    expect(getComputedStyle(view.get('details p span').element).color).toBe('#734399')
  })
})
