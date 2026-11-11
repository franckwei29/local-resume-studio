const fs = require('node:fs/promises')
const path = require('node:path')
const {randomUUID} = require('node:crypto')
const {spawn} = require('node:child_process')
const readline = require('node:readline')

async function sameFile(a,b) {
  if (path.resolve(a) === path.resolve(b)) return true
  try {
    const [left,right]=await Promise.all([fs.stat(a),fs.stat(b)])
    return left.dev===right.dev && left.ino===right.ino
  } catch(err) {if(err.code==='ENOENT') return false; throw err}
}
async function atomicWrite(destination,data,protectedFile) {
  if (protectedFile && await sameFile(destination,protectedFile)) throw new Error('这里是参考原稿，请选择其他文件名。')
  const temp=path.join(path.dirname(destination),'.resume-'+randomUUID()+'.tmp')
  try {
    const file = await fs.open(temp,'wx',0o600)
    try { await file.writeFile(data); await file.sync() } finally {await file.close()}
    await fs.rename(temp,destination)
  } finally { await fs.rm(temp,{force:true}).catch(()=>{}) }
}
async function referencePath(dir) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir,'reference.json'),'utf8')).path
  } catch(e) {if(e.code==='ENOENT') return null; throw e}
}
async function readImport(binary,file,onProgress,signal) {
  const child=spawn(binary,[file],{stdio:['ignore','pipe','pipe']})
  let failure=''
  const completed=new Promise((resolve,reject)=>{
    child.once('error',reject)
    child.once('close',(code)=>resolve(code))
  })
  completed.catch(()=>{})
  const abort=()=>child.kill()
  signal?.addEventListener('abort',abort,{once:true})
  if(signal?.aborted) abort()
  const pages=[]
  let diagnostic=''
  child.stderr.on('data',data=>{diagnostic=(diagnostic+data).slice(-1000)})
  try {
    for await (const line of readline.createInterface({input:child.stdout})) {
      const event=JSON.parse(line)
      if(event.event==='progress') onProgress?.({page:event.page,total:event.total,method:event.method})
      if(event.event==='page') {delete event.event; pages.push(event)}
      if(event.event==='error') failure=event.message
    }
    const code=await completed
    if(signal?.aborted) return null
    if(code!==0 || failure) throw new Error(failure || '本机文档读取失败。'+diagnostic)
    return {name:path.basename(file,path.extname(file)),pages}
  } finally {
    signal?.removeEventListener('abort',abort)
    if(child.exitCode===null) child.kill()
  }
}
module.exports={atomicWrite,referencePath,readImport,sameFile}
