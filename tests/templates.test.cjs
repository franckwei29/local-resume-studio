const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const { Store, validate } = require('../electron/store.cjs')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-template-tests-'))
after(() => fs.rmSync(dir, { recursive: true, force: true }))
const renderer = path.join(dir, 'src')
fs.mkdirSync(renderer)
fs.mkdirSync(path.join(dir, 'electron'))
fs.copyFileSync('electron/templates.json', path.join(dir, 'electron/templates.json'))
for (const name of ['model', 'editorTree', 'templates', 'document', 'seed']) {
  const input = fs.readFileSync(path.resolve('src', name + '.ts'), 'utf8')
  const { outputText } = ts.transpileModule(input, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  })
  fs.writeFileSync(path.join(renderer, name + '.js'), outputText)
}
const imageData = 'data:image/png;base64,' + fs.readFileSync('src/assets/demo-avatar.png').toString('base64')
fs.mkdirSync(path.join(renderer, 'assets'))
fs.writeFileSync(
  path.join(renderer, 'assets/demo-avatar.png?inline.js'),
  'module.exports=' + JSON.stringify(imageData),
)
const { publicSeed } = require(path.join(renderer, 'seed.js'))
const { section, block, entry, blank } = require(path.join(renderer, 'model.js'))
const { templates, getTemplate, switchTemplate, forgetTemplateSection } = require(
  path.join(renderer, 'templates.js'),
)
const { copyResume, exportIssue } = require(path.join(renderer, 'document.js'))

function fixture() {
  const doc = publicSeed()
  doc.photo = { ...doc.photo, x: 0.2, y: 0.7, zoom: 1.5, rotation: 90 }
  for (const kind of ['language', 'custom', 'signature']) {
    const s = section(kind, kind === 'signature' ? 'main' : 'side')
    s.entries = [entry({ text: 'Offline multilingual text.' }), entry({ text: '隐藏 Hidden' })]
    s.entries[1].hidden = true
    doc.sections.push(s)
  }
  const project = doc.sections.find((s) => s.kind === 'project')
  const b = block('group', '子项目')
  const bullet = block('bullet', '一次性资料')
  bullet.runs.push({
    text: 'https://example.test/简历',
    href: 'https://example.test/resume',
    bold: true,
    italic: true,
    underline: true,
  })
  bullet.breakBefore = true
  b.children.push(bullet, { ...block('number', '隐藏的要点'), hidden: true })
  project.entries[0].blocks.push(b)
  project.entries[1].breakBefore = true
  doc.sections.find((s) => s.kind === 'language').breakBefore = true
  return doc
}

const arrangement = (d) => d.sections.map(({ id, lane }) => ({ id, lane }))
function content(d) {
  const { schemaVersion, templateId, templateVersion, templateLayouts, sections, style, ...rest } = d
  return { ...rest, sections: sections.map(({ lane, ...s }) => s).sort((a, b) => a.id.localeCompare(b.id)) }
}
function legacy(d) {
  const { templateId, templateVersion, templateLayouts, ...old } = d
  return { ...old, schemaVersion: 1 }
}
function assertLayoutRefs(doc) {
  const ids = new Set(doc.sections.map((s) => s.id))
  for (const [id, layout] of Object.entries(doc.templateLayouts)) {
    assert.notEqual(id, doc.templateId)
    for (const placement of layout.sections) assert(ids.has(placement.id), id + ' missing ' + placement.id)
  }
}

test('T01 catalog cardinality, physical columns, photo policy and versioned defaults', () => {
  assert.equal(templates.length, 31)
  assert.equal(new Set(templates.map((t) => t.id)).size, 31)
  assert.deepEqual(
    ['single', 'left', 'right'].map((c) => templates.filter((t) => t.columns === c).length),
    [20, 6, 5],
  )
  assert.deepEqual(
    templates.filter((t) => t.photo).map((t) => t.id),
    ['00', 'B1', 'B2', 'B4', 'C3'],
  )
  assert.throws(() => getTemplate('G1'), /更新/)
})

test('T06 placements survive one-column edits, mirrored layouts, additions, deletion and hiding', () => {
  const original = fixture()
  const cert = original.sections.find((s) => s.kind === 'custom')
  cert.title = '证书'
  const skills = original.sections.find((s) => s.kind === 'skills')
  original.sections.splice(original.sections.indexOf(cert), 1)
  original.sections.splice(original.sections.indexOf(skills) + 1, 0, cert)
  const edited = structuredClone(switchTemplate(original, 'A1'))
  assert(edited.sections.every((s) => s.lane === 'main'))
  assert(
    edited.sections.findIndex((s) => s.kind === 'work') <
      edited.sections.findIndex((s) => s.kind === 'skills'),
  )
  edited.sections.unshift(
    edited.sections.splice(
      edited.sections.findIndex((s) => s.id === cert.id),
      1,
    )[0],
  )
  edited.sections.find((s) => s.kind === 'work').entries[0].fields.company = '补充 最新文本'
  edited.sections.find((s) => s.id === skills.id).hidden = true
  const extra = section('custom', 'main')
  edited.sections.push(extra)
  const remove = edited.sections.find((s) => s.kind === 'education')
  edited.sections.splice(edited.sections.indexOf(remove), 1)
  forgetTemplateSection(edited, remove.id)
  edited.style.color = '#a93218'
  const back = switchTemplate(edited, '00')
  const side = back.sections.filter((s) => s.lane === 'side')
  assert.equal(side[side.findIndex((s) => s.id === skills.id) + 1].id, cert.id)
  assert.equal(back.sections.find((s) => s.kind === 'work').entries[0].fields.company, '补充 最新文本')
  assert.equal(back.sections.find((s) => s.id === extra.id).lane, 'main')
  assert(back.sections.find((s) => s.id === skills.id).hidden)
  assert(!back.sections.some((s) => s.id === remove.id))
  const right = switchTemplate(back, 'C1')
  assert.deepEqual(arrangement(right), arrangement(back))
  assert.equal(getTemplate(right.templateId).columns, 'right')
  const restored = switchTemplate(right, 'A1')
  assert.equal(restored.sections[0].id, cert.id)
  assert.equal(restored.style.color, edited.style.color)
  assert.deepEqual(arrangement(switchTemplate(restored, 'D1')), arrangement(restored))
  assert.equal(switchTemplate(restored, 'F3').sections[0].kind, 'project')
  assertLayoutRefs(restored)
  validate(restored)
})

test('T07 all 930 directed switches and returns preserve every content field, ID, crop and local style', () => {
  const original = fixture(),
    baseline = content(original)
  let pairs = 0
  for (const source of templates) {
    const a = structuredClone(switchTemplate(original, source.id))
    a.sections.reverse()
    a.style.color = '#ac347f'
    a.style.pageNumbers = true
    for (const target of templates) {
      if (source.id === target.id) continue
      // Never mutate a live session with a candidate preview.
      const snapshot = JSON.stringify(a)
      const candidate = switchTemplate(a, target.id)
      assert.equal(JSON.stringify(a), snapshot)
      assert.deepEqual(content(candidate), baseline)
      const b = structuredClone(candidate)
      b.sections.reverse()
      b.style.size = 11.75
      const restored = switchTemplate(b, source.id)
      assert.deepEqual(content(restored), baseline)
      assert.deepEqual(arrangement(restored), arrangement(a))
      assert.deepEqual(restored.style, a.style)
      const bAgain = switchTemplate(restored, target.id)
      assert.deepEqual(arrangement(bAgain), arrangement(b))
      assert.deepEqual(bAgain.style, b.style)
      validate(bAgain)
      pairs++
    }
  }
  assert.equal(pairs, 930)
})

test('T09 photo-only export follows the chosen template; long custom contacts and crop are retained', () => {
  const d = blank()
  d.photo = { src: imageData, x: 0.25, y: 0.75, zoom: 2, rotation: 270 }
  assert.equal(exportIssue(d), null)
  const hidden = switchTemplate(d, 'A1')
  assert.match(exportIssue(hidden).message, /换带照模板/)
  assert.deepEqual(switchTemplate(hidden, 'B4').photo, d.photo)
  const p = hidden.sections.find((s) => s.kind === 'personal')
  p.entries.push(entry({ label: '自定义', value: 'mailbox+'.repeat(24) + '@example.com' }))
  assert.equal(exportIssue(hidden), null)
})

test('T11 migrate v1 DB, seed and backups, remap inactive placements across copies and restore after restart', () => {
  const folder = fs.mkdtempSync(path.join(dir, 'db-'))
  let store = new Store(folder)
  try {
    const old = legacy(fixture())
    old.revision = 13
    old.style.margin = 8.5
    const packed = store.storeImages(old)
    store.db
      .prepare('INSERT INTO docs(id,name,trashed,revision,snapshot) VALUES(?,?,?,?,?)')
      .run(old.id, old.name, null, old.revision, JSON.stringify(packed))
    store.db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('initialized', '1')
    fs.writeFileSync(path.join(folder, 'seed.json'), JSON.stringify(old))
    assert.equal(store.initialize(blank()).templateId, '00')
    const migrated = store.get(old.id)
    const savedRaw = JSON.parse(store.db.prepare('SELECT snapshot FROM docs WHERE id=?').get(old.id).snapshot)
    assert.equal(savedRaw.schemaVersion, 2)
    assert.equal(savedRaw.templateId, '00')
    assert(savedRaw.photo.src.startsWith('asset:'))
    assert.deepEqual(legacy(migrated), old)
    const restoredOld = store.restore(old)
    assert.equal(restoredOld.templateId, '00')
    const blue = switchTemplate(migrated, 'B1')
    blue.style.lineHeight = 1.55
    const two = switchTemplate(blue, 'F1')
    two.style.margin = 18.5
    const saved = store.save(two, migrated.revision)
    const copies = [
      store.save(copyResume(saved, '独立副本')),
      store.restore(JSON.parse(JSON.stringify(saved))),
    ]
    const originalIds = new Set(saved.sections.map((s) => s.id))
    for (const c of copies) {
      assert(c.sections.every((s) => !originalIds.has(s.id)))
      assertLayoutRefs(c)
      assert.equal(switchTemplate(c, '00').style.margin, 8.5)
      assert.equal(switchTemplate(c, 'B1').style.lineHeight, 1.55)
    }
    assert.throws(() => store.restore({ ...saved, schemaVersion: 3 }), /版本/)
    assert.throws(() => store.restore({ ...saved, templateVersion: 99 }), /版次/)
    const corrupt = structuredClone(saved)
    corrupt.templateLayouts['00'].sections[0].id = 'missing'
    assert.throws(() => store.restore(corrupt), /位置/)
    assert.equal(store.list().length, 4)
    store.close()
    store = new Store(folder)
    store.initialize(blank())
    for (const c of [saved, ...copies]) assert.deepEqual(store.get(c.id), c)
  } finally {
    store.close()
  }
})

test('T12 a real SQLite write fault rolls back all placements, stale drafts cannot replace a retry', () => {
  const store = new Store(fs.mkdtempSync(path.join(dir, 'fail-')))
  try {
    const base = store.save(fixture())
    const draft = switchTemplate(base, 'B3')
    store.db.exec(
      "CREATE TEMP TRIGGER simulated_full BEFORE UPDATE ON docs BEGIN SELECT RAISE(ABORT,'disk full'); END",
    )
    assert.throws(() => store.save(draft, base.revision), /disk full/)
    assert.deepEqual(store.get(base.id), base)
    const newer = structuredClone(switchTemplate(draft, 'F5'))
    newer.sections.find((s) => s.kind === 'work').entries[0].fields.role = '保存重试后的新输入'
    store.db.exec('DROP TRIGGER simulated_full')
    const saved = store.save(newer, base.revision)
    assert.equal(saved.templateId, 'F5')
    assert.equal(saved.sections.find((s) => s.kind === 'work').entries[0].fields.role, '保存重试后的新输入')
    assert.throws(() => store.save(draft, base.revision), /已被更新/)
    assert.deepEqual(store.get(base.id), saved)
  } finally {
    store.close()
  }
})

test('T11 an unreadable legacy database row rolls back the entire migration', () => {
  const store = new Store(fs.mkdtempSync(path.join(dir, 'migration-failure-')))
  try {
    const first = legacy(blank('First'))
    const second = { ...legacy(blank('Second')), schemaVersion: 9 }
    const insert = store.db.prepare(
      'INSERT INTO docs(id,name,trashed,revision,snapshot) VALUES(?,?,NULL,0,?)',
    )
    insert.run(first.id, first.name, JSON.stringify(first))
    insert.run(second.id, second.name, JSON.stringify(second))
    assert.throws(() => store.initialize(blank()), /数据版本/)
    const snapshots = store.db.prepare('SELECT id,snapshot FROM docs').all()
    assert.deepEqual(new Set(snapshots.map((row) => JSON.parse(row.snapshot).schemaVersion)), new Set([1, 9]))
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 0)
  } finally {
    store.close()
  }
})
