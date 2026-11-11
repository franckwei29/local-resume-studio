import { block, entry, section, uid } from './model'
import type { Block, Entry, Kind, Lane, Resume, Section } from './model'

export type TreeNode = Section | Entry | Block
export type Collection = 'section' | 'entry' | 'block'
export type DragItem = { id: string; marker?: boolean }
export interface NodeInfo {
  node: TreeNode
  siblings: TreeNode[]
  collection: Collection
  parent: string
  ancestors: string[]
  lane: Lane
}

function cloneBlock(b: Block): Block {
  return { ...b, runs: b.runs.map((r) => ({ ...r })), children: b.children.map(cloneBlock) }
}
function cloneEntry(e: Entry): Entry {
  return { ...e, fields: { ...e.fields }, blocks: e.blocks.map(cloneBlock) }
}
function cloneSection(s: Section): Section {
  return {
    ...s,
    intro: s.intro.map(cloneBlock),
    ending: s.ending.map(cloneBlock),
    entries: s.entries.map(cloneEntry),
  }
}
export function editorCopy(doc: Resume): Resume {
  return { ...doc, style: { ...doc.style }, sections: doc.sections.map(cloneSection) }
}
export function findNode(doc: Resume, id: string): NodeInfo | undefined {
  function visit(
    list: TreeNode[],
    collection: Collection,
    parent: string,
    ancestors: string[],
    lane: Lane,
  ): NodeInfo | undefined {
    for (const n of list) {
      const activeLane = 'lane' in n ? n.lane : lane
      if (n.id === id) return { node: n, siblings: list, collection, parent, ancestors, lane: activeLane }
      const path = [...ancestors, n.id]
      let result: NodeInfo | undefined
      if ('entries' in n) {
        result =
          visit(n.intro, 'block', n.id + '/intro', path, activeLane) ||
          visit(n.entries, 'entry', n.id, path, activeLane) ||
          visit(n.ending, 'block', n.id + '/ending', path, activeLane)
      } else if ('fields' in n) {
        result = visit(n.blocks, 'block', n.id + '/blocks', path, activeLane)
      } else {
        result = visit(n.children, 'block', n.id + '/children', path, activeLane)
      }
      if (result) return result
    }
  }
  return visit(doc.sections, 'section', 'sections', [], 'side')
}
function rekey(node: TreeNode) {
  node.id = uid()
  if ('entries' in node) [...node.intro, ...node.entries, ...node.ending].forEach(rekey)
  else if ('fields' in node) node.blocks.forEach(rekey)
  else node.children.forEach(rekey)
}
export function duplicateTreeNode(doc: Resume, id: string) {
  const source = findNode(doc, id)
  if (!source) return
  const n = source.node
  if ('kind' in n && ['personal', 'target'].includes(n.kind)) return
  const copy = 'entries' in n ? cloneSection(n) : 'fields' in n ? cloneEntry(n) : cloneBlock(n)
  rekey(copy)
  source.siblings.splice(source.siblings.indexOf(n) + 1, 0, copy)
  return copy.id
}
export function validDrop(source: NodeInfo, target: NodeInfo, marker = false) {
  if (source.node.id === target.node.id || source.collection !== target.collection) return false
  if (source.collection === 'section') return !marker || source.lane === target.lane
  return source.parent === target.parent
}
export function moveTreeNode(doc: Resume, drag: DragItem, targetId: string, after: boolean) {
  const source = findNode(doc, drag.id),
    dest = findNode(doc, targetId)
  if (!source || !dest || !validDrop(source, dest, drag.marker)) return false
  if (drag.marker) {
    if (!source.node.breakBefore) return false
    source.node.breakBefore = false
    dest.node.breakBefore = true
  } else {
    const siblings = source.siblings
    siblings.splice(siblings.indexOf(source.node), 1)
    if ('lane' in source.node) source.node.lane = dest.lane
    dest.siblings.splice(dest.siblings.indexOf(dest.node) + (after ? 1 : 0), 0, source.node)
  }
  return true
}
export function moveToLane(doc: Resume, id: string, lane: Lane) {
  const i = doc.sections.findIndex((s) => s.id === id)
  if (i < 0) return
  const [s] = doc.sections.splice(i, 1)
  s.lane = lane
  doc.sections.push(s)
}
export function siblingNodes(info: NodeInfo) {
  return info.collection === 'section'
    ? info.siblings.filter((s) => 'lane' in s && s.lane === info.lane)
    : info.siblings
}
export function newEntry(kind: Kind) {
  const e = entry()
  if (kind === 'personal') e.fields = { label: '姓名', value: '', icon: 'name' }
  if (kind === 'signature') e.fields.mode = 'text'
  if (kind === 'project')
    e.blocks = [
      block('label', '', '项目简介'),
      block('label', '', '技术栈'),
      { ...block('group', '', '核心实现'), children: [block('bullet')] },
    ]
  return e
}
export function newSection(kind: Kind, lane: Lane, custom?: string) {
  const s = section(kind, lane)
  if (custom) {
    s.title = custom
    s.customTitle = true
  }
  if (kind !== 'target') s.entries = [newEntry(kind)]
  return s
}
export function sectionError(kind: Kind, e: Entry) {
  const hasContent = (b: Block): boolean =>
    !b.hidden && (b.runs.some((r) => r.text.trim()) || b.children.some(hasContent))
  if (
    e.hidden ||
    !(
      e.start ||
      e.end ||
      e.current ||
      Object.values(e.fields).some((v) => v.trim()) ||
      e.blocks.some(hasContent)
    )
  )
    return ''
  if (e.start && e.end && !e.current && e.end < e.start) return '结束年月早于开始年月'
  if (kind === 'education' && !(e.fields.major?.trim() || e.fields.degree?.trim())) return '请填写专业或学位'
  if (kind === 'work' && !e.fields.role?.trim()) return '请填写职位'
  if (kind === 'project' && !e.fields.name?.trim()) return '请填写项目名'
  return ''
}
export function editorErrors(doc: Resume) {
  return doc.sections
    .filter((s) => !s.hidden)
    .flatMap((s) =>
      s.entries.map((e) => ({ id: e.id, message: sectionError(s.kind, e) })).filter((row) => row.message),
    )
}
