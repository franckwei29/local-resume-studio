import { editorErrors } from './editorTree'
import { getTemplate } from './templates'
import { type Resume, type Entry, type Block, uid } from './model'
export function copyResume(source: Resume, name: string): Resume {
  const doc = structuredClone(source),
    now = Date.now()
  Object.assign(doc, { id: uid(), name, revision: 0, created: now, modified: now, trashed: null })
  function copyBlock(b: Block) {
    b.id = uid()
    b.children.forEach(copyBlock)
  }
  const sectionIds = new Map<string, string>()
  for (const s of doc.sections) {
    const originalId = s.id
    s.id = uid()
    sectionIds.set(originalId, s.id)
    s.intro.forEach(copyBlock)
    s.ending.forEach(copyBlock)
    for (const e of s.entries) {
      e.id = uid()
      e.blocks.forEach(copyBlock)
    }
  }
  for (const layout of Object.values(doc.templateLayouts)) {
    for (const placement of layout.sections) {
      const newId = sectionIds.get(placement.id)
      if (!newId) throw Error('栏目布局与简历内容不一致。')
      placement.id = newId
    }
  }
  return doc
}
export function freeName(base: string, docs: Resume[]) {
  const used = new Set(docs.filter((d) => !d.trashed).map((d) => d.name))
  let name = base
  for (let i = 2; used.has(name); i++) name = base + ' ' + i
  return name
}
const printableBlock = (b: Block): boolean =>
  !b.hidden && (b.runs.some((r) => r.text.trim()) || b.children.some(printableBlock))
function hasEntry(e: Entry) {
  return (
    Object.entries(e.fields).some(
      ([k, v]) => !['icon', 'label', 'mode', 'numbered', 'format', 'levelShown'].includes(k) && v.trim(),
    ) ||
    e.blocks.some(printableBlock) ||
    e.start ||
    e.end ||
    e.current
  )
}
export function exportIssue(doc: Resume): { id: string; message: string } | null {
  const error = editorErrors(doc)[0]
  if (error) return error
  const template = getTemplate(doc.templateId)
  let printable = !!doc.photo && template.photo
  for (const s of doc.sections.filter((s) => !s.hidden)) {
    printable ||=
      s.intro.some(printableBlock) ||
      s.ending.some(printableBlock) ||
      (s.kind === 'target' && !!doc.target.trim())
    printable ||= s.entries.some((e) => !e.hidden && !!hasEntry(e))
  }
  if (printable) return null
  return {
    id: '',
    message:
      doc.photo && !template.photo
        ? '当前模板没有可导出的内容，可换带照模板或补充文字。'
        : '请先添加个人信息或经历，再导出 PDF。',
  }
}
