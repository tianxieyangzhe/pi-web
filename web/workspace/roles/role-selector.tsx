import { useEffect,useRef,useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import type { Agent,Project } from "../../domain/models";
import { RoleEditor } from "./role-editor";

export function RoleSelector({kind,projects,value,onChange,fixedId}:{kind:"coordinator"|"project";botId?:string;projectId?:string;projects:Project[];value:string;onChange:(id:string)=>void;fixedId?:string}) {
  const wrapper=useRef<HTMLDivElement>(null),[roles,setRoles]=useState<Agent[]>([]),[editing,setEditing]=useState<Agent|true|null>(null),[error,setError]=useState("");
  const reload=()=>api.listAgents().then(setRoles).catch(e=>setError(e.message));
  useEffect(()=>{void reload();},[]);
  useEffect(()=>{const leave=()=>setEditing(null);window.addEventListener("memory-before-leave",leave);return()=>window.removeEventListener("memory-before-leave",leave);},[]);
  useEffect(()=>{if(!editing)return;const parent=wrapper.current?.closest("dialog,.modal-backdrop") as HTMLElement|null;if(!parent)return;const previous=parent.style.display;parent.style.display="none";return()=>{parent.style.display=previous;};},[editing]);
  useEffect(()=>{const refresh=()=>void reload();window.addEventListener("roles-updated",refresh);return()=>window.removeEventListener("roles-updated",refresh);},[]);
  const legal=roles.filter(r=>(!fixedId||r.id===fixedId)&&r.kind===kind&&r.status==="active"&&!!r.contentSha256),selected=roles.find(r=>r.id===value);
  return <div ref={wrapper} className="role-selector"><label>{kind==="coordinator"?"协调 Agent":"项目 Agent"}<select value={value} onChange={event=>onChange(event.target.value)}><option value="">请选择 Agent</option>{legal.map(role=><option value={role.id} key={role.id}>{role.name} · v{role.revision}</option>)}{value&&!legal.some(role=>role.id===value)&&<option value={value}>{selected?.name??"已绑定 Agent"} · 不可新选</option>}</select></label><div>{!fixedId&&<button type="button" className="ui-button ui-button--secondary ui-button--small" onClick={()=>setEditing(true)}>新增 Agent</button>}{selected&&<button type="button" className="ui-button ui-button--secondary ui-button--small" onClick={()=>setEditing(selected)}>修改</button>}</div>{selected?.description&&<small>{selected.description}</small>}{error&&<p role="alert">{error}</p>}{editing&&createPortal(<RoleEditor target={{kind,resource:editing===true?undefined:editing}} projects={projects} onClose={()=>setEditing(null)} onSaved={role=>{setEditing(null);void reload();window.dispatchEvent(new Event("roles-updated"));onChange(role.id);}}/>,document.body)}</div>;
}
