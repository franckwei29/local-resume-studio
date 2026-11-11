import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronLeft, ChevronRight, Columns2, Search, X } from 'lucide-react'
import { Paper } from './layout'
import { exportIssue } from './document'
import type { Layout } from './pagination'
import { printedTitle, type Block, type Resume } from './model'
import { getTemplate, switchTemplate, templateFamilies, templates, type Template } from './templates'
import './templatePicker.css'

const columnNames = { single: '单栏', left: '左侧栏', right: '右侧栏' }
const paperWidth = (210 * 96) / 25.4
const atlas = new URL('./assets/template-atlas.webp', import.meta.url).href
const atlasIds = templates.map((t) => t.id).sort()
type Pane = 'current' | 'candidate'
type Measured = { doc: Resume; layout: Layout }
type Notice = { id: string; text: string }

// IPC returns a fresh object after each successful save; only editable data affects the sheet.
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && sameValue(a[k], b[k]))
  )
}
function sameDraft(a: Resume, b: Resume) {
  const { revision: _ar, modified: _am, ...previous } = a
  const { revision: _br, modified: _bm, ...incoming } = b
  return sameValue(previous, incoming)
}

function pageFor(layout: Layout | undefined, id?: string | null) {
  if (!id || id === 'header' || !layout) return 0
  const section = layout.pages.findIndex((p) => p.lines.some((line) => line.anchor === id))
  if (section >= 0) return section
  const item = layout.pages.findIndex((p) =>
    p.lines.some((line) => line.id === id && line.role !== 'directory'),
  )
  return Math.max(0, item)
}

function notesFor(doc: Resume, next: Resume, current: Layout, candidate: Layout) {
  const notes: Notice[] = []
  const previous = getTemplate(doc.templateId),
    selected = getTemplate(next.templateId)
  const place = (template: Template, section: Resume['sections'][number]) => {
    if (template.columns === 'single') return '正文'
    return (section.lane === 'side') === (template.columns === 'left') ? '左栏' : '右栏'
  }
  if (doc.photo && previous.photo !== selected.photo)
    notes.push({ id: 'header', text: selected.photo ? '恢复显示原照片' : '此款不显示照片，原图与裁剪已保留' })
  function breakNote(id: string, label: string) {
    const before = pageFor(current, id),
      after = pageFor(candidate, id)
    if (before !== after)
      notes.push({ id, text: label + '的分页位置从第 ' + (before + 1) + ' 页移至第 ' + (after + 1) + ' 页' })
  }
  function blockBreak(b: Block) {
    if (b.hidden) return
    if (b.breakBefore)
      breakNote(
        b.id,
        b.label ||
          b.runs
            .map((r) => r.text)
            .join('')
            .slice(0, 16) ||
          '正文',
      )
    b.children.forEach(blockBreak)
  }
  for (const section of next.sections) {
    if (section.hidden) continue
    const before = doc.sections.find((s) => s.id === section.id)
    const title = printedTitle(section, doc.lang)
    if (before && place(previous, before) !== place(selected, section))
      notes.push({
        id: section.id,
        text: title + '从' + place(previous, before) + '移至' + place(selected, section),
      })
    if (section.breakBefore) breakNote(section.id, title)
    section.intro.forEach(blockBreak)
    section.ending.forEach(blockBreak)
    for (const entry of section.entries) {
      if (entry.hidden) continue
      if (entry.breakBefore)
        breakNote(entry.id, entry.fields.role || entry.fields.name || entry.fields.school || title)
      entry.blocks.forEach(blockBreak)
    }
  }
  return [...(candidate.notes ?? []), ...notes]
}

function LayoutFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="tp-error" role="alert">
      <strong>这次排版未完成</strong>
      <p>可以重新排版，或取消并回到已应用的简历。</p>
      <button type="button" className="secondary" onClick={onRetry}>
        重新排版
      </button>
    </div>
  )
}
class LayoutBoundary extends Component<
  { children: ReactNode; onError: () => void; onRetry: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? <LayoutFailure onRetry={this.props.onRetry} /> : this.props.children
  }
}

function SheetPane({
  side,
  doc,
  layout,
  page,
  zoom,
  hidden,
  compare,
  onPage,
  onLayout,
  onError,
  onRetry,
  onAlign,
  alignRequest,
  attempt,
}: {
  side: Pane
  doc: Resume
  layout?: Layout
  page: number
  zoom: boolean
  hidden: boolean
  compare: boolean
  onPage: (n: number) => void
  onLayout: (doc: Resume, layout: Layout) => void
  onError: (doc: Resume) => void
  onRetry: () => void
  onAlign: (id: string) => void
  alignRequest: { id: string } | null
  attempt: number
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(340)
  const [selected, select] = useState<string | null>(null)
  const measure = useCallback((value: Layout) => onLayout(doc, value), [doc, onLayout])
  const [stalled, setStalled] = useState<{ doc: Resume; attempt: number } | null>(null)
  useEffect(() => {
    if (layout) return
    const timer = setTimeout(() => {
      setStalled({ doc, attempt })
      onError(doc)
    }, 12000)
    return () => clearTimeout(timer)
  }, [doc, layout, attempt, onError])
  useLayoutEffect(() => {
    const node = viewport.current
    if (!node) return
    const measureWidth = () => {
      if (node.clientWidth) setWidth(node.clientWidth)
    }
    measureWidth()
    const observer = new ResizeObserver(measureWidth)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const total = layout?.pages.length || 0
  const shown = Math.min(page, Math.max(0, total - 1))
  const pageLines = layout?.pages[shown]?.lines ?? []
  const anchor =
    (selected && pageLines.some((l) => l.id === selected) && selected) ||
    pageLines.find((l) => l.id !== 'header' && l.role !== 'directory')?.id ||
    'header'
  const scale = zoom ? 1 : Math.min(1, Math.max(0.15, (width - 24) / paperWidth))
  useEffect(() => {
    viewport.current?.scrollTo(0, 0)
    select(null)
  }, [doc, shown])
  useEffect(() => {
    if (!alignRequest || hidden || !layout || shown !== pageFor(layout, alignRequest.id)) return
    const view = viewport.current
    if (!view) return
    const source = view.querySelector<HTMLElement>(
      '.paper-page[data-page-index="' +
        shown +
        '"] [data-source-id="' +
        CSS.escape(alignRequest.id) +
        '"]:not([data-line-role="directory"])',
    )
    if (!source) return
    view.scrollTop +=
      source.getBoundingClientRect().top - view.getBoundingClientRect().top - view.clientHeight * 0.28
    source.animate([{ outline: '2px solid #669276' }, { outline: '2px solid transparent' }], {
      duration: 1100,
    })
  }, [alignRequest, hidden, layout, shown])
  const name = getTemplate(doc.templateId).name
  return (
    <section
      className="tp-pane"
      data-template-pane={side}
      hidden={hidden}
      aria-label={side === 'current' ? '已应用预览' : '候选预览'}
      data-preview-page={shown + 1}
      data-page-count={total}
    >
      <header className="tp-pane-title">
        <span>{side === 'current' ? '已应用' : '候选'}</span>
        <strong>{name}</strong>
      </header>
      <div
        ref={viewport}
        className="tp-viewport"
        onClickCapture={(e) => {
          const link = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]')
          if (!link) return
          const id = decodeURIComponent(link.hash.slice(1))
          const target = document.getElementById(id)
          if (!target || !e.currentTarget.contains(target)) return
          const targetPage = target.closest<HTMLElement>('[data-page-index]')
          if (!targetPage) return
          e.preventDefault()
          e.stopPropagation()
          onPage(Number(targetPage.dataset.pageIndex))
          requestAnimationFrame(() => target.scrollIntoView({ block: 'center', inline: 'nearest' }))
        }}
      >
        <style>
          {'[data-template-pane="' +
            side +
            '"] .paper-page:not([data-page-index="' +
            shown +
            '"]){display:none}'}
        </style>
        {stalled?.doc === doc && stalled.attempt === attempt ? (
          <LayoutFailure onRetry={onRetry} />
        ) : (
          <LayoutBoundary
            key={(doc.templateId ?? '00') + ':' + attempt}
            onError={() => onError(doc)}
            onRetry={onRetry}
          >
            <div
              className="tp-sheet-size"
              style={{ width: paperWidth * scale, height: ((297 * 96) / 25.4) * scale }}
            >
              <div style={{ transform: 'scale(' + scale + ')' }} className="tp-sheet">
                <Paper doc={doc} onLayout={measure} onLocate={(id) => select(id)} />
              </div>
            </div>
          </LayoutBoundary>
        )}
      </div>
      <footer className="tp-pages">
        <div className="tp-stepper">
          <button type="button" aria-label="上一页" disabled={!shown} onClick={() => onPage(shown - 1)}>
            <ChevronLeft size={15} />
          </button>
          <span>{total ? shown + 1 + ' / ' + total : '排版中…'}</span>
          <button
            type="button"
            aria-label="下一页"
            disabled={shown + 1 >= total}
            onClick={() => onPage(shown + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
        {compare && (
          <button type="button" className="tp-align" disabled={!layout} onClick={() => onAlign(anchor)}>
            对齐到此经历
          </button>
        )}
      </footer>
    </section>
  )
}

export function TemplatePicker({
  doc: liveDoc,
  anchorId,
  onApply,
  onClose,
  sample = false,
}: {
  doc: Resume
  anchorId?: string | null
  sample?: boolean
  onApply: (next: Resume) => void
  onClose: () => void
}) {
  const stable = useRef(liveDoc)
  const doc = useMemo(() => {
    if (stable.current !== liveDoc && !sameDraft(stable.current, liveDoc)) stable.current = liveDoc
    return stable.current
  }, [liveDoc])
  const original = getTemplate(doc.templateId)
  const [chosen, choose] = useState(original.id)
  const [filter, setFilter] = useState({ query: '', family: '', columns: '', photo: '' })
  const [compare, setCompare] = useState(false),
    [zoom, setZoom] = useState(false)
  const [tab, setTab] = useState<Pane>('candidate')
  const [narrow, setNarrow] = useState(false)
  const [attempt, retry] = useState(0),
    [failed, fail] = useState<Resume | null>(null)
  const [left, setLeft] = useState<Measured | null>(null),
    [right, setRight] = useState<Measured | null>(null)
  const [currentPage, goCurrent] = useState(0),
    [candidatePage, goCandidate] = useState(0)
  const [activeAnchor, setAnchor] = useState(anchorId)
  const [alignRequest, requestAlignment] = useState<{ id: string } | null>(
    anchorId && anchorId !== 'header' ? { id: anchorId } : null,
  )
  const selected = getTemplate(chosen)
  const candidate = useMemo(() => switchTemplate(doc, chosen), [doc, chosen])
  const references = useRef({ doc, candidate, activeAnchor })
  references.current = { doc, candidate, activeAnchor }
  const dialog = useRef<HTMLDialogElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const comparisonArea = useRef<HTMLDivElement>(null)
  const committing = useRef(false)
  const seenDoc = useRef(doc)
  const [changed, setChanged] = useState(false)
  useEffect(() => {
    if (seenDoc.current !== doc) {
      setChanged(true)
      seenDoc.current = doc
    }
  }, [doc])
  const currentLayout = left?.doc === doc ? left.layout : undefined
  const candidateLayout = right?.doc === candidate ? right.layout : undefined
  const recordCurrent = useCallback((source: Resume, measured: Layout) => {
    if (source !== references.current.doc) return
    setLeft({ doc: source, layout: measured })
    goCurrent(pageFor(measured, references.current.activeAnchor))
  }, [])
  const recordCandidate = useCallback((source: Resume, measured: Layout) => {
    if (source !== references.current.candidate) return
    setRight({ doc: source, layout: measured })
    goCandidate(pageFor(measured, references.current.activeAnchor))
  }, [])
  const results = useMemo(() => {
    const query = filter.query.trim().toLowerCase()
    return templates.filter(
      (item) =>
        (!filter.family || item.family === filter.family) &&
        (!filter.columns || item.columns === filter.columns) &&
        (!filter.photo || item.photo === (filter.photo === 'yes')) &&
        [item.id, item.name, item.detail, templateFamilies[item.family], columnNames[item.columns]]
          .join(' ')
          .toLowerCase()
          .includes(query),
    )
  }, [filter])
  useLayoutEffect(() => {
    const modal = dialog.current
    const opener = document.activeElement as HTMLElement | null
    modal?.showModal()
    const current = grid.current?.querySelector<HTMLButtonElement>(
      '[data-template-option="' + original.id + '"]',
    )
    current?.focus({ preventScroll: true })
    current?.scrollIntoView({ block: 'nearest' })
    return () => {
      modal?.close()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])
  useLayoutEffect(() => {
    const node = comparisonArea.current
    if (!node) return
    const fit = () => setNarrow(node.clientWidth < 650)
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const differences = useMemo(
    () =>
      currentLayout && candidateLayout && original.id !== chosen
        ? notesFor(doc, candidate, currentLayout, candidateLayout)
        : [],
    [currentLayout, candidateLayout, doc, candidate, original.id, chosen],
  )
  const issue = useMemo(() => exportIssue(candidate), [candidate])
  const emptyMessage = issue?.id === '' ? issue.message : null
  const canApply = !!candidateLayout && failed !== candidate && chosen !== original.id
  function select(id: string) {
    choose(id)
    setTab('candidate')
    setChanged(false)
    fail(null)
  }
  function align(id: string) {
    setAnchor(id)
    requestAlignment({ id })
    goCurrent(pageFor(currentLayout, id))
    goCandidate(pageFor(candidateLayout, id))
  }
  function apply() {
    if (committing.current || !canApply || right?.doc !== references.current.candidate) return
    committing.current = true
    onApply({ ...candidate, revision: liveDoc.revision, modified: liveDoc.modified })
  }
  function tryAgain() {
    fail(null)
    setRight(null)
    setLeft(null)
    retry((i) => i + 1)
  }
  const title = sample ? '虚构样张 · 新建空白简历' : doc.name
  const countText =
    currentLayout && candidateLayout
      ? '当前 ' + currentLayout.pages.length + ' 页 → 候选 ' + candidateLayout.pages.length + ' 页'
      : '正在排版…'
  return createPortal(
    <dialog
      ref={dialog}
      className="tp"
      aria-label="选择模板"
      data-template-picker
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header className="tp-header">
        <div>
          <h2>选择模板</h2>
          <p>
            {title}
            <span> / </span>当前使用 {original.name}
          </p>
        </div>
        <button type="button" className="icon" aria-label="关闭模板选择器" onClick={onClose}>
          <X size={19} />
        </button>
      </header>
      <div className="tp-workspace">
        <aside className="tp-library">
          <div className="tp-filters">
            <label className="tp-search">
              <Search size={15} />
              <input
                aria-label="搜索模板"
                value={filter.query}
                placeholder="搜索名称、编号或特点"
                onChange={(e) => setFilter({ ...filter, query: e.target.value })}
              />
            </label>
            <div className="tp-selects">
              <select
                aria-label="模板系列"
                value={filter.family}
                onChange={(e) => setFilter({ ...filter, family: e.target.value })}
              >
                <option value="">全部系列</option>
                {Object.entries(templateFamilies).map(([id, name]) => (
                  <option value={id} key={id}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label="栏型"
                value={filter.columns}
                onChange={(e) => setFilter({ ...filter, columns: e.target.value })}
              >
                <option value="">全部栏型</option>
                {Object.entries(columnNames).map(([id, name]) => (
                  <option value={id} key={id}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label="照片"
                value={filter.photo}
                onChange={(e) => setFilter({ ...filter, photo: e.target.value })}
              >
                <option value="">全部照片</option>
                <option value="yes">显示照片</option>
                <option value="no">无照片</option>
              </select>
            </div>
          </div>
          <div className="tp-count" data-result-count={results.length}>
            {results.length} 款模板
          </div>
          <div className="tp-card-scroll">
            <div
              className="tp-grid"
              ref={grid}
              onKeyDown={(e) => {
                const cards = Array.from(
                  e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-template-option]'),
                )
                const i = cards.indexOf(document.activeElement as HTMLButtonElement)
                if (i < 0) return
                const columns = getComputedStyle(e.currentTarget).gridTemplateColumns.split(' ').length
                const delta: Record<string, number> = {
                  ArrowLeft: -1,
                  ArrowRight: 1,
                  ArrowUp: -columns,
                  ArrowDown: columns,
                }
                if (e.key in delta) {
                  e.preventDefault()
                  cards[Math.max(0, Math.min(cards.length - 1, i + delta[e.key]))].focus()
                }
              }}
            >
              {results.map((t) => {
                const n = atlasIds.indexOf(t.id)
                const style: CSSProperties = {
                  backgroundImage: 'url("' + atlas + '")',
                  backgroundPosition: ((n % 8) / 7) * 100 + '% ' + (Math.floor(n / 8) / 3) * 100 + '%',
                }
                return (
                  <button
                    type="button"
                    key={t.id}
                    data-template-option={t.id}
                    aria-pressed={chosen === t.id}
                    aria-label={t.id + ' ' + t.name + (t.id === original.id ? '，当前已应用' : '')}
                    className="tp-card"
                    onClick={() => select(t.id)}
                  >
                    <span className="tp-thumb">
                      <i style={style} />
                      {chosen === t.id && (
                        <b>
                          <Check size={12} />
                        </b>
                      )}
                    </span>
                    <span className="tp-card-name">{t.name}</span>
                    <small>
                      {t.id} · {columnNames[t.columns]}
                      {t.id === original.id ? ' · 当前' : ''}
                    </small>
                  </button>
                )
              })}
            </div>
            {!results.length && (
              <div className="tp-empty">
                <p>没有符合条件的模板</p>
                <button
                  className="secondary"
                  type="button"
                  onClick={() => setFilter({ query: '', family: '', columns: '', photo: '' })}
                >
                  清空筛选
                </button>
              </div>
            )}
          </div>
        </aside>
        <div className="tp-review" ref={comparisonArea}>
          <div className="tp-review-head">
            <div>
              <h3>{selected.name}</h3>
              <p>{selected.detail}</p>
            </div>
            <div className="tp-actions">
              <button
                type="button"
                aria-pressed={compare}
                className="secondary"
                disabled={chosen === original.id}
                onClick={() => setCompare((v) => !v)}
              >
                <Columns2 size={14} />
                对比当前样式
              </button>
              <button
                type="button"
                aria-label="切换预览缩放"
                className="secondary"
                aria-pressed={zoom}
                onClick={() => setZoom((v) => !v)}
              >
                {zoom ? '适应宽度' : '放大'}
              </button>
            </div>
          </div>
          {compare && chosen !== original.id && narrow && (
            <div className="tp-tabs" role="group" aria-label="比较视图">
              <button type="button" aria-pressed={tab === 'current'} onClick={() => setTab('current')}>
                当前
              </button>
              <button type="button" aria-pressed={tab === 'candidate'} onClick={() => setTab('candidate')}>
                候选
              </button>
            </div>
          )}
          <div className="tp-panes">
            <SheetPane
              side="current"
              doc={doc}
              layout={currentLayout}
              page={currentPage}
              onPage={goCurrent}
              hidden={!compare || chosen === original.id || (narrow && tab !== 'current')}
              compare={compare}
              zoom={zoom}
              onLayout={recordCurrent}
              onError={fail}
              onRetry={tryAgain}
              onAlign={align}
              alignRequest={alignRequest}
              attempt={attempt}
            />
            <SheetPane
              side="candidate"
              doc={candidate}
              layout={candidateLayout}
              page={candidatePage}
              onPage={goCandidate}
              hidden={compare && chosen !== original.id && narrow && tab !== 'candidate'}
              compare={compare && chosen !== original.id}
              zoom={zoom}
              onLayout={recordCandidate}
              onError={fail}
              onRetry={tryAgain}
              onAlign={align}
              alignRequest={alignRequest}
              attempt={attempt}
            />
          </div>
          {emptyMessage && (
            <p className="tp-empty-sheet" role="status">
              {emptyMessage}
            </p>
          )}
          {differences.length > 0 && (
            <details className="tp-differences" key={chosen}>
              <summary>查看版面变化（{differences.length}）</summary>
              <ul>
                {differences.map((note, i) => (
                  <li key={note.id + i}>
                    <button
                      type="button"
                      onClick={() => {
                        align(note.id)
                        setTab('candidate')
                      }}
                    >
                      {note.text}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
      <footer className="tp-bottom">
        <div aria-live="polite" data-template-status>
          <strong>{failed === candidate ? '候选排版失败' : countText}</strong>
          {changed && <small>简历已更新，请核对后应用。</small>}
        </div>
        <div className="tp-actions">
          <button type="button" className="secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="primary" disabled={!canApply} onClick={apply}>
            应用此模板
          </button>
        </div>
      </footer>
    </dialog>,
    document.body,
  )
}
