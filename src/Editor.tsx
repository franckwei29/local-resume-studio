import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  AlignLeft,
  Award,
  BriefcaseBusiness,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  EyeOff,
  FilePlus2,
  FolderKanban,
  Globe2,
  GraduationCap,
  GripVertical,
  Image as ImageIcon,
  List,
  ListOrdered,
  MapPin,
  Minus,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Plus,
  Signature,
  UserRound,
  X,
} from 'lucide-react'
import { block, defaults, printedTitle, titles } from './model'
import type { Block, Entry, Kind, Lane, Photo, Resume, Section, Style } from './model'
import {
  duplicateTreeNode,
  editorCopy,
  findNode,
  moveToLane,
  moveTreeNode,
  newEntry,
  newSection,
  sectionError,
  siblingNodes,
  validDrop,
} from './editorTree'
import type { DragItem, TreeNode } from './editorTree'
import { fileData, PhotoCrop } from './PhotoCrop'
import RichField from './RichField'
import './editor.css'

export interface EditorProps {
  doc: Resume
  onChange: (next: Resume, group?: string) => void
  focusId?: string | null
  onLocate?: (id: string) => void
}
type Change = (change: (draft: Resume) => void, group?: string) => void
type Confirm = { title: string; body: string; action: () => void }
type EditorContextType = {
  doc: Resume
  change: Change
  expanded: Set<string>
  toggle: (id: string) => void
  reveal: (id: string, focus?: boolean) => void
  locate: (id: string) => void
  confirm: (confirm: Confirm) => void
  startDrag: (e: ReactPointerEvent<HTMLElement>, item: DragItem) => void
  dropMark: string
  notice: (text: string) => void
}
const C = createContext<EditorContextType>(null!)
const useEditor = () => useContext(C)
const iconByKind = {
  personal: UserRound,
  target: MapPin,
  education: GraduationCap,
  work: BriefcaseBusiness,
  project: FolderKanban,
  evaluation: AlignLeft,
  skills: Award,
  language: Globe2,
  custom: FilePlus2,
  signature: Signature,
}
const entryLabels: Record<Kind, string> = {
  personal: '字段',
  target: '岗位',
  education: '教育',
  work: '工作',
  project: '项目',
  evaluation: '评价',
  skills: '技能',
  language: '语言',
  custom: '条目',
  signature: '落款',
}
const blockTitles: Record<Block['type'], string> = {
  paragraph: '段落',
  label: '标签段落',
  group: '子项目',
  bullet: '圆点要点',
  number: '编号要点',
}
function updateNode<T extends TreeNode>(d: Resume, id: string, fn: (n: T) => void) {
  const n = findNode(d, id)?.node
  if (n) fn(n as T)
}
function entryTitle(e: Entry, s: Section, i: number) {
  const f = e.fields
  switch (s.kind) {
    case 'personal':
      return f.label || '个人字段'
    case 'education':
      return [f.major, f.degree].filter(Boolean).join(' · ') || f.school || '新教育'
    case 'work':
      return f.role || '新工作'
    case 'target':
      return '目标岗位'
    case 'evaluation':
      return f.text?.slice(0, 24) || '评价 ' + (i + 1)
    default:
      return f.name || '新' + entryLabels[s.kind]
  }
}

type Choice = { label: string; action: () => void; disabled?: boolean; danger?: boolean }
function Menu({
  choices,
  label,
  children,
  iconOnly = false,
}: {
  choices: Choice[]
  label: string
  children: ReactNode
  iconOnly?: boolean
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null)
  const close = () => setPos(null)
  useEffect(() => {
    if (!pos) return
    const outside = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', key, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('resize', close)
    }
  }, [pos])
  return (
    <>
      <button
        type="button"
        className={iconOnly ? 're-icon' : 're-menu-trigger'}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        ref={trigger}
        onClick={() => {
          if (pos) {
            close()
            return
          }
          const r = trigger.current!.getBoundingClientRect()
          const h = Math.min(choices.length * 34 + 12, 340)
          setPos({
            left: Math.max(8, Math.min(window.innerWidth - 202, iconOnly ? r.right - 184 : r.left)),
            top: Math.max(8, r.bottom + h > window.innerHeight ? r.top - h : r.bottom + 4),
          })
        }}
      >
        {children}
      </button>
      {pos &&
        createPortal(
          <div role="menu" aria-label={label} className="re-menu" ref={panel} style={pos}>
            {choices.map((c) => (
              <button
                key={c.label}
                type="button"
                role="menuitem"
                className={c.danger ? 'danger' : ''}
                disabled={c.disabled}
                onClick={() => {
                  close()
                  c.action()
                }}
              >
                {c.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

function Field({
  label,
  value,
  onValue,
  type = 'text',
  multiline = false,
  placeholder,
  invalid = false,
}: {
  label: string
  value: string
  onValue: (value: string) => void
  type?: string
  multiline?: boolean
  placeholder?: string
  invalid?: boolean
}) {
  const [ime, setIme] = useState<string | null>(null)
  const composing = useRef(false)
  const props = {
    value: ime ?? value ?? '',
    placeholder,
    'aria-label': label,
    'aria-invalid': invalid || undefined,
    onCompositionStart: (e: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      composing.current = true
      setIme(e.currentTarget.value)
    },
    onCompositionEnd: (e: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      composing.current = false
      setIme(null)
      onValue(e.currentTarget.value)
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (composing.current) setIme(e.target.value)
      else onValue(e.target.value)
    },
  }
  return (
    <label className={'re-field' + (multiline ? ' re-wide' : '')}>
      <span>{label}</span>
      {multiline ? <textarea {...props} rows={3} /> : <input {...props} type={type} />}
    </label>
  )
}
function Handle({ node, marker = false }: { node: TreeNode; marker?: boolean }) {
  const { startDrag } = useEditor()
  return (
    <span
      data-drag-id={marker ? undefined : node.id}
      className={marker ? 're-break-grip' : 're-handle'}
      title={marker ? '拖动分页标记' : '拖动排序'}
      aria-label={marker ? '拖动分页标记' : '拖动排序'}
      onPointerDown={(e) => startDrag(e, { id: node.id, marker })}
    >
      <GripVertical size={14} />
      {marker ? '分页' : ''}
    </span>
  )
}
function SortRow({
  node,
  caption,
  summary,
  icon,
  children,
  extra,
  canCopy = true,
}: {
  node: TreeNode
  caption: string
  summary?: string
  icon?: ReactNode
  children: ReactNode
  extra?: Choice[]
  canCopy?: boolean
}) {
  const ctx = useEditor(),
    { doc, expanded, toggle, change } = ctx
  const opened = expanded.has(node.id),
    sectionNode = 'entries' in node
  const scope = sectionNode ? 'section' : 'fields' in node ? 'entry' : 'block'
  const [rename, setRename] = useState(false)
  function menu() {
    const info = findNode(doc, node.id)!
    const siblings = siblingNodes(info),
      i = siblings.findIndex((s) => s.id === node.id)
    const move = (idx: number, after: boolean) =>
      change((d) => {
        moveTreeNode(d, { id: node.id }, siblings[idx].id, after)
      })
    const items: Choice[] = [
      { label: '在预览中定位', action: () => ctx.locate(node.id) },
      { label: '上移', disabled: i <= 0, action: () => move(i - 1, false) },
      { label: '下移', disabled: i >= siblings.length - 1, action: () => move(i + 1, true) },
      { label: '移到最前', disabled: i <= 0, action: () => move(0, false) },
      {
        label: '移到最后',
        disabled: i >= siblings.length - 1,
        action: () => move(siblings.length - 1, true),
      },
    ]
    if (sectionNode) {
      const dest = node.lane === 'side' ? 'main' : 'side'
      items.push(
        {
          label: dest === 'side' ? '移至简历左栏' : '移至简历右栏',
          action: () => change((d) => moveToLane(d, node.id, dest)),
        },
        {
          label: '修改模块标题',
          action: () => {
            if (!opened) toggle(node.id)
            setRename(true)
          },
        },
      )
    }
    if (extra) items.push(...extra)
    items.push(
      {
        label: node.hidden ? '显示' : '隐藏',
        action: () =>
          change((d) =>
            updateNode(d, node.id, (n) => {
              n.hidden = !n.hidden
            }),
          ),
      },
      {
        label: node.breakBefore ? '移除分页' : '从这里另起一页',
        action: () =>
          change((d) =>
            updateNode(d, node.id, (n) => {
              n.breakBefore = !n.breakBefore
            }),
          ),
      },
    )
    if (canCopy)
      items.push({
        label: '复制',
        action: () => {
          let copy = ''
          change((d) => {
            copy = duplicateTreeNode(d, node.id) || ''
          })
          if (copy) ctx.reveal(copy)
        },
      })
    const remove = () =>
      change((d) => {
        const info = findNode(d, node.id)!
        info.siblings.splice(info.siblings.indexOf(info.node), 1)
        if ('kind' in node && node.kind === 'target') d.target = ''
      })
    items.push({
      label: '删除',
      danger: true,
      action: () =>
        sectionNode
          ? ctx.confirm({
              title: '删除「' + caption + '」？',
              body: '将一并移除模块内的 ' + node.entries.length + ' 条记录，可通过撤销恢复。',
              action: remove,
            })
          : remove(),
    })
    return items
  }
  const flag =
    ctx.dropMark === node.id + ':before'
      ? ' re-drop-before'
      : ctx.dropMark === node.id + ':after'
        ? ' re-drop-after'
        : ''
  return (
    <div
      className={
        're-sort re-' + scope + (opened ? ' is-open' : '') + (node.hidden ? ' is-hidden' : '') + flag
      }
      data-editor-id={node.id}
      data-node-kind={sectionNode ? node.kind : scope}
    >
      {node.breakBefore && (
        <div className="re-break">
          <Handle node={node} marker />
          <button
            aria-label="移除分页"
            onClick={() =>
              change((d) =>
                updateNode(d, node.id, (n) => {
                  n.breakBefore = false
                }),
              )
            }
          >
            <X size={11} />
          </button>
        </div>
      )}
      <div className="re-rowhead">
        <Handle node={node} />
        <button
          className="re-toggle"
          type="button"
          aria-label={(opened ? '收起' : '展开') + ' ' + caption}
          aria-expanded={opened}
          onClick={() => toggle(node.id)}
        >
          {icon && <span className="re-section-icon">{icon}</span>}
          <span className="re-caption">{caption}</span>
          {node.hidden && <EyeOff size={12} />}
          {summary && <span className="re-count">{summary}</span>}
          {opened ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <Menu choices={menu()} label={caption + '操作'} iconOnly>
          <MoreHorizontal size={17} />
        </Menu>
      </div>
      {opened && (
        <div className="re-nodebody">
          {rename && sectionNode && (
            <div className="re-rename">
              <Field
                label="模块标题"
                value={node.title}
                onValue={(v) =>
                  change(
                    (d) =>
                      updateNode<Section>(d, node.id, (s) => {
                        s.title = v
                        s.customTitle = true
                      }),
                    node.id + 'title',
                  )
                }
              />
              <button onClick={() => setRename(false)}>完成</button>
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  )
}

function BlockSet({
  blocks,
  owner,
  where,
  label,
}: {
  blocks: Block[]
  owner: string
  where: 'intro' | 'ending' | 'blocks' | 'children'
  label?: string
}) {
  const { change, reveal } = useEditor()
  function list(d: Resume): Block[] {
    const n = findNode(d, owner)!.node
    return (n as unknown as Record<typeof where, Block[]>)[where]
  }
  function add(type: Block['type']) {
    const b = block(type)
    change((d) => list(d).push(b))
    reveal(b.id)
  }
  return (
    <div className="re-blockset">
      {label && <div className="re-group-label">{label}</div>}
      {blocks.map((b, i) => (
        <BlockRow
          key={b.id}
          b={b}
          index={i}
          onSplit={(left, right) => {
            const next = block(b.type)
            next.runs = right
            change((d) => {
              const siblings = list(d),
                index = siblings.findIndex((n) => n.id === b.id)
              siblings[index].runs = left
              siblings.splice(index + 1, 0, next)
            })
            reveal(next.id, true)
          }}
        />
      ))}
      <Menu
        label={'添加' + (label || '内容块')}
        choices={(['paragraph', 'label', 'group', 'bullet', 'number'] as const).map((type) => ({
          label: '添加' + blockTitles[type],
          action: () => add(type),
        }))}
      >
        <Plus size={13} /> {label ? '添加' + label : '添加内容块'} <ChevronDown size={12} />
      </Menu>
    </div>
  )
}
function BlockRow({
  b,
  index,
  onSplit,
}: {
  b: Block
  index: number
  onSplit: (left: Block['runs'], right: Block['runs']) => void
}) {
  const { change } = useEditor()
  function update(fn: (n: Block) => void, field?: string) {
    change((d) => updateNode(d, b.id, fn), field ? b.id + field : undefined)
  }
  const caption =
    b.label ||
    b.runs
      .map((r) => r.text)
      .join('')
      .slice(0, 22) ||
    blockTitles[b.type] + ' ' + (index + 1)
  return (
    <SortRow
      node={b}
      caption={caption}
      icon={
        b.type === 'group' ? (
          <FolderKanban size={14} />
        ) : b.type === 'number' ? (
          <ListOrdered size={14} />
        ) : b.type === 'bullet' ? (
          <List size={14} />
        ) : (
          <AlignLeft size={13} />
        )
      }
    >
      <label className="re-field">
        <span>内容类型</span>
        <select
          value={b.type}
          aria-label="内容类型"
          onChange={(e) =>
            update((n) => {
              n.type = e.target.value as Block['type']
            })
          }
        >
          {Object.entries(blockTitles).map(([key, text]) => (
            <option key={key} value={key}>
              {text}
            </option>
          ))}
        </select>
      </label>
      {b.type === 'group' ? (
        <Field
          label="子项目标题"
          value={b.label || b.runs.map((r) => r.text).join('')}
          onValue={(v) =>
            update((n) => {
              if (n.label) n.label = v
              else n.runs = [{ text: v }]
            }, 'groupTitle')
          }
        />
      ) : (
        <Field
          label="标签或加粗前缀"
          value={b.label}
          onValue={(v) =>
            update((n) => {
              n.label = v
            }, 'label')
          }
        />
      )}
      {(b.type !== 'group' || (b.label && b.runs.some((r) => r.text))) && (
        <RichField
          label="正文"
          runs={b.runs}
          onChange={(r) =>
            update((n) => {
              n.runs = r
            }, 'runs')
          }
          onSplit={['bullet', 'number'].includes(b.type) ? onSplit : undefined}
        />
      )}
      {(b.type === 'group' || b.children.length > 0) && (
        <BlockSet blocks={b.children} owner={b.id} where="children" label="子项目内容" />
      )}
    </SortRow>
  )
}

const personalOptions = [
  ['姓名', 'name'],
  ['邮箱', 'email'],
  ['电话', 'phone'],
  ['所在地', 'location'],
  ['生日', 'birthday'],
  ['网站', 'website'],
  ['领英', 'linkedin'],
  ['国籍', 'nationality'],
  ['驾照', 'license'],
  ['自定义', 'custom'],
]
function Dates({ e, update }: { e: Entry; update: (fn: (item: Entry) => void, key?: string) => void }) {
  const invalid = !!(e.start && e.end && !e.current && e.end < e.start)
  return (
    <div className="re-fields">
      <Field
        label="开始年月"
        type="month"
        value={e.start}
        onValue={(v) =>
          update((n) => {
            n.start = v
          }, 'start')
        }
      />
      {!e.current && (
        <Field
          label="结束年月"
          type="month"
          value={e.end}
          invalid={invalid}
          onValue={(v) =>
            update((n) => {
              n.end = v
            }, 'end')
          }
        />
      )}
      <label className="re-check">
        <input
          type="checkbox"
          checked={e.current}
          onChange={(v) =>
            update((n) => {
              n.current = v.target.checked
            })
          }
        />
        至今
      </label>
    </div>
  )
}
function EntryRow({ s, e, i }: { s: Section; e: Entry; i: number }) {
  const { change, toggle, notice } = useEditor(),
    [submitted, setSubmitted] = useState(false)
  const update = (fn: (n: Entry) => void, key?: string) =>
    change((d) => updateNode(d, e.id, fn), key ? e.id + key : undefined)
  const set = (key: string, value: string) =>
    update((n) => {
      n.fields[key] = value
    }, 'fields.' + key)
  const f = e.fields,
    kind = s.kind,
    error = sectionError(kind, e)
  const field = (key: string, label: string, multiline = false, type = 'text') => (
    <Field
      key={key}
      label={label}
      type={type}
      value={f[key] || ''}
      multiline={multiline}
      onValue={(v) => set(key, v)}
    />
  )
  const dated = ['education', 'work', 'project'].includes(kind) || (kind === 'custom' && f.format === 'dated')
  return (
    <SortRow node={e} caption={entryTitle(e, s, i)} summary={kind === 'work' ? e.start : undefined}>
      {kind === 'personal' && (
        <>
          <label className="re-field">
            <span>字段类型</span>
            <select
              aria-label="字段类型"
              value={f.icon || 'custom'}
              onChange={(v) => {
                const [l, icon] = personalOptions.find((o) => o[1] === v.target.value)!
                update((n) => {
                  n.fields.icon = icon
                  n.fields.label = l
                })
              }}
            >
              {personalOptions.map(([l, id]) => (
                <option key={id} value={id}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          {field('label', '字段名称')}
          {field('value', '字段值', false, f.icon === 'birthday' ? 'date' : 'text')}
        </>
      )}
      {kind === 'education' && (
        <div className="re-fields">
          {field('major', '专业')}
          {field('degree', '学位')}
          {field('school', '学校')}
          {field('note', '学校备注')}
        </div>
      )}
      {kind === 'work' && (
        <div className="re-fields">
          {field('role', '职位')}
          {field('company', '单位')}
          {field('city', '城市')}
          {field('subtitle', '副标题')}
        </div>
      )}
      {kind === 'project' && (
        <div className="re-fields">
          {field('name', '项目名')}
          {field('note', '项目标注')}
          {field('source', '来源／课题')}
        </div>
      )}
      {kind === 'evaluation' && field('text', '评价内容', true)}
      {(kind === 'skills' || kind === 'language') && (
        <>
          {field('name', kind === 'skills' ? '技能名' : '语种')}
          {field('description', '详细说明', true)}
          <label className="re-check">
            <input
              type="checkbox"
              checked={f.levelShown !== 'false'}
              onChange={(v) => set('levelShown', String(v.target.checked))}
            />
            显示熟练度
          </label>
          {f.levelShown !== 'false' && field('level', '熟练度')}
        </>
      )}
      {kind === 'custom' && (
        <>
          <label className="re-field">
            <span>显示格式</span>
            <select
              aria-label="显示格式"
              value={f.format || 'label'}
              onChange={(v) => set('format', v.target.value)}
            >
              <option value="label">标签与说明</option>
              <option value="dated">带日期的经历</option>
              <option value="paragraph">自由段落</option>
            </select>
          </label>
          {f.format !== 'paragraph' && field('name', '名称')}
          {f.format === 'dated' && field('organization', '机构')}
          {field('description', '说明', true)}
        </>
      )}
      {kind === 'signature' && (
        <>
          {field('name', '署名')}
          {field('date', '落款日期', false, 'date')}
          <label className="re-field">
            <span>落款类型</span>
            <select value={f.mode || 'text'} onChange={(v) => set('mode', v.target.value)}>
              <option value="text">使用文字</option>
              <option value="image">使用图片</option>
            </select>
          </label>
          {f.mode === 'image' && (
            <label className="re-field">
              <span>签名图片</span>
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={async (v) => {
                  const file = v.target.files?.[0]
                  if (!file) return
                  try {
                    const data = await fileData(file)
                    const img = new Image()
                    img.src = data
                    await img.decode()
                    set('image', data)
                  } catch {
                    notice('无法读取签名图片')
                  }
                }}
              />
            </label>
          )}
        </>
      )}
      {dated && <Dates e={e} update={update} />}
      {(['work', 'education', 'project', 'custom'].includes(kind) || e.blocks.length > 0) && (
        <BlockSet blocks={e.blocks} owner={e.id} where="blocks" />
      )}
      {error && (submitted || error.includes('年月')) && (
        <p className="re-error" role="alert">
          {error}
        </p>
      )}
      <div className="re-actions end">
        <button
          className="re-done"
          onClick={() => {
            if (error) setSubmitted(true)
            else toggle(e.id)
          }}
        >
          <Check size={14} />
          完成
        </button>
      </div>
    </SortRow>
  )
}
function SectionCard({ s }: { s: Section }) {
  const { doc, change, reveal } = useEditor(),
    Icon = iconByKind[s.kind]
  function addEntry() {
    const e = newEntry(s.kind)
    if (s.kind === 'evaluation' && s.entries[0]?.fields.numbered === 'false') e.fields.numbered = 'false'
    change((d) => updateNode<Section>(d, s.id, (n) => n.entries.push(e)))
    reveal(e.id, true)
  }
  return (
    <SortRow
      node={s}
      caption={printedTitle(s, doc.lang)}
      summary={s.kind === 'target' ? undefined : String(s.entries.length)}
      icon={<Icon size={16} />}
      canCopy={!['personal', 'target'].includes(s.kind)}
    >
      {s.kind === 'target' ? (
        <Field
          label="目标岗位"
          value={doc.target}
          onValue={(v) =>
            change((d) => {
              d.target = v
            }, 'doc.target')
          }
        />
      ) : (
        <>
          {s.kind === 'evaluation' && (
            <label className="re-check">
              <input
                type="checkbox"
                checked={s.entries[0]?.fields.numbered !== 'false'}
                onChange={(v) =>
                  change((d) =>
                    updateNode<Section>(d, s.id, (n) => {
                      for (const e of n.entries) e.fields.numbered = String(v.target.checked)
                    }),
                  )
                }
              />
              自动编号
            </label>
          )}
          {(['work', 'project'].includes(s.kind) || s.intro.length > 0) && (
            <BlockSet owner={s.id} where="intro" blocks={s.intro} label="模块引言" />
          )}
          <div className="re-entries">
            {s.entries.map((e, i) => (
              <EntryRow key={e.id} s={s} e={e} i={i} />
            ))}
          </div>
          <button className="re-add-entry" onClick={addEntry}>
            <Plus size={14} />
            添加{entryLabels[s.kind]}
          </button>
          {(['education', 'work', 'custom'].includes(s.kind) || s.ending.length > 0) && (
            <BlockSet owner={s.id} where="ending" blocks={s.ending} label="结尾说明" />
          )}
        </>
      )}
    </SortRow>
  )
}
function LaneGroup({ lane }: { lane: Lane }) {
  const { doc, change, reveal, dropMark } = useEditor()
  const sections = doc.sections.filter((s) => s.lane === lane),
    name = '简历' + (lane === 'side' ? '左栏' : '右栏')
  function add(kind: Kind, custom?: string) {
    const s = newSection(kind, lane, custom)
    if (custom && ['证书', '课程', '社会实践'].includes(custom)) s.entries[0].fields.format = 'dated'
    change((d) => d.sections.push(s))
    reveal(s.entries[0]?.id || s.id, true)
  }
  const choices = Object.entries(titles)
    .filter(([kind]) => !['personal', 'target'].includes(kind) || !doc.sections.some((s) => s.kind === kind))
    .map(([kind, names]) => ({ label: names[0], action: () => add(kind as Kind) }))
    .concat(
      ['证书', '课程', '个人成果', '社会实践', '推荐人', '爱好'].map((label) => ({
        label,
        action: () => add('custom', label),
      })),
    )
  return (
    <section className="re-lane" data-editor-lane={lane}>
      <header className="re-lanehead">
        {lane === 'side' ? <PanelLeft size={16} /> : <PanelRight size={16} />}
        <h3>{name}</h3>
        <span>{sections.length} 个模块</span>
      </header>
      {sections.map((s) => (
        <SectionCard key={s.id} s={s} />
      ))}
      <div
        className={'re-lane-end' + (dropMark === lane + 'end' ? ' re-drop-before' : '')}
        data-lane-end={lane}
      >
        <Menu choices={choices} label={'添加模块到' + name}>
          <Plus size={15} />
          添加模块
        </Menu>
      </div>
    </section>
  )
}
function HeaderEditor() {
  const { doc, change, notice, expanded, toggle } = useEditor(),
    [crop, setCrop] = useState<Photo | null>(null)
  const file = useRef<HTMLInputElement>(null),
    opened = expanded.has('header')
  return (
    <section className={'re-header-card' + (opened ? ' is-open' : '')} data-editor-id="header">
      <button onClick={() => toggle('header')} className="re-headertoggle" aria-expanded={opened}>
        <span className="re-cap-icon">
          <ImageIcon size={17} />
        </span>
        <strong>抬头与照片</strong>
        {opened ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {opened && (
        <div className="re-nodebody">
          <Field
            label="打印标题"
            value={doc.title}
            onValue={(v) =>
              change((d) => {
                d.title = v
              }, 'doc.title')
            }
          />
          <label className="re-check">
            <input
              type="checkbox"
              checked={doc.useTarget}
              onChange={(e) =>
                change((d) => {
                  d.useTarget = e.target.checked
                })
              }
            />
            使用目标岗位作为标题
          </label>
          <input
            hidden
            type="file"
            ref={file}
            aria-label="选择照片文件"
            accept="image/jpeg,image/png"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              if (!['image/jpeg', 'image/png'].includes(f.type)) {
                notice('请选择 JPG 或 PNG 图片')
                return
              }
              try {
                setCrop({ src: await fileData(f), x: 0.5, y: 0.5, zoom: 1, rotation: 0 })
              } catch {
                notice('无法读取照片')
              }
            }}
          />
          <div className="re-photo">
            {doc.photo ? (
              <img src={doc.photo.src} alt="原始照片" />
            ) : (
              <span>
                <Camera size={22} />
              </span>
            )}
            <div className="re-photo-actions">
              <button onClick={() => file.current?.click()}>{doc.photo ? '更换照片' : '选择照片'}</button>
              {doc.photo && (
                <>
                  <button onClick={() => setCrop(doc.photo)}>编辑照片</button>
                  <button
                    onClick={() =>
                      change((d) => {
                        d.photo = null
                      })
                    }
                  >
                    移除照片
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {crop &&
        createPortal(
          <PhotoCrop
            initial={crop}
            onClose={() => setCrop(null)}
            onApply={(p) => {
              change((d) => {
                d.photo = p
              })
              setCrop(null)
            }}
          />,
          document.body,
        )}
    </section>
  )
}

export function Editor({ doc, onChange, focusId, onLocate }: EditorProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [ghost, setGhost] = useState<{ x: number; y: number; text: string } | null>(null),
    [dropMark, setDropMark] = useState(''),
    [confirm, setConfirm] = useState<Confirm | null>(null)
  const [message, setMessage] = useState(''),
    noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const docRef = useRef(doc)
  docRef.current = doc
  const root = useRef<HTMLDivElement>(null)
  const change: Change = (fn, group) => {
    const next = editorCopy(docRef.current)
    fn(next)
    docRef.current = next
    onChange(next, group)
  }
  function notice(text: string) {
    setMessage(text)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setMessage(''), 3200)
  }
  const reveal = useCallback((id: string, focus = false) => {
    const node = findNode(docRef.current, id)
    if (!node && id !== 'header') return
    setExpanded((prev) => new Set([...prev, ...(node?.ancestors || []), id]))
    requestAnimationFrame(() => {
      const elem = root.current?.querySelector<HTMLElement>('[data-editor-id="' + CSS.escape(id) + '"]')
      elem?.scrollIntoView({ block: 'nearest' })
      if (!elem || !focus) return
      const preferred =
        node?.collection === 'block' && 'type' in node.node && node.node.type !== 'group'
          ? '[contenteditable="true"]'
          : 'input:not([type="checkbox"]):not([hidden]),textarea,select'
      elem.querySelector<HTMLElement>(preferred)?.focus({ preventScroll: true })
    })
  }, [])
  useEffect(() => {
    if (focusId) reveal(focusId, true)
  }, [focusId, reveal])
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    },
    [],
  )
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const cleanupDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanupDrag.current?.(), [])
  function startDrag(e: ReactPointerEvent<HTMLElement>, drag: DragItem) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    cleanupDrag.current?.()
    const startX = e.clientX,
      startY = e.clientY,
      source = findNode(docRef.current, drag.id)
    if (!source) return
    let active = false,
      x = startX,
      y = startY,
      frame = 0
    const handle = e.currentTarget,
      pointer = e.pointerId
    handle.setPointerCapture(pointer)
    const text = drag.marker
      ? '分页'
      : handle.closest('[data-editor-id]')?.querySelector('.re-caption')?.textContent || ''
    type Dest = { target: string; after: boolean } | { lane: Lane }
    function destination(): Dest | null {
      const hit = document.elementFromPoint(x, y)
      if (!hit || !root.current?.contains(hit)) return null
      const tail = hit.closest<HTMLElement>('[data-lane-end]')
      if (tail && source!.collection === 'section' && !drag.marker)
        return { lane: tail.dataset.laneEnd as Lane }
      let target = hit.closest<HTMLElement>('[data-editor-id]')
      while (target) {
        const id = target.dataset.editorId!
        const dest = findNode(docRef.current, id)
        if (dest?.collection === source!.collection) {
          if (!validDrop(source!, dest, drag.marker)) return null
          const rect = target.getBoundingClientRect()
          return { target: id, after: !drag.marker && y > rect.top + rect.height / 2 }
        }
        target = target.parentElement?.closest<HTMLElement>('[data-editor-id]') || null
      }
      return null
    }
    function paint() {
      const d = destination()
      setDropMark(d ? ('lane' in d ? d.lane + 'end' : d.target + (d.after ? ':after' : ':before')) : '')
      setGhost({ x, y, text })
    }
    function autoScroll() {
      const scroller = root.current?.closest<HTMLElement>('.edit-pane')
      if (scroller && active) {
        const r = scroller.getBoundingClientRect(),
          step = y < r.top + 46 ? -10 : y > r.bottom - 46 ? 10 : 0
        if (step && x >= r.left && x <= r.right) {
          const old = scroller.scrollTop
          scroller.scrollTop += step
          if (old !== scroller.scrollTop) paint()
        }
      }
      frame = requestAnimationFrame(autoScroll)
    }
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return
      x = event.clientX
      y = event.clientY
      if (!active && Math.hypot(x - startX, y - startY) > 3) {
        active = true
        frame = requestAnimationFrame(autoScroll)
      }
      if (active) paint()
    }
    const end = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return
      x = event.clientX
      y = event.clientY
      const dest = active || Math.hypot(x - startX, y - startY) > 3 ? destination() : null
      cleanup()
      if (dest)
        change((d) => {
          if ('lane' in dest) moveToLane(d, drag.id, dest.lane)
          else moveTreeNode(d, drag, dest.target, dest.after)
        })
    }
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cleanup()
      }
    }
    function cleanup() {
      document.removeEventListener('pointermove', move, true)
      document.removeEventListener('pointerup', end, true)
      document.removeEventListener('pointercancel', cleanup, true)
      document.removeEventListener('keydown', cancel, true)
      window.removeEventListener('blur', cleanup)
      if (handle.hasPointerCapture(pointer)) handle.releasePointerCapture(pointer)
      cancelAnimationFrame(frame)
      setDropMark('')
      setGhost(null)
      cleanupDrag.current = null
    }
    cleanupDrag.current = cleanup
    document.addEventListener('pointermove', move, true)
    document.addEventListener('pointerup', end, true)
    document.addEventListener('pointercancel', cleanup, true)
    document.addEventListener('keydown', cancel, true)
    window.addEventListener('blur', cleanup)
  }
  return (
    <C.Provider
      value={{
        doc,
        change,
        expanded,
        toggle,
        reveal,
        locate: (id) => onLocate?.(id),
        confirm: setConfirm,
        startDrag,
        dropMark,
        notice,
      }}
    >
      <div ref={root} className="resume-editor">
        {ghost &&
          createPortal(
            <div className="re-drag-ghost" style={{ left: ghost.x + 14, top: ghost.y + 12 }}>
              {ghost.text}
            </div>,
            document.body,
          )}
        <HeaderEditor />
        <LaneGroup lane="side" />
        <LaneGroup lane="main" />
        {message && (
          <div className="re-toast" role="status">
            {message}
          </div>
        )}
      </div>
      {confirm &&
        createPortal(
          <div className="re-overlay">
            <div
              role="alertdialog"
              aria-label={confirm.title}
              className="re-dialog"
              onKeyDown={(e) => {
                if (e.key === 'Escape') setConfirm(null)
              }}
            >
              <h3>{confirm.title}</h3>
              <p>{confirm.body}</p>
              <footer>
                <button autoFocus onClick={() => setConfirm(null)}>
                  取消
                </button>
                <button
                  className="re-danger"
                  onClick={() => {
                    confirm.action()
                    setConfirm(null)
                  }}
                >
                  删除模块
                </button>
              </footer>
            </div>
          </div>,
          document.body,
        )}
    </C.Provider>
  )
}

const controls = [
  ['size', '正文字号', 'pt', 9, 12, 0.25],
  ['lineHeight', '行高', '倍', 1.15, 1.65, 0.05],
  ['itemGap', '条目间距', 'mm', 0, 6, 0.5],
  ['paragraphGap', '正文段间距', 'mm', 0, 3, 0.2],
  ['sectionGap', '模块间距', 'mm', 2, 9, 0.5],
  ['margin', '页面边距', 'mm', 4, 9, 0.5],
] as const
export function StylePanel({ doc, onChange }: { doc: Resume; onChange: EditorProps['onChange'] }) {
  const gesture = useRef(''),
    [hex, setHex] = useState(doc.style.color)
  useEffect(() => setHex(doc.style.color), [doc.style.color])
  function set<K extends keyof Style>(key: K, value: Style[K], group?: string) {
    onChange({ ...doc, style: { ...doc.style, [key]: value } }, group)
  }
  return (
    <div className="re-style">
      <label className="re-field">
        <span>正文字体</span>
        <select
          aria-label="正文字体"
          value={doc.style.font}
          onChange={(e) => set('font', e.target.value as Style['font'])}
        >
          <option value="sans">思源黑体 · Sans</option>
          <option value="serif">思源宋体 · Serif</option>
        </select>
      </label>
      {controls.map(([key, label, unit, min, max, step]) => (
        <div className="re-slider" key={key}>
          <div>
            <label htmlFor={'style-' + key}>{label}</label>
            <output>
              {doc.style[key]} {unit}
            </output>
          </div>
          <div>
            <button
              aria-label={'减小' + label}
              disabled={doc.style[key] <= min}
              onClick={() => set(key, Math.max(min, Number((doc.style[key] - step).toFixed(2))))}
            >
              <Minus size={12} />
            </button>
            <input
              id={'style-' + key}
              type="range"
              min={min}
              max={max}
              step={step}
              value={doc.style[key]}
              onPointerDown={() => {
                gesture.current = crypto.randomUUID()
              }}
              onChange={(e) => set(key, Number(e.target.value), 'style.' + key + '.' + gesture.current)}
            />
            <button
              aria-label={'增大' + label}
              disabled={doc.style[key] >= max}
              onClick={() => set(key, Math.min(max, Number((doc.style[key] + step).toFixed(2))))}
            >
              <Plus size={12} />
            </button>
          </div>
        </div>
      ))}
      <label className="re-color">
        <span>主题色</span>
        <input
          aria-label="选择主题色"
          type="color"
          value={doc.style.color}
          onChange={(e) => set('color', e.target.value, 'theme-color')}
        />
        <input
          aria-label="主题色值"
          value={hex}
          onChange={(e) => {
            const value = e.target.value
            setHex(value)
            if (/^#[0-9a-f]{6}$/i.test(value)) set('color', value, 'theme-color')
          }}
          onBlur={() => setHex(doc.style.color)}
        />
      </label>
      <label className="re-check">
        <input
          type="checkbox"
          checked={doc.style.pageNumbers}
          onChange={(e) => set('pageNumbers', e.target.checked)}
        />
        在成稿显示页码
      </label>
      <button className="re-reset" onClick={() => onChange({ ...doc, style: { ...defaults } })}>
        恢复模板默认值
      </button>
    </div>
  )
}
