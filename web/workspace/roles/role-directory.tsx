import { useEffect, useRef, useState } from "react";
import type { Agent } from "../../domain/models";
import type { RoleTarget } from "./role-editor";
import { api } from "../../api/client";
import { Bot as BotIcon, Plus, X } from "lucide-react";

export function RoleDirectory({open,roles,onRefresh,onClose,onEdit}:{open:boolean;roles:Agent[];onRefresh:()=>Promise<void>;onClose:()=>void;onEdit:(target:RoleTarget)=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busyId,setBusyId]=useState<string|null>(null);
  useEffect(()=>{
    if(!open){dialog.current?.close();return;}
    if(!dialog.current?.open)dialog.current?.showModal();
  },[open]);
  async function remove(role:Agent){
    if(!window.confirm(`删除“${role.name}”？若已有 Bot 或会话引用，将归档并保留历史版本。`))return;
    setError("");setNotice("");
    try{
      const result=await api.deleteAgent(role.id,role.writeETag);
      await onRefresh();
      setNotice(result.archived?`“${role.name}”已归档，历史引用保留。`:`“${role.name}”已删除。`);
    }catch(cause){setError(cause instanceof Error?cause.message:"删除 Agent 失败");}
  }
  async function setStatus(role:Agent,status:Agent["status"]){
    setBusyId(role.id);setError("");setNotice("");
    try{await api.updateAgent(role.id,{status,writeETag:role.writeETag});await onRefresh();setNotice(`“${role.name}”已${status==="active"?"恢复":"停用"}。`);}
    catch(cause){setError(cause instanceof Error?cause.message:"角色状态更新失败");}
    finally{setBusyId(null);}
  }
  return <>
    {open&&<dialog ref={dialog} className="role-list-dialog" onCancel={event=>{event.preventDefault();onClose();}}>
      <header><div className="role-list-dialog__title"><span className="role-list-dialog__icon"><BotIcon size={18}/></span><div><h2>Agent 列表</h2><small>独立角色定义；在新建 Bot 时再绑定项目和运行关系。</small></div></div><button type="button" className="role-list-dialog__close" aria-label="关闭" onClick={onClose}><X size={18}/></button></header>
      <div className="role-list-dialog__toolbar"><span>角色库</span><button type="button" className="ui-button ui-button--primary" onClick={()=>{setError("");setNotice("");onEdit({});}}><Plus size={15}/>新增 Agent</button></div>
      <div className="role-list-dialog__rows">{roles.map(role=>{
        const kindLabel=role.kind===null?"历史角色":role.kind==="coordinator"?"协调角色":"项目角色",
          statusLabel=!role.contentSha256?"待转换":role.status==="active"?"启用":role.status==="disabled"?"停用":"已归档";
        return <article className="role-list-dialog__row" key={role.id}>
        <div className="role-list-dialog__identity"><div className="role-list-dialog__identity-title"><b>{role.name}</b><span className="role-list-dialog__kind">{kindLabel}</span></div><p>{role.description||"尚无简短说明"}</p><div className="role-list-dialog__meta"><span>v{role.revision}</span><span className={`role-list-dialog__status role-list-dialog__status--${role.contentSha256?role.status:"legacy"}`}>{statusLabel}</span></div></div>
        <div className="role-list-dialog__actions"><button type="button" className="ui-button ui-button--secondary ui-button--small" onClick={()=>{setError("");setNotice("");onEdit({resource:role});}}>修改</button>{role.status!=="archived"&&<button type="button" className="ui-button ui-button--secondary ui-button--small" disabled={busyId===role.id} onClick={()=>void setStatus(role,role.status==="active"?"disabled":"active")}>{role.status==="active"?"停用":"启用"}</button>}{role.status==="archived"&&<button type="button" className="ui-button ui-button--secondary ui-button--small" disabled={busyId===role.id} onClick={()=>void setStatus(role,"active")}>恢复</button>}<button type="button" className="ui-button ui-button--danger ui-button--small" disabled={busyId===role.id} onClick={()=>void remove(role)}>删除</button></div>
      </article>})}{roles.length===0&&<div className="role-list-dialog__empty"><span className="role-list-dialog__empty-icon"><BotIcon size={22}/></span><b>从第一个角色开始</b><p>用对话描述职责、工作方式和边界，整理后保存为 Markdown。</p><small>保存后，Agent 可在新建 Bot 或项目会话时选择。</small></div>}</div>
      {notice&&<p role="status" className="role-list-dialog__notice">{notice}</p>}{error&&<p role="alert" className="role-list-dialog__error">{error}</p>}
    </dialog>}
  </>;
}
