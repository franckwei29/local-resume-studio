import React, {useEffect, useLayoutEffect, useMemo, useState} from 'react'
import { CalendarDays, Globe2, House, Mail, Phone, UserRound, Link as LinkIcon, Info } from 'lucide-react'
import '@fontsource-variable/noto-sans-sc/wght.css'
import '@fontsource-variable/noto-serif-sc/wght.css'
import './paper.css'
import {type Photo, type Resume} from './model'
import {fontFamily, paginate, resetMeasurementCache, type PositionedLine} from './pagination'
import {photoGeometry} from './photoGeometry'

const mm=(value:number)=>value+'mm'
const icons:Record<string,typeof Info>={name:UserRound,email:Mail,phone:Phone,location:House,birthday:CalendarDays,website:Globe2,linkedin:LinkIcon}
const safeHref=(href?:string)=>href && /^(?:https?:\/\/|mailto:)/i.test(href)?href:undefined
const readyGlyphs = new Map<string,Set<string>>()
const imageSizes = new Map<string,[number,number]>()
function Avatar({photo,y}:{photo:Photo;y:number}){
  const [size,setSize]=useState<[number,number]>(()=>imageSizes.get(photo.src)??[1,1])
  const geometry=photoGeometry(photo,size[0],size[1],42)
  return <div className="paper-photo" data-source-id="header" style={{left:mm(16),top:mm(y+1.5),width:mm(42),height:mm(42)}}>
    <img alt="" src={photo.src} onLoad={e=>{
      const img=e.currentTarget
      const dim:[number,number]=[img.naturalWidth,img.naturalHeight]
      imageSizes.set(photo.src,dim);setSize(dim)
    }} style={{left:mm(geometry.centerX),top:mm(geometry.centerY),width:mm(geometry.width),height:mm(geometry.height),transform:'translate(-50%,-50%) rotate('+photo.rotation+'deg)'}}/>
  </div>
}
function Line({line,accent}:{line:PositionedLine;accent:string}) {
  const Icon=line.icon?(icons[line.icon]??Info):null
  return <div className="paper-line" data-source-id={line.id} data-lane={line.lane} data-y={line.y.toFixed(2)}
    style={{left:mm(line.x),top:mm(line.y),width:mm(line.width),height:mm(line.height)}}>
    {Icon&&<Icon aria-hidden color={accent} strokeWidth={2.35}/>}
    {line.image&&<img src={line.image} alt="" style={{width:'32mm',height:'12mm',objectFit:'contain',objectPosition:'left center'}}/>}
    {line.pieces.map((p,i)=>{
      const style:React.CSSProperties={left:mm(p.x),fontSize:p.size+'pt',fontWeight:p.bold?700:400,
        fontStyle:p.italic?'italic':undefined,textDecoration:p.underline?'underline':undefined,color:p.color,lineHeight:mm(line.rule?line.height-2:line.height)}
      const url=safeHref(p.href)
      return url?<a key={i} href={url} onClick={e=>e.preventDefault()} style={style}>{p.text}</a>:<span key={i} style={style}>{p.text}</span>
    })}
    {line.rule&&<i className="paper-line-rule"/>}
  </div>
}
function documentCharacters(doc:Resume){
  const chars=new Set<string>('简历工作经历个人信息教育背景自我评价技能语言项目经历目标岗位签名0123456789年至今月日—：·ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz')
  JSON.stringify(doc,(_k,v)=>{
    if(typeof v==='string'&&!v.startsWith('data:')) for(const ch of v)chars.add(ch)
    return v
  })
  return chars
}
export interface PaperProps {doc:Resume;onLocate?:(id:string)=>void;onPageCount?:(n:number)=>void}
export function Paper({doc,onLocate,onPageCount}:PaperProps) {
  const family=fontFamily(doc.style)
  const chars=useMemo(()=>documentCharacters(doc),[doc])
  const [generation,setGeneration]=useState(0)
  const loaded=readyGlyphs.get(family)
  const needed=[...chars].filter(ch=>!loaded?.has(ch)).join('')
  useLayoutEffect(()=>{
    if(!needed)return
    let active=true
    Promise.all([400,700].map(weight=>document.fonts.load(weight+' 14px "'+family+'"',needed))).then(()=>{
      let set=readyGlyphs.get(family);if(!set){set=new Set();readyGlyphs.set(family,set)}
      for(const ch of needed)set.add(ch)
      resetMeasurementCache()
      if(active)setGeneration(i=>i+1)
    }).catch(error=>console.error('加载排版字体失败',error))
    return ()=>{active=false}
  },[needed,family])
  const {pages,cover}=useMemo(()=>paginate(doc),[doc,generation])
  useEffect(()=>onPageCount?.(pages.length),[pages.length,onPageCount])
  return <div className="paper-document" data-layout-ready={needed?'false':'true'} data-revision={doc.revision}
    onClick={onLocate?event=>{const item=(event.target as Element).closest('[data-source-id]');if(item)onLocate(item.getAttribute('data-source-id')!)}:undefined}>
    {pages.map((page,i)=><div className="paper-page" key={i} data-page-index={i} style={{fontFamily:'"'+family+'"'}}>
      <div className="paper-side"/>
      {i===0&&(cover.title.length>0||doc.photo)&&<>
        <svg className="paper-cap" viewBox={'0 0 70 '+(cover.curveMid-3)} preserveAspectRatio="none" style={{height:mm(cover.curveMid-3)}} aria-hidden>
          <path d={'M0 0H70V'+(cover.curveEdge-3)+' Q35 '+(2*cover.curveMid-cover.curveEdge-3)+' 0 '+(cover.curveEdge-3)+'Z'} fill={doc.style.color}/>
        </svg>
        {cover.title.map((text,line)=><div className="paper-cover-title" data-source-id="header" key={line} style={{top:mm(cover.titleTop+line*cover.titleHeight),lineHeight:mm(cover.titleHeight)}}>{text}</div>)}
        {doc.photo&&<Avatar photo={doc.photo} y={cover.photoY}/>}
      </>}
      {page.lines.map((line,j)=><Line key={line.id+'-'+j} line={line} accent={doc.style.color}/>)}
      {i===pages.length-1&&<svg className="paper-foot-curve" viewBox="0 0 70 12" preserveAspectRatio="none" aria-hidden><path d="M0 0Q35 15 70 0V12H0Z" fill={doc.style.color}/></svg>}
      {doc.style.pageNumbers&&<div className="paper-page-no" style={{right:mm(doc.style.margin+1)}}>{i+1} / {pages.length}</div>}
    </div>)}
  </div>
}
