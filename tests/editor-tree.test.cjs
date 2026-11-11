const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const ts = require('typescript')

// Exercise the same renderer model without starting a graphical session.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-editor-model-'))
after(() => fs.rmSync(dir, { recursive: true, force: true }))
for (const name of ['model', 'editorTree', 'photoGeometry']) {
  const input = fs.readFileSync(path.resolve('src', name + '.ts'), 'utf8')
  const { outputText } = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  })
  fs.writeFileSync(path.join(dir, name + '.js'), outputText)
}
const model = require(path.join(dir, 'model.js'))
const tree = require(path.join(dir, 'editorTree.js'))
const { photoGeometry } = require(path.join(dir, 'photoGeometry.js'))
test('stable nested drag boundaries, marker moves, immutable draft and subtree duplication', () => {
  const base = model.blank(),
    work = base.sections.find((s) => s.kind === 'work')
  const group = model.block('group', 'Test')
  group.children = [model.block('bullet', 'First'), model.block('bullet', 'Second')]
  group.children[0].breakBefore = true
  work.entries = [model.entry({ role: 'A' }), model.entry({ role: 'B' })]
  work.entries[0].blocks = [group]
  const doc = tree.editorCopy(base)
  assert(tree.moveTreeNode(doc, { id: group.children[0].id, marker: true }, group.children[1].id, false))
  assert.equal(tree.findNode(doc, group.children[1].id).node.breakBefore, true)
  assert(!tree.moveTreeNode(doc, { id: group.children[0].id }, work.entries[1].id, false))
  assert(tree.moveTreeNode(doc, { id: group.children[1].id }, group.children[0].id, false))
  assert.equal(tree.findNode(doc, group.id).node.children[0].runs[0].text, 'Second')
  assert.equal(group.children[0].runs[0].text, 'First')
  const copyId = tree.duplicateTreeNode(doc, group.id),
    copy = tree.findNode(doc, copyId).node
  assert.notEqual(copy.children[0].id, group.children[1].id)
  assert(copy.children[0].breakBefore)
  assert.equal(tree.duplicateTreeNode(doc, doc.sections.find((s) => s.kind === 'personal').id), undefined)
})
test('visible date and title validation ignores empty placeholders and hidden nodes', () => {
  const doc = model.blank(),
    work = doc.sections.find((s) => s.kind === 'work')
  work.entries = [model.entry(), { ...model.entry({ role: 'Planning' }), start: '2025-10', end: '2025-01' }]
  assert.equal(tree.editorErrors(doc).length, 1)
  work.entries[1].current = true
  assert.deepEqual(tree.editorErrors(doc), [])
  work.entries[1].fields.role = ''
  assert.match(tree.editorErrors(doc)[0].message, /职位/)
  work.hidden = true
  assert.deepEqual(tree.editorErrors(doc), [])
})
test('portrait crop covers circular frame at rotated aspect and pan extremes', () => {
  const g = photoGeometry({ src: '', x: 0, y: 1, rotation: 90, zoom: 2 }, 1200, 800, 200)
  assert.equal(g.width, 600)
  assert.equal(g.height, 400)
  assert.equal(g.overflowX, 200)
  assert.equal(g.overflowY, 400)
  assert.equal(g.centerX, 200)
  assert.equal(g.centerY, -100)
})
