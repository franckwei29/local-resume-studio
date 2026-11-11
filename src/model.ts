export type Lane = 'side' | 'main'
export type Kind =
  | 'personal'
  | 'target'
  | 'education'
  | 'work'
  | 'project'
  | 'evaluation'
  | 'skills'
  | 'language'
  | 'custom'
  | 'signature'
export interface Run {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  href?: string
}
export interface Block {
  id: string
  type: 'paragraph' | 'label' | 'group' | 'bullet' | 'number'
  label: string
  runs: Run[]
  children: Block[]
  hidden?: boolean
  breakBefore?: boolean
}
export interface Entry {
  id: string
  fields: Record<string, string>
  start: string
  end: string
  current: boolean
  blocks: Block[]
  hidden?: boolean
  breakBefore?: boolean
}
export interface Section {
  id: string
  kind: Kind
  title: string
  customTitle?: boolean
  lane: Lane
  entries: Entry[]
  intro: Block[]
  ending: Block[]
  hidden?: boolean
  breakBefore?: boolean
}
export interface Photo {
  src: string
  x: number
  y: number
  zoom: number
  rotation: number
}
export interface Style {
  font: 'sans' | 'serif'
  size: number
  lineHeight: number
  itemGap: number
  paragraphGap: number
  sectionGap: number
  margin: number
  color: string
  pageNumbers: boolean
}
export interface TemplateLayout {
  version: 1
  style: Style
  sections: { id: string; lane: Lane }[]
}
export interface Resume {
  schemaVersion: 2
  templateId: string
  templateVersion: 1
  templateLayouts: Record<string, TemplateLayout>
  id: string
  name: string
  target: string
  title: string
  useTarget: boolean
  photo: Photo | null
  lang: 'zh' | 'en'
  sections: Section[]
  style: Style
  revision: number
  created: number
  modified: number
  trashed: number | null
}
export const defaults: Style = {
  font: 'sans',
  size: 10,
  lineHeight: 1.35,
  itemGap: 3,
  paragraphGap: 0.8,
  sectionGap: 5,
  margin: 5,
  color: '#405983',
  pageNumbers: false,
}
export const titles: Record<Kind, [string, string]> = {
  personal: ['个人信息', 'Personal details'],
  target: ['目标岗位', 'Target role'],
  education: ['教育背景', 'Education'],
  work: ['工作经历', 'Work experience'],
  project: ['项目经历', 'Projects'],
  evaluation: ['自我评价', 'Profile'],
  skills: ['技能', 'Skills'],
  language: ['语言', 'Languages'],
  custom: ['自定义段落', 'Additional information'],
  signature: ['签名', 'Signature'],
}
export const uid = () => crypto.randomUUID()
export const block = (type: Block['type'] = 'paragraph', text = '', label = ''): Block => ({
  id: uid(),
  type,
  label,
  runs: [{ text }],
  children: [],
})
export const entry = (fields: Record<string, string> = {}): Entry => ({
  id: uid(),
  fields,
  start: '',
  end: '',
  current: false,
  blocks: [],
})
export const section = (kind: Kind, lane: Lane): Section => ({
  id: uid(),
  kind,
  title: titles[kind][0],
  lane,
  entries: [],
  intro: [],
  ending: [],
})
export function blank(name = '新简历'): Resume {
  const now = Date.now()
  return {
    schemaVersion: 2,
    templateId: '00',
    templateVersion: 1,
    templateLayouts: {},
    id: uid(),
    name,
    target: '',
    title: '简历',
    useTarget: false,
    photo: null,
    lang: 'zh',
    sections: [
      section('personal', 'side'),
      section('target', 'side'),
      section('education', 'main'),
      section('work', 'main'),
    ],
    style: { ...defaults },
    revision: 0,
    created: now,
    modified: now,
    trashed: null,
  }
}
export const printedTitle = (s: Section, lang: Resume['lang']) =>
  s.customTitle ? s.title : titles[s.kind][lang === 'zh' ? 0 : 1]
