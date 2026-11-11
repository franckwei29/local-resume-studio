import { type Block, type Entry, type Resume, type Section } from './model'
import { printableBlock } from './paperText'

export interface HeaderField {
  id: string
  text: string
  href?: string
}
export interface Feature {
  section: Section
  entries: Entry[]
  point?: Block
  firstIndex: number
}
const visibleBlocks = (blocks: Block[]) => blocks.some(printableBlock)
function hasBreak(blocks: Block[]): boolean {
  return blocks.some((b) => printableBlock(b) && (!!b.breakBefore || hasBreak(b.children)))
}
function withoutPoint(blocks: Block[], id: string): Block[] {
  return blocks
    .filter((b) => b.id !== id)
    .map((b) => (b.children.length ? { ...b, children: withoutPoint(b.children, id) } : b))
}
function firstPoint(blocks: Block[]): Block | undefined {
  for (const b of blocks.filter(printableBlock)) {
    if (
      !b.children.some(printableBlock) &&
      ['bullet', 'number'].includes(b.type) &&
      b.runs.some((r) => r.text.trim())
    )
      return b
    const child = firstPoint(b.children)
    if (child) return child
  }
}
const hasText = (e: Entry) =>
  Object.entries(e.fields).some(
    ([k, v]) => !['icon', 'label', 'mode', 'numbered', 'format', 'levelShown'].includes(k) && v.trim(),
  ) ||
  visibleBlocks(e.blocks) ||
  e.start ||
  e.end ||
  e.current

/** Presentation projection. The editable entries and their source IDs remain intact. */
export function projectContent(doc: Resume, template: string) {
  let sections = doc.sections.filter((s) => !s.hidden)
  const notes: { id: string; text: string }[] = []
  let name: HeaderField | undefined, target: HeaderField | undefined, feature: Feature | undefined
  const contacts: HeaderField[] = []
  const blocked = (s: Section) => !!s.breakBefore || visibleBlocks(s.intro)
  sections = sections.map((s) => {
    if (s.kind !== 'target' && s.kind !== 'personal') return s
    if (blocked(s)) {
      notes.push({ id: s.id, text: s.title + '保留在正文，遵循引言或手动分页。' })
      return s
    }
    if (s.kind === 'target') {
      if (target || !doc.target.trim()) return s
      target = { id: s.id, text: doc.target }
      return {
        ...s,
        kind: 'custom' as const,
        customTitle: true,
        title: s.customTitle ? s.title : doc.lang === 'zh' ? '目标岗位' : 'Target role',
      }
    }
    let afterBreak = false
    const entries = s.entries.filter((e) => {
      if (e.hidden) return true
      afterBreak ||= !!e.breakBefore
      if (afterBreak || visibleBlocks(e.blocks) || !e.fields.value?.trim()) return true
      const { icon, value } = e.fields
      if (icon === 'name' && !name) {
        name = { id: e.id, text: value }
        return false
      }
      const headerIcons = ['email', 'phone', 'location', 'website', 'linkedin']
      if (!headerIcons.includes(icon)) return true
      const href = icon === 'email' ? 'mailto:' + value : /^(https?:\/\/)/i.test(value) ? value : undefined
      contacts.push({ id: e.id, text: value, href })
      return false
    })
    if (afterBreak) notes.push({ id: s.id, text: '手动分页后的个人资料留在原模块。' })
    return { ...s, entries }
  })
  const wanted: Record<string, Section['kind']> = {
    E1: 'project',
    E2: 'evaluation',
    E3: 'skills',
    E4: 'education',
    E5: 'project',
  }
  if (wanted[template]) {
    for (let si = 0; si < sections.length; si++) {
      const s = sections[si]
      if (s.kind !== wanted[template]) continue
      const visible = s.entries.filter((e) => !e.hidden && hasText(e))
      const pointEntry = template === 'E5' ? visible.find((e) => firstPoint(e.blocks)) : undefined
      const selected =
        template === 'E3'
          ? visible
          : template === 'E4'
            ? visible.slice(0, 2)
            : template === 'E5'
              ? pointEntry
                ? [pointEntry]
                : []
              : visible.slice(0, 1)
      if (!selected.length) continue
      const last = visible.indexOf(selected[selected.length - 1])
      if (blocked(s) || visible.slice(0, last + 1).some((e) => e.breakBefore || hasBreak(e.blocks))) {
        notes.push({ id: s.id, text: s.title + '按原引言和手动分页展示，首屏导读已收起。' })
        break
      }
      const point = pointEntry ? firstPoint(pointEntry.blocks) : undefined
      feature = { section: s, entries: selected, point, firstIndex: visible.indexOf(selected[0]) }
      const chosen = new Set(selected.map((e) => e.id))
      sections[si] = {
        ...s,
        entries: point
          ? s.entries.map((e) => (chosen.has(e.id) ? { ...e, blocks: withoutPoint(e.blocks, point.id) } : e))
          : s.entries.filter((e) => !chosen.has(e.id)),
      }
      notes.push({
        id: point?.id ?? selected[0].id,
        text: s.title + '的' + (point ? '首条要点' : selected.length + '条记录') + '已移到首页导读。',
      })
      break
    }
  }
  return { sections, name, target, contacts, feature, notes }
}
