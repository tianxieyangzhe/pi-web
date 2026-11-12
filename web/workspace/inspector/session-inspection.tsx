import {Button} from '../../components/button';
import { useEffect, useId, useMemo, useState } from 'react';
import type { SessionTree } from '../../domain/models';
function previewText(content:unknown):string {
  if(typeof content==='string')return content.replace(/\s+/g,' ').trim();
  if(!Array.isArray(content))return '';
  return content.flatMap(part=>part&&typeof part==='object'&&part.type==='text'&&typeof part.text==='string'?[part.text]:[]).join(' ').replace(/\s+/g,' ').trim();
}
function entryPreview(entry:SessionTree['entries'][number]['entry']) {
  const message=entry.message as {role?:string;content?:unknown;toolName?:string;command?:string;stopReason?:string;errorMessage?:string}|undefined;
  if(entry.type==='message'&&message){
    if(message.role==='user'||message.role==='assistant'){
      const blocks:Array<{type?:string;name?:string}>=Array.isArray(message.content)?message.content.filter(part=>part&&typeof part==='object'):[];
      const tools=blocks.filter(block=>block.type==='toolCall').map(block=>block.name||'tool');
      const types=[...new Set(blocks.filter(block=>block.type!=='text').map(block=>block.type==='thinking'?'思考':block.type==='image'?'图片':block.type||'未知内容'))];
      const fallback=message.stopReason==='aborted'?'(aborted)':message.errorMessage?'(error)':tools.length?`工具调用 · ${tools.join('、')}`:types.length?types.join('、'):'(无正文)';
      return {kind:`${message.role}: `,text:previewText(message.content)||fallback,tone:message.role==='user'?'text-sky-700':'text-emerald-700'};
    }
    if(message.role==='toolResult')return {kind:`[${message.toolName||'tool'}]`,text:'',tone:'text-slate-500'};
    if(message.role==='bashExecution')return {kind:'[bash]: ',text:previewText(message.command),tone:'text-slate-500'};
    return {kind:`[${message.role||'message'}]`,text:'',tone:'text-slate-500'};
  }
  switch(entry.type){
    case 'model_change':return {kind:`[model: ${entry.modelId??'unknown'}]`,text:'',tone:'text-slate-500'};
    case 'thinking_level_change':return {kind:`[thinking: ${entry.thinkingLevel??'unknown'}]`,text:'',tone:'text-slate-500'};
    case 'compaction':return {kind:typeof entry.tokensBefore==='number'?`[compaction: ${Math.round(entry.tokensBefore/1000)}k tokens]`:'[compaction]',text:'',tone:'text-sky-700'};
    case 'branch_summary':return {kind:'[branch summary]',text:'',tone:'text-amber-700'};
    case 'custom_message':return {kind:`[${entry.customType??'custom'}]: `,text:previewText(entry.content),tone:'text-slate-500'};
    case 'custom':return {kind:`[custom: ${entry.customType??'unknown'}]`,text:'',tone:'text-slate-500'};
    case 'label':return {kind:`[label: ${entry.label??'(cleared)'}]`,text:'',tone:'text-slate-500'};
    case 'session_info':return {kind:`[title: ${entry.name||'empty'}]`,text:'',tone:'text-slate-500'};
    default:return {kind:`[${entry.type}]`,text:'',tone:'text-slate-500'};
  }
}
export function SessionTreeNavigator({tree,onLocate,onSelect,selected}:{tree:SessionTree;onLocate:(entryId:string)=>void;onSelect:(entryId:string)=>void;selected:string|null}) {
  const {rows,activePath}=useMemo(()=>{
    type Item=SessionTree['entries'][number];
    type Row={item:Item;indent:number;branched:boolean;connector:boolean;last:boolean;gutters:Array<{position:number;show:boolean}>;anomaly:boolean};
    const byId=new Map(tree.entries.map(item=>[item.entry.id,item])),children=new Map<string|null,Item[]>(),activePath=new Set<string>();
    let current=tree.activeLeafId;
    while(current&&!activePath.has(current)){activePath.add(current);current=byId.get(current)?.entry.parentId??null;}
    for(const item of tree.entries){const parent=byId.has(item.entry.parentId??'')?item.entry.parentId:null;const list=children.get(parent)??[];list.push(item);children.set(parent,list);}
    const result:Array<Row&{prefix:string}>=[],visited=new Set<string>();
    const root=(item:Item):Row=>({item,indent:0,branched:false,connector:false,last:true,gutters:[],anomaly:!!item.entry.parentId&&!byId.has(item.entry.parentId)});
    const stack=(children.get(null)??[]).map(root).reverse();
    const drain=()=>{while(stack.length){
      const next=stack.pop()!;if(visited.has(next.item.entry.id))continue;visited.add(next.item.entry.id);
      let prefix='';for(let level=0;level<next.indent;level++){
        const gutter=next.gutters.find(value=>value.position===level);
        prefix+=gutter?(gutter.show?'│  ':'   '):next.connector&&level===next.indent-1?(next.last?'└─ ':'├─ '):'   ';
      }
      result.push({...next,prefix});
      const descendants=children.get(next.item.entry.id)??[],branch=descendants.length>1;
      const indent=branch||next.branched&&next.indent>0?next.indent+1:next.indent;
      const gutters=next.connector?[...next.gutters,{position:next.indent-1,show:!next.last}]:next.gutters;
      for(let i=descendants.length-1;i>=0;i--)stack.push({item:descendants[i],indent,branched:branch,connector:branch,last:i===descendants.length-1,gutters,anomaly:false});
    }};
    drain();
    for(const item of tree.entries)if(!visited.has(item.entry.id)){stack.push({...root(item),anomaly:true});drain();}
    return {rows:result,activePath};
  },[tree]);
  const selectedId=selected??tree.activeLeafId;
  return <nav aria-label="完整会话树" className="min-w-0 p-4 font-mono text-xs leading-6">
    {!rows.length&&<p className="text-slate-500">当前会话还没有节点。</p>}
    {rows.map(({item,prefix,anomaly})=>{
      const preview=entryPreview(item.entry),chosen=selectedId===item.entry.id,active=activePath.has(item.entry.id),leaf=tree.activeLeafId===item.entry.id;
      const title=`${item.label?`[${item.label}] `:''}${preview.kind}${preview.text}`;
      return <Button variant="ghost" size="row" selected={chosen} type="button" key={item.entry.id} aria-current={chosen?'true':undefined} aria-label={`${title}${leaf?' · 当前叶子':active?' · 活动路径':''}${anomaly?' · 关系异常':''}`} title={`${title}\n${item.entry.id}`}  onClick={()=>{onSelect(item.entry.id);onLocate(item.entry.id);}}>
        <span aria-hidden="true" className="sticky left-0 w-[2ch] shrink-0 self-stretch text-emerald-700">{chosen?'›':' '}</span>
        <span className="min-w-0 flex-1 truncate"><span aria-hidden="true" className="whitespace-pre text-slate-400">{prefix}</span>{active&&<span aria-hidden="true" className="text-emerald-600">• </span>}{anomaly&&<span className="text-amber-700">[关系异常] </span>}{item.label&&<span className="text-amber-700">[{item.label}] </span>}<span className={preview.tone}>{preview.kind}</span>{preview.text}</span>
      </Button>;
    })}
    <p className="mt-1 text-slate-400" aria-label="会话树节点计数">  ({Math.max(0,rows.findIndex(row=>row.item.entry.id===selectedId)+1)}/{rows.length})</p>
  </nav>;
}
export function SessionInspection({tree,settings,onLocate,selected,onSelect}:{tree:SessionTree;settings:import('react').ReactNode;onLocate:(id:string)=>void;selected:string|null;onSelect:(id:string)=>void}) {
  const [tab,setTab]=useState<'tree'|'settings'>('tree'),id=useId();
  useEffect(()=>{if(selected&&!tree.entries.some(item=>item.entry.id===selected))onSelect('');},[tree,selected,onSelect]);
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><div role="tablist" className="flex shrink-0 border-b border-slate-200 px-4 pt-2" aria-label="会话检查内容">{(['tree','settings'] as const).map(value=><Button variant="tab" selected={tab===value} key={value} id={`${id}-${value}-tab`} type="button" role="tab" aria-selected={tab===value} aria-controls={`${id}-${value}-panel`} tabIndex={tab===value?0:-1} onClick={()=>setTab(value)} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?'tree':event.key==='End'?'settings':value==='tree'?'settings':'tree';setTab(next);document.getElementById(`${id}-${next}-tab`)?.focus();}} >{value==='tree'?'会话树':'Session 设置'}</Button>)}</div><div className="relative grid min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden"><div role="tabpanel" id={`${id}-settings-panel`} aria-labelledby={`${id}-settings-tab`} tabIndex={tab==='settings'?0:-1} aria-hidden={tab!=='settings'} inert={tab!=='settings'} className={`min-h-0 overflow-auto ${tab==='settings'?'visible':'invisible'}`}><div className="space-y-5 p-5 text-sm">{settings}</div></div>{tab==='tree'&&<div role="tabpanel" id={`${id}-tree-panel`} aria-labelledby={`${id}-tree-tab`} tabIndex={0} className="absolute inset-0 overflow-auto"><SessionTreeNavigator tree={tree} onLocate={onLocate} selected={selected} onSelect={onSelect}/></div>}</div></div>;
}
export function locateSessionEntry(id:string) {
  const target=[...document.querySelectorAll<HTMLElement>('[data-entry-id]')].find(element=>element.dataset.entryId===id);
  if(!target)return false;
  let ancestor=target.parentElement;while(ancestor){if(ancestor instanceof HTMLDetailsElement)ancestor.open=true;ancestor=ancestor.parentElement;}
  target.scrollIntoView?.({block:'center',behavior:'smooth'});target.setAttribute('tabindex','-1');target.focus({preventScroll:true});
  target.classList.add('ring-2','ring-emerald-400');setTimeout(()=>target.classList.remove('ring-2','ring-emerald-400'),1800);
  return true;
}
