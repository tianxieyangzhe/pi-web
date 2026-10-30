import {RoleVersion} from '../roles/role-version';
import {useState,useEffect} from 'react';
import {api} from '../../api/client';
import type {Agent} from '../../domain/models';
import {RoleSelector} from '../roles/role-selector';
import {NativeContextSection} from "./native-context-section";
import { RotateCcw } from "lucide-react";
import type { Project, Session } from "../../domain/models";
import { useProjectSession } from "../conversation/project-session/use-project-session";

export function ProjectSessionInspector({ project, session }: { project: Project; session: ReturnType<typeof useProjectSession> }) {

  const active = session.sessions.find((item) => item.id === session.sessionId) ?? null;
  const agent = active?.agent ?? null;
  const mcpSnapshots = active?.mcps ?? [];
  const prompts = session.messages.filter((message) => message.role === "user").length;
  const runtimeState = active?.state === "running" || active?.state === "starting" || active?.state === "interrupting"
    ? "运行中"
    : active?.state === "unavailable" ? "需要恢复" : active?.state === "ended" ? "已结束" : active ? "空闲" : "未启动";

  return <div className="inspector__body session-inspector">
    <NativeContextSection projectId={project.id} sessionId={session.sessionId} onBusy={session.setCompacting} onRestore={session.restore} running={session.running} />
    <section className="session-inspector__section"><h2>Session</h2>
      <DetailRow label="项目" value={project.name} />
      <DetailRow label="状态" value={active ? sessionStateLabel(active.state) : "尚未创建"} />
      <DetailRow label="会话 ID" value={active ? `${active.id.slice(0, 14)}…` : "发送首条消息后创建"} />
      <DetailRow label="提示记录" value={`${prompts} 条`} />
      {active?.lastActivityAt && <DetailRow label="最近活动" value={formatTime(active.lastActivityAt)} />}
    </section>
    <section className="session-inspector__section"><h2>运行环境</h2>
      <DetailRow label="执行器" value="Pi Agent" />
      <DetailRow label="模型" value="服务端统一配置" />
      <DetailRow label="执行状态" value={runtimeState} />
      <DetailRow label="SessionManager" value={active ? "持久会话记录" : "等待首次提示"} />
      {active?.state === "unavailable" && <button className="session-inspector__action" onClick={() => void session.restore()}><RotateCcw size={13} />恢复工作线</button>}
      <p className="session-inspector__note">运行时由平台管理，不展示本地 transcript 文件或内部句柄。</p>
    </section>
    <section className="session-inspector__section"><h2>角色</h2>
      <DetailRow label="执行配置" value={agent?.name ?? "待配置角色"} />
      {agent && <><DetailRow label="版本" value={`修订 ${agent.revision}`} /></>}
    </section>
    {active&&<RoleVersion key={active.id} state={active.roleState} snapshot={active.agentSnapshot} agentId={active.agentId} kind="project" projectId={project.id} projects={[project]} onRefresh={()=>session.selectSession(active.id)} onAdopt={async(id,revision,sha)=>{await api.configureSessionRole(project.id,active,id,revision,sha);await session.selectSession(active.id);}}/>}
    <section className="session-inspector__section"><h2>MCP</h2>
      {mcpSnapshots.length ? mcpSnapshots.map((mcp) => <DetailRow key={mcp.id} label={mcp.name} value={mcp.accessPolicy === "read_only" ? "只读" : mcp.accessPolicy === "approval" ? "需审批" : "按策略运行"} />) : <p className="session-inspector__empty">此工作线没有绑定 MCP。</p>}
    </section>
    <section className="session-inspector__section"><h2>Skills</h2>
      <DetailRow label="Skill 配置" value={`${agent?.skills.length ?? 0} 项`} />
      {agent?.skills.length ? <div className="session-inspector__tags">{agent.skills.map((skill) => <span key={skill}>{skill}</span>)}</div> : <p className="session-inspector__empty">本版角色不启用隐式 Skill。</p>}
    </section>
  </div>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="session-inspector__row"><span>{label}</span><b title={value}>{value}</b></div>;
}

function sessionStateLabel(state: Session["state"]) {
  return ({ not_started: "未启动", starting: "正在启动", idle: "空闲", running: "运行中", interrupting: "正在停止", ended: "已结束", unavailable: "不可用" })[state];
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
