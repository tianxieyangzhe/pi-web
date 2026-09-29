import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Room } from "../../domain/models";
import { RoomRunTimeline } from "../../shared/ui/ai-elements/room-run-timeline";
import { PromptInput } from "../../components/prompt-input";
import { useRoom } from "../../hooks/use-room";

export function RoomView({ room, onUpdate, onDelete }: { room: Room; onUpdate: (body: Record<string, unknown>) => void; onDelete: () => void }) {
  const state = useRoom(room.id);
  const [draft, setDraft] = useState("");
  function submit(value: string) { setDraft(""); void state.submit(value); }
  const projects = state.view?.projects ?? [];
  const pending = state.view?.tasks.filter((task) => task.state === "review_pending") ?? [];
  const contents = state.view?.contents ?? [];
  return <main className="surface"><header className="surface__header"><div><span className="eyebrow">Cross-project Room</span><h1>{room.title}</h1><p>{projects.map((project) => project.name).join(" · ") || "固定项目范围"}</p></div><div className="header-actions"><button aria-label="编辑会话" title="编辑会话" onClick={() => { const title = window.prompt("修改会话标题", room.title); if (title?.trim()) onUpdate({ title: title.trim() }); }}><Pencil size={16} /></button><button aria-label="删除会话" title="删除会话" onClick={onDelete}><Trash2 size={16} /></button></div></header><div className="scope-bar">{projects.map((project) => <span key={project.id}>{project.name}</span>)}</div><div className="surface__body"><div className="content-width"><RoomRunTimeline runs={state.view?.runs ?? []} tasks={state.view?.tasks ?? []} activities={state.activities} progress={state.progress} response={state.response} running={state.running} projects={projects} onApprove={(id) => void state.approve(id)} onCancel={(id) => void state.cancel(id)} pendingTasks={pending} />{contents.length > 0 && <section className="content-panel"><header><b>会话内容</b><button aria-label="新增内容" title="新增内容" onClick={() => { const title = window.prompt("内容标题"); const body = title ? window.prompt("内容正文") : null; if (title && body) void state.saveContent(null, { kind: "memory", title, body, status: "draft" }); }}><Plus size={14} /></button></header>{contents.map((content) => <article key={content.id}><div><b>{content.title}</b><small>{content.kind} · {content.status}</small></div><p>{content.body}</p><div className="content-actions"><button onClick={() => { const body = window.prompt("修改正文", content.body); if (body !== null) void state.saveContent(content.id, { body }); }}>编辑</button><button onClick={() => void state.deleteContent(content.id)}>删除</button></div></article>)}</section>}{!state.view?.runs.length && !state.running && <div className="empty-state"><h2>跨项目会话准备就绪</h2><p>描述目标后，只会在当前固定项目范围内协调。</p></div>}{state.error && <button className="error-banner" onClick={() => state.setError("")}>{state.error}<Trash2 size={13} /></button>}</div></div><footer className="composer"><PromptInput placeholder="描述跨项目目标或下一步" running={state.running} onSubmit={submit} onStop={() => {}} /></footer></main>;
}
