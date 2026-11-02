/** Controlled anonymous formatting acceptance. No authentication, environment files, or real imports. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'
import { chromium } from '../../frontend/node_modules/playwright/index.mjs'
import AxeBuilder from '../../frontend/node_modules/@axe-core/playwright/dist/index.mjs'

const target = new URL(process.env.LOCAL_FRONTEND_URL || 'http://127.0.0.1:4183')
assert(target.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) && !target.username && !target.password, 'Only an anonymous local HTTP frontend is allowed')
const origin = target.origin
const root = fileURLToPath(new URL('../../', import.meta.url))
const output = resolve(root, 'output/playwright/notion-acceptance-20261102')
const slug = 'controlled-formatting-fixture'
const mediaBase = '/api/v1/documents/media/11111111-1111-4111-8111-111111111111/'
const coverUrl = mediaBase + 'a'.repeat(64) + '.png'
const imageUrl = mediaBase + 'b'.repeat(64) + '.png'
const rich = (text, extra = {}) => ({ text, bold: false, italic: false, underline: false, strikethrough: false, code: false, color: 'default', href: null, ...extra })
const block = (id, type, text, extra = {}) => ({ id, type, ...(text === undefined ? {} : { text: [rich(text)] }), ...extra })
const fixture = {
  slug, title: 'Formatting acceptance · 格式验收',
  summary: 'CONTROLLED FIXTURE: rich text, nested colors, headings, lists, tables, columns and local images. Not a real Notion import.',
  categories: ['格式验收'], created_at: '2026-11-02T00:00:00Z', updated_at: '2026-11-02T00:00:00Z',
  icon: '📐', cover_url: coverUrl, content: 'Native blocks must render instead of this fallback marker.',
  blocks: [
    block('rich-heading', 'heading_2', 'Rich text / 富文本'),
    block('rich-text', 'paragraph', undefined, { text: [
      rich('Bold sample', { bold: true }), rich(' · '), rich('Italic sample', { italic: true }), rich(' · '),
      rich('Underline sample', { underline: true }), rich(' · '), rich('Strike sample', { strikethrough: true }), rich(' · '),
      rich('Both decorations', { underline: true, strikethrough: true }), rich(' · '), rich('inline <code>', { code: true }),
      rich(' · '), rich('Inline blue', { color: 'blue' }), rich(' · '), rich('Green highlight', { color: 'green_background' }),
    ] }),
    block('escaped', 'paragraph', 'Literal <img src=x onerror="window.__formattingEscaped=true"> & <script>window.__formattingEscaped=true</script>'),
    block('links', 'paragraph', undefined, { text: [
      rich('Safe HTTPS link', { href: 'https://example.com/formatting' }), rich(' · '),
      rich('Safe mail link', { href: 'mailto:formatting@example.invalid' }), rich(' · '),
      rich('Rejected active link', { href: 'javascript:window.__formattingEscaped=true' }),
    ] }),
    block('empty', 'paragraph', undefined, { text: [] }),
    block('red', 'paragraph', 'Block red parent', { color: 'red', children: [
      block('inherited-red', 'paragraph', undefined, { color: 'default', text: [rich('Inherited red'), rich(' · '), rich('Inline blue override', { color: 'blue' })] }),
      block('green', 'paragraph', 'Explicit green child', { color: 'green', children: [block('inherited-green', 'paragraph', 'Inherited green grandchild')] }),
    ] }),
    block('callout', 'callout', 'Blue background callout', { color: 'blue_background', icon: 'ℹ️', children: [block('callout-child', 'paragraph', 'Callout nested content')] }),
    block('quote', 'quote', 'Stored green quote', { color: 'green', children: [block('quote-child', 'paragraph', 'Quote child inherits green')] }),
    block('invalid-color', 'paragraph', 'Invalid block color stays default', { color: 'red color-blue' }),
    block('heading-children', 'heading_2', 'Heading children / 标题子内容', { children: [block('heading-child', 'paragraph', 'Non-toggle heading child')] }),
    block('toggle-heading', 'heading_3', 'Keyboard toggle heading', { is_toggleable: true, color: 'yellow_background', children: [block('toggle-child', 'paragraph', 'Revealed heading child')] }),
    block('lists-heading', 'heading_2', 'Lists, tasks and code'),
    block('bullet-a', 'bulleted_list_item', 'Bullet A', { children: [
      block('number-one', 'numbered_list_item', 'Nested ordered one'),
      block('number-two', 'numbered_list_item', 'Nested ordered two', { children: [block('deep-bullet', 'bulleted_list_item', 'Deep nested bullet')] }),
    ] }),
    block('bullet-b', 'bulleted_list_item', 'Bullet B'),
    block('todo-default', 'to_do', 'Checked default task', { checked: true }),
    block('todo-red', 'to_do', 'Checked red task', { checked: true, color: 'red', children: [block('task-child', 'paragraph', 'Checked task child inherits red')] }),
    block('code', 'code', 'const html = "<script>literal only</script>";\nconst longValue = "' + '0123456789'.repeat(22) + '";\nconsole.log(html);', { language: 'javascript' }),
    block('table-heading', 'heading_2', 'Table and columns'),
    block('table', 'table', undefined, { has_column_header: true, has_row_header: true, rows: [
      [[rich('Property')], [rich('Value')]], [[rich('State')], [rich('public')]], [[rich('Format')], [rich('native blocks')]],
    ] }),
    block('columns', 'column_list', undefined, { children: [
      block('left-column', 'column', undefined, { children: [block('left-title', 'heading_3', 'Left column'), block('left-text', 'paragraph', 'Left column copy')] }),
      block('right-column', 'column', undefined, { children: [block('right-title', 'heading_3', 'Right column'), block('right-text', 'paragraph', 'Right column copy')] }),
    ] }),
    block('media-heading', 'heading_2', 'Local media and safe reference'),
    block('image', 'image', undefined, { url: imageUrl, caption: [rich('Local mock diagram')] }),
    block('untrusted-image', 'image', undefined, { url: 'https://untrusted.example.invalid/image.png', caption: [rich('Must not load')] }),
    block('bookmark', 'bookmark', undefined, { url: 'https://example.com/reference', caption: [rich('Safe external reference')] }),
    block('divider', 'divider'),
  ],
}
const { blocks: _blocks, content: _content, ...summary } = fixture

// A generated PNG keeps the media fixture entirely offline and independently decodable.
function png(width, height, variant) {
  const crc = buffer => {
    let value = 0xffffffff
    for (const byte of buffer) {
      value ^= byte
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
    }
    return (value ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const label = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4)
    size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([label, data])))
    return Buffer.concat([size, label, data, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  const pixels = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * (width * 3 + 1) + 1 + x * 3
    const accent = x > width * .58 && y > height * .22 && y < height * .78
    pixels[index] = accent ? 225 : 30 + Math.round(x / width * 45)
    pixels[index + 1] = accent ? 235 : 80 + Math.round(y / height * 55)
    pixels[index + 2] = accent ? 120 : 160 + variant * 25
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}
const media = new Map([[coverUrl, png(960, 280, 0)], [imageUrl, png(640, 240, 1)]])
const report = {
  mode: 'controlled-anonymous-public-api-fixture', origin, startedAt: new Date().toISOString(),
  fixture: { slug, title: fixture.title, topLevelBlocks: fixture.blocks.length },
  limitations: ['Not a real Notion import; no backend, DB, authorization, importer or snapshot downloading is exercised.', 'Toggleable headings use explicit fixture metadata; older snapshots may omit is_toggleable.'],
  checks: [], axe: [], pageerrors: [], unexpectedApi: [], blockedExternal: [], apiRequests: [], screenshots: [], issues: [],
}
let browser
async function check(profile, name, fn) {
  try { const evidence = await fn(); report.checks.push({ profile, name, passed: true, ...(evidence === undefined ? {} : { evidence }) }) }
  catch (error) { const message = String(error.message || error); report.checks.push({ profile, name, passed: false, error: message }); report.issues.push({ profile, name, message }) }
}
async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}
async function screenshot(page, name) {
  await settle(page)
  await page.screenshot({ path: resolve(output, name), fullPage: true, animations: 'disabled' })
  report.screenshots.push(name)
}
async function overflow(page) {
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
  assert(dimensions.document <= dimensions.viewport && dimensions.body <= dimensions.viewport, JSON.stringify(dimensions))
  return dimensions
}
// Retain rendered measurements for human review; never disable an axe rule or
// turn an inconclusive result into an automated axe pass.
async function contrastEvidence(page, target) {
  if (target.length !== 1 || typeof target[0] !== 'string') return { reviewed: false, reason: 'Unsupported target shape' }
  const locator = page.locator(target[0])
  const isCode = await locator.evaluate(element => element.matches('.notion-code pre code'))
  // Bring the scrollport into view, rather than centering a very wide inline
  // code box and thereby hiding its first glyph during hit testing.
  await (isCode ? locator.locator('..') : locator).scrollIntoViewIfNeeded()
  if (isCode) await locator.evaluate(element => { element.parentElement.scrollLeft = 0 })
  await settle(page)
  return locator.evaluate(element => {
    const rgba = value => {
      const parts = value.match(/[\d.]+/g)?.map(Number)
      if (!parts || parts.length < 3) throw new Error('Unsupported computed color')
      return [...parts.slice(0, 3), parts[3] ?? 1]
    }
    const over = (front, back) => front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3]))
    const rect = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right } }
    const ancestors = []
    for (let node = element; node; node = node.parentElement) {
      const s = getComputedStyle(node)
      ancestors.push({ tag: node.tagName, class: node.className, background: s.backgroundColor, image: s.backgroundImage, opacity: s.opacity, filter: s.filter })
    }
    let background = [255, 255, 255]
    for (const item of [...ancestors].reverse()) background = over(rgba(item.background), background)
    const s = getComputedStyle(element), foreground = over(rgba(s.color), background)
    const luminance = color => color.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0)
    const a = luminance(foreground), b = luminance(background)
    const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
    const evidence = { text: element.textContent.slice(0, 100), foreground, background, ratio, required: 4.5, fontSize: s.fontSize, ancestors, textBounds: rect(element), simpleBackground: ancestors.every(item => item.image === 'none' && item.opacity === '1' && item.filter === 'none') }
    if (element.matches('.nav-link > small')) {
      const link = element.parentElement, pseudo = getComputedStyle(link, '::after'), linkRect = rect(link)
      const pseudoTop = linkRect.bottom - parseFloat(pseudo.bottom) - parseFloat(pseudo.height)
      evidence.underline = { content: pseudo.content, position: pseudo.position, height: pseudo.height, bottom: pseudo.bottom, transform: pseudo.transform, top: pseudoTop, textBottom: evidence.textBounds.bottom, overlapsText: pseudoTop < evidence.textBounds.bottom }
    }
    if (element.matches('.notion-code pre code')) {
      const pre = element.parentElement, range = document.createRange()
      range.setStart(element.firstChild, 0); range.setEnd(element.firstChild, 1)
      const first = range.getBoundingClientRect(), bounds = rect(pre)
      const hit = document.elementFromPoint(first.x + first.width / 2, first.y + first.height / 2)
      evidence.codeScroller = { bounds, overflowX: getComputedStyle(pre).overflowX, clientWidth: pre.clientWidth, scrollWidth: pre.scrollWidth, firstGlyphVisible: hit === element || element.contains(hit), firstGlyphHit: hit?.tagName, clippedToScroller: evidence.textBounds.right > bounds.right && ['auto', 'scroll'].includes(getComputedStyle(pre).overflowX) }
    }
    return evidence
  })
}
async function audit(page, profile, view) {
  const result = await new AxeBuilder({ page }).analyze()
  await writeFile(resolve(output, `formatting-axe-${profile}-${view}.json`), JSON.stringify(result, null, 2))
  const reviews = {
    'color-contrast': 'Rendered contrast failure retained; no styles or axe rules were overridden.',
    'scrollable-region-focusable': 'Rendered keyboard-access failure retained; explicit region semantics and Tab/ArrowRight access are checked independently.',
  }
  const violations = result.violations.map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes: nodes.map(({ target, html, failureSummary, any, all, none }) => ({ target, html, failureSummary, checks: [...any, ...all, ...none].map(({ id, data, message }) => ({ id, data, message })) })), review: reviews[id] || 'Rendered-page finding retained without exclusions; product changes are outside this harness scope.' }))
  const incomplete = []
  for (const { id, nodes } of result.incomplete) {
    const measurements = []
    for (const node of nodes) {
      const evidence = id === 'color-contrast' ? await contrastEvidence(page, node.target) : null
      const explained = evidence?.underline ? !evidence.underline.overlapsText : evidence?.codeScroller?.firstGlyphVisible && evidence.codeScroller.clippedToScroller
      const reviewed = Boolean(evidence?.simpleBackground && evidence.ratio >= evidence.required && explained)
      measurements.push({ target: node.target, axeReasons: [...node.any, ...node.all, ...node.none].map(check => check.message), evidence, reviewed, review: reviewed ? 'Measured contrast meets 4.5:1. Pseudo underline does not overlap text, or intentional code overflow clips to its keyboard-accessible scroller. Raw axe result remains incomplete.' : 'Manual review unresolved; retained as an issue.' })
      if (!reviewed) report.issues.push({ profile, name: `axe-incomplete:${view}:${id}`, target: node.target, message: 'Contrast review unresolved or measured below threshold' })
    }
    incomplete.push({ id, targets: nodes.map(node => node.target), measurements })
  }
  report.axe.push({ profile, view, violations, incomplete })
  for (const violation of violations) report.issues.push({ profile, name: `axe:${view}:${violation.id}`, message: violation.help, impact: violation.impact, targets: violation.nodes.map(node => node.target) })
}
async function disableMotion(page) {
  await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }' })
}
async function formatting(page, profile, viewport) {
  const content = page.locator('.document-content')
  const textSpan = value => content.locator('span').filter({ hasText: new RegExp('^' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).last()
  const style = (locator, property) => locator.evaluate((element, property) => getComputedStyle(element).getPropertyValue(property), property)
  await check(profile, 'rich-text-styles-and-html-escaping', async () => {
    assert(Number(await style(textSpan('Bold sample'), 'font-weight')) >= 600)
    assert.equal(await style(textSpan('Italic sample'), 'font-style'), 'italic')
    assert.match(await style(textSpan('Underline sample'), 'text-decoration-line'), /underline/)
    assert.match(await style(textSpan('Strike sample'), 'text-decoration-line'), /line-through/)
    assert.match(await style(textSpan('Both decorations'), 'text-decoration-line'), /underline/)
    assert.match(await style(textSpan('Both decorations'), 'text-decoration-line'), /line-through/)
    assert.equal(await style(textSpan('Inline blue'), 'color'), 'rgb(35, 89, 168)')
    assert.equal(await style(textSpan('Green highlight'), 'background-color'), 'rgb(219, 236, 225)')
    assert.match(await style(textSpan('inline <code>'), 'font-family'), /mono/i)
    assert.equal(await style(textSpan('inline <code>'), 'background-color'), 'rgb(238, 234, 229)')
    assert.equal(await content.locator('img[src="x"], script').count(), 0)
    assert.equal(await page.evaluate(() => window.__formattingEscaped), undefined)
    assert((await content.textContent()).includes('<img src=x onerror='))
    assert(!(await content.textContent()).includes('Native blocks must render instead'))
  })
  await check(profile, 'stored-block-colors-and-recursive-inheritance', async () => {
    const expected = { 'Block red parent': 'rgb(177, 59, 53)', 'Inherited red': 'rgb(177, 59, 53)', 'Inline blue override': 'rgb(35, 89, 168)', 'Explicit green child': 'rgb(39, 100, 72)', 'Inherited green grandchild': 'rgb(39, 100, 72)', 'Stored green quote': 'rgb(39, 100, 72)', 'Quote child inherits green': 'rgb(39, 100, 72)', 'Invalid block color stays default': 'rgb(55, 53, 47)' }
    const actual = {}
    for (const [text, expectedColor] of Object.entries(expected)) {
      actual[text] = await style(textSpan(text), 'color')
      assert.equal(actual[text], expectedColor, text)
    }
    assert.equal(await style(content.locator('.notion-callout'), 'background-color'), 'rgb(220, 233, 247)')
    return actual
  })
  await check(profile, 'empty-paragraph-and-heading-children', async () => {
    assert.equal(await content.locator('.notion-paragraph > p > br').count(), 1)
    assert((await content.locator('.notion-paragraph').filter({ has: page.locator('p > br') }).boundingBox()).height >= 20)
    const heading = content.locator('.notion-heading').filter({ has: page.getByRole('heading', { name: 'Heading children / 标题子内容', exact: true }) })
    assert.equal(await heading.getByText('Non-toggle heading child', { exact: true }).isVisible(), true)
    assert.equal(await heading.locator('h2 p').count(), 0)
  })
  await check(profile, 'toggleable-heading-keyboard-enter-space', async () => {
    const details = content.locator('details').filter({ has: page.getByRole('heading', { name: 'Keyboard toggle heading', exact: true }) })
    const summary = details.locator(':scope > summary')
    const child = details.getByText('Revealed heading child', { exact: true })
    assert.equal(await details.evaluate(element => element.open), false)
    assert.equal(await child.isVisible(), false)
    assert.equal(await style(details, 'background-color'), 'rgb(249, 237, 199)')
    await summary.focus()
    assert.equal(await summary.evaluate(element => element === document.activeElement), true)
    await page.keyboard.press('Enter'); await settle(page)
    assert.equal(await details.evaluate(element => element.open), true)
    assert.equal(await child.isVisible(), true)
    await page.keyboard.press('Space'); await settle(page)
    assert.equal(await details.evaluate(element => element.open), false)
    assert.equal(await child.isVisible(), false)
    await page.keyboard.press('Enter'); await settle(page)
    assert.equal(await child.isVisible(), true)
    return { expandedBy: 'Enter', collapsedBy: 'Space', focusTarget: 'native summary', screenshotState: 'expanded' }
  })
  await check(profile, 'nested-bullet-and-numbered-list-structure', async () => {
    const list = content.locator(':scope > .notion-blocks > ul')
    assert.equal(await list.count(), 1)
    assert.equal(await list.locator(':scope > li').count(), 2)
    assert.equal(await list.locator('ol > li').count(), 2)
    assert.equal(await list.locator('ol > li ul > li').textContent(), 'Deep nested bullet')
  })
  await check(profile, 'checked-task-default-and-explicit-color', async () => {
    const colors = {}
    for (const [name, color] of [['Checked default task', 'rgb(104, 100, 94)'], ['Checked red task', 'rgb(177, 59, 53)']]) {
      const input = content.getByRole('checkbox', { name, exact: true })
      assert.equal(await input.isChecked(), true); assert.equal(await input.isDisabled(), true)
      const label = input.locator('..').locator(':scope > span')
      assert.match(await style(label, 'text-decoration-line'), /line-through/)
      colors[name] = await style(label.locator(':scope > span'), 'color')
      assert.equal(colors[name], color, name)
    }
    assert.equal(await style(textSpan('Checked task child inherits red'), 'color'), 'rgb(177, 59, 53)')
    return colors
  })
  await check(profile, 'literal-code-and-contained-long-line', async () => {
    const code = content.locator('.notion-code pre code')
    assert((await code.textContent()).includes('<script>literal only</script>'))
    assert.equal(await code.locator('script').count(), 0)
    assert.equal(await style(code.locator('..'), 'white-space'), 'pre')
    assert(['auto', 'scroll'].includes(await style(code.locator('..'), 'overflow-x')))
    assert((await code.locator('..').boundingBox()).width <= viewport.width)
    // Assert product-provided semantics and exercise native Tab/ArrowRight;
    // never add tabindex or change the tested DOM to make accessibility pass.
    const pre = code.locator('..')
    assert.equal(await pre.getAttribute('tabindex'), '0')
    assert.equal(await pre.getAttribute('role'), 'region')
    assert.equal(await pre.getAttribute('aria-label'), '代码内容')
    await content.locator('details > summary').focus()
    const keyboard = { reached: false, scrolled: false, tabStops: [] }
    for (let step = 0; step < 8; step++) {
      await page.keyboard.press('Tab')
      keyboard.tabStops.push(await page.evaluate(() => ({ tag: document.activeElement?.tagName, class: document.activeElement?.className })))
      if (await pre.evaluate(element => element === document.activeElement)) { keyboard.reached = true; break }
    }
    if (keyboard.reached) {
      keyboard.focusOutline = await pre.evaluate(element => { const s = getComputedStyle(element); return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor } })
      assert.notEqual(keyboard.focusOutline.style, 'none')
      assert(parseFloat(keyboard.focusOutline.width) >= 2)
      const before = await pre.evaluate(element => element.scrollLeft)
      for (let step = 0; step < 4; step++) await page.keyboard.press('ArrowRight')
      await settle(page)
      keyboard.scrolled = await pre.evaluate((element, before) => element.scrollLeft > before, before)
      // Chromium animates keyboard scrolling independently of CSS transitions.
      // Wait for it to stop before restoring the screenshot's initial position.
      await pre.evaluate(async element => {
        let last = element.scrollLeft, stable = 0
        for (let step = 0; step < 20 && stable < 3; step++) {
          await new Promise(resolve => setTimeout(resolve, 50))
          const next = element.scrollLeft
          stable = next === last ? stable + 1 : 0
          last = next
        }
      })
      await pre.evaluate(element => { element.scrollLeft = 0 })
    }
    assert(keyboard.reached, 'Code region must be reachable with Tab')
    assert(keyboard.scrolled, 'ArrowRight must scroll the long code line')
    return { ...await pre.evaluate(element => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, tabIndex: element.tabIndex })), keyboard }
  })
  await check(profile, 'table-column-and-row-header-semantics', async () => {
    const table = content.getByRole('region', { name: '资料表格', exact: true })
    assert.equal(await table.locator('th[scope="col"]').allTextContents().then(text => text.join('|')), 'Property|Value')
    assert.equal(await table.locator('th[scope="row"]').allTextContents().then(text => text.join('|')), 'State|Format')
    assert.equal(await table.locator('td').allTextContents().then(text => text.join('|')), 'public|native blocks')
    assert.equal(await table.getAttribute('tabindex'), '0')
  })
  await check(profile, 'columns-responsive-layout', async () => {
    const columns = content.locator('.notion-column')
    assert.equal(await columns.count(), 2)
    const left = await columns.nth(0).boundingBox(), right = await columns.nth(1).boundingBox()
    if (viewport.width > 650) { assert(Math.abs(left.y - right.y) <= 2); assert(right.x >= left.x + left.width) }
    else { assert(right.y >= left.y + left.height - 1); assert(Math.abs(left.x - right.x) <= 2) }
    return { left, right }
  })
  await check(profile, 'safe-links-and-unsafe-input-rejection', async () => {
    for (const [name, href] of [['Safe HTTPS link', 'https://example.com/formatting'], ['Safe mail link', 'mailto:formatting@example.invalid'], ['Safe external reference', 'https://example.com/reference']]) {
      const link = content.getByRole('link', { name, exact: name !== 'Safe external reference' })
      assert.equal(await link.getAttribute('href'), href)
      assert.equal(await link.getAttribute('target'), '_blank')
      const rel = (await link.getAttribute('rel')).split(/\s+/)
      assert(rel.includes('noopener') && rel.includes('noreferrer'))
    }
    assert.equal(await textSpan('Rejected active link').evaluate(element => element.closest('a')), null)
    assert.equal(await content.locator('a[href^="javascript:"], img[src^="https:"]').count(), 0)
  })
  await check(profile, 'decoded-local-cover-and-content-image', async () => {
    const images = page.locator('.document-detail img')
    assert.equal(await images.count(), 2)
    const decoded = []
    for (const image of await images.all()) {
      await image.scrollIntoViewIfNeeded()
      decoded.push(await image.evaluate(async element => { await element.decode(); return { src: element.getAttribute('src'), width: element.naturalWidth, height: element.naturalHeight, complete: element.complete, alt: element.alt } }))
    }
    assert.deepEqual(decoded.map(image => image.src), [coverUrl, imageUrl])
    assert(decoded.every(image => image.complete && image.width >= 640 && image.height >= 240))
    assert.equal(decoded[0].alt, ''); assert.equal(decoded[1].alt, 'Local mock diagram')
    return decoded
  })
}

await mkdir(output, { recursive: true })
await writeFile(resolve(output, 'formatting-fixture.json'), JSON.stringify(fixture, null, 2))
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  report.browser = browser.version()
  for (const profile of [
    { name: 'desktop', viewport: { width: 1440, height: 1000 } },
    { name: 'mobile', viewport: { width: 390, height: 844 } },
  ]) {
    // Separate contexts avoid resizing an already composited page and start anonymous.
    const context = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await context.newPage()
    page.setDefaultTimeout(7000)
    page.on('pageerror', error => report.pageerrors.push({ profile: profile.name, message: error.message }))
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) { report.blockedExternal.push({ profile: profile.name, url: url.href }); return route.abort('blockedbyclient') }
      if (!url.pathname.startsWith('/api/')) return route.continue()
      const entry = { profile: profile.name, method: request.method(), path: url.pathname, query: url.search, anonymous: !request.headers().authorization && !request.headers().cookie }
      report.apiRequests.push(entry)
      if (!entry.anonymous || request.method() !== 'GET') { report.unexpectedApi.push(entry); return route.fulfill({ status: 405, json: { detail: 'Anonymous GET fixtures only' } }) }
      if (media.has(url.pathname)) return route.fulfill({ contentType: 'image/png', body: media.get(url.pathname), headers: { 'Cache-Control': 'no-store' } })
      if (url.pathname === '/api/v1/documents') return route.fulfill({ json: { items: [summary], total: 1, page: 1, page_size: 10, total_pages: 1 } })
      if (url.pathname === `/api/v1/documents/${slug}`) return route.fulfill({ json: fixture })
      report.unexpectedApi.push(entry)
      return route.fulfill({ status: 503, json: { detail: 'No backend requests allowed in formatting acceptance' } })
    })
    try {
      await page.goto(origin + '/documents', { waitUntil: 'networkidle', timeout: 30000 })
      await disableMotion(page)
      await page.locator('.document-card').waitFor()
      await check(profile.name, 'anonymous-public-list-fixture', async () => {
        assert.equal(await page.locator('.document-card').count(), 1)
        assert.equal(await page.getByRole('link', { name: fixture.title, exact: true }).count(), 1)
        assert.equal(await page.locator('a[href^="/admin"]').count(), 0)
        const image = page.locator('.document-card img')
        await image.evaluate(async element => { await element.decode() })
        assert.equal(await image.getAttribute('src'), coverUrl)
        assert.deepEqual(await context.cookies(), [])
        assert.equal(await page.evaluate(() => localStorage.getItem('token')), null)
      })
      await check(profile.name, 'list-no-horizontal-overflow', () => overflow(page))
      await screenshot(page, `formatting-list-${profile.name}.png`)
      await audit(page, profile.name, 'list')
      await page.getByRole('link', { name: fixture.title, exact: true }).click()
      await page.waitForURL(origin + '/documents/' + slug)
      await page.locator('.document-content > .notion-blocks').waitFor()
      await disableMotion(page); await settle(page)
      await formatting(page, profile.name, profile.viewport)
      await check(profile.name, 'detail-no-horizontal-overflow', () => overflow(page))
      await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
      await screenshot(page, `formatting-detail-${profile.name}.png`)
      await audit(page, profile.name, 'detail')
    } catch (error) {
      report.issues.push({ profile: profile.name, name: 'navigation-or-audit', message: String(error.message || error) })
      await screenshot(page, `formatting-failure-${profile.name}.png`).catch(() => {})
    } finally { await context.close() }
  }
  if (report.pageerrors.length) report.issues.push({ name: 'pageerrors', messages: report.pageerrors })
  if (report.unexpectedApi.length) report.issues.push({ name: 'unexpected-api-requests', requests: report.unexpectedApi })
  if (report.blockedExternal.length) report.issues.push({ name: 'external-requests-blocked', requests: report.blockedExternal })
  report.passed = report.issues.length === 0
} catch (error) {
  report.passed = false
  report.issues.push({ name: 'browser-harness', message: String(error.message || error) })
} finally {
  await browser?.close()
  report.finishedAt = new Date().toISOString()
  report.totals = { checks: report.checks.length, passed: report.checks.filter(check => check.passed).length, failed: report.checks.filter(check => !check.passed).length, axeViolations: report.axe.reduce((count, audit) => count + audit.violations.length, 0), axeIncomplete: report.axe.reduce((count, audit) => count + audit.incomplete.length, 0), pageerrors: report.pageerrors.length, unexpectedApi: report.unexpectedApi.length, blockedExternal: report.blockedExternal.length }
  await writeFile(resolve(output, 'formatting-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ mode: report.mode, passed: report.passed, totals: report.totals, issues: report.issues, artifacts: output }, null, 2))
  if (!report.passed) process.exitCode = 1
}
