"use client";

import type { Agent, Mcp, Project, ResourceStatus } from "@/domain/models";
import { DialogForm, Field } from "@/shared/ui/primitives/dialog";
import { Select } from "@/shared/ui/primitives/select";
import { useState, type FormEvent } from "react";

export type CatalogResourceKind = "project" | "mcp" | "agent";

function lines(value: string) {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

export function ResourceDialog({
  kind,
  resourceId,
  projects,
  mcps,
  agents,
  onClose,
  onSave,
  onDelete,
}: {
  kind: CatalogResourceKind;
  resourceId?: string;
  projects: Project[];
  mcps: Mcp[];
  agents: Agent[];
  onClose: () => void;
  onSave: (kind: CatalogResourceKind, id: string | undefined, input: Record<string, unknown>) => void;
  onDelete?: () => void;
}) {
  const project = kind === "project" ? projects.find((item) => item.id === resourceId) : undefined;
  const mcp = kind === "mcp" ? mcps.find((item) => item.id === resourceId) : undefined;
  const agent = kind === "agent" ? agents.find((item) => item.id === resourceId) : undefined;
  const [name, setName] = useState(project?.name ?? mcp?.name ?? agent?.name ?? "");
  const [description, setDescription] = useState(project?.description ?? mcp?.description ?? agent?.description ?? "");
  const [status, setStatus] = useState<ResourceStatus>(project?.status ?? mcp?.status ?? agent?.status ?? "active");
  const [rootPath, setRootPath] = useState(project?.rootPath ?? "");
  const [projectKind, setProjectKind] = useState<Project["kind"]>(project?.kind ?? "code");
  const [accessMode, setAccessMode] = useState<Project["accessMode"]>(project?.accessMode ?? "read");
  const [mcpKind, setMcpKind] = useState<Mcp["config"]["kind"]>(mcp?.config.kind ?? "stdio");
  const [commandOrUrl, setCommandOrUrl] = useState(
    mcp?.config.kind === "stdio" ? mcp.config.command : mcp?.config.kind === "streamable_http" ? mcp.config.url : "",
  );
  const [args, setArgs] = useState(mcp?.config.kind === "stdio" ? mcp.config.args.join("\n") : "");
  const [accessPolicy, setAccessPolicy] = useState<Mcp["accessPolicy"]>(mcp?.accessPolicy ?? "approval");
  const [instruction, setInstruction] = useState(agent?.extension.instruction ?? "");
  const [thinkingLevel, setThinkingLevel] = useState(agent?.extension.thinkingLevel ?? "");
  const [tools, setTools] = useState(agent?.extension.tools?.join("\n") ?? "");
  const [excludeTools, setExcludeTools] = useState(agent?.extension.excludeTools.join("\n") ?? "");
  const [extensionSources, setExtensionSources] = useState(agent?.extension.extensionSources.join("\n") ?? "");
  const [skillPaths, setSkillPaths] = useState(agent?.extension.skillPaths.join("\n") ?? "");
  const [settings, setSettings] = useState(JSON.stringify(agent?.extension.settings ?? {}, null, 2));
  const [formError, setFormError] = useState("");
  const [allowProjectWrite, setAllowProjectWrite] = useState(agent?.policy.allowProjectWrite ?? false);
  const [allowExternalWrite, setAllowExternalWrite] = useState(agent?.policy.allowExternalWrite ?? false);
  const [allowDelegation, setAllowDelegation] = useState(agent?.policy.allowDelegation ?? false);
  const [maxParallelSessions, setMaxParallelSessions] = useState(agent?.policy.maxParallelSessions ?? 4);

  const title = `${resourceId ? "修改" : "新增"}${kind === "project" ? "项目" : kind === "mcp" ? " MCP" : " Agent"}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (kind === "project") {
      onSave(kind, resourceId, { name, description, rootPath, kind: projectKind, accessMode, status });
      return;
    }
    if (kind === "mcp") {
      const config = mcpKind === "built_in"
        ? { kind: "built_in", implementation: "workspace" }
        : mcpKind === "stdio"
          ? { kind: "stdio", command: commandOrUrl, args: lines(args), envSecretRefs: mcp?.config.kind === "stdio" ? mcp.config.envSecretRefs : {} }
          : { kind: "streamable_http", url: commandOrUrl, authSecretRef: mcp?.config.kind === "streamable_http" ? mcp.config.authSecretRef : null };
      onSave(kind, resourceId, { name, description, config, accessPolicy, status });
      return;
    }
    let parsedSettings: Record<string, unknown>;
    try {
      const value: unknown = JSON.parse(settings || "{}");
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
      parsedSettings = value as Record<string, unknown>;
    } catch {
      setFormError("Settings 必须是有效的 JSON 对象");
      return;
    }
    const extension = {
      instruction: instruction || null,
      thinkingLevel: thinkingLevel || null,
      tools: tools.trim() ? lines(tools) : null,
      excludeTools: lines(excludeTools),
      extensionSources: lines(extensionSources),
      skillPaths: lines(skillPaths),
      settings: parsedSettings,
    };
    const policy = { allowProjectWrite, allowExternalWrite, allowDelegation, maxParallelSessions };
    onSave(kind, resourceId, { name, description, extension, policy, status });
  }

  return (
    <DialogForm title={title} dangerAction={resourceId && onDelete ? { label: "删除资源", onClick: onDelete } : undefined} onClose={onClose} onSubmit={submit}>
      <Field label="名称"><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label="说明"><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
      {resourceId && <Field label="状态"><Select ariaLabel="资源状态" value={status} onChange={setStatus} options={[{ value: "active", label: "可用" }, { value: "disabled", label: "停用" }, { value: "archived", label: "归档" }]} /></Field>}
      {kind === "project" && <>
        <Field label="目录绝对路径"><input required value={rootPath} onChange={(event) => setRootPath(event.target.value)} placeholder="/Users/name/project" /></Field>
        <Field label="类型"><Select ariaLabel="项目类型" value={projectKind} onChange={setProjectKind} options={[{ value: "code", label: "代码" }, { value: "knowledge", label: "知识" }, { value: "general", label: "通用" }]} /></Field>
        <Field label="访问"><Select ariaLabel="项目访问模式" value={accessMode} onChange={setAccessMode} options={[{ value: "read", label: "只读" }, { value: "write", label: "读写" }]} /></Field>
      </>}
      {kind === "mcp" && <>
        <Field label="连接类型"><Select ariaLabel="MCP 连接类型" value={mcpKind} onChange={setMcpKind} options={[{ value: "built_in", label: "内置" }, { value: "stdio", label: "stdio" }, { value: "streamable_http", label: "HTTP" }]} /></Field>
        {mcpKind !== "built_in" && <Field label={mcpKind === "stdio" ? "命令" : "URL"}><input required value={commandOrUrl} onChange={(event) => setCommandOrUrl(event.target.value)} /></Field>}
        {mcpKind === "stdio" && <Field label="参数" hint="每行一个参数"><textarea value={args} onChange={(event) => setArgs(event.target.value)} /></Field>}
        <Field label="外部操作策略"><Select ariaLabel="MCP 外部操作策略" value={accessPolicy} onChange={setAccessPolicy} options={[{ value: "read_only", label: "只读" }, { value: "approval", label: "需要确认" }, { value: "allow", label: "允许" }]} /></Field>
      </>}
      {kind === "agent" && <>
        <Field label="角色与指令"><textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} /></Field>
        <Field label="思考强度"><Select ariaLabel="思考强度" value={thinkingLevel} onChange={setThinkingLevel} options={[{ value: "", label: "使用平台默认值" }, { value: "off", label: "关闭" }, { value: "minimal", label: "最少" }, { value: "low", label: "低" }, { value: "medium", label: "中" }, { value: "high", label: "高" }, { value: "xhigh", label: "很高" }, { value: "max", label: "最高" }]} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="允许的工具" hint="每行一个；留空使用默认工具"><textarea value={tools} onChange={(event) => setTools(event.target.value)} /></Field><Field label="排除工具" hint="每行一个"><textarea value={excludeTools} onChange={(event) => setExcludeTools(event.target.value)} /></Field></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="扩展来源" hint="每行一个绝对路径"><textarea value={extensionSources} onChange={(event) => setExtensionSources(event.target.value)} /></Field><Field label="Skills 路径" hint="每行一个绝对路径"><textarea value={skillPaths} onChange={(event) => setSkillPaths(event.target.value)} /></Field></div>
        <Field label="Settings JSON"><textarea className="font-mono text-[11px]" value={settings} onChange={(event) => setSettings(event.target.value)} /></Field>
        <div className="max-h-36 overflow-auto rounded-lg border border-slate-200 p-2 text-xs text-slate-600 [&_label]:flex [&_label]:min-h-7 [&_label]:items-center [&_label]:gap-2"><label><input type="checkbox" checked={allowProjectWrite} onChange={(event) => setAllowProjectWrite(event.target.checked)} />允许项目写入</label><label><input type="checkbox" checked={allowExternalWrite} onChange={(event) => setAllowExternalWrite(event.target.checked)} />允许外部写入</label><label><input type="checkbox" checked={allowDelegation} onChange={(event) => setAllowDelegation(event.target.checked)} />允许委派辅助工作线</label></div>
        <Field label="最大并行工作线"><input type="number" min={1} max={32} value={maxParallelSessions} onChange={(event) => setMaxParallelSessions(Number(event.target.value))} /></Field>
      </>}
      {formError && <p className="mb-3 text-xs text-red-700" role="alert">{formError}</p>}
    </DialogForm>
  );
}
