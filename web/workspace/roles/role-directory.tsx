import {Button} from '../../components/button';
import { useState } from "react";
import type { Agent } from "../../domain/models";
import type { RoleTarget } from "./role-editor";
import { api } from "../../api/client";
import { UserRound as AgentIcon, Plus } from "lucide-react";

export function RoleDirectory({open,roles,onRefresh,onEdit}:{open:boolean;roles:Agent[];onRefresh:()=>Promise<void>;onEdit:(target:RoleTarget)=>void}) {
  const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busyId,setBusyId]=useState<string|null>(null);
  async function remove(role:Agent){
    if(!window.confirm(`删除“${role.name}”？若已有会话引用，将归档并保留历史版本。`))return;
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
    {open&&<section className="role-editor flex min-h-0 min-w-0 flex-col overflow-hidden bg-white" aria-label="助手列表">
      <header className="shrink-0 border-b border-slate-100 px-6 py-6 sm:px-8"><div className="role-list-dialog__title"><span className="role-list-dialog__icon"><AgentIcon size={18}/></span><div className="min-w-0"><h2 className="m-0 text-xl font-semibold text-slate-800">助手列表</h2><p className="mt-1 mb-0 text-xs leading-5 text-slate-500">选择助手以查看或编辑，项目助手可被工作区使用。</p></div></div></header>
      <div className="role-list-dialog__toolbar"><span>助手库</span><Button variant="primary" type="button"  onClick={()=>{setError("");setNotice("");onEdit({});}}><Plus size={15}/>新增助手</Button></div>
      <div className="role-list-dialog__rows">{roles.map(role=>{
        const kindLabel=role.definition?.scope==="workspace"||role.definition?.source?.kind==="workspace"?"工作区助手":role.definition?.scope==="global"||!role.definition?.source?"通用助手":"项目助手",
          statusLabel=!role.contentSha256?"待转换":role.status==="active"?"启用":role.status==="disabled"?"停用":"已归档";
        return <article className="role-list-dialog__row" key={role.id}>
        <div className="role-list-dialog__identity"><div className="role-list-dialog__identity-title"><b>{role.name}</b><span className="role-list-dialog__kind">{kindLabel}</span></div><div className="role-list-dialog__meta"><span>v{role.revision}</span><span className={`role-list-dialog__status role-list-dialog__status--${role.contentSha256?role.status:"legacy"}`}>{statusLabel}</span></div></div>
        <div className="role-list-dialog__actions"><Button type="button"  onClick={()=>{setError("");setNotice("");onEdit({resource:role});}}>修改</Button>{role.status!=="archived"&&<Button type="button"  disabled={busyId===role.id} onClick={()=>void setStatus(role,role.status==="active"?"disabled":"active")}>{role.status==="active"?"停用":"启用"}</Button>}{role.status==="archived"&&<Button type="button"  disabled={busyId===role.id} onClick={()=>void setStatus(role,"active")}>恢复</Button>}<Button variant="danger" type="button"  disabled={busyId===role.id} onClick={()=>void remove(role)}>删除</Button></div>
      </article>})}{roles.length===0&&<div className="role-list-dialog__empty"><span className="role-list-dialog__empty-icon"><AgentIcon size={22}/></span><b>创建第一个助手</b><p>设置系统提示词和作用范围，项目规则在项目设置中管理。</p><small>保存后，在会话设置中选择使用。</small></div>}</div>
      {notice&&<p role="status" className="role-list-dialog__notice">{notice}</p>}{error&&<p role="alert" className="role-list-dialog__error">{error}</p>}
    </section>}
  </>;
}
