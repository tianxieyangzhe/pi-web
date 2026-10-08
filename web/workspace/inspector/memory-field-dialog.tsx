import {useEffect,useRef} from "react";
import type {SessionMemoryContext} from "../../domain/session-memory";
import {memoryLabels} from "./session-memory-context-editor";

function markdown(node:Node):string {
  if(node.nodeType===Node.TEXT_NODE)return node.textContent??"";
  if(!(node instanceof HTMLElement))return "";
  const children=Array.from(node.childNodes).map(markdown).join("");
  const tag=node.tagName.toLowerCase();
  if(tag==="br")return "\n";
  if(tag==="b"||tag==="strong")return `**${children}**`;
  if(tag==="i"||tag==="em")return `*${children}*`;
  if(tag==="li")return `- ${children.trim()}\n`;
  if(["p","div","ul","ol"].includes(tag))return `${children}\n`;
  return children;
}
function RichText({value,onChange,label,disabled}:{value:string;onChange:(value:string)=>void;label:string;disabled:boolean}) {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(ref.current&&document.activeElement!==ref.current)ref.current.textContent=value;},[value]);
  function update(){if(ref.current)onChange(Array.from(ref.current.childNodes).map(markdown).join("").replace(/\n{3,}/g,"\n\n").trim());}
  function format(command:string){ref.current?.focus();document.execCommand(command,false);update();}
  return <div className="memory-rich-text"><div className="memory-rich-text__toolbar" role="toolbar" aria-label={`${label}格式`}>
    {[["bold","加粗"],["italic","斜体"],["insertUnorderedList","列表"],["removeFormat","清除格式"]].map(([command,name])=><button key={command} type="button" disabled={disabled} onMouseDown={event=>event.preventDefault()} onClick={()=>format(command)}>{name}</button>)}
  </div><div ref={ref} className="memory-rich-text__content" role="textbox" aria-label={label} aria-multiline="true" contentEditable={!disabled} suppressContentEditableWarning onInput={update} onPaste={event=>{event.preventDefault();document.execCommand("insertText",false,event.clipboardData.getData("text/plain"));update();}}/><small>{value.length} 字符</small></div>;
}
export function MemoryFieldDialog({field,value,onChange,onSave,onCancel,busy,error}:{field:keyof SessionMemoryContext;value:SessionMemoryContext;onChange:(value:SessionMemoryContext)=>void;onSave:()=>void;onCancel:()=>void;busy:boolean;error:string}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
  const label=memoryLabels[field];
  const items=field!=="summary"&&field!=="goal"&&field!=="outputs"?value[field]:null;
  return <dialog ref={ref} className="memory-field-dialog" aria-labelledby="memory-field-dialog-title" onCancel={event=>{event.preventDefault();onCancel();}} onClick={event=>{if(event.target===ref.current)onCancel();}}><header><h2 id="memory-field-dialog-title">修改{label}</h2><button type="button" aria-label="关闭修改弹窗" onClick={onCancel}>×</button></header><div className="memory-field-dialog__body">
    {(field==="summary"||field==="goal")&&<RichText label={label} value={value[field]} disabled={busy} onChange={text=>onChange({...value,[field]:text})}/>}
    {items&&<>{items.map((item,index)=><div className="memory-field-dialog__item" key={index}><RichText label={`${label} ${index+1}`} value={item} disabled={busy} onChange={text=>onChange({...value,[field]:items.map((entry,i)=>i===index?text:entry)})}/><div><button type="button" disabled={busy} onClick={()=>onChange({...value,[field]:items.filter((_,i)=>i!==index)})}>删除</button>{index>0&&<button type="button" disabled={busy} onClick={()=>{const next=[...items];[next[index-1],next[index]]=[next[index],next[index-1]];onChange({...value,[field]:next});}}>上移</button>}</div></div>)}<button type="button" disabled={busy||items.length>=20} onClick={()=>onChange({...value,[field]:[...items,""]})}>添加{label}</button></>}
    {field==="outputs"&&<>{value.outputs.map((output,index)=><div key={index} className="memory-field-dialog__item"><label>标题<input disabled={busy} value={output.title} maxLength={120} onChange={event=>onChange({...value,outputs:value.outputs.map((item,i)=>i===index?{...item,title:event.target.value}:item)})}/></label><RichText label={`产出摘要 ${index+1}`} value={output.summary} disabled={busy} onChange={summary=>onChange({...value,outputs:value.outputs.map((item,i)=>i===index?{...item,summary}:item)})}/><label>项目相对路径（可选）<input disabled={busy} value={output.path??""} maxLength={512} onChange={event=>onChange({...value,outputs:value.outputs.map((item,i)=>i===index?{...item,path:event.target.value||null}:item)})}/></label><button type="button" disabled={busy} onClick={()=>onChange({...value,outputs:value.outputs.filter((_,i)=>i!==index)})}>删除产出</button></div>)}<button type="button" disabled={busy||value.outputs.length>=20} onClick={()=>onChange({...value,outputs:[...value.outputs,{title:"",summary:"",path:null}]})}>添加产出</button></>}
    {error&&<p role="alert" className="error-banner">{error}</p>}
  </div><footer><span>仅修改总结展示；其他部分保持不变。</span><button type="button" onClick={onCancel}>取消</button><button type="button" disabled={busy} onClick={onSave}>{busy?"保存中…":"保存修改"}</button></footer></dialog>;
}
