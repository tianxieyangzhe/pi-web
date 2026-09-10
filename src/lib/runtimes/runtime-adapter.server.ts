import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeEvent, RuntimeType, Session } from "@/lib/runtimes/runtime-types";
import { createACPProvider } from "@mcpc-tech/acp-ai-provider";
import { streamText } from "ai";
import { createAgentSession, ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";

export type RuntimeTurn = { events: RuntimeEvent[]; runtimeSessionId?: string };

export interface RuntimeAdapter {
  start(session: Session, workingDirectory: string): Promise<void>;
  sendMessage(session: Session, message: string, workingDirectory: string, onEvent?: (event: RuntimeEvent) => void): Promise<RuntimeTurn>;
  interrupt(sessionId: string): Promise<void>;
  close(sessionId: string): Promise<void>;
}

const codexBinary = process.env.CODEX_CLI_PATH ?? "/Applications/ChatGPT.app/Contents/Resources/codex";
const opencodeBinary = process.env.OPENCODE_CLI_PATH ?? "/opt/homebrew/bin/opencode";
function requireExecutable(binary: string | undefined, name: string) {
  if (!binary || !fs.existsSync(binary)) throw new Error(`${name} 尚未连接。请安装 CLI 并设置对应的运行时路径。`);
  return binary;
}

function runCli(binary: string, args: string[], cwd: string, onLine?: (line: string) => void) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let bufferedLine = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      bufferedLine += text;
      const lines = bufferedLine.split("\n");
      bufferedLine = lines.pop() ?? "";
      lines.forEach((line) => onLine?.(line));
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr.trim() || `${binary} 退出，状态码 ${code ?? "未知"}`)));
  });
}

function runGit(cwd: string, args: string[]) {
  return new Promise<string>((resolve) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.on("error", () => resolve(""));
    child.on("close", () => resolve(stdout));
  });
}

async function listWorkspaceFiles(cwd: string) {
  const [tracked, untracked] = await Promise.all([
    runGit(cwd, ["ls-files", "-z"]),
    runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  return [...new Set([...tracked.split("\0"), ...untracked.split("\0")].filter(Boolean))];
}

type WorkingTreeSnapshot = Map<string, Buffer>;

async function snapshotWorkingTree(cwd: string): Promise<WorkingTreeSnapshot> {
  const snapshot: WorkingTreeSnapshot = new Map();
  for (const file of await listWorkspaceFiles(cwd)) {
    try { snapshot.set(file, fs.readFileSync(path.join(cwd, file))); } catch { /* file disappeared during snapshot */ }
  }
  return snapshot;
}

async function collectTurnDiff(cwd: string, before: WorkingTreeSnapshot) {
  const afterFiles = await listWorkspaceFiles(cwd);
  const files = [...new Set([...before.keys(), ...afterFiles])];
  const changed = files.filter((file) => {
    const oldContent = before.get(file);
    let newContent: Buffer | undefined;
    try { newContent = fs.readFileSync(path.join(cwd, file)); } catch { /* file was deleted */ }
    return !oldContent || !newContent || !oldContent.equals(newContent);
  }).slice(0, 30);
  if (!changed.length) return undefined;

  const snapshotDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ai-workspace-turn-"));
  try {
    const pieces = await Promise.all(changed.map(async (file, index) => {
      const beforePath = path.join(snapshotDirectory, String(index));
      const oldContent = before.get(file);
      const afterPath = path.join(cwd, file);
      if (oldContent) fs.writeFileSync(beforePath, oldContent);
      const left = oldContent ? beforePath : "/dev/null";
      const right = fs.existsSync(afterPath) ? afterPath : "/dev/null";
      const raw = await runGit(cwd, ["diff", "--no-index", "--binary", "--", left, right]);
      return raw.replace(/^diff --git .+$/m, `diff --git a/${file} b/${file}`);
    }));
    const diff = pieces.filter(Boolean).join("\n").trim();
    if (!diff) return undefined;
    const capped = diff.length > 30000 ? `${diff.slice(0, 30000)}\n\n…本轮其余改动已截断` : diff;
    return { summary: `本轮修改了 ${changed.length} 个文件`, diff: capped };
  } finally {
    fs.rmSync(snapshotDirectory, { recursive: true, force: true });
  }
}

function parseJsonLines(output: string) {
  return output.split("\n").flatMap((line) => {
    try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; }
  });
}

class CodexRuntimeAdapter implements RuntimeAdapter {
  async start(_session: Session, _workingDirectory: string) {}

  async sendMessage(session: Session, message: string, workingDirectory: string, onEvent?: (event: RuntimeEvent) => void): Promise<RuntimeTurn> {
    const binary = requireExecutable(codexBinary, "Agent（Codex）");
    const args = session.runtimeSessionId
      ? ["exec", "resume", session.runtimeSessionId, message, "--json", "--skip-git-repo-check"]
      : ["exec", message, "--json", "--sandbox", "workspace-write", "--skip-git-repo-check"];
    const { stdout } = await runCli(binary, args, workingDirectory, (line) => {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type === "item.started") onEvent?.({ type: "progress", text: "Agent 正在执行任务…" });
        if (event.type === "item.completed" && (event.item as { type?: string } | undefined)?.type === "command_execution") onEvent?.({ type: "progress", text: "Agent 正在执行命令…" });
      } catch { /* non-JSON CLI diagnostics stay out of the chat transcript */ }
    });
    const events = parseJsonLines(stdout);
    const runtimeSessionId = events.find((event) => event.type === "thread.started")?.thread_id;
    const text = events.filter((event) => event.type === "item.completed" && (event.item as { type?: string } | undefined)?.type === "agent_message")
      .map((event) => ((event.item as { text?: string } | undefined)?.text ?? "").trim()).filter(Boolean).join("\n\n");
    return { runtimeSessionId: typeof runtimeSessionId === "string" ? runtimeSessionId : session.runtimeSessionId, events: text ? [{ type: "text", text }, { type: "status", status: "ready" }] : [{ type: "status", status: "ready" }] };
  }

  async interrupt(_sessionId: string) {}
  async close(_sessionId: string) {}
}

class OpenCodeRuntimeAdapter implements RuntimeAdapter {
  private providers = new Map<string, ReturnType<typeof createACPProvider>>();

  async start(_session: Session, _workingDirectory: string) {}

  async sendMessage(session: Session, message: string, workingDirectory: string, onEvent?: (event: RuntimeEvent) => void): Promise<RuntimeTurn> {
    let provider = this.providers.get(session.id);
    if (!provider) {
      const binary = requireExecutable(opencodeBinary, "OpenCode");
      provider = createACPProvider({
        command: binary,
        args: ["acp"],
        session: { cwd: workingDirectory, mcpServers: [] },
        existingSessionId: session.runtimeSessionId,
        persistSession: true,
      });
      this.providers.set(session.id, provider);
    }
    const result = streamText({ model: provider.languageModel(), prompt: message, tools: provider.tools as any });
    let text = "";
    for await (const chunk of result.textStream) {
      text += chunk;
      onEvent?.({ type: "text", text });
    }
    const runtimeSessionId = provider.getSessionId() ?? session.runtimeSessionId;
    return { runtimeSessionId: runtimeSessionId ?? undefined, events: text.trim() ? [{ type: "text", text: text.trim() }, { type: "status", status: "ready" }] : [{ type: "status", status: "ready" }] };
  }

  async interrupt(_sessionId: string) {}
  async close(sessionId: string) { const provider = this.providers.get(sessionId); provider?.cleanup(); this.providers.delete(sessionId); }
}

type PiSession = Awaited<ReturnType<typeof createAgentSession>>["session"];

function traceText(value: unknown, limit = 2400) {
  const raw = typeof value === "string" ? value : (() => {
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  })();
  // Tool arguments can contain authorization values. Observability must never
  // become a secondary route for exposing runtime secrets.
  const redacted = raw.replace(/(api[_-]?key|authorization|token|password|secret)\s*([:=])\s*([^\s,"}]+)/gi, "$1$2 [已隐藏]");
  return redacted.length > limit ? `${redacted.slice(0, limit)}\n…已截断` : redacted;
}

/**
 * Pi is deliberately embedded through its SDK rather than through its CLI.
 * Pi keeps its own JSONL session tree, compaction and project-local resources;
 * our database stores only the native session file reference.
 */
class PiRuntimeAdapter implements RuntimeAdapter {
  private sessions = new Map<string, PiSession>();
  private modelRuntime = ModelRuntime.create({ refreshOnCreate: false });

  private async getSession(session: Session, workingDirectory: string) {
    const active = this.sessions.get(session.id);
    if (active) return active;

    const sessionManager = session.runtimeSessionId
      ? SessionManager.open(session.runtimeSessionId, undefined, workingDirectory)
      : SessionManager.create(workingDirectory);
    const modelRuntime = await this.modelRuntime;
    // A Workspace runtime owns its default model. Do not rely on a developer's
    // global Pi settings, which are absent for a freshly created Workspace.
    const model = modelRuntime.getModel("deepseek", "deepseek-v4-flash");
    if (!model) {
      throw new Error("Pi 未找到内置的 DeepSeek 默认模型。请检查 Pi SDK 安装。");
    }
    const { session: piSession } = await createAgentSession({
      cwd: workingDirectory,
      sessionManager,
      modelRuntime,
      model,
    });
    this.sessions.set(session.id, piSession);
    return piSession;
  }

  async start(session: Session, workingDirectory: string) {
    await this.getSession(session, workingDirectory);
  }

  async sendMessage(session: Session, message: string, workingDirectory: string, onEvent?: (event: RuntimeEvent) => void): Promise<RuntimeTurn> {
    const piSession = await this.getSession(session, workingDirectory);
    const workingTreeBefore = await snapshotWorkingTree(workingDirectory);
    let text = "";
    const unsubscribe = piSession.subscribe((event) => {
      const payload = event as unknown as {
        type: string;
        id?: string;
        delta?: string;
        toolCallId?: string;
        toolName?: string;
        args?: unknown;
        result?: unknown;
        isError?: boolean;
        assistantMessageEvent?: { type?: string; contentIndex?: number; delta?: string; content?: string };
      };
      const modelEvent = payload.assistantMessageEvent;
      if (payload.type === "message_update" && payload.assistantMessageEvent?.type === "text_delta") {
        text += payload.assistantMessageEvent.delta ?? "";
        onEvent?.({ type: "text", text });
      }
      if (payload.type === "message_update" && modelEvent?.type === "thinking_start") {
        onEvent?.({ type: "trace", id: `thinking-${modelEvent.contentIndex ?? 0}`, kind: "thinking", status: "running", summary: "正在思考", detail: "" });
      }
      if (payload.type === "message_update" && modelEvent?.type === "thinking_delta") {
        onEvent?.({ type: "trace", id: `thinking-${modelEvent.contentIndex ?? 0}`, kind: "thinking", status: "running", summary: "正在思考", detail: traceText(modelEvent.delta ?? "") });
      }
      if (payload.type === "message_update" && modelEvent?.type === "thinking_end") {
        onEvent?.({ type: "trace", id: `thinking-${modelEvent.contentIndex ?? 0}`, kind: "thinking", status: "completed", summary: "已完成思考", detail: traceText(modelEvent.content ?? "") });
      }
      if (payload.type === "tool_execution_start") {
        onEvent?.({ type: "trace", id: `tool-${payload.toolCallId ?? payload.toolName ?? "unknown"}`, kind: "tool", status: "running", summary: `正在执行 ${payload.toolName ?? "工具"}`, detail: traceText(payload.args) });
      }
      if (payload.type === "tool_execution_update") {
        onEvent?.({ type: "trace", id: `tool-${payload.toolCallId ?? payload.toolName ?? "unknown"}`, kind: "tool", status: "running", summary: `正在执行 ${payload.toolName ?? "工具"}`, detail: traceText(payload.result ?? payload.delta ?? "") });
      }
      if (payload.type === "tool_execution_end") {
        onEvent?.({ type: "trace", id: `tool-${payload.toolCallId ?? payload.toolName ?? "unknown"}`, kind: "tool", status: payload.isError ? "error" : "completed", summary: `${payload.isError ? "执行失败" : "已完成"}：${payload.toolName ?? "工具"}`, detail: traceText(payload.result) });
      }
      if (payload.type === "compaction_start") {
        onEvent?.({ type: "trace", id: "context-compaction", kind: "context", status: "running", summary: "正在压缩原生上下文", detail: "Pi 正在整理较早的对话内容，以保持当前会话可继续执行。" });
      }
      if (payload.type === "compaction_end") {
        onEvent?.({ type: "trace", id: "context-compaction", kind: "context", status: "completed", summary: "原生上下文已压缩", detail: "较早内容已由 Pi 原生会话总结；完整记录仍保留在原生 Session 中。" });
      }
      if (payload.type === "bash_execution_update" && payload.delta) {
        onEvent?.({ type: "trace", id: `bash-${payload.id ?? "output"}`, kind: "tool", status: "running", summary: "正在运行项目命令", detail: traceText(payload.delta) });
      }
    });
    try {
      await piSession.prompt(message);
      const changes = await collectTurnDiff(workingDirectory, workingTreeBefore);
      if (changes) onEvent?.({ type: "file_changes", ...changes });
      return {
        runtimeSessionId: piSession.sessionFile ?? piSession.sessionId,
        events: [{ type: "status", status: "ready" }],
      };
    } finally {
      unsubscribe();
    }
  }

  async interrupt(sessionId: string) {
    await this.sessions.get(sessionId)?.abort();
  }

  async close(sessionId: string) {
    this.sessions.get(sessionId)?.dispose();
    this.sessions.delete(sessionId);
  }
}

export const runtimeAdapters: Record<RuntimeType, RuntimeAdapter> = {
  agent: new CodexRuntimeAdapter(),
  opencode: new OpenCodeRuntimeAdapter(),
  pi: new PiRuntimeAdapter(),
};
