import {
  printedTitle,
  type Block,
  type Entry,
  type Lane,
  type Resume,
  type Run,
  type Section,
  type Style,
} from './model'

export const mmToPx = 96 / 25.4
const ptToMm = 25.4 / 72
export const fontFamily = (style: Style) =>
  style.font === 'sans' ? 'Noto Sans SC Variable' : 'Noto Serif SC Variable'
export interface Piece extends Run {
  x: number
  size: number
  color?: string
  alignRight?: boolean
}
export interface PaperLine {
  id: string
  height: number
  pieces: Piece[]
  rule?: boolean
  icon?: string
  image?: string
}
interface Paragraph {
  lines: PaperLine[]
  gap: number
  keepNext: boolean
  breakBefore: boolean
}
export interface PositionedLine extends PaperLine {
  x: number
  y: number
  width: number
  lane: Lane
}
export interface PageLayout {
  lines: PositionedLine[]
}
export interface Cover {
  title: string[]
  titleTop: number
  titleHeight: number
  photoY: number
  curveEdge: number
  curveMid: number
  contentY: number
}
export interface Layout {
  pages: PageLayout[]
  cover: Cover
}
let context: CanvasRenderingContext2D | null = null
const widthCache = new Map<string, number>()
export function resetMeasurementCache() {
  widthCache.clear()
}
function widthOf(text: string, size: number, run: Run, style: Style) {
  if (!context) context = document.createElement('canvas').getContext('2d')
  if (!context) throw new Error('无法读取本机字体度量')
  const font =
    (run.italic ? 'italic ' : '') +
    (run.bold ? '700 ' : '400 ') +
    (size * 96) / 72 +
    'px "' +
    fontFamily(style) +
    '"'
  const key = font + '\u0000' + text
  let w = widthCache.get(key)
  if (w === undefined) {
    context.font = font
    w = context.measureText(text).width / mmToPx
    if (widthCache.size > 70000) widthCache.clear()
    widthCache.set(key, w)
  }
  return w
}
const same = (a: Run, b: Run) =>
  a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.href === b.href
// Preserve Latin words when possible. Splitting an oversized token by Unicode code point
// guarantees forward progress even for a pasted URL that is wider than a whole column.
function wrap(runs: Run[], width: number, size: number, style: Style): Run[][] {
  const rows: Run[][] = []
  let line: Run[] = []
  let used = 0
  const flush = () => {
    rows.push(line)
    line = []
    used = 0
  }
  function add(t: string, r: Run, w: number) {
    const last = line.at(-1)
    if (last && same(last, r)) last.text += t
    else line.push({ ...r, text: t })
    used += w
  }
  for (const r of runs) {
    const tokens =
      r.text
        .replace(/\r\n?/g, '\n')
        .match(/\n|[^\S\n]+|[\p{Script=Latin}\p{Number}]+(?:[.\-'][\p{Script=Latin}\p{Number}]+)*|[^]/gu) ||
      []
    const joined: string[] = []
    for (const token of tokens) {
      if (/^[，。！？、；：,.!?;:%）)》〉」』】]$/u.test(token) && joined.length && joined.at(-1) !== '\n')
        joined[joined.length - 1] += token
      else if (joined.length && /[（(《〈「『【]$/u.test(joined.at(-1)!)) joined[joined.length - 1] += token
      else joined.push(token)
    }
    for (const t of joined) {
      if (t === '\n') {
        flush()
        continue
      }
      const w = widthOf(t, size, r, style)
      if (w > width) {
        for (const c of t) {
          const cw = widthOf(c, size, r, style)
          if (line.length && used + cw > width) flush()
          add(c, r, cw)
        }
      } else {
        if (line.length && used + w > width) flush()
        add(t, r, w)
      }
    }
  }
  if (line.length) flush()
  return rows
}
const plain = (text: string, bold = false): Run => ({ text, ...(bold ? { bold: true } : {}) })
const nonblank = (r: Run[]) => r.some((x) => x.text.trim())
const printableBlock = (b: Block): boolean =>
  !b.hidden && (nonblank(b.runs) || b.children.some(printableBlock))
const withLabel = (label: string, runs: Run[]): Run[] =>
  label ? [plain(label + (runs.some((r) => r.text) ? '：' : ''), true), ...runs] : runs
function date(value: string) {
  const m = /^(\d{4})-(\d\d)$/.exec(value)
  return m ? m[1] + '年' + m[2] + '月' : value
}
function period(e: Entry) {
  if (e.start && e.end && !e.current && e.start > e.end) return ''
  const from = date(e.start),
    to = e.current ? '至今' : date(e.end)
  return from && to ? from + '—' + to : from || (to ? (e.current ? to : '截至 ' + to) : '')
}
type Options = {
  gap?: number
  indent?: number
  mark?: string
  bold?: boolean
  keep?: boolean
  lineHeight?: number
  color?: string
  size?: number
  breakBefore?: boolean
  icon?: string
}
class Column {
  groups: Paragraph[] = []
  constructor(
    readonly style: Style,
    readonly width: number,
  ) {}
  rows(id: string, runs: Run[], opts: Options = {}): PaperLine[] {
    const { style } = this
    const size = opts.size ?? style.size
    const indent = opts.indent ?? 0
    if (!nonblank(runs)) return []
    return wrap(runs, this.width - indent, size, style).map((row, i) => {
      let x = indent
      const pieces: Piece[] = row.map((r) => {
        const effective = opts.bold ? { ...r, bold: true } : r
        const piece = { ...effective, x, size, color: opts.color }
        x += widthOf(r.text, size, effective, style)
        return piece
      })
      if (!i && opts.mark) pieces.unshift({ ...plain(opts.mark), x: 0, size })
      return {
        id,
        height: opts.lineHeight ?? size * ptToMm * style.lineHeight,
        pieces,
        icon: i === 0 ? opts.icon : undefined,
      }
    })
  }
  add(id: string, runs: Run[], opts: Options = {}) {
    const lines = this.rows(id, runs, opts)
    if (lines.length)
      this.groups.push({ lines, gap: opts.gap ?? 0, keepNext: !!opts.keep, breakBefore: !!opts.breakBefore })
  }
  blocks(blocks: Block[], depth = 0) {
    let number = 0
    for (const b of blocks.filter(printableBlock)) {
      if (b.type === 'number') number++
      else number = 0
      const first = this.groups.length
      const isList = b.type === 'bullet' || b.type === 'number'
      const indent = Math.min(depth, 2) * 1.3 + (isList ? 6 : 0)
      const runs = withLabel(b.label, b.runs)
      this.add(b.id, b.type === 'group' ? runs.map((r) => ({ ...r, bold: true })) : runs, {
        indent,
        mark: b.type === 'bullet' ? '•' : b.type === 'number' ? number + '.' : undefined,
        gap: this.style.paragraphGap * (isList ? 0.03 : 0.34),
        keep: b.type === 'group',
      })
      if (b.children.length) this.blocks(b.children, depth + (b.type === 'group' ? 0 : 1))
      if (this.groups[first] && b.breakBefore) this.groups[first].breakBefore = true
    }
  }
  entryHeader(e: Entry, title: string, subtitle: string) {
    const when = period(e),
      size = this.style.size
    const header = plain(title, true),
      dateRun = plain(when, true),
      dw = widthOf(when, size, dateRun, this.style)
    const available = this.width - (when ? dw + 3 : 0)
    const stack = !!when && !!title && available < 8 * size * ptToMm
    const titleWidth = stack ? this.width : available
    const h = size * ptToMm * this.style.lineHeight
    const lines: PaperLine[] = wrap([header], Math.max(titleWidth, 1), size, this.style).map((runs) => ({
      id: e.id,
      height: h,
      pieces: runs.map((r) => ({ ...r, x: 0, size })),
    }))
    if (when) {
      if (dw > this.width) {
        for (const row of wrap([dateRun], this.width, size, this.style)) {
          const text = row.map((r) => r.text).join('')
          lines.push({
            id: e.id,
            height: h,
            pieces: [
              {
                ...dateRun,
                text,
                x: this.width - widthOf(text, size, dateRun, this.style),
                size,
                alignRight: true,
              },
            ],
          })
        }
      } else {
        if (stack || !lines.length) lines.push({ id: e.id, height: h, pieces: [] })
        lines[stack ? lines.length - 1 : 0].pieces.push({
          ...dateRun,
          x: this.width - dw,
          size,
          alignRight: true,
        })
      }
    }
    if (lines.length) this.groups.push({ lines, gap: 0, keepNext: true, breakBefore: false })
    this.add(e.id, [plain(subtitle)], { color: this.style.color, keep: true })
  }
  record(s: Section, e: Entry, index: number) {
    const f = e.fields
    switch (s.kind) {
      case 'personal': {
        let value = f.value || ''
        if (f.icon === 'birthday') value = value.replace(/^(\d{4})-0?(\d+)-0?(\d+)$/, '$1年$2月$3日')
        const known = ['name', 'email', 'phone', 'location', 'birthday', 'website', 'linkedin']
        const custom = !known.includes(f.icon) && f.label
        const displayed = custom && value ? f.label + '：' + value : value
        this.add(e.id, [plain(displayed)], { indent: 8, icon: f.icon || 'other' })
        break
      }
      case 'education':
        this.entryHeader(
          e,
          [f.major, f.degree].filter(Boolean).join(' | '),
          (f.school || '') + (f.note ? '（' + f.note + '）' : ''),
        )
        break
      case 'work':
        this.entryHeader(
          e,
          (f.role || '') + (f.company ? '(' + f.company + ')' : ''),
          [f.subtitle, f.city].filter(Boolean).join(' · '),
        )
        break
      case 'project':
        this.entryHeader(e, (f.name || '') + (f.note ? ' (' + f.note + ')' : ''), f.source || '')
        break
      case 'evaluation':
        if (f.text) this.add(e.id, [plain((f.numbered === 'false' ? '' : index + 1 + '、') + f.text)])
        break
      case 'skills':
      case 'language': {
        const level = f.levelShown === 'false' ? '' : f.level
        const text = [f.description, level].filter(Boolean).join('　')
        this.add(e.id, withLabel(f.name || '', [plain(text)]), { mark: '•', indent: 4 })
        break
      }
      case 'signature':
        if (f.mode === 'image' && f.image)
          this.groups.push({
            lines: [{ id: e.id, height: 12, image: f.image, pieces: [] }],
            gap: 0,
            keepNext: false,
            breakBefore: false,
          })
        else this.add(e.id, [plain(f.name || '')])
        this.add(e.id, [plain(f.date || '')])
        break
      case 'custom':
        if (f.format === 'dated') {
          this.entryHeader(e, f.name || '', f.organization || '')
          this.add(e.id, [plain(f.description || '')])
        } else if (f.format === 'paragraph') this.add(e.id, [plain(f.description || '')])
        else this.add(e.id, withLabel(f.name || '', [plain(f.description || '')]))
        break
    }
    this.blocks(e.blocks)
  }
  section(s: Section, doc: Resume) {
    if (s.hidden) return
    const initial = this.groups.length
    this.blocks(s.intro)
    if (s.kind === 'target') this.add(s.id, [plain(doc.target)])
    let index = 0
    for (const e of s.entries.filter((e) => !e.hidden)) {
      const before = this.groups.length
      this.record(s, e, index)
      if (this.groups.length === before) continue
      const gap =
        s.kind === 'personal'
          ? 3.9
          : s.kind === 'skills'
            ? 0
            : s.kind === 'evaluation'
              ? this.style.itemGap + 1.2
              : this.style.itemGap
      if (before > initial) this.groups[before].gap += gap
      this.groups[before].breakBefore ||= !!e.breakBefore
      this.groups.at(-1)!.keepNext = false
      index++
    }
    const bodyEnd = this.groups.length
    this.blocks(s.ending)
    if (this.groups.length > bodyEnd && bodyEnd > initial)
      this.groups[bodyEnd].gap += this.style.itemGap + 1.5
    if (this.groups.length === initial) return
    const title = printedTitle(s, doc.lang)
    const lines = this.rows(s.id, [plain(title)], { size: 17, color: this.style.color, lineHeight: 7.8 })
    if (!lines.length) return
    lines.at(-1)!.height += 2
    lines.at(-1)!.rule = true
    const first = this.groups[initial]
    const breakBefore = !!s.breakBefore || first.breakBefore
    first.breakBefore = false
    first.gap += 2.6
    this.groups.splice(initial, 0, {
      lines,
      gap: initial ? this.style.sectionGap : 0,
      keepNext: true,
      breakBefore,
    })
  }
}
function getCover(doc: Resume): Cover {
  const text = doc.useTarget && doc.target.trim() ? doc.target : doc.title
  const title = wrap([plain(text, true)], 60, 15, doc.style).map((l) => l.map((r) => r.text).join(''))
  const extra = Math.max(0, title.length - 1) * 6.5
  const photoY = (title.length ? 23 : 10) + extra
  return {
    title,
    titleTop: 10.2,
    titleHeight: 6.5,
    photoY,
    curveEdge: 34 + extra,
    curveMid: 43 + extra,
    contentY: doc.photo ? photoY + 46.5 : title.length ? 44 + extra : 11,
  }
}
function needed(groups: Paragraph[], start: number, height: number) {
  let result = 0
  for (let i = start; i < groups.length; i++) {
    const group = groups[i]
    if (i > start && group.breakBefore) break
    if (i > start) result += group.gap
    const n = group.keepNext || group.lines.length <= 4 ? group.lines.length : 2
    result += group.lines.slice(0, n).reduce((h, line) => h + line.height, 0)
    if (!group.keepNext || result > height) break
  }
  return result
}
export function paginate(doc: Resume): Layout {
  const cover = getCover(doc),
    pages: PageLayout[] = [{ lines: [] }]
  const margin = doc.style.margin
  for (const lane of ['side', 'main'] as const) {
    const x = (lane === 'side' ? 2 : 72) + margin
    const width = (lane === 'side' ? 70 : 137) - 2 * margin
    const col = new Column(doc.style, width)
    for (const s of doc.sections.filter((s) => s.lane === lane)) col.section(s, doc)
    let page = 0,
      used = false
    const top = () => (page === 0 ? (lane === 'side' ? cover.contentY : 11.3) : 9.4) + margin - 5
    const bottom = (lane === 'side' ? 282 : 286) - (margin - 5)
    let y = top()
    const nextPage = () => {
      page++
      pages[page] ??= { lines: [] }
      used = false
      y = top()
    }
    for (let gi = 0; gi < col.groups.length; gi++) {
      const group = col.groups[gi]
      if (used && group.breakBefore) nextPage()
      const gap = used ? group.gap : 0
      const min = needed(col.groups, gi, bottom - 9.4)
      if (used && y + gap + min > bottom) nextPage()
      else y += gap
      let i = 0
      while (i < group.lines.length) {
        let n = 0,
          h = 0
        while (i + n < group.lines.length && y + h + group.lines[i + n].height <= bottom + 0.001) {
          h += group.lines[i + n].height
          n++
        }
        const left = group.lines.length - i
        if (used && n < left && ((left <= 4 && i === 0) || n < 2)) {
          nextPage()
          continue
        }
        if (n > 2 && left - n === 1) n--
        if (n === 0) {
          if (used) {
            nextPage()
            continue
          }
          n = 1
        }
        for (let j = 0; j < n; j++) {
          const line = group.lines[i++]
          pages[page].lines.push({ ...line, x, y, width, lane })
          y += line.height
          used = true
        }
        if (i < group.lines.length) nextPage()
      }
    }
  }
  return { cover, pages }
}
