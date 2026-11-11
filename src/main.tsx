import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ArrowDownToLine,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FileText,
  FileUp,
  FolderOpen,
  Languages,
  Maximize2,
  Minus,
  PanelLeft,
  Plus,
  Redo2,
  SlidersHorizontal,
  Undo2,
  X,
} from 'lucide-react'
import { blank, type Resume } from './model'
import { copyResume, exportIssue, freeName } from './document'
import { publicSeed } from './seed'
import { Paper } from './layout'
import { Editor, StylePanel } from './Editor'
import { ImportReview } from './ImportReview'
import { Library, type Action } from './Library'
import { useSession } from './session'
import './style.css'

type View = 'library' | 'edit' | 'preview' | 'import'
type Dialog = {
  kind: 'new' | 'name' | 'confirm'
  title: string
  value?: string
  confirm?: string
  detail?: string
  danger?: boolean
  run: (name: string, mode: string) => Promise<void>
}
type Notice = { text: string; action?: string; run?: () => void }
function Modal({ dialog, onClose, onImport }: { dialog: Dialog; onClose: () => void; onImport: () => void }) {
  const [value, setValue] = useState(dialog.value || ''),
    [mode, setMode] = useState('seed'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await dialog.run(value.trim(), mode)
      onClose()
    } catch (e) {
      setError(String(e).replace(/^Error: /, ''))
      setBusy(false)
    }
  }
  return (
    <div
      className="overlay"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !busy) onClose()
      }}
    >
      <form role="dialog" aria-label={dialog.title} className="modal" onSubmit={submit}>
        <div className="row between">
          <h2>{dialog.title}</h2>
          <button type="button" aria-label="关闭" className="icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {dialog.detail && <p>{dialog.detail}</p>}
        {dialog.kind === 'new' && (
          <div className="start-options">
            {[
              ['seed', '基准简历', FileText],
              ['blank', '空白简历', FilePlus2],
            ].map(([key, label, Icon]) => {
              const Symbol = Icon as typeof FileText
              return (
                <button
                  type="button"
                  key={String(key)}
                  className={mode === key ? 'chosen' : ''}
                  onClick={() => setMode(String(key))}
                >
                  <Symbol size={22} />
                  {String(label)}
                </button>
              )
            })}
            <button type="button" onClick={onImport}>
              <FileUp size={22} />
              从文件导入
            </button>
          </div>
        )}
        {dialog.kind !== 'confirm' && (
          <label className="form-label">
            文档名称
            <input
              autoFocus
              value={value}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            取消
          </button>
          <button className={dialog.danger ? 'danger' : 'primary'} disabled={busy}>
            {dialog.confirm || '确认'}
          </button>
        </div>
      </form>
    </div>
  )
}
function App() {
  const [docs, setDocs] = useState<Resume[]>([]),
    [baseline, seed] = useState<Resume | null>(null),
    [fatal, fail] = useState(''),
    [view, show] = useState<View>('library'),
    [trash, setTrash] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null),
    [notice, setNotice] = useState<Notice | null>(null)
  const [styleOpen, styleToggle] = useState(false),
    [focus, setFocus] = useState(''),
    [pages, setPages] = useState(1),
    [page, setPage] = useState(1),
    [zoom, setZoom] = useState('fit'),
    [width, setWidth] = useState(720),
    [split, setSplit] = useState(42),
    [narrowPreview, setNarrowPreview] = useState(false)
  const [printing, setPrinting] = useState(false),
    [pdf, setPdf] = useState(''),
    [autoExport, setAutoExport] = useState(false)
  const viewport = useRef<HTMLDivElement>(null),
    pending = useRef(false),
    origin = useRef<View>('library'),
    editScroll = useRef(0)
  const updateDoc = useCallback((d: Resume) => setDocs((all) => [...all.filter((i) => i.id !== d.id), d]), [])
  const session = useSession(updateDoc),
    doc = session.doc
  const refresh = async () => setDocs(await window.studio.list())
  useEffect(() => {
    void (async () => {
      const s = await window.studio.initialize(publicSeed())
      seed(s)
      await refresh()
    })().catch((e) => fail(String(e)))
  }, [])
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), notice.action ? 12000 : 5500)
    return () => clearTimeout(t)
  }, [notice])
  function tryAction(fn: () => Promise<void>) {
    void fn().catch((e) => setNotice({ text: String(e) }))
  }
  function checkName(name: string, except?: string) {
    if (!name.trim()) throw Error('请填写文档名称')
    if (docs.some((d) => !d.trashed && d.id !== except && d.name === name)) throw Error('文档名称已被使用')
  }
  const gotoEditor = (d: Resume) => {
    session.load(d)
    styleToggle(false)
    setPage(1)
    setFocus('')
    setNarrowPreview(false)
    show('edit')
  }
  function newDialog() {
    setDialog({
      kind: 'new',
      title: '新建简历',
      value: freeName('新简历', docs),
      confirm: '创建并编辑',
      run: async (name, mode) => {
        checkName(name)
        const d = mode === 'seed' && baseline ? copyResume(baseline, name) : blank(name)
        const saved = await window.studio.save(d)
        updateDoc(saved)
        gotoEditor(saved)
      },
    })
  }
  async function action(a: Action, d: Resume) {
    if (a === 'edit') {
      gotoEditor(d)
      return
    }
    if (a === 'preview' || a === 'export') {
      session.load(d)
      origin.current = 'library'
      setPage(1)
      show('preview')
      setAutoExport(a === 'export')
      return
    }
    if (a === 'copy' || a === 'rename') {
      setDialog({
        kind: 'name',
        title: a === 'copy' ? '复制简历' : '重命名',
        value: a === 'copy' ? freeName(d.name + '（副本）', docs) : d.name,
        confirm: a === 'copy' ? '创建并编辑' : '保存',
        run: async (name) => {
          checkName(name, a === 'rename' ? d.id : undefined)
          const saved = await window.studio.save(
            a === 'copy' ? copyResume(d, name) : { ...d, name },
            a === 'rename' ? d.revision : undefined,
          )
          updateDoc(saved)
          if (a === 'copy') gotoEditor(saved)
          else if (session.current.current?.id === d.id) session.load(saved)
        },
      })
      return
    }
    if (a === 'backup') {
      const path = await window.studio.backup(d)
      if (path) setNotice({ text: '已保存可编辑备份' })
      return
    }
    if (a === 'restore') {
      const active = docs.filter((x) => x.id !== d.id && !x.trashed)
      const name = active.some((x) => x.name === d.name) ? freeName(d.name + '（已恢复）', active) : d.name
      updateDoc(await window.studio.save({ ...d, name, trashed: null }, d.revision))
      setNotice({ text: '已恢复 ' + name })
      return
    }
    setDialog({
      kind: 'confirm',
      title: a === 'trash' ? '移入回收站？' : '永久删除简历？',
      confirm: a === 'trash' ? '移入回收站' : '永久删除',
      danger: a === 'remove',
      detail: '「' + d.name + '」' + (a === 'trash' ? '可以在回收站恢复。' : '将从本机删除。'),
      run: async () => {
        if (a === 'remove') {
          await window.studio.remove(d.id)
          await refresh()
        } else {
          const moved = await window.studio.save({ ...d, trashed: Date.now() }, d.revision)
          updateDoc(moved)
          setNotice({
            text: '已移入回收站',
            action: '撤销',
            run: () =>
              tryAction(async () => {
                await action('restore', moved)
              }),
          })
        }
      },
    })
  }
  const locate = (id: string) => {
    setNarrowPreview(false)
    setFocus('')
    requestAnimationFrame(() => setFocus(id))
  }
  const locatePaper = (id: string) => {
    const node = document.querySelector<HTMLElement>('#print-root [data-source-id="' + CSS.escape(id) + '"]')
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    node?.animate([{ outline: '2px solid #448479' }, { outline: '2px solid transparent' }], {
      duration: 1350,
    })
  }
  const navigatePage = (n: number) => {
    if (n < 1 || n > pages) return
    const el = document.querySelectorAll<HTMLElement>('#print-root .paper-page')[n - 1]
    if (el && viewport.current) {
      viewport.current.scrollTop +=
        el.getBoundingClientRect().top - viewport.current.getBoundingClientRect().top - 15
      setPage(n)
    }
  }
  async function exportPDF() {
    if (pending.current || !session.current.current) return
    pending.current = true
    setPrinting(true)
    setPdf('')
    try {
      ;(document.activeElement as HTMLElement)?.blur()
      await session.flush()
      const snapshot = session.current.current!
      const issue = exportIssue(snapshot)
      if (issue) {
        show('edit')
        locate(issue.id)
        setNotice({ text: issue.message })
        return
      }
      await document.fonts.ready
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      const path = await window.studio.exportPDF(snapshot.id, snapshot.name, snapshot.revision)
      if (path) setPdf(path)
    } catch (e) {
      setNotice({ text: '导出失败 · ' + String(e), action: '重试', run: () => void exportPDF() })
    } finally {
      pending.current = false
      setPrinting(false)
    }
  }
  useEffect(() => {
    if (autoExport && view === 'preview' && doc) {
      setAutoExport(false)
      void exportPDF()
    }
  }, [autoExport, view, doc])
  async function back() {
    await session.flush()
    setPdf('')
    if (view === 'preview' && origin.current === 'edit') {
      show('edit')
      requestAnimationFrame(() => {
        if (viewport.current) viewport.current.scrollTop = editScroll.current
      })
      return
    }
    session.load(null)
    styleToggle(false)
    show('library')
  }
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [view, narrowPreview])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog || printing) return
      if (view === 'edit' && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        session.travel(e.shiftKey)
      }
      if (view === 'preview' && e.key === 'Escape') {
        tryAction(back)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const scale = zoom === 'fit' ? Math.max(0.25, Math.min(1.35, (width - 54) / 793.7)) : Number(zoom)
  if (fatal)
    return (
      <main className="empty">
        <h2>无法打开工作区</h2>
        <p>{fatal}</p>
        <button onClick={() => location.reload()}>重新打开</button>
      </main>
    )
  if (!baseline)
    return (
      <div className="loading">
        <FileText />
        正在打开本机工作区…
      </div>
    )
  return (
    <>
      {view === 'library' ? (
        <Library
          docs={docs}
          trash={trash}
          setTrash={setTrash}
          onNew={newDialog}
          onRestore={() =>
            tryAction(async () => {
              const d = await window.studio.restore()
              if (d) {
                updateDoc(d)
                gotoEditor(d)
              }
            })
          }
          onAction={(a, d) => tryAction(() => action(a, d))}
        />
      ) : view === 'import' ? (
        <ImportReview
          onCancel={() => show('library')}
          onCreate={async (d) => {
            d.name = freeName(d.name, docs)
            const saved = await window.studio.save(d)
            updateDoc(saved)
            gotoEditor(saved)
          }}
        />
      ) : (
        doc && (
          <div
            className={
              'workspace ' + (view === 'preview' ? 'full-view ' : '') + (narrowPreview ? 'show-paper' : '')
            }
          >
            <header className="work-header">
              <button className="back" onClick={() => tryAction(back)}>
                <ArrowLeft size={17} />
                {view === 'preview' && origin.current === 'edit' ? '返回编辑' : '简历库'}
              </button>
              <i />
              <button
                className="name-button"
                disabled={!!doc.trashed}
                onClick={() =>
                  tryAction(async () => {
                    await session.flush()
                    await action('rename', session.current.current!)
                  })
                }
              >
                {doc.name}
              </button>
              <span className="save-status" title={new Date(doc.modified).toLocaleTimeString()}>
                <b />
                {session.status}
              </span>
              <div className="tools">
                {view === 'edit' ? (
                  <>
                    <button
                      className="icon"
                      aria-label="撤销"
                      disabled={!session.canUndo}
                      onClick={() => session.travel(false)}
                    >
                      <Undo2 size={17} />
                    </button>
                    <button
                      className="icon"
                      aria-label="重做"
                      disabled={!session.canRedo}
                      onClick={() => session.travel(true)}
                    >
                      <Redo2 size={17} />
                    </button>
                    <i />
                    <button
                      className="icon lang-button"
                      aria-label="栏目语言"
                      title="切换栏目语言"
                      onClick={() => session.change({ ...doc, lang: doc.lang === 'zh' ? 'en' : 'zh' })}
                    >
                      <Languages size={16} />
                      {doc.lang === 'zh' ? '中' : 'EN'}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => {
                        origin.current = 'edit'
                        editScroll.current = viewport.current?.scrollTop || 0
                        show('preview')
                      }}
                    >
                      <Maximize2 size={15} />
                      全屏预览
                    </button>
                  </>
                ) : (
                  !doc.trashed && (
                    <button className="secondary" onClick={() => show('edit')}>
                      编辑
                    </button>
                  )
                )}
                <button className="primary" disabled={printing} onClick={() => void exportPDF()}>
                  <ArrowDownToLine size={16} />
                  {printing ? '正在生成…' : '导出 PDF'}
                </button>
              </div>
            </header>
            {session.error && (
              <div className="error-banner">
                保存失败 · {session.error}
                <button onClick={() => tryAction(session.flush)}>重试</button>
                <button
                  onClick={() =>
                    tryAction(async () => {
                      await window.studio.backup(doc)
                    })
                  }
                >
                  另存可编辑备份
                </button>
              </div>
            )}
            <div className="work-body" style={{ '--split': split + '%' } as React.CSSProperties}>
              {view === 'edit' && (
                <>
                  <aside className="edit-pane" data-editor-scroll>
                    <div className="pane-heading">
                      <div>
                        <PanelLeft size={18} />
                        <h2>内容编辑</h2>
                      </div>
                      <button className="narrow-switch" onClick={() => setNarrowPreview(true)}>
                        查看预览
                      </button>
                    </div>
                    <Editor doc={doc} onChange={session.change} focusId={focus} onLocate={locatePaper} />
                  </aside>
                  <div
                    className="splitter"
                    aria-label="调整面板宽度"
                    role="separator"
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId)
                    }}
                    onPointerMove={(e) => {
                      if (e.currentTarget.hasPointerCapture(e.pointerId))
                        setSplit(
                          Math.max(
                            (340 / window.innerWidth) * 100,
                            Math.min(59, (e.clientX / window.innerWidth) * 100),
                          ),
                        )
                    }}
                  />
                </>
              )}
              <section className="preview-pane">
                <div className="preview-heading">
                  <span>
                    <span className="live-dot" />
                    简历预览
                  </span>
                  <div className="row">
                    {view === 'edit' && (
                      <>
                        <button className="narrow-switch" onClick={() => setNarrowPreview(false)}>
                          返回编辑
                        </button>
                        <button
                          className={'paper-action ' + (styleOpen ? 'selected' : '')}
                          onClick={() => styleToggle(!styleOpen)}
                        >
                          <SlidersHorizontal size={15} />
                          排版
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {styleOpen && view === 'edit' && (
                  <div className="style-pop">
                    <div className="between row">
                      <h3>排版设置</h3>
                      <button className="icon" aria-label="关闭排版" onClick={() => styleToggle(false)}>
                        <X size={15} />
                      </button>
                    </div>
                    <StylePanel doc={doc} onChange={session.change} />
                  </div>
                )}
                <div
                  ref={viewport}
                  className="paper-viewport"
                  onScroll={() => {
                    const vp = viewport.current
                    if (!vp) return
                    const blocks = [...vp.querySelectorAll('.paper-page')]
                    const top = vp.getBoundingClientRect().top + vp.clientHeight * 0.4
                    const idx = blocks.findIndex((el) => el.getBoundingClientRect().bottom >= top)
                    if (idx !== -1) setPage(idx + 1)
                  }}
                >
                  <div
                    className="paper-sizing"
                    style={{ width: 793.7 * scale, height: ((1122.52 + 16) * pages - 16) * scale }}
                  >
                    <div id="print-root" style={{ transform: 'scale(' + scale + ')' }}>
                      <Paper
                        doc={doc}
                        onPageCount={setPages}
                        onLocate={view === 'edit' ? locate : undefined}
                      />
                    </div>
                  </div>
                </div>
                <footer className="view-footer">
                  <div className="row">
                    <button
                      className="icon"
                      aria-label="上一页"
                      disabled={page <= 1}
                      onClick={() => navigatePage(page - 1)}
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <input
                      key={page + '-' + pages}
                      aria-label="跳转页码"
                      defaultValue={Math.min(page, pages)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const n = Number(e.currentTarget.value)
                          if (Number.isInteger(n) && n >= 1 && n <= pages) navigatePage(n)
                          else setNotice({ text: '页码范围为 1 至 ' + pages })
                        }
                      }}
                    />
                    <span>/ {pages}</span>
                    <button
                      className="icon"
                      aria-label="下一页"
                      disabled={page >= pages}
                      onClick={() => navigatePage(page + 1)}
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                  <div className="row">
                    <button
                      className="icon"
                      aria-label="缩小"
                      onClick={() => setZoom(String(Math.max(0.5, Math.ceil(scale * 4 - 1) / 4)))}
                    >
                      <Minus size={14} />
                    </button>
                    <select aria-label="查看比例" value={zoom} onChange={(e) => setZoom(e.target.value)}>
                      <option value="fit">适合宽度</option>
                      {[0.5, 0.75, 1, 1.25, 1.5].map((n) => (
                        <option key={n} value={n}>
                          {n * 100}%
                        </option>
                      ))}
                    </select>
                    <button
                      className="icon"
                      aria-label="放大"
                      onClick={() => setZoom(String(Math.min(1.5, Math.floor(scale * 4 + 1) / 4)))}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </footer>
              </section>
            </div>
          </div>
        )
      )}
      {dialog && (
        <Modal
          dialog={dialog}
          onClose={() => setDialog(null)}
          onImport={() => {
            setDialog(null)
            show('import')
          }}
        />
      )}
      {pdf && (
        <div className="toast">
          <Check size={16} />
          已导出 {pdf.split('/').pop()}
          <button onClick={() => tryAction(() => window.studio.openOutput(pdf))}>打开 PDF</button>
          <button
            aria-label="在文件夹中显示"
            onClick={() => tryAction(() => window.studio.revealOutput(pdf))}
          >
            <FolderOpen size={16} />
          </button>
          <button aria-label="关闭导出提示" onClick={() => setPdf('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice.text}
          {notice.action && (
            <button
              onClick={() => {
                notice.run?.()
                setNotice(null)
              }}
            >
              {notice.action}
            </button>
          )}
          <button aria-label="关闭提示" onClick={() => setNotice(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {printing && <div className="printing-shield" aria-label="正在生成 PDF" />}
    </>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
