import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { Run } from './model';
import { Bold, Italic, Underline, Link2, Unlink } from 'lucide-react';

const escape = (s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function safeLink(s:string) {
  try {return ['https:','http:','mailto:'].includes(new URL(s.trim()).protocol) ? s.trim() : '';} catch {return '';}
}
export function runsToHtml(runs: Run[]) {
  return runs.map(r=>{
    let s=escape(r.text).replace(/\n/g,'<br>');
    if(r.bold) s='<strong>'+s+'</strong>';
    if(r.italic) s='<em>'+s+'</em>';
    if(r.underline) s='<u>'+s+'</u>';
    if(r.href && safeLink(r.href)) s='<a href="'+escape(r.href)+'">'+s+'</a>';
    return s;
  }).join('');
}
export function readRuns(root: Node): Run[] {
  const out:Run[]=[];
  type Mark=Omit<Run,'text'>;
  const append=(s:string,mark:Mark)=>{
    if(!s) return;
    const last=out[out.length-1];
    if(last && !!last.bold===!!mark.bold && !!last.italic===!!mark.italic && !!last.underline===!!mark.underline && last.href===mark.href) last.text+=s;
    else out.push({text:s,...mark});
  };
  function visit(node:Node, mark:Mark) {
    if(node.nodeType===Node.TEXT_NODE) {append((node.textContent || '').replace(/\u00a0/g,' '),mark);return;}
    if(!(node instanceof Element)) {node.childNodes.forEach(c=>visit(c,mark));return;}
    if(['STYLE','SCRIPT','TEMPLATE','IFRAME','OBJECT'].includes(node.tagName))return;
    if(node.tagName==='BR') {append('\n',mark);return;}
    const n=node as HTMLElement;
    const m={...mark};
    const weight=n.style?.fontWeight;
    if(n.matches('b,strong') || (weight==='bold' || Number(weight)>=600)) m.bold=true;
    if(n.matches('i,em') || n.style?.fontStyle==='italic') m.italic=true;
    if(n.matches('u') || n.style?.textDecoration?.includes('underline')) m.underline=true;
    if(n.matches('a')) { const url=safeLink(n.getAttribute('href')||''); if(url) m.href=url; }
    const lineBreak=/^(DIV|P|LI)$/.test(n.tagName);
    if(lineBreak && n.previousSibling && out.length && !out.at(-1)?.text.endsWith('\n')) append('\n',{});
    n.childNodes.forEach(c=>visit(c,m));
  }
  root.childNodes.forEach(c=>visit(c,{}));
  if(out.length===1 && out[0].text==='\n') return [{text:''}];
  return out.length?out:[{text:''}];
}

export default function RichField({label,runs,onChange,onSplit}:{label:string;runs:Run[];onChange:(r:Run[])=>void;onSplit?:(left:Run[],right:Run[])=>void}) {
  const root=useRef<HTMLDivElement>(null), last=useRef(''), composing=useRef(false), savedRange=useRef<Range|null>(null);
  const [url,setUrl]=useState<string|null>(null),[linkErr,setLinkErr]=useState('');
  const key=JSON.stringify(runs), inputId=useId();
  useLayoutEffect(()=>{
    if(!root.current || last.current===key || composing.current) return;
    root.current.innerHTML=runsToHtml(runs);
    last.current=key;
  },[key,runs]);
  function changed() {
    if(!root.current || composing.current) return;
    const parsed=readRuns(root.current);
    const serial=JSON.stringify(parsed);
    if(last.current!==serial){last.current=serial; onChange(parsed);}
  }
  const remember=()=>{
    const s=window.getSelection();
    if(s?.rangeCount && root.current?.contains(s.anchorNode) && root.current.contains(s.focusNode)) savedRange.current=s.getRangeAt(0).cloneRange();
  };
  function restore() {
    root.current?.focus({preventScroll:true});
    const s=window.getSelection(),r=savedRange.current;
    if(s && r && root.current?.contains(r.commonAncestorContainer)){s.removeAllRanges();s.addRange(r);}
  }
  function format(cmd:string) {
    restore(); document.execCommand(cmd); changed();remember();
  }
  function insertLink() {
    const link=safeLink(url||'');
    if(!link) {setLinkErr('请输入以 https://、http:// 或 mailto: 开头的地址');return;}
    restore();
    if(window.getSelection()?.isCollapsed) document.execCommand('insertHTML',false,'<a href="'+escape(link)+'">'+escape(link)+'</a>');
    else document.execCommand('createLink',false,link);
    changed();remember();setUrl(null);setLinkErr('');
  }
  return <div className="re-rich">
    <label id={inputId}>{label}</label>
    <div className="re-richbox">
      <div className="re-richbar" aria-label="文字格式">
        {[[Bold,'粗体','bold'],[Italic,'斜体','italic'],[Underline,'下划线','underline']] .map(([icon,name,action])=>{
          const Icon=icon as typeof Bold;
          return <button key={String(name)} type="button" aria-label={String(name)} title={String(name)}
            onMouseDown={e=>{e.preventDefault();remember();}} onClick={()=>format(String(action))}><Icon size={14}/></button>;
        })}
        <i/>
        <button type="button" aria-label="添加链接" onMouseDown={e=>{e.preventDefault();remember();}} onClick={()=>{const node=window.getSelection()?.anchorNode;const a=(node?.parentElement)?.closest('a');setUrl(a?.getAttribute('href')||'');setLinkErr('');}}><Link2 size={14}/></button>
        <button type="button" aria-label="移除链接" onMouseDown={e=>{e.preventDefault();remember();}} onClick={()=>format('unlink')}><Unlink size={14}/></button>
      </div>
      {url!==null && <div className="re-link-form"><input autoFocus aria-label="链接地址" value={url} placeholder="https://…" onChange={e=>setUrl(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();insertLink();}if(e.key==='Escape')setUrl(null);}}/><button onClick={insertLink}>应用</button><button onClick={()=>setUrl(null)}>取消</button>{linkErr&&<small role="alert">{linkErr}</small>}</div>}
      <div role="textbox" aria-multiline="true" aria-labelledby={inputId} className="re-rich-input" contentEditable suppressContentEditableWarning
        ref={root} data-placeholder="输入正文…" onMouseUp={remember} onKeyUp={remember} onInput={changed}
        onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;changed();}}
        onPaste={e=>{
          e.preventDefault(); const raw=e.clipboardData.getData('text/html');
          const sanitized=raw ? runsToHtml(readRuns(new DOMParser().parseFromString(raw,'text/html').body)) : runsToHtml([{text:e.clipboardData.getData('text/plain')}]);
          document.execCommand('insertHTML',false,sanitized);changed();
        }}
        onDrop={e=>{e.preventDefault();}}
        onKeyDown={e=>{
          if(e.key!=='Enter'||e.nativeEvent.isComposing || composing.current) return;
          e.preventDefault();
          if(!onSplit || e.shiftKey){document.execCommand('insertLineBreak');changed();return;}
          const selection=window.getSelection();
          if(!selection?.rangeCount || !root.current)return;
          const r=selection.getRangeAt(0), before=r.cloneRange(),after=r.cloneRange();
          before.selectNodeContents(root.current);before.setEnd(r.startContainer,r.startOffset);
          after.selectNodeContents(root.current);after.setStart(r.endContainer,r.endOffset);
          onSplit(readRuns(before.cloneContents()),readRuns(after.cloneContents()));
        }}/>
    </div>
  </div>;
}
