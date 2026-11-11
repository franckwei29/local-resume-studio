const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { buildSync } = require('esbuild')
const Module = require('node:module')

// Run the production paginator with deterministic text advances. Electron PDF tests
// separately exercise the installed fonts, print geometry, and clickable destinations.
const bundle = buildSync({
  stdin: {
    contents:
      "export * from './model';export * from './templates';export * from './pagination';export * from './seed'",
    resolveDir: path.resolve('src'),
  },
  bundle: true,
  loader: { '.png': 'dataurl' },
  platform: 'node',
  format: 'cjs',
  write: false,
})
const moduleUnderTest = new Module('template-layout-acceptance')
moduleUnderTest._compile(bundle.outputFiles[0].text, 'template-layout-acceptance.cjs')
const { blank, section, entry, block, paginate, templateDefaults } = moduleUnderTest.exports
global.document = {
  createElement: () => ({
    getContext: () => ({
      font: '10px sans-serif',
      measureText(text) {
        const px = parseFloat(this.font.match(/[\d.]+px/)[0])
        return { width: Array.from(text).reduce((n, c) => n + (c.charCodeAt(0) > 255 ? px : px * 0.53), 0) }
      },
    }),
  }),
}
function specimen(id) {
  const doc = blank('布局验收')
  doc.templateId = id
  doc.style = templateDefaults(id)
  const pre = section('custom', 'main')
  const before = entry({ format: 'paragraph', description: '正文起始标记' })
  pre.entries = [before]
  const kind = { E1: 'project', E2: 'evaluation', E3: 'skills', E4: 'education', E5: 'project' }[id]
  const sample = section(kind, 'main')
  function item(i) {
    const f =
      kind === 'education'
        ? { school: '学院' + i, major: '专业' + i }
        : kind === 'skills'
          ? { name: '能力' + i, description: '描述' + i }
          : kind === 'evaluation'
            ? { text: '评价' + i }
            : { name: '案例' + i }
    const e = entry(f)
    const g = block('group', '父项' + i)
    g.children = [block('bullet', '唯一要点' + i), block('bullet', '随后的说明' + i)]
    e.blocks = [g]
    return e
  }
  const hidden = item(0)
  hidden.hidden = true
  sample.entries = [hidden, ...[1, 2, 3].map(item)]
  doc.sections = [pre, sample]
  return { doc, sample, before, first: sample.entries[1] }
}
const lines = (layout) => layout.pages.flatMap((p) => p.lines)
const texts = (layout, id) =>
  lines(layout)
    .filter((l) => l.id === id)
    .flatMap((l) => l.pieces.map((p) => p.text))
    .join('')
function bounds(layout) {
  for (const page of layout.pages) {
    assert.ok(page.lines.length > 0)
    for (const l of page.lines) {
      assert.ok(l.y >= 0 && l.y + l.height <= 297.01, 'line outside page height ' + l.y + ' ' + l.height)
      assert.ok(l.x >= 0 && l.x + l.width <= 210.01, 'line outside page width ' + l.x + ' ' + l.width)
    }
  }
}
for (const id of ['E1', 'E2', 'E3', 'E4', 'E5']) {
  test(
    'T08 ' + id + ' promotes visible sources exactly once and keeps manual breaks, notes and long text',
    () => {
      const { doc, sample, before, first } = specimen(id)
      let layout = paginate(doc)
      const point = first.blocks[0].children[0]
      const expected =
        id === 'E5'
          ? [point.id]
          : id === 'E3'
            ? sample.entries.slice(1).map((e) => e.id)
            : id === 'E4'
              ? sample.entries.slice(1, 3).map((e) => e.id)
              : [first.id]
      assert.deepEqual(layout.featuredIds, expected)
      const marker = lines(layout).findIndex((l) => l.id === before.id && l.pieces.length)
      assert.ok(marker > 0)
      for (const source of expected)
        assert.ok(
          lines(layout)
            .slice(0, marker)
            .some((l) => l.id === source),
        )
      assert.equal(texts(layout, point.id).split('唯一要点1').length, 2)
      assert.ok(!lines(layout).some((l) => l.id === sample.entries[0].id))
      if (id === 'E4') {
        const [a, b] = expected.map((source) => lines(layout).find((l) => l.id === source))
        assert.equal(a.y, b.y)
        assert.ok(a.x < b.x)
      }
      first.blocks[0].children[1].runs[0].text = '可搜索长要点'.repeat(3400)
      layout = paginate(doc)
      bounds(layout)
      assert.ok(layout.pages.length > 2)
      assert.equal(
        texts(layout, first.blocks[0].children[1].id).replace(/^•/u, ''),
        '可搜索长要点'.repeat(3400),
      )
      for (const object of [sample, first, first.blocks[0], point]) {
        object.breakBefore = true
        layout = paginate(doc)
        assert.deepEqual(layout.featuredIds, [])
        assert.match(layout.notes.at(-1).text, /分页/)
        object.breakBefore = false
      }
      if (id === 'E4') {
        sample.entries[2].breakBefore = true
        assert.deepEqual(paginate(doc).featuredIds, [])
        sample.entries[2].breakBefore = false
      }
      sample.intro = [block('paragraph', '必须先读的引言')]
      assert.deepEqual(paginate(doc).featuredIds, [])
      sample.intro = []
      sample.hidden = true
      assert.deepEqual(paginate(doc).featuredIds, [])
      doc.sections = doc.sections.filter((s) => s !== sample)
      assert.deepEqual(paginate(doc).featuredIds, [])
    },
  )
}
test('T08 F2 six navigation cells target the right chapters across nine modules', () => {
  const doc = blank()
  doc.templateId = 'F2'
  doc.style = templateDefaults('F2')
  doc.sections = Array.from({ length: 9 }, (_, i) => {
    const s = section('custom', 'main')
    s.customTitle = true
    s.title = '第' + (i + 1) + '个栏目' + (i === 0 ? '长'.repeat(40) : '')
    s.entries = [entry({ format: 'paragraph', description: '内容' + i })]
    s.breakBefore = i > 3
    return s
  })
  const layout = paginate(doc),
    links = lines(layout)
      .flatMap((l) => l.pieces)
      .filter((p) => p.targetId)
  assert.equal(links.length, 6)
  assert.equal(links.at(-1).text, '另有 4 章')
  assert.ok(links[0].text.endsWith('…'))
  assert.deepEqual(
    links.map((p) => p.targetId),
    doc.sections.slice(0, 6).map((s) => s.id),
  )
  for (const link of links) assert.equal(lines(layout).filter((l) => l.anchor === link.targetId).length, 1)
  assert.ok(layout.pages.slice(1).some((p) => p.lines.some((l) => l.anchor === links.at(-1).targetId)))
})
test('T08 project archive numbers follow the visible order and empty ledger cells collapse', () => {
  const { doc, sample } = specimen('E1')
  doc.templateId = 'F3'
  for (const reverse of [false, true]) {
    if (reverse) sample.entries.reverse()
    const layout = paginate(doc)
    sample.entries
      .filter((e) => !e.hidden)
      .forEach((e, i) => {
        assert.ok(
          lines(layout).find(
            (l) => l.id === e.id && l.pieces.some((p) => p.text === String(i + 1).padStart(2, '0')),
          ),
        )
      })
  }
  doc.templateId = 'A4'
  const s = section('work', 'main'),
    e = entry({ role: '空单位仍保留的职位', company: '', city: '杭州' })
  e.start = '2021-10'
  s.entries = [e]
  doc.sections = [s]
  const layout = paginate(doc)
  assert.match(texts(layout, e.id), /空单位仍保留的职位/)
  assert.match(texts(layout, e.id), /杭州/)
  assert.ok(!texts(layout, e.id).includes('()'))
  bounds(layout)
})

test('T01 all 30 designs have distinct paper geometry and valid source positions on A4', () => {
  const { publicSeed, templates, switchTemplate } = moduleUnderTest.exports
  const doc = publicSeed()
  const sections = new Map(doc.sections.map((s) => [s.kind, s]))
  const layouts = new Map()
  const seen = new Map()
  const duplicates = []
  const mm = (n) => Math.round(n * 100) / 100
  const rect = (r) => [r.x, r.y, r.width, r.height].map(mm)
  for (const spec of templates.filter((t) => t.id !== '00')) {
    const layout = paginate(switchTemplate(doc, spec.id))
    layouts.set(spec.id, layout)
    bounds(layout)
    for (const page of layout.pages) {
      for (const frame of [...(page.decorations ?? []), ...(page.portrait ? [page.portrait] : [])]) {
        assert.ok(
          frame.x >= -0.01 &&
            frame.y >= -0.01 &&
            frame.x + frame.width <= 210.01 &&
            frame.y + frame.height <= 297.01,
          spec.id + ' artwork leaves A4',
        )
      }
    }
    assert.equal(Boolean(layout.pages[0].portrait), spec.photo, spec.id + ' first-page photo')
    assert.ok(
      layout.pages.slice(1).every((p) => !p.portrait),
      spec.id + ' repeated portrait',
    )
    // Compare actual marks on paper. Template/field IDs, texts, role names,
    // font families and paint colours deliberately do not contribute.
    const geometry = layout.pages.map((p) => [
      p.portrait ? rect(p.portrait) : [],
      (p.decorations ?? []).map((a) => [...rect(a), mm(a.radius ?? 0), Boolean(a.stroke)]).sort(),
      p.lines
        .filter((l) => l.pieces.length || l.rule || l.image)
        .map((l) => [
          ...rect(l),
          !!l.rule,
          !!l.image,
          l.pieces.map((r) => [mm(r.x), mm(r.size), !!r.alignRight]),
        ]),
    ])
    const key = JSON.stringify(geometry)
    if (seen.has(key)) duplicates.push(seen.get(key) + ' and ' + spec.id)
    seen.set(key, spec.id)
  }
  assert.equal(layouts.size, 30)
  const firstEntry = sections.get('education').entries[0].id
  const firstJob = sections.get('work').entries[0].id
  const source = (id, sourceId) => lines(layouts.get(id)).filter((l) => l.id === sourceId && l.pieces.length)
  const email = sections.get('personal').entries.find((e) => e.fields.icon === 'email').id
  assert.ok(
    source('A3', email)[0].x > source('F4', email)[0].x + 8,
    'formal letterhead reserves a wider identity block',
  )
  assert.ok(
    layouts.get('A3').pages[0].decorations.some((a) => a.width > 175 && a.height >= 1 && a.height < 2),
    'A3 top rule',
  )
  assert.ok(
    layouts.get('F4').pages[0].decorations.some((a) => a.width > 175 && a.height > 8 && a.stroke),
    'F4 framed facing header',
  )
  const left = source('B4', sections.get('evaluation').id)[0],
    right = source('C1', sections.get('evaluation').id)[0]
  assert.ok(left.x < source('B4', firstJob)[0].x && right.x > source('C1', firstJob)[0].x)
  assert.ok(layouts.get('B4').pages[0].portrait.width > layouts.get('B4').pages[0].portrait.height)
  for (const id of ['D1', 'D4']) {
    const rows = source(id, firstEntry)
    const title = rows.find((l) => l.pieces.some((p) => p.text.includes('交互设计')))
    const when = rows.find((l) => l.pieces.some((p) => p.text.includes('2018')))
    assert.ok(id === 'D1' ? when.x < title.x : when.x > title.x, id + ' date rail')
  }
  const education = sections.get('education').entries
  const first = source('E4', education[0].id)[0],
    second = source('E4', education[1].id)[0]
  assert.equal(first.y, second.y)
  assert.ok(first.x < second.x)
  assert.ok(lines(layouts.get('F2')).some((l) => l.pieces.some((p) => p.targetId)))
  const banner = layouts.get('F5').pages
  assert.ok(banner[0].decorations.some((b) => b.width === 210 && b.height > 8))
  assert.ok(banner[1].decorations.some((b) => b.width === 210 && b.height === 2))
  assert.deepEqual(duplicates, [], 'identical paper structure: ' + duplicates.join(', '))
})
