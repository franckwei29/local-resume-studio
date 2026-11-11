import {useEffect,useRef,useState} from 'react'
import type {Resume} from './model'
export function useSession(saved:(d:Resume)=>void){
 const [doc,render]=useState<Resume|null>(null),[status,setStatus]=useState('已保存在本机'),[error,setError]=useState('')
 const current=useRef<Resume|null>(null),dirty=useRef(false),job=useRef<Promise<void>|null>(null)
 const timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),generation=useRef(0)
 const past=useRef<Resume[]>([]),future=useRef<Resume[]>([]),last=useRef({group:'',time:0})
 const assign=(d:Resume|null)=>{current.current=d;render(d)}
 function load(d:Resume|null){clearTimeout(timer.current);dirty.current=false;generation.current++;past.current=[];future.current=[];last.current.group='';setError('');setStatus('已保存在本机');assign(d)}
 async function flush():Promise<void>{
  clearTimeout(timer.current)
  if(job.current){await job.current;if(dirty.current)return flush();return}
  if(!dirty.current||!current.current)return
  const persist=async()=>{
   while(dirty.current&&current.current){
    const base=current.current,seq=generation.current
    setStatus('保存中…')
    const result=await window.studio.save(base,base.revision)
    if(current.current?.id!==result.id)return
    saved(result)
    dirty.current=seq!==generation.current
    const updated=dirty.current?{...current.current,revision:result.revision,modified:result.modified}:result
    assign(updated)
   }
   setStatus('已保存在本机');setError('')
  }
  job.current=persist()
  try{await job.current}catch(e){setStatus('保存失败');setError(String(e));throw e}finally{job.current=null}
 }
 function update(next:Resume){dirty.current=true;generation.current++;assign({...next,revision:current.current?.revision??next.revision});setStatus('保存中…');clearTimeout(timer.current);timer.current=setTimeout(()=>{void flush().catch(()=>{})},350)}
 function change(next:Resume,group?:string){
  if(!current.current)return
  const now=Date.now()
  if(!group||group!==last.current.group||now-last.current.time>750){past.current.push(current.current);if(past.current.length>100)past.current.shift()}
  last.current={group:group||'',time:now};future.current=[];update(next)
 }
 function travel(redo:boolean){const from=redo?future:past,to=redo?past:future;const next=from.current.pop();if(!next||!current.current)return;to.current.push(current.current);last.current.group='';update(next)}
 const flushRef=useRef(flush);flushRef.current=flush
 useEffect(()=>window.studio.onBeforeClose(()=>{void flushRef.current().then(()=>window.studio.closeReady()).catch(()=>{})}),[])
 return {doc,current,load,change,flush,travel,canUndo:!!past.current.length,canRedo:!!future.current.length,status,error}
}
