import { editorErrors } from './editorTree'
import { type Resume, type Entry, type Block, uid } from './model'
export function copyResume(source: Resume, name: string): Resume {
  const doc = structuredClone(source),
    now = Date.now()
  Object.assign(doc, { id: uid(), name, revision: 0, created: now, modified: now, trashed: null })
  function copyBlock(b: Block) {
    b.id = uid()
    b.children.forEach(copyBlock)
  }
  for (const s of doc.sections) {
    s.id = uid()
    s.intro.forEach(copyBlock)
    s.ending.forEach(copyBlock)
    for (const e of s.entries) {
      e.id = uid()
      e.blocks.forEach(copyBlock)
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
  let printable = !!doc.photo
  for (const s of doc.sections.filter((s) => !s.hidden)) {
    printable ||=
      s.intro.some(printableBlock) ||
      s.ending.some(printableBlock) ||
      (s.kind === 'target' && !!doc.target.trim())
    printable ||= s.entries.some((e) => !e.hidden && !!hasEntry(e))
  }
  return printable ? null : { id: '', message: '请先添加个人信息或经历，再导出 PDF。' }
}
