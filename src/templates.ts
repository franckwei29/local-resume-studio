import catalog from '../electron/templates.json'
import { defaults } from './model'
import type { Kind, Lane, Resume, Section, Style, TemplateLayout } from './model'

export interface Template {
  id: string
  name: string
  family: string
  columns: 'single' | 'left' | 'right'
  photo: boolean
  detail: string
}
export const templateFamilies: Record<string, string> = {
  '0': '原稿',
  A: '正式单栏',
  B: '左侧栏',
  C: '右侧栏',
  D: '时间履历',
  E: '重点前置',
  F: '编辑出版',
}
const photos = new Set(['00', 'B1', 'B2', 'B4', 'C3'])
export const templates: Template[] = catalog.map((item) => {
  const family = item.id[0]
  return {
    ...item,
    family,
    columns: family === 'C' ? 'right' : family === 'B' || family === '0' ? 'left' : 'single',
    photo: photos.has(item.id),
  }
})
const byId = new Map(templates.map((template) => [template.id, template]))
export function getTemplate(id = '00'): Template {
  const template = byId.get(id)
  if (!template) throw new Error('当前版本无法读取模板 ' + id + '，请更新简历工坊。')
  return template
}
const colors: Record<string, string> = {
  A: '#414a47',
  B: '#35524b',
  C: '#374d60',
  D: '#6e4c37',
  E: '#3f5767',
  F: '#634148',
}
export function templateDefaults(id = '00'): Style {
  if (id === '00') return { ...defaults }
  const { family } = getTemplate(id)
  return {
    ...defaults,
    margin: 12,
    color: colors[family],
    font: ['F1', 'F2', 'A1'].includes(id) ? 'serif' : 'sans',
  }
}

const sideKinds = new Set<Kind>(['personal', 'target', 'evaluation', 'skills', 'language'])
function defaultLane(kind: Kind, template: Template): Lane {
  return template.columns !== 'single' && sideKinds.has(kind) ? 'side' : 'main'
}
function inLane(section: Section, lane: Lane): Section {
  return section.lane === lane ? section : { ...section, lane }
}
function firstLayout(doc: Resume, from: Template, to: Template): Section[] {
  if (to.columns !== 'single') {
    return from.columns === 'single'
      ? doc.sections.map((s) => inLane(s, defaultLane(s.kind, to)))
      : doc.sections.slice()
  }
  const source =
    from.columns === 'single'
      ? doc.sections
      : [...doc.sections.filter((s) => s.lane === 'main'), ...doc.sections.filter((s) => s.lane === 'side')]
  const ordered =
    to.id === 'F3'
      ? [...source.filter((s) => s.kind === 'project'), ...source.filter((s) => s.kind !== 'project')]
      : source
  return ordered.map((s) => inLane(s, 'main'))
}
function restoreLayout(source: Section[], layout: TemplateLayout, template: Template): Section[] {
  const remaining = new Map(source.map((s) => [s.id, s]))
  const sections: Section[] = []
  for (const { id, lane } of layout.sections) {
    const section = remaining.get(id)
    if (!section) continue
    sections.push(inLane(section, lane))
    remaining.delete(id)
  }
  for (const s of remaining.values()) {
    const lane = defaultLane(s.kind, template)
    const sameKind = sections.findLastIndex((item) => item.lane === lane && item.kind === s.kind)
    const previous = sameKind >= 0 ? sameKind : sections.findLastIndex((item) => item.lane === lane)
    sections.splice(previous < 0 ? sections.length : previous + 1, 0, inLane(s, lane))
  }
  return sections
}

/** Project onto another layout. Only the caller's explicit Apply records this value in the session. */
export function switchTemplate(doc: Resume, id: string): Resume {
  const current = getTemplate(doc.templateId),
    target = getTemplate(id)
  if (current.id === target.id) return doc
  const layouts = { ...doc.templateLayouts }
  const previous = layouts[target.id]
  delete layouts[target.id]
  layouts[current.id] = {
    version: 1,
    style: { ...doc.style },
    sections: doc.sections.map(({ id, lane }) => ({ id, lane })),
  }
  return {
    ...doc,
    schemaVersion: 2,
    templateId: target.id,
    templateVersion: 1,
    templateLayouts: layouts,
    sections: previous ? restoreLayout(doc.sections, previous, target) : firstLayout(doc, current, target),
    style: previous ? { ...previous.style } : templateDefaults(target.id),
  }
}

/** Remove a deleted section's placement without mutating the snapshots retained by Undo. */
export function forgetTemplateSection(doc: Resume, sectionId: string) {
  doc.templateLayouts = Object.fromEntries(
    Object.entries(doc.templateLayouts).map(([id, layout]) => [
      id,
      { ...layout, sections: layout.sections.filter((s) => s.id !== sectionId) },
    ]),
  )
}
