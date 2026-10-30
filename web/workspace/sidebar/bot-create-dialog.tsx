import { useEffect,useMemo,useRef,useState } from "react";
import { botApi } from "../../api/bot-client";
import type { Agent,Project } from "../../domain/models";
import { RoleSelector } from "../roles/role-selector";
import { ProjectAgentPicker } from "../roles/project-agent-picker";

export function BotCreateDialog({botId,projects,agents,onClose,onSaved}:{botId?:string;projects:Project[];agents:Agent[];onClose:()=>void;onSaved:(id:string)=>void}) {
  const ref=useRef<HTMLDialogElement>(null),[error,setError]=useState(""),[pending,setPending]=useState(false),[coordinatorAgentId,setCoordinatorAgentId]=useState(""),[projectIds,setProjectIds]=useState<string[]>([]),[projectAgents,setProjectAgents]=useState<Record<string,string[]>>({}),[search,setSearch]=useState("");
  useEffect(()=>{ref.current?.showModal();},[]);
  const candidates=agents.filter(agent=>agent.kind==="project"&&agent.status==="active"&&agent.contentSha256),
    visibleProjects=useMemo(()=>projects.filter(project=>`${project.name} ${project.rootPath}`.toLowerCase().includes(search.trim().toLowerCase())),[projects,search]);
  function toggleProject(id:string,checked:boolean){setProjectIds(current=>checked?[...new Set([...current,id])]:current.filter(x=>x!==id));if(!checked)setProjectAgents(current=>({...current,[id]:[]}));}
  return <dialog ref={ref} className={`bot-dialog${botId?"":" bot-dialog--create"}`} onCancel={event=>{event.preventDefault();onClose();}}><form onSubmit={async event=>{
    event.preventDefault();if(pending)return;setPending(true);setError("");const data=new FormData(event.currentTarget);
    try{
      if(botId){const saved=await botApi.createConversation(botId,{title:data.get("name"),goal:data.get("goal")});onSaved(saved.id);onClose();return;}
      const bindings=projectIds.map(projectId=>({projectId,agentIds:projectAgents[projectId]??[]}));
      const saved=await botApi.create({name:data.get("name"),workingDirectory:data.get("directory"),coordinatorAgentId:coordinatorAgentId||null,projectBindings:bindings});
      onSaved(saved.id);onClose();
    }catch(cause){setError(cause instanceof Error?cause.message:"创建失败");}finally{setPending(false);}
  }}><header><div><h2>{botId?"新建总对话":"新建 Bot"}</h2>{!botId&&<small>先选择协调 Agent 和项目；Agent 定义在角色列表中独立创建。</small>}</div><button type="button" className="bot-dialog__close" onClick={onClose} aria-label="关闭">×</button></header>
    <label>{botId?"对话标题":"Bot 名称"}<input name="name" required maxLength={120}/></label>
    {botId?<label>共同目标<textarea name="goal" maxLength={4000}/></label>:<>
      <label>工作目录（可选）<input name="directory" placeholder="留空自动创建工作目录"/><small>指定已有绝对目录；留空在 .data 中创建独立工作目录。</small></label>
      <section className="bot-form__agent"><RoleSelector kind="coordinator" projects={projects} value={coordinatorAgentId} onChange={setCoordinatorAgentId}/>{!coordinatorAgentId&&<small>可以先保存 Bot；配置协调 Agent 前不能创建总对话。</small>}</section>
      <section className="bot-form__projects"><div className="bot-form__project-heading"><h3>项目范围（可为空）</h3><input aria-label="搜索项目名称或路径" placeholder="搜索项目名称或路径" value={search} onChange={event=>setSearch(event.target.value)}/></div>
        {visibleProjects.map(project=>{const checked=projectIds.includes(project.id);return <article className="bot-form__project" key={project.id}><label className="bot-form__project-choice"><input type="checkbox" checked={checked} onChange={event=>toggleProject(project.id,event.target.checked)}/><span><b>{project.name}</b><small>{project.rootPath}</small></span><small>{candidates.length} 个可选项目 Agent</small></label>{checked&&<ProjectAgentPicker agents={candidates} selectedIds={projectAgents[project.id]??[]} onChange={agentIds=>setProjectAgents(current=>({...current,[project.id]:agentIds}))} emptyMessage="角色列表中尚无项目 Agent；协调 Agent 可按能力检索读取。"/>}</article>;})}
        {!visibleProjects.length&&<p className="bot-form__empty">没有匹配项目。创建 Bot 时不会扫描磁盘发现项目。</p>}
      </section>
    </>}
    {error&&<p role="alert">{error}</p>}<footer><button type="button" className="ui-button ui-button--secondary" onClick={onClose}>取消</button><button type="submit" className="ui-button ui-button--primary" disabled={pending}>{pending?"创建中…":botId?"创建对话":"创建 Bot"}</button></footer>
  </form></dialog>;
}
