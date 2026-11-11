import {useEffect, useRef, useState} from 'react'
import {blank, block, entry, section, type Resume, type Kind, uid} from './model'
import type { ImportedFile, Progress } from './bridge'
import './import.css'

const categories = {personal:'个人信息', target:'目标岗位', education:'教育背景', work:'工作经历', project:'项目经历', skills:'技能', evaluation:'自我评价', custom:'待归类 / 自定义段落'} as const
type Category = keyof typeof categories
type RecordDraft = {id:string; category:Category; page:number; source:string; title:string; detail:string; org:string; degree:string; start:string; end:string; current:boolean; skip:boolean}
const headings:Record<string,Category>={
  个人信息:'personal',联系方式:'personal',目标岗位:'target',求职意向:'target',教育背景:'education',教育经历:'education',education:'education',
  工作经历:'work',工作经验:'work',实习经历:'work',experience:'work',工作履历:'work',项目经历:'project',项目经验:'project',projects:'project',
  技能:'skills',skills:'skills',专业技能:'skills',自我评价:'evaluation',个人简介:'evaluation',profile:'evaluation'
}
function analyze(text:string,category:Category,page:number,source:string):RecordDraft{
  const dates = Array.from(text.matchAll(/((?:19|20)\d{2})\s*[年.\/-]\s*(0?[1-9]|1[012])(?:月)?(?=\D|$)/g))
  const months = dates.map(match=>match[1]+'-'+match[2].padStart(2,'0'))
  let line=text
  if(['education','work','project'].includes(category)){
    for (const date of dates) line=line.replace(date[0],'')
    line=line.replace(/(?:^|\s)[—–\-~至]+(?:\s|今|$)/g,' ').replace(/至今\s*$/,'').trim()
  }
  const [first,...rest]=line.split('\n')
  const draft={id:uid(),page,source,category,title:first,detail:rest.join('\n'),org:'',degree:'',start:months[0]||'',end:months[1]||'',current:/至今|present\b/i.test(text),skip:false}
  if(category==='education'){
    const org=first.match(/^(.{1,40}?(?:大学|学院|University|College))\s*[,，|｜ ]*\s*/i)
    if(org){draft.org=org[1];draft.title=first.slice(org[0].length)}
    const degree=draft.title.match(/博士|硕士|本科|学士|专科|master'?s?|bachelor'?s?|ph\.?d/i)
    if(degree){draft.degree=degree[0];draft.title=draft.title.replace(degree[0],'').replace(/[|｜.·,，\s]+$/,'').trim()}
  } else if(category==='work'){
    const org=first.match(/^(.+?)[（(](.+?)[）)]\s*$/)
    if(org){draft.title=org[1];draft.org=org[2]}
  } else if(category==='personal' || category==='skills'){
    const fields=/^([^:：]{1,24})[:：]\s*(.+)$/.exec(first)
    if(fields){draft.title=fields[1];draft.detail=[fields[2],...rest].join('\n')}
    else if(category==='personal'){draft.title=/@/.test(first)?'邮箱':/^\+?[\d ()-]{6,}$/.test(first)?'电话':'个人信息';draft.detail=line}
  }
  return draft
}
export function classify(file:ImportedFile):RecordDraft[]{
  let category:Category='custom'
  const result:RecordDraft[]=[]
  for(const page of file.pages){
    page.lines.forEach((line,i)=>{
      const clean=line.trim()
      if(!clean)return
      const heading=headings[clean.toLowerCase().replace(/[:：\s]/g,'')]
      if(heading){category=heading;return}
      let type=category
      if(type==='custom'){
        if(/@|^(?:电话|邮箱|姓名)[:：]/.test(clean)) type='personal'
        else if(/大学|学院|university|college/i.test(clean))type='education'
      }
      result.push(analyze(clean,type,page.page,page.method==='docx'?'段落 '+(i+1):'第 '+page.page+' 页 · '+(i+1)))
    })
  }
  return result
}
function toResume(name:string,drafts:RecordDraft[]):Resume{
  const doc=blank(name.trim());doc.sections=[]
  for(const d of drafts.filter(x=>!x.skip)){
    const kind:Kind=d.category
    let s=doc.sections.find(x=>x.kind===kind)
    if(!s){s=section(kind,['personal','target','skills','evaluation'].includes(kind)?'side':'main');doc.sections.push(s)}
    if(kind==='target'){doc.target=[doc.target,d.title,d.detail].filter(Boolean).join(' ');continue}
    const e=entry()
    switch(kind){
      case 'personal':e.fields={label:d.title,value:d.detail,icon:/邮箱/.test(d.title)?'mail':/电话/.test(d.title)?'phone':'user'};break
      case 'skills':e.fields={name:d.title,description:d.detail};break
      case 'evaluation':e.fields={text:[d.title,d.detail].filter(Boolean).join('\n')};break
      case 'education':e.fields={major:d.title,degree:d.degree,school:d.org,note:''};break
      case 'work':e.fields={role:d.title,company:d.org};break
      case 'project':e.fields={name:d.title,source:d.org};break
      default:e.fields={name:d.title};break
    }
    if(['education','work','project'].includes(kind)){e.start=d.start;e.end=d.end;e.current=d.current}
    if(!['personal','skills','evaluation'].includes(kind)) {
      if(kind==='custom'){e.fields={};e.blocks=[block('paragraph',[d.title,d.detail].filter(Boolean).join('\n'))]}
      else if(d.detail)e.blocks=d.detail.split('\n').filter(Boolean).map(t=>block('paragraph',t))
    }
    s.entries.push(e)
  }
  return doc
}

export function ImportReview({onCreate,onCancel}:{onCreate:(doc:Resume)=>void|Promise<void>;onCancel:()=>void}){
  const [file,setFile]=useState<ImportedFile|null>(null)
  const [rows,setRows]=useState<RecordDraft[]>([])
  const [selected,setSelected]=useState('')
  const [name,setName]=useState('')
  const [busy,setBusy]=useState(false)
  const [progress,setProgress]=useState<Progress|null>(null)
  const [error,setError]=useState('')
  const [paste,setPaste]=useState('')
  const [page,setPage]=useState(1)
  const alive=useRef(true)
  const splitAt=useRef<HTMLTextAreaElement>(null)
  useEffect(()=>{alive.current=true;const off=window.studio.onImportProgress(setProgress);return()=>{alive.current=false;off();void window.studio.cancelImport()}},[])
  function load(source:ImportedFile){
    const records=classify(source)
    setFile(source);setRows(records);setSelected(records[0]?.id||'');setName(source.name);setPage(1)
  }
  async function choose(){
    setBusy(true);setProgress(null);setError('')
    try{const f=await window.studio.importFile();if(f && alive.current)load(f)}
    catch(e){if(alive.current)setError(String(e))}
    finally{if(alive.current)setBusy(false)}
  }
  const row=rows.find(x=>x.id===selected)
  const index=rows.findIndex(x=>x.id===selected)
  const sourcePage=file?.pages.find(p=>p.page===page)
  function change(fields:Partial<RecordDraft>){setRows(list=>list.map(x=>x.id===selected?{...x,...fields}:x))}
  function select(r:RecordDraft){setSelected(r.id);setPage(r.page)}
  function add(){
    const item=analyze('','custom',page,'手动录入');setRows([...rows,item]);select(item)
  }
  function split(){
    if(!row)return
    const value=row.detail.trim()
    if(!value){setError('先将需拆分的文字放入说明框。');return}
    const cursor=splitAt.current?.selectionStart||0
    const cut=cursor>0 && cursor<value.length?cursor:value.indexOf('\n')+1
    const upper=value.slice(0,cut).trim(),lower=value.slice(cut).trim()
    if(!lower)return
    const next=analyze(lower,row.category,row.page,row.source)
    setRows([...rows.slice(0,index),{...row,detail:upper},next,...rows.slice(index+1)])
    select(next);setError('')
  }
  function merge(){
    if(!row || index===rows.length-1)return
    const next=rows[index+1]
    const text=[next.title,next.org,next.degree,next.start,next.current?'至今':next.end,next.detail].filter(Boolean).join(' ')
    setRows([...rows.slice(0,index),{...row,source:row.source+'、'+next.source,detail:[row.detail,text].filter(Boolean).join('\n')},...rows.slice(index+2)])
  }
  async function confirm(){
    if(!name.trim() || !rows.some(x=>!x.skip && (x.title||x.detail||x.org||x.degree))){setError('请填写文档名并至少保留一条有内容的记录。');return}
    setBusy(true);setError('')
    try{await onCreate(toResume(name,rows))}catch(e){if(alive.current){setError(String(e));setBusy(false)}}
  }
  return <div className="import-view">
    <header><button onClick={onCancel}>‹ 简历库</button><h1>从本地文件导入</h1>
      {file && <button className="import-primary" disabled={busy} onClick={confirm}>创建并编辑</button>}</header>
    {error && <p className="import-error" role="alert">{error}</p>}
    {!file ? <section className="import-start"><h2>选择要导入的简历</h2><p>打开 PDF 或 DOCX，核对识别内容后创建一份新简历。</p>
      <button className="import-primary" onClick={choose} disabled={busy}>{busy?progress?'正在处理第 '+progress.page+' / '+progress.total+' 页…':'正在读取…':'选择 PDF 或 Word'}</button>
      {busy && <button onClick={()=>void window.studio.cancelImport()}>取消读取</button>}
      <details><summary>手工粘贴原文</summary><textarea aria-label="粘贴原文" value={paste} onChange={e=>setPaste(e.target.value)}/>
      <button disabled={!paste.trim()||busy} onClick={()=>load({name:'导入的简历',pages:[{page:1,total:1,method:'docx',lines:paste.split('\n')}]})}>核对内容</button></details>
    </section>:<div className="import-grid">
      <section className="import-source"><div className="import-bar"><h2>来源原文</h2><select aria-label="来源页" value={page} onChange={e=>setPage(+e.target.value)}>
        {file.pages.map(p=><option key={p.page} value={p.page}>第 {p.page} 页</option>)}</select></div>
        {sourcePage?.image?<img alt={'来源第 '+page+' 页'} src={sourcePage.image}/>:<article>{sourcePage?.lines.map((text,i)=><p key={i}>{text}</p>)}</article>}
        {sourcePage?.warning && <p>{sourcePage.warning}</p>}
      </section>
      <section className="import-records"><h2>识别记录</h2><label>文档名称<input value={name} onChange={e=>setName(e.target.value)}/></label>
        {rows.map(r=><button key={r.id} className={'import-record '+(r.id===selected?'current':'')} onClick={()=>select(r)}>
          <small>{r.source} · {r.skip?'已跳过':categories[r.category]}</small><span>{r.title||r.detail||'新记录'}</span></button>)}
        <button onClick={add}>＋ 手动补录</button></section>
      <section className="import-fields"><h2>核对字段</h2>{row ? <>
        <label>归入栏目<select value={row.category} onChange={e=>change({category:e.target.value as Category})}>{Object.entries(categories).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
        <label>{row.category==='education'?'专业':row.category==='work'?'职位':'标题 / 名称'}<input value={row.title} onChange={e=>change({title:e.target.value})}/></label>
        {['education','work','project'].includes(row.category) && <><label>{row.category==='education'?'学校':row.category==='work'?'单位':'项目来源'}<input value={row.org} onChange={e=>change({org:e.target.value})}/></label>
          {row.category==='education' && <label>学位<input value={row.degree} onChange={e=>change({degree:e.target.value})}/></label>}
          <label>开始年月<input type="month" value={row.start} onChange={e=>change({start:e.target.value})}/></label>
          <label>结束年月<input disabled={row.current} type="month" value={row.end} onChange={e=>change({end:e.target.value})}/></label>
          <label className="imp-check"><input type="checkbox" checked={row.current} onChange={e=>change({current:e.target.checked})}/>至今</label></>}
        <label>说明 / 值<textarea ref={splitAt} value={row.detail} onChange={e=>change({detail:e.target.value})}/></label>
        <div className="import-actions"><button disabled={!row.detail.trim()} onClick={split}>在光标处拆分</button><button disabled={index===rows.length-1} onClick={merge}>合并下一条</button></div>
        <label className="imp-check"><input type="checkbox" checked={row.skip} onChange={e=>change({skip:e.target.checked})}/>跳过此条</label>
        </>:<p>选择一条记录，或补录未识别的内容。</p>}</section>
    </div>}
  </div>
}
