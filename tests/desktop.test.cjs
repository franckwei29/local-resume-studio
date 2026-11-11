const {test}=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs/promises')
const os=require('node:os')
const path=require('node:path')
const {execFileSync}=require('node:child_process')
const {Store,validate}=require('../electron/store.cjs')
const {atomicWrite,readImport}=require('../electron/files.cjs')

function seed(){
  return {schemaVersion:1,id:'doc',name:'公开示例',target:'设计师',title:'简历',useTarget:false,photo:null,lang:'zh',revision:0,created:0,modified:0,trashed:null,
    style:{font:'sans',size:10,lineHeight:1.35,itemGap:3,paragraphGap:.8,sectionGap:5,margin:5,color:'#405983',pageNumbers:false},
    sections:[{id:'sec',lane:'main',kind:'work',title:'工作经历',intro:[],ending:[],entries:[{id:'role',fields:{role:'设计师'},start:'2020-01',end:'',current:true,blocks:[
      {id:'group',type:'group',label:'子项目',runs:[],children:[{id:'child',type:'bullet',label:'成果',runs:[{text:'说明',bold:true}],children:[],breakBefore:true}]}]}]}]}
}
async function temporary(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'resume-studio-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir
}
test('SQLite initialization, revisions, isolated restore and restart',async t=>{
 const dir=await temporary(t)
 let store=new Store(dir);t.after(()=>store.close())
 store.initialize(seed());store.initialize(seed())
 assert.equal(store.list().length,1)
 const [base]=store.list()
 const copy=store.restore(base)
 assert.equal(copy.name,base.name+'（已恢复）')
 assert.notEqual(copy.sections[0].entries[0].blocks[0].children[0].id,base.sections[0].entries[0].blocks[0].children[0].id)
 assert.equal(copy.sections[0].entries[0].blocks[0].children[0].breakBefore,true)
 copy.sections[0].entries[0].fields.role='编辑'
 const saved=store.save(copy)
 assert.throws(()=>store.save(copy),/版本|更新/)
 assert.equal(store.get(base.id).sections[0].entries[0].fields.role,'设计师')
 assert.throws(()=>store.save({...saved,name:base.name}),/同名/)
 assert.equal(store.get(saved.id).revision,saved.revision)
 assert.throws(()=>store.remove(base.id),/回收站/)
 store.save({...base,trashed:Date.now()});store.remove(base.id)
 store.close();store=new Store(dir);store.initialize(seed())
 assert.equal(store.list().length,1);assert.equal(store.get(saved.id).sections[0].entries[0].fields.role,'编辑')
 const duplicate=structuredClone(saved);duplicate.sections.push(duplicate.sections[0])
 assert.throws(()=>store.restore(duplicate),/重复/)
 assert.throws(()=>validate({...saved,photo:{src:'data:image/png;base64,YmFk',x:0,y:0,zoom:1,rotation:0}}),/图片/)
 assert.equal(store.list().length,1)
})
test('atomic output preserves protected original, symlink target, and old data on failure',async t=>{
 const dir=await temporary(t), original=path.join(dir,'source.pdf'),alias=path.join(dir,'alias.pdf'),out=path.join(dir,'ready.pdf')
 await fs.writeFile(original,'original');await fs.symlink(original,alias);await fs.writeFile(out,'previous')
 await assert.rejects(atomicWrite(original,Buffer.from('new'),original),/参考原稿/)
 await assert.rejects(atomicWrite(alias,Buffer.from('new'),original),/参考原稿/)
 await assert.rejects(atomicWrite(out,{},original))
 assert.equal(await fs.readFile(out,'utf8'),'previous')
 await assert.rejects(atomicWrite(path.join(dir,'missing','bad.pdf'),'new',original))
 assert.deepEqual((await fs.readdir(dir)).sort(),['alias.pdf','ready.pdf','source.pdf'])
 await atomicWrite(out,'valid',original);assert.equal(await fs.readFile(out,'utf8'),'valid')
})
test('real DOCX, PDF text layer and raster-only PDF imports', {skip:process.platform!=='darwin',timeout:120000},async t=>{
 const dir=await temporary(t)
 execFileSync(process.execPath,['scripts/build-native.cjs'])
 const binary=path.resolve('native/bin/resume-import')
 execFileSync('/usr/bin/swift',['-module-cache-path',path.join(os.tmpdir(),'resume-studio-swift-cache'),'tests/fixtures/import.swift',dir])
 await fs.mkdir(path.join(dir,'word'))
 await fs.writeFile(path.join(dir,'word/document.xml'),'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+['教育背景','北湖大学 软件工程 硕士 2022.09—2025.07','西山学院 数学 本科 2018.09—2022.07'].map(s=>'<w:p><w:r><w:t>'+s+'</w:t></w:r></w:p>').join('')+'</w:body></w:document>')
 await fs.writeFile(path.join(dir,'[Content_Types].xml'),'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
 await fs.mkdir(path.join(dir,'_rels'))
 await fs.writeFile(path.join(dir,'_rels/.rels'),'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
 execFileSync('/usr/bin/zip',['-q','-r','education.docx','word','_rels','[Content_Types].xml'],{cwd:dir})
 const word=await readImport(binary,path.join(dir,'education.docx'))
 assert.equal(word.pages[0].method,'docx');assert.equal(word.pages[0].lines.length,3)
 const text=await readImport(binary,path.join(dir,'text.pdf'))
 assert.equal(text.pages[0].method,'pdf');assert.match(text.pages[0].lines.join(' '),/West City College/)
 const scan=await readImport(binary,path.join(dir,'scanned.pdf'))
 assert.equal(scan.pages[0].method,'ocr');assert.match(scan.pages[0].lines.join(' '),/North Lake University/i)
 assert.match(scan.pages[0].image,/^data:image\/jpeg;base64,/)
})
