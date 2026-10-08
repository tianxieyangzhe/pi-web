import type {useSessionMemory} from "../conversation/project-session/use-session-memory";
import {createPortal} from "react-dom";
import {MemoryFieldDialog} from "./memory-field-dialog";
import {useEffect,useRef,useState} from "react";
import {api} from "../../api/client";
import type {SessionMemoryContext} from "../../domain/session-memory";
import {memoryLabels,memoryFieldHints} from "./session-memory-context-editor";
export function SessionMemoryPanel({projectId,sessionId,visible,running,onOpenOutput,headerActionsTarget,memory}:{memory:ReturnType<typeof useSessionMemory>;headerActionsTarget:HTMLElement|null;projectId:string;sessionId:string|null;visible:boolean;running:boolean;onOpenOutput:(path:string)=>void}) {
  const [editingField,setEditingField]=useState<keyof SessionMemoryContext|null>(null);
  const [rangeStart,setRangeStart]=useState(0);const [rangeEnd,setRangeEnd]=useState(0);
  const view=memory.view;const [error,setError]=useState("");const [editing,setEditing]=useState<"context"|null>(null);const [form,setForm]=useState<SessionMemoryContext|null>(null);const [etag,setETag]=useState("");const [busy,setBusy]=useState(false);const submission=useRef<AbortController|null>(null);const submissionVersion=useRef(0);const mounted=useRef(true);const identity=useRef(`${projectId}:${sessionId}`);identity.current=`${projectId}:${sessionId}`;
  const refresh=memory.refresh;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;submissionVersion.current++;submission.current?.abort();};},[projectId,sessionId]);
  function cancelEditing(){submissionVersion.current++;submission.current?.abort();submission.current=null;setBusy(false);setEditing(null);setEditingField(null);setForm(null);setError("");}
  useEffect(()=>{if(!visible)cancelEditing();},[visible]);
  useEffect(()=>{const leave=()=>cancelEditing();window.addEventListener("memory-before-leave",leave);window.addEventListener("pagehide",leave);return()=>{window.removeEventListener("memory-before-leave",leave);window.removeEventListener("pagehide",leave);};},[]);

  function editField(field:keyof SessionMemoryContext){if(!view)return;setEditing("context");setEditingField(field);setForm(structuredClone(view.sessionMemory.contextJson));setETag(view.writeETag);}
  async function change(action:string,body:unknown,token=view?.writeETag){
    if(!sessionId||!token)return;
    submission.current?.abort();
    const controller=new AbortController();submission.current=controller;
    const version=++submissionVersion.current;
    setBusy(true);setError("");
    try{
      const result=await api.changeSessionMemory(projectId,sessionId,action,token,body,controller.signal);
      if(controller.signal.aborted||version!==submissionVersion.current||!mounted.current)return;
      memory.accept(result);setEditing(null);setEditingField(null);setForm(null);
      if(action==="context")window.dispatchEvent(new CustomEvent("session-memory-saved",{detail:{projectId}}));
    }catch(cause){
      if(controller.signal.aborted||version!==submissionVersion.current||!mounted.current)return;
      setError(cause instanceof Error?cause.message:"操作失败");await refresh();
    }finally{if(version===submissionVersion.current&&mounted.current){setBusy(false);submission.current=null;}}
  }

  const summaryDisabledReason = busy ? "正在提交，请稍候" : !view ? "正在读取记忆" : editing ? "请先保存或取消修改" : view.generationState==="generating" ? "正在总结" : view.generationState==="queued" ? "已排队，等待原生上下文稳定" : !view.canWrite ? "项目只读，不能总结" : !view.canSummarize ? "请先恢复会话或检查对话来源" : "";
  if(!visible)return <div hidden/>;
  if(!sessionId)return <p className="session-inspector__empty">创建会话后可查看独立的记忆。</p>;

  return <div className="inspector__body memory-panel">
    {headerActionsTarget&&createPortal(<button className="memory-summary-action" disabled={!!summaryDisabledReason} title={summaryDisabledReason||"整理尚未审阅的对话"} onClick={()=>void change("summarize",{})}>立即总结</button>,headerActionsTarget)}
    {(error||memory.error)&&<p role="alert" className="error-banner">{error||memory.error}</p>}{view&&<>
    <div className="memory-sync-status" role="status">
      <span>{view.syncState==="synced"?"与已完成对话同步":view.syncState==="updating"?"正在同步记忆":view.syncState==="pending"?`${view.pendingAnswerCount} 条回答待同步`:view.syncState==="failed"?"记忆同步失败":"对话来源不可用"}</span>
      <time dateTime={view.memoryUpdatedAt} title={new Date(view.memoryUpdatedAt).toLocaleString("zh-CN")}>{new Date(view.memoryUpdatedAt).toLocaleTimeString("zh-CN")}</time>
    </div>
    {view.lastOutcome==="no_new_messages"&&<p role="status">没有新对话可总结</p>}
    {view.error&&<p role="alert">{view.error}</p>}
    <section><header><h3>当前内容</h3></header><ContextRead value={view.sessionMemory.contextJson} onOpenOutput={onOpenOutput} onModify={editField} disabled={busy||!view.canWrite||!!editing}/></section>
    {editingField&&form&&<MemoryFieldDialog field={editingField} value={form} onChange={setForm} busy={busy} error={error} onCancel={cancelEditing} onSave={()=>void change("context",{context:form},etag)}/>}

    {view.availableRanges.length>0&&<details><summary>重新审查指定对话范围</summary><p>选择连续的完整回答范围，总结将直接更新记忆。</p><label>起点<select value={rangeStart} onChange={event=>setRangeStart(Number(event.target.value))}>{view.availableRanges.map((range,index)=><option key={range.through} value={index}>{range.label}</option>)}</select></label><label>终点<select value={rangeEnd} onChange={event=>setRangeEnd(Number(event.target.value))}>{view.availableRanges.map((range,index)=><option key={range.through} value={index}>{range.label}</option>)}</select></label><button disabled={busy||!!editing||rangeEnd<rangeStart||!view.canWrite||view.generationState==="generating"||view.generationState==="queued"} onClick={()=>void change("summarize",{sourceAfterEntryId:view.availableRanges[rangeStart].after,sourceThroughEntryId:view.availableRanges[rangeEnd].through})}>重新总结此范围</button></details>}

    </>}
  </div>;
}
function ContextRead({value,onOpenOutput,onModify,disabled=false}:{value:SessionMemoryContext;onOpenOutput:(path:string)=>void;onModify:(field:keyof SessionMemoryContext)=>void;disabled?:boolean}) {
  return <div className="memory-fields">{Object.entries(memoryLabels).map(([key,label]) => {
    const content = value[key as keyof SessionMemoryContext];
    return <section className="session-inspector__section memory-field" key={key}>
      <h2>{label}</h2>
      <p className="session-inspector__note">{memoryFieldHints[key as keyof SessionMemoryContext]}</p>
      <div className="memory-field__body">{key === "outputs" ? value.outputs.length ? value.outputs.map((out,index) => <div key={index} className="memory-field__output"><b>{out.title}</b><p>{out.summary}</p>{out.path && <button type="button" onClick={() => onOpenOutput(out.path!)}>{out.path}</button>}</div>) : <p className="session-inspector__empty">暂无产出</p>
        : Array.isArray(content) ? content.length ? <ul>{(content as string[]).map((item,index) => <li key={index}>{item}</li>)}</ul> : <p className="session-inspector__empty">尚未填写</p>
        : <p className={content ? "memory-field__text" : "session-inspector__empty"}>{content || "尚未填写"}</p>}<button className="memory-field__modify" type="button" disabled={disabled} onClick={()=>onModify(key as keyof SessionMemoryContext)}>修改</button></div>
    </section>;
  })}</div>;
}