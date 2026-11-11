import type { Resume } from './model'
import { Column, needed, wrap, plain, type Cover, type Layout, type PageLayout } from './paperText'
import { paginateTemplate } from './templatePagination'
export * from './paperText'

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
export function paginate(doc: Resume): Layout {
  if (doc.templateId && doc.templateId !== '00') return paginateTemplate(doc)
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
