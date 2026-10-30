import { useEffect,useState } from "react";
import type { Bot } from "../../domain/bot";
import type { Agent,Project } from "../../domain/models";
import { RoleSelector } from "./role-selector";
import { ProjectAgentPicker } from "./project-agent-picker";
import { botApi } from "../../api/bot-client";

export function BotHome({bot,projects,agents,onRefresh,onConversation}:{bot:Bot;projects:Project[];agents:Agent[];onRefresh:()=>Promise<void>;onConversation:(id:string)=>void}) {
  const [role,setRole]=useState(bot.coordinatorAgentId??""),[projectIds,setProjectIds]=useState<string[]>([]),[projectAgents,setProjectAgents]=useState<Record<string,string[]>>({}),[error,setError]=useState(""),[pending,setPending]=useState(false);
  useEffect(()=>{setRole(bot.coordinatorAgentId??"");setProjectIds((bot.projectBindings??[]).map(x=>x.projectId));setProjectAgents(Object.fromEntries((bot.projectBindings??[]).map(x=>[x.projectId,x.agents.map(a=>a.agentId)])));},[bot.id,bot.coordinatorAgentId,bot.projectBindings]);
  const candidates=agents.filter(agent=>agent.kind==="project"&&agent.status==="active"&&agent.contentSha256);
  async function save(adoptLatest=false) {
    setPending(true);setError("");
    try{
      await botApi.update(bot,{coordinatorAgentId:role||null,adoptLatest,projectBindings:projectIds.map(projectId=>({projectId,agentIds:projectAgents[projectId]??[]}))});
      await onRefresh();
    }catch(cause){setError(cause instanceof Error?cause.message:"Bot 配置失败");}
    finally{setPending(false);}
  }
  function toggleProject(id:string,checked:boolean){setProjectIds(current=>checked?[...new Set([...current,id])]:current.filter(x=>x!==id));if(!checked)setProjectAgents(current=>({...current,[id]:[]}));}
  return <main className="surface"><header className="surface__header"><h1>{bot.name}</h1></header><div className="surface__body"><div className="content-width bot-home"><p>工作目录：{bot.workingDirectory}</p>
    <section className="bot-home__config"><RoleSelector kind="coordinator" projects={projects} value={role} onChange={setRole}/><p>{bot.coordinatorAgentSnapshot?`当前默认 ${bot.coordinatorAgentSnapshot.name} · v${bot.coordinatorAgentSnapshot.revision}`:"尚未配置协调 Agent"}</p>{bot.coordinatorAgentSnapshot&&<button type="button" className="ui-button ui-button--secondary ui-button--small" disabled={!role||pending} onClick={()=>void save(true)}>采用角色最新版（仅影响新总对话）</button>}</section>
    <section className="bot-home__config"><h2>项目范围与项目 Agent</h2>{projects.filter(project=>project.status==="active").map(project=>{const checked=projectIds.includes(project.id),linked=projectAgents[project.id]??[],available=[...candidates,...linked.map(id=>agents.find(agent=>agent.id===id)).filter((agent):agent is Agent=>!!agent&&!candidates.some(active=>active.id===agent.id))];return <article className="bot-form__project" key={project.id}><label className="bot-form__project-choice"><input type="checkbox" checked={checked} onChange={event=>toggleProject(project.id,event.target.checked)}/><span><b>{project.name}</b><small>{project.rootPath}</small></span></label>{checked&&<ProjectAgentPicker agents={available} selectedIds={linked} onChange={agentIds=>setProjectAgents(current=>({...current,[project.id]:agentIds}))} emptyMessage="角色列表中暂无项目 Agent。协调 Agent 有只读检索能力时仍可查阅项目。"/>}</article>;})}<p>项目可以留空；Agent 创建时选择的参考项目不会自动绑定到 Bot。</p></section>
    <div className="bot-home__actions"><button type="button" className="ui-button ui-button--secondary" disabled={pending} onClick={()=>void save()}>{pending?"保存中…":"保存 Bot 配置"}</button>
    <button type="button" className="ui-button ui-button--primary" disabled={!bot.coordinatorAgentSnapshot||pending} onClick={()=>{setPending(true);void botApi.createConversation(bot.id,{}).then(async c=>{await onRefresh();onConversation(c.id);}).catch(cause=>setError(cause instanceof Error?cause.message:"新建总对话失败")).finally(()=>setPending(false));}}>新建总对话</button></div>
    {error&&<p role="alert">{error}</p>}
  </div></div></main>;
}
