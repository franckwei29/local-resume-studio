const { DatabaseSync } = require('node:sqlite')
const { randomUUID } = require('node:crypto')
const { mkdirSync, readFileSync } = require('node:fs')
const path = require('node:path')

const kinds = new Set(['personal','target','education','work','project','evaluation','skills','language','custom','signature'])
const blockTypes = new Set(['paragraph','label','group','bullet','number'])
const string = value => typeof value === 'string'
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = value => typeof value === 'number' && Number.isFinite(value)
function check(valid, detail) {
  if (!valid) throw new Error('简历数据无效：' + detail)
}
function validateImage(src) {
  const match = typeof src === 'string' && src.match(/^data:image\/(png|jpeg);base64,([a-zA-Z0-9+/]+={0,2})$/)
  check(match,'图片需要内嵌 PNG 或 JPEG')
  const data = Buffer.from(match[2],'base64')
  check(match[1] === 'png' ? data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) :
    data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,'图片内容损坏')
}
function validate(doc) {
  check(object(doc) && doc.schemaVersion === 1, '不支持的数据版本')
  const ids = new Set()
  function node(item) {
    check(object(item) && string(item.id) && item.id.length && !ids.has(item.id), '条目标识缺失或重复')
    ids.add(item.id)
    for (const flag of ['hidden','breakBefore']) check(item[flag] === undefined || typeof item[flag] === 'boolean', '显示或分页状态')
  }
  function blocks(list) {
    check(Array.isArray(list),'缺少段落列表')
    for (const b of list) {
      node(b)
      check(blockTypes.has(b.type) && string(b.label) && Array.isArray(b.runs),'段落类型')
      for (const r of b.runs) {
        check(object(r) && string(r.text),'缺少文字')
        for (const flag of ['bold','italic','underline']) check(r[flag] === undefined || typeof r[flag] === 'boolean','文字格式')
        check(!r.href || (string(r.href) && /^(https?:\/\/|mailto:)/i.test(r.href)),'链接需要使用 http、https 或 mailto')
      }
      blocks(b.children)
    }
  }
  node(doc)
  check(string(doc.name) && doc.name.trim(),'文档名称为空')
  check([doc.target,doc.title].every(string) && typeof doc.useTarget === 'boolean','基本信息')
  check(['zh','en'].includes(doc.lang) && Array.isArray(doc.sections),'栏目或语言')
  check(Number.isSafeInteger(doc.revision) && doc.revision >= 0 && finite(doc.created) && finite(doc.modified) &&
    (doc.trashed === null || finite(doc.trashed)),'版本或时间')
  const st = doc.style
  check(object(st) && ['serif','sans'].includes(st.font) && /^#[\da-f]{6}$/i.test(st.color) &&
    typeof st.pageNumbers === 'boolean' && ['size','lineHeight','itemGap','paragraphGap','sectionGap','margin'].every(k => finite(st[k]) && st[k] >= 0),'排版参数')
  if (doc.photo !== null) {
    check(object(doc.photo) && ['x','y','zoom','rotation'].every(k => finite(doc.photo[k])) && doc.photo.zoom > 0,'照片取景')
    validateImage(doc.photo.src)
  }
  for (const sec of doc.sections) {
    node(sec)
    check(kinds.has(sec.kind) && ['main','side'].includes(sec.lane) && string(sec.title) && Array.isArray(sec.entries),'栏目类型')
    blocks(sec.intro)
    blocks(sec.ending)
    for (const e of sec.entries) {
      node(e)
      check(object(e.fields) && Object.values(e.fields).every(string) && string(e.start) && string(e.end) && typeof e.current === 'boolean','条目字段')
      for (const v of Object.values(e.fields)) if (v.startsWith('data:image/')) validateImage(v)
      blocks(e.blocks)
    }
  }
  return doc
}

function freshCopy(source) {
  const copy = structuredClone(validate(source))
  function id(item) { item.id = randomUUID() }
  function resetBlocks(list) { for (const b of list) {id(b); resetBlocks(b.children)} }
  id(copy)
  for (const sec of copy.sections) {
    id(sec); resetBlocks(sec.intro); resetBlocks(sec.ending)
    for (const e of sec.entries) {id(e); resetBlocks(e.blocks)}
  }
  return Object.assign(copy,{created: Date.now(), modified: Date.now(), revision: 0, trashed:null})
}
class Store {
  constructor(folder) {
    mkdirSync(folder,{recursive:true,mode:0o700})
    this.folder=folder
    this.db = new DatabaseSync(path.join(folder,'resumes.sqlite'))
    this.db.exec(`PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, name TEXT NOT NULL, trashed INTEGER, revision INTEGER NOT NULL, snapshot TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS active_name ON docs(name) WHERE trashed IS NULL;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS exports (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,at INTEGER NOT NULL);`)
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try {const result=fn(); this.db.exec('COMMIT'); return result}
    catch (err) {this.db.exec('ROLLBACK'); throw err}
  }
  privateSeed() {
    try { return validate(JSON.parse(readFileSync(path.join(this.folder,'seed.json'),'utf8'))) }
    catch (e) {if(e.code==='ENOENT') return null; throw e}
  }
  initialize(publicSeed) {
    const chosen = this.privateSeed() || validate(publicSeed)
    this.transaction(() => {
      if (!this.db.prepare("SELECT 1 FROM settings WHERE key='initialized'").get()) {
        this.put(freshCopy(chosen),0)
        this.db.prepare('INSERT INTO settings(key,value) VALUES (?,?)').run('initialized','1')
      }
    })
    return chosen
  }
  list() { return this.db.prepare('SELECT snapshot FROM docs ORDER BY id').all().map(r=>JSON.parse(r.snapshot)) }
  get(id) { const row=this.db.prepare('SELECT snapshot FROM docs WHERE id=?').get(id); return row ? JSON.parse(row.snapshot) : null }
  put(incoming,expected) {
    const doc=validate(structuredClone(incoming))
    doc.name=doc.name.trim()
    const existing=this.get(doc.id)
    if ((existing?.revision || 0) !== (expected ?? doc.revision)) throw new Error('文档已被更新，请重新打开后重试。')
    if (doc.trashed === null && this.db.prepare('SELECT id FROM docs WHERE name=? AND trashed IS NULL AND id<>?').get(doc.name,doc.id)) {
      throw new Error('已存在同名简历。')
    }
    doc.created=existing?.created ?? doc.created
    doc.modified=Date.now(); doc.revision=(existing?.revision || 0)+1
    this.db.prepare(`INSERT INTO docs(id,name,trashed,revision,snapshot) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,trashed=excluded.trashed,revision=excluded.revision,snapshot=excluded.snapshot`)
      .run(doc.id,doc.name,doc.trashed,doc.revision,JSON.stringify(doc))
    return doc
  }
  save(doc,expected) {return this.transaction(()=>this.put(doc,expected))}
  restore(raw) {
    const doc=freshCopy(raw)
    return this.transaction(()=>{
      const base=doc.name
      let n=1
      while (this.db.prepare('SELECT 1 FROM docs WHERE trashed IS NULL AND name=?').get(doc.name)) {
        doc.name=n===1 ? base+'（已恢复）' : base+'（已恢复 '+n+'）'; n++
      }
      return this.put(doc,0)
    })
  }
  remove(id) {
    this.transaction(()=>{
      if (!this.db.prepare('DELETE FROM docs WHERE id=? AND trashed IS NOT NULL').run(id).changes)
        throw new Error('只能永久删除回收站中的简历。')
      this.db.prepare('DELETE FROM exports WHERE id=?').run(id)
    })
  }
  recordExport(id,revision) {
    this.db.prepare('INSERT OR REPLACE INTO exports(id,revision,at) VALUES (?,?,?)').run(id,revision,Date.now())
  }
  close() {this.db.close()}
}
module.exports={Store,validate,freshCopy}
