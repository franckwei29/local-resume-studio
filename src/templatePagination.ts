import { printedTitle, type Entry, type Lane, type Resume, type Section, type Style } from './model'
import { getTemplate } from './templates'
import {
  Column,
  needed,
  period,
  plain,
  ptToMm,
  withLabel,
  widthOf,
  type Cover,
  type Layout,
  type PageLayout,
  type PaperLine,
  type Paragraph,
  type PositionedLine,
} from './paperText'
import { projectContent, type Feature } from './templateContent'

type Region = { x: number; width: number }
type Content = ReturnType<typeof projectContent>
const group = (lines: PaperLine[], gap = 0, keepNext = false): Paragraph => ({
  lines,
  gap,
  keepNext,
  breakBefore: false,
})
const lineHeight = (style: Style, size = style.size) => size * ptToMm * style.lineHeight
const groupHeight = (g: Paragraph) => g.lines.reduce((a, b) => a + b.height, 0)
const paperHeight = (groups: Paragraph[]) =>
  groups.reduce((h, g, i) => h + groupHeight(g) + (i ? g.gap : 0), 0)
const emptyCover: Cover = {
  title: [],
  titleTop: 0,
  titleHeight: 0,
  photoY: 0,
  curveEdge: 0,
  curveMid: 0,
  contentY: 0,
}
function rows(
  style: Style,
  width: number,
  id: string,
  text: string,
  size = style.size,
  color?: string,
  bold = false,
) {
  return new Column(style, width).rows(id, [plain(text, bold)], { size, color })
}
function shift(groups: Paragraph[], dx: number, width: number) {
  for (const g of groups)
    for (const l of g.lines) {
      l.inset = (l.inset ?? 0) + dx
      l.extent ??= width
    }
}
function tint(hex: string, weight = 0.09) {
  const n = parseInt(hex.slice(1), 16)
  return (
    'rgb(' +
    [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * weight + 255 * (1 - weight))).join(',') +
    ')'
  )
}
function darkInk(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 165 ? '#172225' : '#ffffff'
}
function art(
  page: PageLayout,
  x: number,
  y: number,
  width: number,
  height: number,
  fill?: string,
  stroke?: string,
  radius?: number,
) {
  if (width <= 0 || height <= 0) return
  ;(page.decorations ??= []).push({ x, y, width, height, fill, stroke, radius })
}
function stamp(col: Column, role: PaperLine['role']) {
  col.groups.forEach((g) => g.lines.forEach((l) => (l.role = role)))
}
/** Shared band with individually locatable sub-lines. Its height is measured before placing it. */
function parallel(cells: { groups: Paragraph[]; x: number; width: number }[], id: string): PaperLine {
  const companions: NonNullable<PaperLine['companions']> = []
  let height = 0
  for (const cell of cells) {
    let y = 0
    cell.groups.forEach((g, gi) => {
      if (gi) y += g.gap
      g.lines.forEach((l) => {
        companions.push({ line: l, x: cell.x + (l.inset ?? 0), y, width: l.extent ?? cell.width })
        y += l.height
      })
    })
    height = Math.max(height, y)
  }
  return { id, height, pieces: [], companions }
}

class RecordColumn extends Column {
  constructor(
    style: Style,
    width: number,
    readonly template: string,
    readonly sectionKind: Section['kind'],
  ) {
    super(style, width)
  }
  override entryHeader(e: Entry, title: string, subtitle: string) {
    const id = this.template,
      when = period(e),
      style = this.style,
      size = style.size
    if (id === 'A4' && when) {
      const f = e.fields
      let left = title,
        right = subtitle
      if (this.sectionKind === 'work') {
        left = f.company || ''
        right = f.role || ''
      }
      if (this.sectionKind === 'education') {
        left = f.school || ''
        right = [f.major, f.degree].filter(Boolean).join(' · ')
      }
      const parts = [
        { value: when, weight: 0.24 },
        { value: left, weight: 0.4 },
        { value: right, weight: 0.36 },
      ].filter((p) => p.value)
      const total = parts.reduce((sum, p) => sum + p.weight, 0)
      let x = 0
      const cells = parts.map((p, i) => {
        const width = (this.width * p.weight) / total
        const item = {
          x: x + 1,
          width: width - 2,
          groups: [
            group(
              rows(style, width - 2, e.id, p.value, i ? size : size - 1, i ? undefined : style.color, i > 0),
            ),
          ],
        }
        x += width
        return item
      })
      // One baseline per table row allows even a multi-page company name to wrap safely.
      const count = Math.max(...cells.map((c) => c.groups[0].lines.length))
      const tableLines: PaperLine[] = Array.from({ length: count }, (_, row) => ({
        id: e.id,
        height: lineHeight(style),
        role: 'entry',
        pieces: [],
        companions: cells
          .filter((c) => c.groups[0].lines[row])
          .map((c) => ({ line: c.groups[0].lines[row], x: c.x, y: 0, width: c.width })),
      }))
      this.groups.push(group(tableLines, 0, true))
      if (this.sectionKind === 'work') this.add(e.id, [plain(subtitle)], { color: style.color, keep: true })
      if (this.sectionKind === 'education' && f.note)
        this.add(e.id, [plain(f.note)], { color: style.color, keep: true })
      return
    }
    if ((id === 'D1' || id === 'D4') && when) {
      const rail = id === 'D1' ? 28 : 31
      const titleLines = rows(style, this.width, e.id, title, size, undefined, true)
      const dateLines = rows(style, rail - 3, e.id, when, Math.max(8, size - 1), style.color, true)
      const h = lineHeight(style)
      const out: PaperLine[] = []
      for (let i = 0; i < Math.max(titleLines.length, dateLines.length); i++) {
        const l = titleLines[i] ?? { id: e.id, height: h, pieces: [] }
        if (dateLines[i])
          l.companions = [
            { line: dateLines[i], x: id === 'D1' ? -rail : this.width + 3, y: 0, width: rail - 3 },
          ]
        out.push(l)
      }
      this.groups.push(group(out, 0, true))
      this.add(e.id, [plain(subtitle)], { color: style.color, keep: true })
      return
    }
    if (id === 'D5' && when) {
      const band = rows(style, this.width - 3, e.id, when, size - 1, style.color, true)
      band.forEach((l) => {
        l.role = 'date'
        l.pieces.forEach((p) => (p.x += 1.5))
      })
      this.groups.push(group(band, 0, true))
      this.add(e.id, [plain(title, true)], { keep: true })
      this.add(e.id, [plain(subtitle)], { color: style.color, keep: true })
      return
    }
    super.entryHeader(e, title, subtitle)
  }
}

class TemplateColumn extends Column {
  constructor(
    style: Style,
    width: number,
    readonly template: string,
    readonly lane: Lane,
  ) {
    super(style, width)
  }
  override record(s: Section, e: Entry, index: number) {
    const t = this.template
    const left =
      t === 'D1'
        ? 28
        : ['D2', 'D3'].includes(t)
          ? 6
          : t === 'F3' && s.kind === 'project'
            ? 14
            : t === 'B4' && this.lane === 'main'
              ? 2
              : 0
    const right = t === 'D4' ? 31 : t === 'B4' && this.lane === 'main' ? 2 : 0
    const col = new RecordColumn(this.style, this.width - left - right, t, s.kind)
    col.record(s, e, index)
    if (!col.groups.length) return
    shift(col.groups, left, col.width)
    for (const g of col.groups) for (const l of g.lines) l.entryId = e.id
    const first = col.groups[0].lines[0]
    first.role ??= 'entry'
    if ((t === 'D2' || t === 'D3') && period(e)) first.node = true
    if (t === 'F3' && s.kind === 'project')
      (first.companions ??= []).push({
        line: rows(
          this.style,
          12,
          e.id,
          String(index + 1).padStart(2, '0'),
          this.style.size + 3,
          this.style.color,
          true,
        )[0],
        x: -14,
        y: 0,
        width: 12,
      })
    this.groups.push(...col.groups)
  }
  appendSection(s: Section, doc: Resume) {
    const t = this.template
    const rail = t === 'A2' ? 28 : t === 'A5' ? 12 : 0
    const inset = t === 'C2' && this.lane === 'side' ? 2 : 0
    const inner = new TemplateColumn(this.style, this.width - rail - inset * 2, t, this.lane)
    inner.section(s, doc)
    if (!inner.groups.length) return false
    const heading = inner.groups[0].lines.some((l) => l.rule)
      ? inner.groups.shift()!
      : { ...group([]), breakBefore: !!s.breakBefore }
    const size = this.style.size + (t === 'F1' ? 5 : t === 'F5' ? 1.5 : 2)
    const title = printedTitle(s, doc.lang)
    shift(inner.groups, rail + inset, inner.width)
    let titleWidth = t === 'A5' ? this.style.size * ptToMm + 0.12 : rail ? rail - 3 : inner.width
    // A very long custom index title can use full measure and split normally.
    let titleRows = rows(
      this.style,
      titleWidth,
      s.id,
      title,
      rail ? this.style.size : size,
      this.style.color,
      true,
    )
    if (rail && titleRows.length > 5) {
      titleWidth = this.width
      titleRows = rows(this.style, titleWidth, s.id, title, size, this.style.color, true)
    }
    if (!titleRows.length) titleRows = [{ id: s.id, pieces: [], height: 0 }]
    titleRows.forEach((l) => {
      l.role = 'section'
      l.inset = inset
      l.extent = titleWidth
    })
    titleRows[0].anchor = s.id
    const body = inner.groups
    const start = body[0]
    if (rail && titleWidth !== this.width && start && !start.breakBefore) {
      const bandHeight = titleRows.reduce((n, l) => n + l.height, 0)
      const first = start.lines[0]
      let at = 0
      for (const l of titleRows) {
        ;(first.companions ??= []).push({ line: l, x: -(first.inset ?? rail), y: at, width: titleWidth })
        at += l.height
      }
      start.minHeight = bandHeight
      const remaining = bandHeight - paperHeight(body)
      if (remaining > 0) body.push(group([{ id: s.id, height: remaining, pieces: [] }]))
      start.breakBefore ||= heading.breakBefore
      start.gap = this.groups.length ? this.style.sectionGap : 0
    } else {
      const last = titleRows[titleRows.length - 1]
      last.height += 1.6
      if (!['D2', 'D3', 'A5', 'B1', 'C4', 'F5'].includes(t)) last.rule = true
      body.unshift({ ...heading, lines: titleRows, gap: this.groups.length ? this.style.sectionGap : 0 })
      if (start) start.gap = 1.3
    }
    for (const g of body) for (const l of g.lines) l.sectionId = s.id
    this.groups.push(...body)
    return true
  }
}

function addFeature(col: TemplateColumn, feature: Feature, doc: Resume) {
  const { style, width, template: t } = col
  const { section: s, entries, point } = feature
  const groupStart = col.groups.length
  let title = printedTitle(s, doc.lang)
  if (t === 'E5')
    title =
      (doc.lang === 'zh' ? '成果提要' : 'Highlight') +
      (entries[0].fields.name ? ' · ' + entries[0].fields.name : '')
  const titleLines = rows(style, width, s.id, title, style.size + 2, style.color, true)
  if (titleLines.length) {
    titleLines.forEach((l) => {
      l.role = 'feature'
    })
    col.groups.push(group(titleLines, 0, true))
  }
  if (t === 'E5' && point) {
    col.add(point.id, withLabel(point.label, point.runs), { size: style.size + 2, indent: 3 })
  } else if (t === 'E4' && entries.length === 2) {
    const w = (width - 5) / 2
    const cells = entries.map((e, i) => {
      const cell = new TemplateColumn(style, w - 4, t, 'main')
      cell.record(s, e, i)
      return { groups: cell.groups, x: i * (w + 5) + 2, width: w - 4 }
    })
    const band = parallel(cells, s.id)
    if (band.height + 10 < 297 - 2 * style.margin) {
      band.role = 'feature'
      col.groups.push(group([band], 2))
    } else entries.forEach((e, i) => col.record(s, e, i))
  } else if (t === 'E3') {
    let cells: Parameters<typeof parallel>[0] = [],
      used = 0
    const flush = () => {
      if (cells.length) col.groups.push(group([parallel(cells, s.id)], 1))
      cells = []
      used = 0
    }
    for (const e of entries) {
      const text = [
        e.fields.name,
        e.fields.description,
        e.fields.levelShown === 'false' ? '' : e.fields.level,
      ]
        .filter(Boolean)
        .join('：')
      const natural = widthOf(text, style.size, plain(text, true), style) + 6
      const w = Math.min(width, Math.max(18, natural))
      const cell = new TemplateColumn(style, w, t, 'main')
      cell.record(s, e, 0)
      if (paperHeight(cell.groups) > 12) {
        flush()
        col.record(s, e, 0)
        continue
      }
      if (used + w > width) flush()
      cells.push({ groups: cell.groups, x: used, width: w })
      used += w + 2
    }
    flush()
  } else {
    entries.forEach((e, i) => {
      if (t === 'E2' && e.fields.text) {
        col.add(e.id, [plain(e.fields.text)], { size: style.size + 2, indent: 3 })
        col.blocks(e.blocks)
      } else col.record(s, e, i + feature.firstIndex)
    })
  }
  col.groups.slice(groupStart).forEach((g) =>
    g.lines.forEach((l) => {
      l.sectionId = s.id
      l.featured = true
      l.role ??= 'feature'
    }),
  )
}

function headerGroups(doc: Resume, content: Content, width: number, template: string, hasPhoto: boolean) {
  const style = doc.style
  const col = new Column(style, width)
  const poster = template === 'F1',
    banner = template === 'F5',
    dark = banner || template === 'B1' || template === 'B2'
  const ink = dark ? darkInk(style.color) : style.color
  const hColor = dark ? ink : undefined
  const split = template === 'A3' || template === 'F4' || template === 'C3'
  const mainW = split ? width * 0.51 : width
  const identity = new Column(style, mainW)
  const role = content.target?.text
  const title = doc.useTarget && role ? role : doc.title
  const name = content.name
  if (name)
    identity.add(name.id, [plain(name.text, true)], {
      size: style.size + (poster ? 15 : 8),
      color: ink,
      keep: true,
    })
  if (title.trim() && title !== name?.text)
    identity.add(doc.useTarget && role ? content.target!.id : 'header', [plain(title, true)], {
      size: style.size + (name ? 1 : 7),
      color: ink,
      keep: true,
    })
  if (role && role !== title)
    identity.add(content.target!.id, [plain(role)], { size: style.size + 1, color: ink, keep: true })
  const contactWidth = split ? width - mainW - 6 : width
  const contacts = new Column(style, contactWidth)
  if (hasPhoto) {
    const dest = template === 'C3' ? contacts : identity
    const size = template === 'C3' ? 18 : Math.min(36, width - 1)
    dest.groups.unshift(
      group([
        {
          id: 'header',
          height: (template === 'B4' ? size * 0.82 : size) + 3,
          pieces: [],
          extent: size,
          portrait: true,
        },
      ]),
    )
  }
  const cells: Parameters<typeof parallel>[0] = []
  let used = 0
  const flush = () => {
    if (cells.length) contacts.groups.push(group([parallel(cells, 'header')], 0.5))
    cells.length = 0
    used = 0
  }
  for (const c of content.contacts) {
    const size = Math.max(8, style.size - 1)
    const text: import('./model').Run = { text: c.text, href: c.href }
    const w = Math.min(contactWidth, Math.max(9, widthOf(c.text, size, text, style) + 0.5))
    const lines = new Column(style, w).rows(c.id, [text], { size, color: hColor })
    if (w + used > contactWidth) flush()
    if (lines.length > 2) {
      flush()
      contacts.groups.push(group(lines, 0.5))
      continue
    }
    cells.push({ groups: [group(lines)], x: used, width: w })
    used += w + 3
  }
  flush()
  if (
    split &&
    identity.groups.length &&
    contacts.groups.length &&
    Math.max(paperHeight(identity.groups), paperHeight(contacts.groups)) < 78
  ) {
    col.groups.push(
      group([
        parallel(
          [
            { groups: identity.groups, x: 0, width: mainW },
            { groups: contacts.groups, x: mainW + 6, width: contactWidth },
          ],
          'header',
        ),
      ]),
    )
  } else {
    if (split) shift(contacts.groups, 0, contactWidth)
    col.groups.push(...identity.groups, ...contacts.groups)
  }
  stamp(col, 'header')
  if (template === 'A1') {
    const center = (l: PaperLine, w: number) => {
      if (!l.pieces.length && l.companions?.length) {
        const total = Math.max(...l.companions.map((c) => c.x + c.width))
        l.companions.forEach((c) => (c.x += (w - total) / 2))
      } else {
        const measured = Math.max(0, ...l.pieces.map((p) => p.x + widthOf(p.text, p.size, p, style)))
        l.pieces.forEach((p) => (p.x += (w - measured) / 2))
      }
    }
    col.groups.forEach((g) => g.lines.forEach((l) => center(l, width)))
  }
  if (col.groups.length) col.groups.at(-1)!.keepNext = false
  return col.groups
}

function addIndex(col: TemplateColumn, sections: Section[], doc: Resume) {
  if (!sections.length) return
  const w = (col.width - 6) / 3,
    size = Math.max(8, col.style.size - 1)
  const tiles = sections.slice(0, 6).map((s, i) => {
    const label =
      i === 5 && sections.length > 6
        ? doc.lang === 'en'
          ? sections.length - 5 + ' more sections'
          : '另有 ' + (sections.length - 5) + ' 章'
        : printedTitle(s, doc.lang)
    let str = label
    if (widthOf(label, size, plain(label, true), col.style) > w - 2) {
      const chars = Array.from(label)
      let lo = 0,
        hi = chars.length
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2),
          prefix = chars.slice(0, mid).join('') + '…'
        if (widthOf(prefix, size, plain(prefix, true), col.style) <= w - 2) lo = mid
        else hi = mid - 1
      }
      str = chars.slice(0, lo).join('') + '…'
    }
    const line: PaperLine = {
      id: s.id,
      role: 'directory',
      pieces: [{ text: str, targetId: s.id, x: 1, size, bold: true, color: col.style.color }],
      height: 6,
    }
    return { groups: [group([line])], x: (i % 3) * (w + 3), width: w }
  })
  for (let i = 0; i < tiles.length; i += 3) {
    const row = parallel(tiles.slice(i, i + 3), 'header')
    row.role = 'directory'
    col.groups.push(group([row], 1))
  }
}

type Cursor = { page: number; y: number; used: boolean }
function place(
  groups: Paragraph[],
  pages: PageLayout[],
  lane: Lane,
  region: Region,
  start: Cursor,
  top: number,
  bottom: number,
): Cursor {
  let { page, y, used } = start
  const next = () => {
    page++
    pages[page] ??= { lines: [] }
    y = top
    used = false
  }
  const emit = (l: PaperLine, x: number, at: number, width: number, inherited?: PaperLine) => {
    if (l.portrait) {
      const frame = l.extent ?? width
      pages[page].portrait = { x, y: at, width: frame, height: l.height - 3 }
    }
    // Cells have their own source IDs and coordinates (headers, education cards, ledger rows).
    const { companions, ...line } = l
    const placed = {
      ...line,
      x,
      y: at,
      width,
      lane,
      role: line.role ?? inherited?.role,
      entryId: line.entryId ?? inherited?.entryId,
      featured: line.featured || inherited?.featured,
      sectionId: line.sectionId ?? inherited?.sectionId,
    }
    if (line.pieces.length || line.image || line.portrait || line.anchor || line.node || line.role)
      pages[page].lines.push(placed)
    for (const c of companions ?? []) emit(c.line, x + c.x, at + c.y, c.width, placed)
  }
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi]
    if (used && g.breakBefore) next()
    const space = used ? g.gap : 0
    const min = Math.max(g.minHeight ?? 0, needed(groups, gi, bottom - top))
    // If an exceptionally long keep chain exceeds a whole page, let its text flow from here.
    if (used && min <= bottom - top && y + space + min > bottom) next()
    else y += space
    for (const l of g.lines) {
      if (used && y + l.height > bottom + 0.001) next()
      emit(l, region.x + (l.inset ?? 0), y, l.extent ?? region.width)
      y += l.height
      used = true
    }
  }
  return { page, y, used }
}

function regionFrames(style: Style, cols: 'single' | 'left' | 'right', id: string) {
  const m = style.margin,
    width = 210 - 2 * m
  if (cols === 'single') return { side: { x: m, width: 0 }, main: { x: m, width } }
  const side = (width - 6) * (id === 'C5' ? 0.46 : 0.3),
    main = width - 6 - side
  return {
    side: { x: cols === 'left' ? m : m + main + 6, width: side },
    main: { x: cols === 'left' ? m + side + 6 : m, width: main },
  }
}
function bounds(lines: PositionedLine[]) {
  return { top: Math.min(...lines.map((l) => l.y)), bottom: Math.max(...lines.map((l) => l.y + l.height)) }
}
function clusters(lines: PositionedLine[], key: 'sectionId' | 'entryId') {
  const groups = new Map<string, PositionedLine[]>()
  for (const l of lines) {
    const id = l[key]
    if (!id) continue
    const items = groups.get(id) ?? []
    items.push(l)
    groups.set(id, items)
  }
  return groups.values()
}

function decorate(
  doc: Resume,
  pages: PageLayout[],
  regions: ReturnType<typeof regionFrames>,
  template: string,
  columns: 'single' | 'left' | 'right',
) {
  const { margin: m, color } = doc.style,
    side = regions.side,
    main = regions.main
  const pale = tint(color),
    mid = tint(color, 0.28),
    divider = columns === 'left' ? side.x + side.width + 3 : main.x + main.width + 3
  const seen = new Set<string>()
  const sources = new Map(doc.sections.map((s) => [s.id, s]))
  pages.forEach((page, pageIndex) => {
    const lines = page.lines
    const header = lines.filter((l) => l.role === 'header')
    const headerBottom = header.length ? bounds(header).bottom : 0
    if (template === 'B1') art(page, 0, 0, divider, 297, color)
    if (template === 'B2' && header.length) art(page, 0, 0, divider, headerBottom + 3, color)
    if (template === 'B3' || template === 'C5') art(page, divider, m, 0.35, 297 - 2 * m, mid)
    if (template === 'B4') art(page, 0, 0, divider, 297, pale)
    if (template === 'C1') art(page, divider, 0, 210 - divider, 297, pale)
    if (template === 'C3' && header.length) art(page, 105, m - 2, 105 - m, headerBottom - m + 4, pale)
    if (template === 'B5' && header.length) art(page, m, headerBottom + 1, 210 - 2 * m, 0.75, color)
    if (template === 'F5') {
      if (header.length) art(page, 0, 0, 210, headerBottom + 3, color)
      else art(page, 0, 0, 210, 2, color)
    }
    if (template === 'F1') {
      art(page, m, pageIndex ? m - 3 : m - 1, 210 - 2 * m, 0.35, color)
      if (header.length) {
        art(page, m, headerBottom + 1, 210 - 2 * m, 0.6, color)
        art(page, m, headerBottom + 2.2, 210 - 2 * m, 0.2, color)
      }
    }
    if (['A1', 'A3', 'F4'].includes(template) && header.length)
      art(page, m, headerBottom + 1, 210 - 2 * m, 0.4, color)
    if (['A3', 'F4'].includes(template) && header.length)
      art(page, m + (210 - 2 * m) * 0.51 + 3, m, 0.3, Math.max(3, headerBottom - m), mid)
    if (template === 'D2') {
      const body = lines.filter((l) => l.entryId)
      if (body.length) {
        const r = bounds(body)
        art(page, main.x + 2, r.top, 0.4, r.bottom - r.top, mid)
      }
    }
    for (const l of lines) {
      if (template === 'B1' && l.lane === 'side') l.pieces.forEach((p) => (p.color = darkInk(color)))
      if (l.node) art(page, main.x + 1, l.y + 1.4, 2.4, 2.4, color, undefined, 1.2)
      if (template === 'A5' && l.role === 'section' && l.width < 8) {
        art(page, l.x - 0.6, l.y, l.width + 1.2, l.height + 0.03, color)
        l.pieces.forEach((p) => (p.color = darkInk(color)))
      }
      if (l.role === 'date' && template === 'D5') art(page, l.x, l.y, l.width, l.height, pale)
      if (l.role === 'entry' && template === 'A4' && l.companions === undefined && !l.pieces.length)
        art(page, l.x, l.y, l.width, l.height, pale)
      if (l.role === 'section' && template === 'C4' && l.lane === 'side')
        art(page, l.x, l.y - 1.2, 8, 0.6, color)
      if (l.role === 'section' && template === 'F5') art(page, l.x - 2, l.y, 0.8, l.height, color)
      if (l.role === 'directory' && l.pieces.length) art(page, l.x, l.y, l.width, l.height, pale)
      if (template === 'B3' && l.lane === 'side' && l.entryId)
        art(page, l.x, l.y + l.height, l.width, 0.18, mid)
    }
    const featured = lines.filter((l) => l.featured && (l.pieces.length || l.entryId))
    if (featured.length) {
      const r = bounds(featured)
      if (template === 'E2' || template === 'E5') art(page, m - 1, r.top, 1.1, r.bottom - r.top, color)
      if (template === 'E3') art(page, m - 1, r.top, main.width + 2, r.bottom - r.top + 1, pale)
      if (template === 'E1') art(page, m, r.top - 1, main.width, 0.9, color)
      if (template === 'E4') {
        const cells = lines.filter((l) => l.featured && l.entryId)
        for (const part of clusters(cells, 'entryId')) {
          const b = bounds(part)
          const x = Math.min(...part.map((l) => l.x)),
            width = Math.max(...part.map((l) => l.width))
          art(page, x - 1, b.top - 0.4, width + 2, b.bottom - b.top + 0.8, pale)
        }
      }
    }
    for (const part of clusters(
      lines.filter((l) => l.role !== 'feature' && l.role !== 'directory'),
      'sectionId',
    )) {
      const first = part[0],
        s = sources.get(first.sectionId!)
      if (!s) continue
      const r = bounds(part)
      if (template === 'C2' && first.lane === 'side')
        art(page, side.x - 1, r.top - 0.6, side.width + 2, r.bottom - r.top + 1.2, undefined, mid)
      if (template === 'D3') {
        art(page, main.x + 2, r.top + 1, 0.45, r.bottom - r.top - 1, mid)
      }
      if ((template === 'A2' || template === 'A5') && !part.some((l) => l.anchor) && seen.has(s.id)) {
        const w = template === 'A2' ? 25 : 10,
          size = Math.min(9, doc.style.size)
        const suffix = doc.lang === 'zh' ? '续' : 'cont.'
        const title =
          (template === 'A2' ? Array.from(printedTitle(s, doc.lang)).slice(0, 4).join('') + ' · ' : '') +
          suffix
        const continuation = rows(doc.style, w, s.id, title, size, color, true)
        let at = r.top
        for (const l of continuation) {
          lines.push({ ...l, role: 'continuation', x: main.x, y: at, width: w, lane: 'main' })
          at += l.height
        }
      }
      if (template === 'A5' && seen.has(s.id))
        art(page, main.x - 1.2, r.top, 0.4, Math.min(6, r.bottom - r.top), color)
      seen.add(s.id)
    }
    if (template === 'B4') {
      for (const part of clusters(
        lines.filter((l) => l.lane === 'main'),
        'entryId',
      )) {
        const r = bounds(part)
        art(page, main.x, r.top - 0.4, main.width, r.bottom - r.top + 0.8, undefined, mid)
      }
    }
  })
}

export function paginateTemplate(doc: Resume): Layout {
  const spec = getTemplate(doc.templateId),
    t = spec.id,
    columns = spec.columns
  const content = projectContent(doc, t)
  const pages: PageLayout[] = [{ lines: [] }]
  const { margin: m } = doc.style,
    bottom = 297 - m - (doc.style.pageNumbers ? 4 : 0)
  const regions = regionFrames(doc.style, columns, t)
  const headerLane = columns === 'left' && t !== 'B5' ? 'side' : 'main'
  const across = t === 'B5' || t === 'C3'
  const hWidth = across ? 210 - 2 * m : regions[headerLane].width
  const head = headerGroups(doc, content, hWidth, t, spec.photo && !!doc.photo)
  const first: Cursor = { page: 0, y: m, used: false }
  let afterHeader = first
  if (across && head.length) {
    afterHeader = place(head, pages, 'main', { x: m, width: hWidth }, first, m, bottom)
    afterHeader = { ...afterHeader, y: afterHeader.y + 6 }
  }
  for (const lane of (columns === 'single' ? ['main'] : ['main', 'side']) as Lane[]) {
    const col = new TemplateColumn(doc.style, regions[lane].width, t, lane)
    const visible: Section[] = []
    for (const s of content.sections.filter((s) => columns === 'single' || s.lane === lane)) {
      if (col.appendSection(s, doc)) visible.push(s)
    }
    if (t === 'F2' || content.feature) {
      const prefix = new TemplateColumn(doc.style, regions[lane].width, t, lane)
      if (content.feature) addFeature(prefix, content.feature, doc)
      if (t === 'F2') addIndex(prefix, visible, doc)
      if (prefix.groups.length && col.groups.length) col.groups[0].gap += doc.style.sectionGap
      col.groups.unshift(...prefix.groups)
    }
    if (!across && lane === headerLane && head.length) {
      if (col.groups.length) col.groups[0].gap += 6
      col.groups.unshift(...head)
    }
    place(col.groups, pages, lane, regions[lane], afterHeader, m, bottom)
  }
  decorate(doc, pages, regions, t, columns)
  const featuredIds = content.feature?.point
    ? [content.feature.point.id]
    : (content.feature?.entries.map((e) => e.id) ?? [])
  return { pages, cover: emptyCover, notes: content.notes, featuredIds }
}
