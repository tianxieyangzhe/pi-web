import { Bot, CircleStop, RotateCcw } from "lucide-react";
import type { Project } from "../../domain/models";
import { Conversation } from "../../components/conversation";
import { PromptInput } from "../../components/prompt-input";
import { useProjectSession } from "../../hooks/use-project-session";
import type { Session } from "../../domain/models";

export function ProjectSessionView({ project, session }: { project: Project; session: ReturnType<typeof useProjectSession> }) {
  const activeSession = session.sessions.find((item) => item.id === session.sessionId);
  return <main className="surface">
    <header className="surface__header"><div><span className="eyebrow">项目会话</span><h1>{project.name}</h1><p>{activeSession?.purpose || "消息直接进入此项目的工作线。"}</p></div><div className="header-actions">{session.sessionId && <button aria-label="结束工作线" title="结束工作线" onClick={() => void session.end()}><CircleStop size={16} /></button>}</div></header>
    <div className="surface__body"><div className="content-width">{session.messages.length === 0 && !session.pendingText && <div className="empty-state"><Bot size={28} /><h2>项目工作线准备就绪</h2><p>输入任务后将直接调用该项目 Session。</p></div>}<Conversation messages={session.messages} pendingText={session.pendingText} streamingText={session.streamingText} activities={session.activities} running={session.running} />{session.error && <button className="error-banner" onClick={() => session.setError("")}>{session.error}</button>}</div></div>
    <footer className="composer"><PromptInput placeholder={`直接交给 ${project.name} 处理`} running={session.running} onSubmit={(value) => void session.send(value)} onStop={() => void session.interrupt()} /></footer>
  </main>;
}

export function ProjectSessionInspector({ project, session }: { project: Project; session: ReturnType<typeof useProjectSession> }) {
  const active = session.sessions.find((item) => item.id === session.sessionId) ?? null;
  const agent = active?.agent ?? null;
  const mcpSnapshots = active?.mcps ?? [];
  const prompts = session.messages.filter((message) => message.role === "user").length;
  const runtimeState = active?.state === "running" || active?.state === "starting" || active?.state === "interrupting"
    ? "运行中"
    : active?.state === "unavailable" ? "需要恢复" : active?.state === "ended" ? "已结束" : active ? "空闲" : "未启动";

  return <div className="inspector__body session-inspector">
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
    <section className="session-inspector__section"><h2>Agent</h2>
      <DetailRow label="执行配置" value={agent?.name ?? "平台默认"} />
      {agent && <><DetailRow label="版本" value={`修订 ${agent.revision}`} /><DetailRow label="思考等级" value={agent.thinkingLevel ?? "平台默认"} /></>}
    </section>
    <section className="session-inspector__section"><h2>MCP</h2>
      {mcpSnapshots.length ? mcpSnapshots.map((mcp) => <DetailRow key={mcp.id} label={mcp.name} value={mcp.accessPolicy === "read_only" ? "只读" : mcp.accessPolicy === "approval" ? "需审批" : "按策略运行"} />) : <p className="session-inspector__empty">此工作线没有绑定 MCP。</p>}
    </section>
    <section className="session-inspector__section"><h2>Skills</h2>
      <DetailRow label="Skill 配置" value={`${agent?.skills.length ?? 0} 项`} />
      {agent?.skills.length ? <div className="session-inspector__tags">{agent.skills.map((skill) => <span key={skill}>{skill}</span>)}</div> : <p className="session-inspector__empty">Agent 未配置专属 Skill；Pi 仍按项目与用户配置发现可用 Skill。</p>}
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
