import {memo,useState} from 'react'
import {ArchiveRestore, ArrowDownToLine, BookOpen, ChevronDown, Copy, Ellipsis, FileInput, FilePlus2, FileText, FolderOpen, Grid2X2, HardDrive, LayoutList, PencilLine, Plus, RotateCcw, Search, Trash2, X} from 'lucide-react'
import type {Resume} from './model'
import {Paper} from './layout'
export type Action='edit'|'preview'|'export'|'copy'|'rename'|'trash'|'restore'|'remove'|'backup'
type Props={docs:Resume[];trash:boolean;setTrash:(v:boolean)=>void;onNew:()=>void;onRestore:()=>void;onAction:(a:Action,d:Resume)=>void}
const Miniature=memo(({doc,onCount}:{doc:Resume;onCount:(n:number)=>void})=><div className="miniature" aria-hidden="true"><div><Paper doc={doc} onPageCount={onCount}/></div></div>)
const actions:[Action,string,typeof Copy][]=[['edit','编辑',PencilLine],['preview','查看详情',BookOpen],['rename','重命名',PencilLine],['copy','复制',Copy],['export','导出 PDF',ArrowDownToLine],['backup','导出可编辑备份',ArchiveRestore],['trash','移入回收站',Trash2]]
function Card({doc,trash,onAction}:{doc:Resume;trash:boolean;onAction:Props['onAction']}){
 const [open,menu]=useState(false),[pages,count]=useState(0)
 function act(a:Action){menu(false);onAction(a,doc)}
 return <article className="doc-card">
 <button className="sheet-cover" onClick={()=>act(trash?'preview':'edit')} aria-label={'打开 '+doc.name}><Miniature doc={doc} onCount={count}/></button>
 <div className="card-meta"><div><button className="doc-title" onClick={()=>act(trash?'preview':'edit')}>{doc.name}</button><div className="doc-sub">{doc.target||'个人简历'}<span>·</span>{pages||'…'} 页</div><time>{new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(trash?doc.trashed!:doc.modified)} {trash?'移入':'编辑'}</time></div>
 <div className="action-wrap"><button className="icon" aria-label={'文档操作 '+doc.name} aria-expanded={open} onClick={()=>menu(!open)}><Ellipsis size={20}/></button>
 {open&&<><button tabIndex={-1} aria-label="关闭文档菜单" className="menu-backdrop" onClick={()=>menu(false)}/><div role="menu" className="menu">{(trash?[['restore','恢复',RotateCcw],['remove','永久删除',Trash2]] as typeof actions:actions).map(([id,label,Icon])=><button key={id} role="menuitem" onClick={()=>act(id)}><Icon size={15}/>{label}</button>)}</div></>}</div></div></article>
}
export function Library({docs,trash,setTrash,onNew,onRestore,onAction}:Props){
 const [query,setQuery]=useState(''),[sort,setSort]=useState('modified'),[list,setList]=useState(false)
 const activeDocs=docs.filter(d=>!d.trashed)
 const visible=docs.filter(d=>Boolean(d.trashed)===trash && (d.name+' '+d.target).toLowerCase().includes(query.toLowerCase().trim())).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'zh-CN'):sort==='created'?b.created-a.created:(b.trashed||b.modified)-(a.trashed||a.modified))
 const switchTab=(v:boolean)=>{setTrash(v);setQuery('')}
 return <div className="library"><aside className="sidebar"><div className="brand"><span className="brand-mark"><FileText size={22}/></span>简历工坊</div><nav>
 <button className={!trash?'active':''} onClick={()=>switchTab(false)}><FolderOpen size={18}/>简历库<span>{activeDocs.length}</span></button>
 <button className={trash?'active':''} onClick={()=>switchTab(true)}><Trash2 size={17}/>回收站<span>{docs.length-activeDocs.length}</span></button></nav>
 <div className="local-info"><HardDrive size={16}/>本机工作区</div></aside>
 <main className="lib-main"><div className="lib-header"><div><h1>{trash?'回收站':'我的简历'}</h1><p>{trash?'恢复或永久删除已移入的简历。':'管理简历与岗位版本。'}</p></div>{!trash&&<div className="row"><button className="secondary" onClick={onRestore}><FileInput size={16}/>导入备份</button><button className="primary" onClick={onNew}><Plus size={17}/>新建简历</button></div>}</div>
 <div className="lib-toolbar"><label className="search"><Search size={16}/><input placeholder="搜索文档名称或目标岗位" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button aria-label="清除搜索" onClick={()=>setQuery('')}><X size={14}/></button>}</label><div className="row"><label className="select-wrap"><select aria-label="排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="modified">最近编辑</option><option value="created">最近创建</option><option value="name">名称升序</option></select><ChevronDown size={13}/></label><div className="seg"><button aria-label="网格视图" aria-pressed={!list} onClick={()=>setList(false)}><Grid2X2 size={15}/></button><button aria-label="列表视图" aria-pressed={list} onClick={()=>setList(true)}><LayoutList size={17}/></button></div></div></div>
 <div className={list?'doc-list':'doc-grid'}>{visible.map(d=><Card key={d.id} doc={d} trash={trash} onAction={onAction}/>)}{!trash&&!query&&!list&&<button className="new-tile" onClick={onNew}><span><FilePlus2 size={23}/></span>新建简历</button>}</div>
 {!visible.length&&(trash||query||list)&&<div className="empty"><FolderOpen size={29}/><h3>{query?'没有匹配的简历':trash?'回收站为空':'创建第一份简历'}</h3>{query?<button onClick={()=>setQuery('')}>清除搜索</button>:!trash&&<button onClick={onNew}>新建简历</button>}</div>}</main></div>
}
