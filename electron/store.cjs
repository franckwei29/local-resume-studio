const { DatabaseSync } = require('node:sqlite')
const { randomUUID, createHash } = require('node:crypto')
const { mkdirSync, readFileSync } = require('node:fs')
const path = require('node:path')
const templates = new Set(require('./templates.json').map((template) => template.id))

const kinds = new Set([
  'personal',
  'target',
  'education',
  'work',
  'project',
  'evaluation',
  'skills',
  'language',
  'custom',
  'signature',
])
const blockTypes = new Set(['paragraph', 'label', 'group', 'bullet', 'number'])
const styleRanges = {
  size: [9, 12],
  lineHeight: [1.15, 1.65],
  itemGap: [0, 6],
  paragraphGap: [0, 3],
  sectionGap: [2, 9],
}
const string = (value) => typeof value === 'string'
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value) => typeof value === 'number' && Number.isFinite(value)
function check(valid, detail) {
  if (!valid) throw new Error('简历数据无效：' + detail)
}
function validateImage(src) {
  const match = typeof src === 'string' && src.match(/^data:image\/(png|jpeg);base64,([a-zA-Z0-9+/]+={0,2})$/)
  check(match, '图片需要内嵌 PNG 或 JPEG')
  const data = Buffer.from(match[2], 'base64')
  check(
    match[1] === 'png'
      ? data.length >= 45 &&
          data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
          data.toString('ascii', 12, 16) === 'IHDR' &&
          data.includes(Buffer.from('IEND'))
      : data.length >= 12 &&
          data[0] === 0xff &&
          data[1] === 0xd8 &&
          data[2] === 0xff &&
          data.lastIndexOf(Buffer.from([0xff, 0xd9])) >= 2,
    '图片内容损坏',
  )
}
function mapImages(doc, transform) {
  if (doc.photo) doc.photo.src = transform(doc.photo.src)
  for (const section of doc.sections) {
    if (section.kind === 'signature')
      for (const entry of section.entries) {
        if (entry.fields.image) entry.fields.image = transform(entry.fields.image)
      }
  }
  return doc
}
function supportedTemplate(id, version) {
  check(templates.has(id) && version === 1, '当前版本无法读取模板或其版次，请更新简历工坊。')
}
function validateStyle(st, templateId) {
  const [minMargin, maxMargin] = templateId === '00' ? [4, 9] : [8, 20]
  check(
    object(st) &&
      ['serif', 'sans'].includes(st.font) &&
      /^#[\da-f]{6}$/i.test(st.color) &&
      typeof st.pageNumbers === 'boolean' &&
      finite(st.margin) &&
      st.margin >= minMargin &&
      st.margin <= maxMargin &&
      Object.entries(styleRanges).every(
        ([key, [low, high]]) => finite(st[key]) && st[key] >= low && st[key] <= high,
      ),
    '排版参数',
  )
}
function upgradeLegacy(doc) {
  return { ...doc, schemaVersion: 2, templateId: '00', templateVersion: 1, templateLayouts: {} }
}
function validate(doc) {
  check(object(doc) && [1, 2].includes(doc.schemaVersion), '不支持的数据版本，请更新简历工坊。')
  if (doc.schemaVersion === 1) {
    check(
      doc.templateId === undefined && doc.templateVersion === undefined && doc.templateLayouts === undefined,
      '旧格式的模板数据无效',
    )
    doc = upgradeLegacy(doc)
  }
  supportedTemplate(doc.templateId, doc.templateVersion)
  const ids = new Set()
  function node(item) {
    check(object(item) && string(item.id) && item.id.length && !ids.has(item.id), '条目标识缺失或重复')
    ids.add(item.id)
    for (const flag of ['hidden', 'breakBefore'])
      check(item[flag] === undefined || typeof item[flag] === 'boolean', '显示或分页状态')
  }
  function blocks(list) {
    check(Array.isArray(list), '缺少段落列表')
    for (const b of list) {
      node(b)
      check(blockTypes.has(b.type) && string(b.label) && Array.isArray(b.runs), '段落类型')
      for (const r of b.runs) {
        check(object(r) && string(r.text), '缺少文字')
        for (const flag of ['bold', 'italic', 'underline'])
          check(r[flag] === undefined || typeof r[flag] === 'boolean', '文字格式')
        check(
          !r.href || (string(r.href) && /^(https?:\/\/|mailto:)/i.test(r.href)),
          '链接需要使用 http、https 或 mailto',
        )
      }
      blocks(b.children)
    }
  }
  node(doc)
  check(string(doc.name) && doc.name.trim(), '文档名称为空')
  check([doc.target, doc.title].every(string) && typeof doc.useTarget === 'boolean', '基本信息')
  check(['zh', 'en'].includes(doc.lang) && Array.isArray(doc.sections), '栏目或语言')
  check(
    Number.isSafeInteger(doc.revision) &&
      doc.revision >= 0 &&
      finite(doc.created) &&
      finite(doc.modified) &&
      (doc.trashed === null || finite(doc.trashed)),
    '版本或时间',
  )
  validateStyle(doc.style, doc.templateId)
  if (doc.photo !== null) {
    check(
      object(doc.photo) &&
        ['x', 'y'].every((k) => finite(doc.photo[k]) && doc.photo[k] >= 0 && doc.photo[k] <= 1) &&
        finite(doc.photo.zoom) &&
        doc.photo.zoom >= 1 &&
        doc.photo.zoom <= 3 &&
        [0, 90, 180, 270].includes(doc.photo.rotation),
      '照片取景',
    )
    validateImage(doc.photo.src)
  }
  for (const sec of doc.sections) {
    node(sec)
    check(
      kinds.has(sec.kind) &&
        ['main', 'side'].includes(sec.lane) &&
        string(sec.title) &&
        Array.isArray(sec.entries),
      '栏目类型',
    )
    blocks(sec.intro)
    blocks(sec.ending)
    for (const e of sec.entries) {
      node(e)
      check(
        object(e.fields) &&
          Object.values(e.fields).every(string) &&
          string(e.start) &&
          string(e.end) &&
          typeof e.current === 'boolean',
        '条目字段',
      )
      for (const v of Object.values(e.fields)) if (v.startsWith('data:image/')) validateImage(v)
      blocks(e.blocks)
    }
  }
  check(object(doc.templateLayouts), '缺少模板布局')
  const sections = new Set(doc.sections.map((s) => s.id))
  const isSingle = (id) => !['0', 'B', 'C'].includes(id[0])
  check(!isSingle(doc.templateId) || doc.sections.every((s) => s.lane === 'main'), '单栏模板只支持正文区')
  for (const [id, layout] of Object.entries(doc.templateLayouts)) {
    check(id !== doc.templateId && object(layout), '模板布局重复或无效')
    supportedTemplate(id, layout.version)
    validateStyle(layout.style, id)
    check(Array.isArray(layout.sections), '模板缺少栏目位置')
    const placed = new Set()
    for (const placement of layout.sections) {
      check(
        object(placement) && sections.has(placement.id) && !placed.has(placement.id),
        '模板栏目位置缺失或重复',
      )
      check(placement.lane === 'main' || (placement.lane === 'side' && !isSingle(id)), '模板栏位无效')
      placed.add(placement.id)
    }
  }
  return doc
}

function freshCopy(source) {
  const copy = structuredClone(validate(source))
  function id(item) {
    item.id = randomUUID()
  }
  function resetBlocks(list) {
    for (const b of list) {
      id(b)
      resetBlocks(b.children)
    }
  }
  id(copy)
  const sectionIds = new Map()
  for (const sec of copy.sections) {
    const oldId = sec.id
    id(sec)
    sectionIds.set(oldId, sec.id)
    resetBlocks(sec.intro)
    resetBlocks(sec.ending)
    for (const e of sec.entries) {
      id(e)
      resetBlocks(e.blocks)
    }
  }
  for (const layout of Object.values(copy.templateLayouts)) {
    for (const placement of layout.sections) placement.id = sectionIds.get(placement.id)
  }
  return Object.assign(copy, { created: Date.now(), modified: Date.now(), revision: 0, trashed: null })
}
class Store {
  constructor(folder) {
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    this.folder = folder
    this.db = new DatabaseSync(path.join(folder, 'resumes.sqlite'))
    this.db.exec(`PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, name TEXT NOT NULL, trashed INTEGER, revision INTEGER NOT NULL, snapshot TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS active_name ON docs(name) WHERE trashed IS NULL;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS images (digest TEXT PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS image_refs (doc TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(doc,digest));
      CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,at INTEGER NOT NULL);`)
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }
  privateSeed() {
    try {
      return validate(JSON.parse(readFileSync(path.join(this.folder, 'seed.json'), 'utf8')))
    } catch (e) {
      if (e.code === 'ENOENT') return null
      throw e
    }
  }
  initialize(publicSeed) {
    const chosen = this.privateSeed() || validate(publicSeed)
    this.transaction(() => {
      const { user_version: version } = this.db.prepare('PRAGMA user_version').get()
      check(version <= 2, '该数据库需要更新版本的简历工坊。')
      if (version < 2) {
        const update = this.db.prepare('UPDATE docs SET snapshot=? WHERE id=?')
        for (const row of this.db.prepare('SELECT id,snapshot FROM docs').all()) {
          const packed = JSON.parse(row.snapshot)
          validate(this.readSnapshot(row))
          if (packed.schemaVersion === 1) update.run(JSON.stringify(upgradeLegacy(packed)), row.id)
        }
        this.db.exec('PRAGMA user_version=2')
      }
      if (!this.db.prepare("SELECT 1 FROM settings WHERE key='initialized'").get()) {
        this.put(freshCopy(chosen), 0)
        this.db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('initialized', '1')
      }
    })
    return chosen
  }
  readSnapshot(row) {
    return mapImages(JSON.parse(row.snapshot), (src) => {
      if (!src.startsWith('asset:')) return src
      const image = this.db.prepare('SELECT mime,bytes FROM images WHERE digest=?').get(src.slice(6))
      if (!image) throw new Error('本地图片资源缺失，请恢复可编辑备份。')
      return 'data:' + image.mime + ';base64,' + Buffer.from(image.bytes).toString('base64')
    })
  }
  list() {
    return this.db
      .prepare('SELECT snapshot FROM docs ORDER BY id')
      .all()
      .map((r) => this.readSnapshot(r))
  }
  get(id) {
    const row = this.db.prepare('SELECT snapshot FROM docs WHERE id=?').get(id)
    return row ? this.readSnapshot(row) : null
  }
  storeImages(doc) {
    this.db.prepare('DELETE FROM image_refs WHERE doc=?').run(doc.id)
    const packed = mapImages(structuredClone(doc), (src) => {
      validateImage(src)
      const cut = src.indexOf(';base64,')
      const mime = src.slice(5, cut)
      const bytes = Buffer.from(src.slice(cut + 8), 'base64')
      const digest = createHash('sha256').update(bytes).digest('hex')
      this.db
        .prepare('INSERT OR IGNORE INTO images(digest,mime,bytes) VALUES (?,?,?)')
        .run(digest, mime, bytes)
      this.db.prepare('INSERT OR IGNORE INTO image_refs(doc,digest) VALUES (?,?)').run(doc.id, digest)
      return 'asset:' + digest
    })
    this.collectUnusedImages()
    return packed
  }
  collectUnusedImages() {
    this.db.exec('DELETE FROM images WHERE digest NOT IN (SELECT digest FROM image_refs)')
  }
  put(incoming, expected) {
    const doc = validate(structuredClone(incoming))
    doc.name = doc.name.trim()
    const existing = this.get(doc.id)
    if ((existing?.revision || 0) !== (expected ?? doc.revision))
      throw new Error('文档已被更新，请重新打开后重试。')
    if (
      doc.trashed === null &&
      this.db.prepare('SELECT id FROM docs WHERE name=? AND trashed IS NULL AND id<>?').get(doc.name, doc.id)
    ) {
      throw new Error('已存在同名简历。')
    }
    doc.created = existing?.created ?? doc.created
    doc.modified = Date.now()
    doc.revision = (existing?.revision || 0) + 1
    const snapshot = this.storeImages(doc)
    this.db
      .prepare(
        `INSERT INTO docs(id,name,trashed,revision,snapshot) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,trashed=excluded.trashed,revision=excluded.revision,snapshot=excluded.snapshot`,
      )
      .run(doc.id, doc.name, doc.trashed, doc.revision, JSON.stringify(snapshot))
    return doc
  }
  save(doc, expected) {
    return this.transaction(() => this.put(doc, expected))
  }
  restore(raw) {
    const doc = freshCopy(raw)
    return this.transaction(() => {
      const base = doc.name
      let n = 1
      while (this.db.prepare('SELECT 1 FROM docs WHERE trashed IS NULL AND name=?').get(doc.name)) {
        doc.name = n === 1 ? base + '（已恢复）' : base + '（已恢复 ' + n + '）'
        n++
      }
      return this.put(doc, 0)
    })
  }
  remove(id) {
    this.transaction(() => {
      if (!this.db.prepare('DELETE FROM docs WHERE id=? AND trashed IS NOT NULL').run(id).changes)
        throw new Error('只能永久删除回收站中的简历。')
      this.db.prepare('DELETE FROM exports WHERE id=?').run(id)
      this.db.prepare('DELETE FROM image_refs WHERE doc=?').run(id)
      this.collectUnusedImages()
    })
  }
  recordExport(id, revision) {
    this.db
      .prepare('INSERT OR REPLACE INTO exports(id,revision,at) VALUES (?,?,?)')
      .run(id, revision, Date.now())
  }
  close() {
    this.db.close()
  }
}
module.exports = { Store, validate, freshCopy, mapImages }
