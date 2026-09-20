"use client";

import type { Agent, Mcp, Project, Session } from "@/domain/models";
import { DialogForm, Field } from "@/shared/ui/primitives/dialog";
import { Select } from "@/shared/ui/primitives/select";
import { useState, type FormEvent } from "react";

export function SessionDialog({
  session,
  projects,
  mcps,
  agents,
  onClose,
  onSave,
}: {
  session: Session | null;
  projects: Project[];
  mcps: Mcp[];
  agents: Agent[];
  onClose: () => void;
  onSave: (input: Record<string, unknown>) => void;
}) {
  const [purpose, setPurpose] = useState(session?.purpose ?? "");
  const [agentId, setAgentId] = useState(session?.agentId ?? "");
  const [workingProjectId, setWorkingProjectId] = useState(session?.workingProjectId ?? "");
  const [referenceProjectIds, setReferenceProjectIds] = useState(session?.referenceProjectIds ?? []);
  const [mcpIds, setMcpIds] = useState(session?.mcpIds ?? []);

  function toggle(id: string, values: string[], setValues: (values: string[]) => void) {
    setValues(values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const configuration = { agentId: agentId || null, mcpIds, workingProjectId: workingProjectId || null, referenceProjectIds };
    onSave(session ? configuration : { ...configuration, role: "worker", purpose });
  }

  const activeProjects = projects.filter((project) => project.status === "active");
  return (
    <DialogForm title={session ? "配置当前工作线" : "新建辅助工作线"} onClose={onClose} onSubmit={submit}>
      {!session && <Field label="工作线目的"><input autoFocus required value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="例如：实现登录模块" /></Field>}
      {session?.state === "running" && <p className="mb-3 text-xs leading-5 text-slate-500">当前工作正在运行，保存的配置会从下一轮开始生效。</p>}
      <Field label="Agent"><Select ariaLabel="选择 Agent" value={agentId} onChange={setAgentId} options={[{ value: "", label: "不使用 Agent，使用 Pi 基础能力" }, ...agents.filter((agent) => agent.status === "active").map((agent) => ({ value: agent.id, label: agent.name }))]} /></Field>
      <Field label="工作项目"><Select ariaLabel="选择工作项目" value={workingProjectId} onChange={setWorkingProjectId} options={[{ value: "", label: "不绑定工作项目" }, ...activeProjects.map((project) => ({ value: project.id, label: project.name }))]} /></Field>
      <Field label="参考项目"><div className="max-h-36 overflow-auto rounded-lg border border-slate-200 p-2 [&_label]:flex [&_label]:w-full [&_label]:min-h-8 [&_label]:items-center [&_label]:gap-2 [&_label]:rounded-md [&_label]:px-2 [&_label]:font-normal [&_label]:text-slate-700 [&_label:hover]:bg-slate-50 [&_input[type=checkbox]]:size-4 [&_input[type=checkbox]]:shrink-0 [&_input[type=checkbox]]:accent-teal-700">{activeProjects.length ? activeProjects.map((project) => <label key={project.id}><input type="checkbox" checked={referenceProjectIds.includes(project.id)} disabled={workingProjectId === project.id} onChange={() => toggle(project.id, referenceProjectIds, setReferenceProjectIds)} />{project.name}</label>) : <span className="px-2 text-xs font-normal text-slate-400">还没有可用项目</span>}</div></Field>
      <Field label="MCP"><div className="max-h-36 overflow-auto rounded-lg border border-slate-200 p-2 [&_label]:flex [&_label]:w-full [&_label]:min-h-8 [&_label]:items-center [&_label]:gap-2 [&_label]:rounded-md [&_label]:px-2 [&_label]:font-normal [&_label]:text-slate-700 [&_label:hover]:bg-slate-50 [&_input[type=checkbox]]:size-4 [&_input[type=checkbox]]:shrink-0 [&_input[type=checkbox]]:accent-teal-700">{mcps.filter((mcp) => mcp.status === "active").length ? mcps.filter((mcp) => mcp.status === "active").map((mcp) => <label key={mcp.id}><input type="checkbox" checked={mcpIds.includes(mcp.id)} onChange={() => toggle(mcp.id, mcpIds, setMcpIds)} />{mcp.name}</label>) : <span className="px-2 text-xs font-normal text-slate-400">还没有可用 MCP</span>}</div></Field>
    </DialogForm>
  );
}
