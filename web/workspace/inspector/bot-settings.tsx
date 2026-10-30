import { useState } from 'react';
import type { BotDetail } from '../../domain/bot';
import type { Project } from '../../domain/models';
import { botApi } from '../../api/bot-client';
import { RoleVersion } from '../roles/role-version';
import { RoleSelector } from '../roles/role-selector';

export function BotSettings({detail,projects,onRefresh}:{detail:BotDetail;projects:Project[];onRefresh:()=>Promise<void>}){
  const [role,setRole]=useState(detail.bot.coordinatorAgentId??''),[error,setError]=useState(''),[pending,setPending]=useState(false),b=detail.bot.id,c=detail.conversation.id;
  async function act(fn:()=>Promise<unknown>){if(pending)return;setPending(true);setError('');try{await fn();await onRefresh();}catch(cause){setError(cause instanceof Error?cause.message:'操作失败');}finally{setPending(false);}}
  return <>
    <RoleVersion key={c} state={detail.conversation.roleState} snapshot={detail.conversation.agentSnapshot} agentId={detail.conversation.agentId} kind="coordinator" botId={b} projects={projects} onRefresh={onRefresh} onAdopt={async(id,revision,sha)=>{await botApi.configureRole(b,detail.conversation,id,revision,sha);await onRefresh();}} />
    <details><summary>标题与工作说明</summary><form className="bot-form" key={detail.conversation.title+detail.conversation.goal} onSubmit={event=>{event.preventDefault();const values=new FormData(event.currentTarget);void act(()=>botApi.updateConversation(b,detail.conversation,{title:values.get('title'),goal:values.get('goal')}));}}><label>标题<input name="title" defaultValue={detail.conversation.title} maxLength={120}/></label><label>对话说明<textarea name="goal" defaultValue={detail.conversation.goal} maxLength={4000}/></label><button type="submit" className="ui-button ui-button--primary" disabled={pending}>保存</button></form></details>
    <details><summary>Bot 默认设置（用于新总对话）</summary><p>当前默认协调 Agent：{detail.bot.coordinatorAgentSnapshot?.name??'未配置'} · v{detail.bot.coordinatorAgentSnapshot?.revision??'—'}</p><form className="bot-form" onSubmit={event=>{event.preventDefault();const values=new FormData(event.currentTarget);void act(()=>botApi.update(detail.bot,{name:values.get('name'),maxParallelExecutions:Number(values.get('parallel')),...(role!==detail.bot.coordinatorAgentId?{coordinatorAgentId:role}:{})}));}}><label>Bot 名称<input name="name" defaultValue={detail.bot.name} maxLength={120}/></label><RoleSelector kind="coordinator" botId={b} projects={projects} value={role} onChange={setRole}/><button type="button" className="ui-button ui-button--secondary ui-button--small" disabled={pending||!role} onClick={()=>void act(()=>botApi.update(detail.bot,{coordinatorAgentId:role,adoptLatest:true}))}>明确采用角色最新版</button><label>项目并发数<input name="parallel" type="number" min={1} max={8} defaultValue={detail.bot.maxParallelExecutions}/></label><button type="submit" className="ui-button ui-button--primary" disabled={pending}>保存设置</button></form></details>
    <section className="session-inspector__section"><h2>项目调度</h2><p>{detail.conversation.schedulingMode==='enabled'?'正在领取可执行的项目任务。':'已暂停领取项目任务；总对话仍可交流。'} 请使用总对话页头的调度开关。</p></section>
    <p className="session-inspector__hint">消息送达核对、执行结果恢复、Task 重试和 Work 停止请在总对话中对应的 Session 标签处理。</p>
    {error&&<p role="alert">{error}</p>}
  </>;
}
