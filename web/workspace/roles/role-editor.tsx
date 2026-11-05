import { useEffect, useMemo, useRef, useState } from "react";
import { Response } from "../conversation/ai-elements/response";
import { api } from "../../api/client";
import type { Agent, AgentDefinition, Project } from "../../domain/models";
import { renderAgentMarkdown } from "../../domain/agent-markdown";
import { ArrowLeft, FileText } from "lucide-react";

const capabilityLabels: Record<keyof AgentDefinition["capabilities"],string> = {
  readFiles:"读取当前工作目录",
  writeFiles:"修改当前工作目录",
  readProjects:"历史项目直读（已停用）",
  dispatchTasks:"向项目角色派发任务",
  dispatchProjectWrites:"派发项目修改",
  exchangeMessages:"参与 Bot 会话协作消息"
};
const blankCapabilities = (): AgentDefinition["capabilities"] => ({readFiles:false,writeFiles:false,readProjects:false,dispatchTasks:false,dispatchProjectWrites:false,exchangeMessages:false});
type Candidate = {name:string;description:string|null;definition:AgentDefinition;warnings:string[];sources:Array<{path:string;hash:string}>};
type ReferenceFile = {name:string;content:string};
export type RoleTarget = {kind?:"coordinator"|"project";resource?:Agent;initialFeedback?:string};
type Message = {role:"assistant"|"user";content:string};

export function RoleEditor({target,projects,onClose,onSaved}:{target:RoleTarget;projects:Project[];onClose:()=>void;onSaved:(role:Agent)=>void}) {
  const heading=useRef<HTMLHeadingElement>(null),abort=useRef<AbortController|null>(null),alive=useRef(true),messagesEnd=useRef<HTMLDivElement>(null);
  const [kind,setKind]=useState<"coordinator"|"project">(target.resource?.kind??target.kind??"coordinator"),
    [name,setName]=useState(target.resource?.name??""),
    [description,setDescription]=useState(target.resource?.description??""),
    [instructions,setInstructions]=useState(target.resource?.definition?.instructions??target.resource?.legacySource??""),
    [capabilities,setCapabilities]=useState<AgentDefinition["capabilities"]>(()=>({...blankCapabilities(),...(target.resource?.definition?.capabilities??{})})),
    [status,setStatus]=useState<Agent["status"]>(target.resource?.status??"active"),
    [projectId,setProjectId]=useState(""),
    [references,setReferences]=useState<ReferenceFile[]>([]),
    [messages,setMessages]=useState<Message[]>([{role:"assistant",content:target.initialFeedback?`当前协调总对话报告此角色定义可能存在问题：${target.initialFeedback}\n\n请核对后发送修改意见。这里生成的是未保存草稿，原版本继续有效。`:target.resource?.legacySource&&!target.resource.contentSha256?"这是旧版角色内容，尚未转成可运行的 Agent.md。你可以先让 AI 整理，再继续提出修改意见。":"告诉我这个 Agent 的职责，或选择参考项目、上传材料。我会整理成角色草稿并显示在右侧。"}]),
    [feedback,setFeedback]=useState(target.initialFeedback??""),
    [warnings,setWarnings]=useState<string[]>([]),
    [sources,setSources]=useState<Candidate["sources"]>([]),
    [pending,setPending]=useState(false),
    [error,setError]=useState(""),
    [dirty,setDirty]=useState(false),
    [showSaved,setShowSaved]=useState(false);
  const activeKind=target.resource?.kind??kind;
  const savedMarkdown=useMemo(()=>target.resource?.legacySource&&!target.resource.contentSha256?target.resource.legacySource:target.resource?.definition&&target.resource.kind?renderAgentMarkdown({agentId:target.resource.id,revision:target.resource.revision,kind:target.resource.kind,name:target.resource.name,description:target.resource.description,definition:target.resource.definition}):"",[target.resource]);
  const draftMarkdown=useMemo(()=>instructions.trim()?renderAgentMarkdown({agentId:target.resource?.id,revision:target.resource?target.resource.revision+(dirty?1:0):undefined,kind:activeKind,name:name||"待命名角色",description:description||null,definition:{instructions,capabilities}}):"",[activeKind,capabilities,description,dirty,instructions,name,target.resource]);

  useEffect(()=>{
    alive.current=true;
    heading.current?.focus({preventScroll:true});
    return()=>{alive.current=false;abort.current?.abort();};
  },[]);
  useEffect(()=>{messagesEnd.current?.scrollIntoView({block:"nearest"});},[messages,pending]);

  async function prepare(body:Record<string,unknown>,userText:string) {
    if(pending)return;
    abort.current?.abort();
    const controller=new AbortController();abort.current=controller;setPending(true);setError("");
    setMessages(current=>[...current,{role:"user",content:userText}]);
    try {
      const result=await api.prepareAgent({kind:activeKind,...body},controller.signal);
      if(!alive.current||controller.signal.aborted)return;
      accept(result);
    } catch(cause) {
      if(alive.current&&!controller.signal.aborted) setError(cause instanceof Error?cause.message:"Agent 整理失败");
    } finally {if(alive.current)setPending(false);}
  }
  function accept(value:Candidate) {
    setName(value.name);setDescription(value.description??"");setInstructions(value.definition.instructions);
    setWarnings(value.warnings);setSources(value.sources);setDirty(true);setShowSaved(false);
    const summary=value.warnings.length?`已整理出新草稿。${value.warnings.slice(0,3).join("；")}`:"已整理出新草稿。右侧显示完整 Agent.md；你可以继续提出修改意见。";
    setMessages(current=>[...current,{role:"assistant",content:summary}]);
  }
  async function uploadReference(event:React.ChangeEvent<HTMLInputElement>) {
    const files=Array.from(event.target.files??[]);event.target.value="";
    if(!files.length||pending)return;
    try {
      const next=[...references];
      for(const file of files){
        if(file.size>65536)throw Error(`${file.name} 超过 64KiB`);
        const content=new TextDecoder("utf-8",{fatal:true}).decode(await file.arrayBuffer());
        if(content.includes("\0"))throw Error(`${file.name} 不是可读取的文本文件`);
        next.push({name:file.name,content});
      }
      if(next.length>8||next.reduce((n,f)=>n+new TextEncoder().encode(f.content).length,0)>262144)throw Error("参考文件总量不能超过 8 个文件或 256KiB");
      setReferences(next);
      const isFirst=!instructions.trim();
      const prompt=isFirst?`请识别这份材料并整理出适合的${activeKind==="coordinator"?"协调":"项目"}角色定义。` : "请结合新上传的参考文件修订当前角色草稿，保留未冲突的职责和边界。";
      await prepare({mode:isFirst?"generate":"revise",projectId:projectId||undefined,...(isFirst?{requirements:prompt}:{currentDraft:{name,description:description||null,instructions},feedback:prompt}),referenceFiles:next},prompt);
    } catch(cause){setError(cause instanceof Error?cause.message:"无法读取参考文件");}
  }
  async function sendFeedback() {
    const text=feedback.trim();if(!text||pending)return;
    setFeedback("");
    const body:Record<string,unknown>={projectId:projectId||undefined,referenceFiles:references,requirements:text};
    if(instructions.trim()) { body.mode="revise";body.currentDraft={name,description:description||null,instructions};body.feedback=text; }
    else body.mode="generate";
    await prepare(body,text);
  }
  async function save() {
    if(pending||!instructions.trim()||!name.trim())return;
    abort.current?.abort();setPending(true);setError("");
    try {
      const body={name,description:description||null,kind:activeKind,status,definition:{instructions,capabilities}};
      const saved=target.resource?.contentSha256?await api.updateAgent(target.resource.id,{...body,writeETag:target.resource.writeETag}):await api.createAgent(body);
      if(!alive.current)return;
      window.dispatchEvent(new Event("roles-updated"));onSaved(saved);
    } catch(cause) {if(alive.current)setError(cause instanceof Error?cause.message:"保存角色失败");}
    finally {if(alive.current)setPending(false);}
  }
  const capKeys=(Object.keys(capabilityLabels) as Array<keyof AgentDefinition["capabilities"]>).filter(key=>key!=="readProjects"&&(activeKind==="coordinator"||!(["dispatchTasks","dispatchProjectWrites"] as string[]).includes(key)));
  return <section className="role-editor" aria-label="Agent 编辑工作区">
    <header className="role-editor__header"><div><h2 ref={heading} tabIndex={-1}>{target.resource?`修改 Agent · ${target.resource.name}`:"新建 Agent"}</h2><small>{target.resource?`当前版本 v${target.resource.revision} · 编辑对话独立于工作会话`:"独立角色定义 · 尚未绑定 Bot 或 Project"}</small></div><button className="ui-button ui-button--secondary ui-button--small role-editor__back" type="button" onClick={onClose}><ArrowLeft size={15}/>返回列表</button></header>
    <div className="role-editor__workspace">
      <section className="role-editor__conversation" aria-label="Agent 编辑对话">
        {(!target.resource||!target.resource.kind)&&<label className="role-editor__kind">角色用途<select value={kind} disabled={pending} onChange={event=>setKind(event.target.value as typeof kind)}><option value="coordinator">协调角色</option><option value="project">项目角色</option></select></label>}
        {target.resource?.legacySource&&!target.resource.contentSha256&&<button type="button" className="ui-button ui-button--secondary ui-button--small" disabled={pending} onClick={()=>void prepare({mode:"import",markdown:target.resource!.legacySource,fileName:`${target.resource!.name}（历史角色内容）`},"请把这份历史角色内容整理为独立 Agent 定义，保留业务边界并标出未映射事项。")}>让 AI 转换历史角色内容</button>}
        <div className="role-editor__references">
          <label>参考项目<select value={projectId} disabled={pending} onChange={event=>setProjectId(event.target.value)}><option value="">不选项目</option>{projects.filter(project=>project.status==="active").map(project=><option key={project.id} value={project.id}>{project.name} · {project.rootPath}</option>)}</select></label>
          <label className="role-editor__upload">上传参考文件<input type="file" multiple accept=".md,.txt,.yaml,.yml,.json,.ts,.tsx,.js,.go,.py,text/*" disabled={pending} onChange={event=>void uploadReference(event)}/></label>
          {references.length>0&&<div className="role-editor__chips">{references.map((file,index)=><span key={`${file.name}-${index}`}>{file.name}<button type="button" aria-label={`移除 ${file.name}`} onClick={()=>setReferences(items=>items.filter((_,i)=>i!==index))}>×</button></span>)}</div>}
          <small>项目和文件仅作为本次生成/修订材料，不会绑定角色或扩大权限。</small>
        </div>
        <div className="role-editor__messages" aria-live="polite">{messages.map((message,index)=><article key={index} className={`role-editor__message role-editor__message--${message.role}`}><b>{message.role==="assistant"?"Agent 助手":"你的意见"}</b><Response>{message.content}</Response></article>)}{pending&&<p role="status">LLM 正在整理角色定义… <button type="button" className="ui-button ui-button--secondary ui-button--small" onClick={()=>abort.current?.abort()}>取消请求</button></p>}<div ref={messagesEnd}/></div>
        <div className="role-editor__composer"><label className="sr-only" htmlFor="agent-feedback">输入 Agent 修改意见</label><textarea id="agent-feedback" value={feedback} maxLength={4000} disabled={pending} placeholder={instructions?"提出修改意见，例如：补充跨项目对比步骤，并保留现有权限边界。":"描述这个 Agent 的职责、工作方式和边界……"} onChange={event=>setFeedback(event.target.value)} onKeyDown={event=>{if(event.key==="Enter"&&(event.metaKey||event.ctrlKey)){event.preventDefault();void sendFeedback();}}}/><button type="button" className="ui-button ui-button--primary" disabled={pending||!feedback.trim()} onClick={()=>void sendFeedback()}>发送意见</button></div>
        {error&&<p role="alert" className="role-editor__error">{error}</p>}
      </section>
      <aside className="role-editor__markdown" aria-label="Agent Markdown 预览">
        <header><div><b>Agent.md</b><small>{dirty?"未保存草稿":target.resource?`已保存 v${target.resource.revision}`:"等待生成"}</small></div>{target.resource&&savedMarkdown&&<button type="button" className="ui-button ui-button--secondary ui-button--small" onClick={()=>setShowSaved(!showSaved)}>{showSaved?"查看草稿":"查看已保存版本"}</button>}</header>
        {showSaved||draftMarkdown?<pre>{showSaved?savedMarkdown:draftMarkdown}</pre>:<div className="role-editor__empty-preview"><span><FileText size={22}/></span><b>Agent.md 等待生成</b><p>在左侧描述职责，或选择参考项目、上传材料。</p><small>生成后会在这里预览规范 Markdown；正文不能手动编辑。</small></div>}
        {(warnings.length>0||sources.length>0)&&<details><summary>来源与待核对项</summary>{warnings.map((warning,index)=><p key={index}>{warning}</p>)}{sources.map(source=><p key={source.path}>{source.path}</p>)}</details>}
        <details className="role-editor__capabilities"><summary>明确设置运行能力（默认关闭）</summary><p>协调会话始终有只读 Project Directory；读取或修改项目文件必须由项目 Session 执行。</p>{capKeys.map(key=><label key={key}><input type="checkbox" disabled={pending||!instructions.trim()} checked={capabilities[key]} onChange={event=>{const checked=event.target.checked;setDirty(true);setCapabilities(value=>({...value,[key]:checked,...(key==="dispatchTasks"&&!checked?{dispatchProjectWrites:false}:{}),...(key==="dispatchProjectWrites"&&checked?{dispatchTasks:true}:{})}));}}/>{capabilityLabels[key]}</label>)}</details>
      </aside>
    </div>
    <footer className="role-editor__footer"><button type="button" className="ui-button ui-button--secondary" onClick={onClose}>取消</button><button type="button" className="ui-button ui-button--primary" disabled={pending||!instructions.trim()||!name.trim()} onClick={()=>void save()}>{pending?"处理中…":target.resource?"保存新版本":"保存 Agent"}</button></footer>
  </section>;
}
