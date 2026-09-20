"use client";

import type { Room, RoomContent, RoomContentKind, RoomContentStatus, RoomOutputKind, Workspace } from "@/domain/models";
import { DialogForm, Field } from "@/shared/ui/primitives/dialog";
import { Select } from "@/shared/ui/primitives/select";
import { useState, type FormEvent } from "react";

export type RoomContentCandidate = {
  kind: "goal" | "direction" | "output";
  outputKind?: RoomOutputKind;
  title: string;
  body: string;
};

export function WorkspaceDialog({ workspace, onClose, onSave, onDelete }: { workspace?: Workspace; onClose: () => void; onSave: (input: Record<string, unknown>) => void; onDelete?: () => void }) {
  const [name, setName] = useState(workspace?.name ?? "");
  const [description, setDescription] = useState(workspace?.description ?? "");
  const [status, setStatus] = useState(workspace?.status ?? "active");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ name, description, status });
  }
  return <DialogForm title={workspace ? "修改工作空间" : "新建工作空间"} dangerAction={workspace && onDelete ? { label: "删除工作空间", onClick: onDelete } : undefined} onClose={onClose} onSubmit={submit}><Field label="名称"><input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：产品研发" /></Field><Field label="说明"><textarea value={description} onChange={(event) => setDescription(event.target.value)} /></Field>{workspace && <Field label="状态"><Select ariaLabel="工作空间状态" value={status} onChange={setStatus} options={[{ value: "active", label: "可用" }, { value: "archived", label: "归档" }]} /></Field>}</DialogForm>;
}

export function RoomDialog({ room, onClose, onSave, onDelete }: { room: Room; onClose: () => void; onSave: (input: Record<string, unknown>) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(room.title);
  const [status, setStatus] = useState(room.status);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ title, status });
  }
  return <DialogForm title="修改会话" dangerAction={{ label: "删除会话", onClick: onDelete }} onClose={onClose} onSubmit={submit}><Field label="标题"><input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="状态"><Select ariaLabel="会话状态" value={status} onChange={setStatus} options={[{ value: "active", label: "进行中" }, { value: "paused", label: "已暂停" }, { value: "closed", label: "已关闭" }, { value: "archived", label: "已归档" }]} /></Field></DialogForm>;
}

const defaultStatus: Record<RoomContentKind, RoomContentStatus> = {
  overview: "active",
  goal: "active",
  direction: "candidate",
  output: "draft",
};

const statusOptions: Record<RoomContentKind, Array<{ value: RoomContentStatus; label: string }>> = {
  overview: [{ value: "active", label: "当前总览" }, { value: "superseded", label: "已替代" }],
  goal: [{ value: "active", label: "当前目标" }, { value: "superseded", label: "已替代" }, { value: "retracted", label: "已撤回" }],
  direction: [{ value: "candidate", label: "候选" }, { value: "adopted", label: "已采用" }, { value: "dismissed", label: "已忽略" }],
  output: [{ value: "draft", label: "草稿" }, { value: "published", label: "已发布" }, { value: "superseded", label: "已替代" }, { value: "retracted", label: "已撤回" }],
};

export function RoomContentDialog({ content, candidate, initialKind = "goal", onClose, onSave, onDelete }: { content?: RoomContent; candidate?: RoomContentCandidate; initialKind?: RoomContentKind; onClose: () => void; onSave: (input: Record<string, unknown>) => void; onDelete?: () => void }) {
  const startingKind = content?.kind ?? candidate?.kind ?? initialKind;
  const [kind, setKind] = useState<RoomContentKind>(startingKind);
  const [outputKind, setOutputKind] = useState<RoomOutputKind>(content?.outputKind ?? candidate?.outputKind ?? "note");
  const [title, setTitle] = useState(content?.title ?? candidate?.title ?? "");
  const [body, setBody] = useState(content?.body ?? candidate?.body ?? "");
  const [status, setStatus] = useState<RoomContentStatus>(content?.status ?? defaultStatus[startingKind]);

  function changeKind(next: RoomContentKind) {
    setKind(next);
    setStatus(defaultStatus[next]);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ kind, outputKind: kind === "output" ? outputKind : null, title, body, status });
  }

  return (
    <DialogForm title={content ? "修改结构内容" : "新增结构内容"} dangerAction={content && onDelete && (content.status === "candidate" || content.status === "draft") ? { label: "删除内容", onClick: onDelete } : undefined} onClose={onClose} onSubmit={submit}>
      <Field label="类型"><Select ariaLabel="内容类型" disabled={Boolean(content)} value={kind} onChange={changeKind} options={[{ value: "overview", label: "总览" }, { value: "goal", label: "目标" }, { value: "direction", label: "方向" }, { value: "output", label: "输出" }]} /></Field>
      {kind === "output" && <Field label="输出类型"><Select ariaLabel="输出类型" disabled={Boolean(content)} value={outputKind} onChange={setOutputKind} options={[{ value: "note", label: "笔记" }, { value: "decision", label: "决策" }, { value: "plan", label: "计划" }, { value: "delivery", label: "交付" }, { value: "summary", label: "总结" }]} /></Field>}
      <Field label="标题"><input autoFocus required value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
      <Field label="正文"><textarea required rows={7} value={body} onChange={(event) => setBody(event.target.value)} /></Field>
      <Field label="状态"><Select ariaLabel="内容状态" value={status} onChange={setStatus} options={statusOptions[kind].map((option) => ({ value: option.value, label: option.label }))} /></Field>
    </DialogForm>
  );
}
