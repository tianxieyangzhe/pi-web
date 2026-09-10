"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileTree, FileTreeActions, FileTreeFile, FileTreeFolder, FileTreeIcon, FileTreeName } from "@/components/ai-elements/file-tree";

type Runtime = "Agent" | "OpenCode" | "Pi";

type Workspace = {
  id: string;
  name: string;
  group: string;
  icon: string;
  workingDirectory?: string;
};

type Session = {
  id: string;
  workspaceId: string;
  runtime: Runtime;
  title: string;
  status: "Running" | "Ready" | "Idle" | "Error";
  color: string;
  icon: string;
  messages: string[];
};

type FileEntry = {
  path: string;
  parentPath: string;
  name: string;
  type: "file" | "directory";
  depth: number;
  gitStatus?: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";
};

type FileLanguage = {
  label: string;
  icon: string;
  tone: string;
};

type OpenFilePreview =
  | { status: "loading" }
  | { status: "ready"; content: string; size: number }
  | { status: "error"; message: string };

type DirectoryEntry = {
  name: string;
  path: string;
};

const runtimeKey: Record<Runtime, "agent" | "opencode" | "pi"> = { Agent: "agent", OpenCode: "opencode", Pi: "pi" };
const runtimeName: Record<string, Runtime> = { agent: "Agent", opencode: "OpenCode", pi: "Pi" };

const workspaces: Workspace[] = [{ id: "default", name: "默认项目", group: "项目", icon: "⬡" }];

const runtimeMeta: Record<Runtime, { color: string; icon: string; subtitle: string }> = {
  Agent: { color: "#62558f", icon: "AI", subtitle: "AI SDK Harness" },
  OpenCode: { color: "#168777", icon: "OC", subtitle: "OpenCode Harness" },
  Pi: { color: "#bfce6e", icon: "π", subtitle: "Pi Harness" },
};

function getFileLanguage(filePath: string): FileLanguage {
  const fileName = filePath.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  const extension = fileName.includes(".") ? fileName.split(".").at(-1) : "";
  if (fileName === "dockerfile") return { label: "Dockerfile", icon: "DK", tone: "docker" };
  if (fileName === "makefile") return { label: "Makefile", icon: "MK", tone: "make" };
  const languages: Record<string, FileLanguage> = {
    ts: { label: "TypeScript", icon: "TS", tone: "typescript" }, tsx: { label: "TypeScript", icon: "TS", tone: "typescript" },
    js: { label: "JavaScript", icon: "JS", tone: "javascript" }, jsx: { label: "JavaScript", icon: "JS", tone: "javascript" },
    json: { label: "JSON", icon: "{}", tone: "json" }, css: { label: "CSS", icon: "#", tone: "css" }, scss: { label: "SCSS", icon: "#", tone: "css" },
    html: { label: "HTML", icon: "<>", tone: "html" }, htm: { label: "HTML", icon: "<>", tone: "html" }, svg: { label: "SVG", icon: "<>", tone: "html" },
    md: { label: "Markdown", icon: "M", tone: "markdown" }, mdx: { label: "MDX", icon: "M", tone: "markdown" },
    py: { label: "Python", icon: "PY", tone: "python" }, go: { label: "Go", icon: "GO", tone: "go" }, rs: { label: "Rust", icon: "RS", tone: "rust" },
    java: { label: "Java", icon: "J", tone: "java" }, kt: { label: "Kotlin", icon: "KT", tone: "kotlin" }, swift: { label: "Swift", icon: "SW", tone: "swift" },
    rb: { label: "Ruby", icon: "RB", tone: "ruby" }, php: { label: "PHP", icon: "PHP", tone: "php" },
    sh: { label: "Shell", icon: "$", tone: "shell" }, bash: { label: "Shell", icon: "$", tone: "shell" }, zsh: { label: "Shell", icon: "$", tone: "shell" },
    sql: { label: "SQL", icon: "SQL", tone: "sql" }, yml: { label: "YAML", icon: "Y", tone: "yaml" }, yaml: { label: "YAML", icon: "Y", tone: "yaml" }, toml: { label: "TOML", icon: "T", tone: "toml" },
    xml: { label: "XML", icon: "<>", tone: "html" }, txt: { label: "Text", icon: "·", tone: "text" },
  };
  return languages[extension ?? ""] ?? { label: "Text", icon: "·", tone: "text" };
}

const languageKeywords = new Set(["and", "as", "async", "await", "break", "case", "catch", "class", "const", "def", "default", "do", "else", "enum", "export", "extends", "false", "finally", "for", "from", "function", "if", "import", "in", "interface", "let", "match", "new", "None", "null", "package", "pass", "private", "protected", "public", "return", "self", "static", "struct", "switch", "this", "throw", "trait", "true", "try", "type", "undefined", "use", "var", "void", "while", "with", "yield", "SELECT", "FROM", "WHERE", "INSERT", "UPDATE", "DELETE", "CREATE", "TABLE", "VALUES"]);

function highlightCode(content: string, language: FileLanguage): ReactNode[] {
  const isMarkup = language.tone === "html";
  const commentPrefix = ["python", "shell", "yaml", "toml"].includes(language.tone) ? "#[^\\n]*" : language.tone === "sql" ? "--[^\\n]*" : "//[^\\n]*|/\\*[\\s\\S]*?\\*/";
  const pattern = isMarkup
    ? /(<!--[\s\S]*?-->|<\/?[\w:-]+(?:\s+[^<>]*?)?\/?\>|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b\d+(?:\.\d+)?\b)/g
    : new RegExp(`(${commentPrefix}|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`|\\b\\d+(?:\\.\\d+)?\\b|\\b[A-Za-z_][A-Za-z0-9_]*\\b)`, "g");
  const nodes: ReactNode[] = [];
  let cursor = 0;

  for (const match of content.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (cursor < index) nodes.push(content.slice(cursor, index));
    let tokenType = "plain";
    if (token.startsWith("//") || token.startsWith("/*") || token.startsWith("#") || token.startsWith("--") || token.startsWith("<!--")) tokenType = "comment";
    else if (token.startsWith("<")) tokenType = "tag";
    else if (token.startsWith("\"") || token.startsWith("'") || token.startsWith("`")) tokenType = "string";
    else if (/^\d/.test(token)) tokenType = "number";
    else if (languageKeywords.has(token)) tokenType = "keyword";
    nodes.push(tokenType === "plain" ? token : <span className={`token-${tokenType}`} key={`${index}-${token}`}>{token}</span>);
    cursor = index + token.length;
  }
  if (cursor < content.length) nodes.push(content.slice(cursor));
  return nodes;
}

function highlightCodeLines(content: string, language: FileLanguage): ReactNode[] {
  return content.split("\n").map((line, index) => (
    <span className="code-line" key={`${index}-${line.slice(0, 24)}`}>
      <span className="code-line-number" aria-hidden="true">{index + 1}</span>
      <span className="code-line-content">{line ? highlightCode(line, language) : "\u00a0"}</span>
    </span>
  ));
}

const initialSessions: Session[] = [
  { id: "agent-1", workspaceId: "test", runtime: "Agent", title: "架构分析", status: "Ready", ...runtimeMeta.Agent, messages: ["为了理解这个项目，我会先梳理当前 Workspace 的结构、运行时边界和需要保留的约束。"] },
  { id: "opencode-1", workspaceId: "test", runtime: "OpenCode", title: "代码实现", status: "Running", ...runtimeMeta.OpenCode, messages: ["我会在当前 Workspace 工作目录中检查代码结构，然后根据任务执行修改。"] },
  { id: "pi-1", workspaceId: "test", runtime: "Pi", title: "快速检查", status: "Idle", ...runtimeMeta.Pi, messages: ["我可以快速阅读项目文件、运行检查并反馈需要注意的地方。"] },
];

function Avatar({ color, label }: { color: string; label: string }) {
  return <span className="avatar" style={{ background: color }}>{label}</span>;
}

export default function Home() {
  const [workspaceItems, setWorkspaceItems] = useState(workspaces);
  const [workspaceId, setWorkspaceId] = useState("default");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [message, setMessage] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({ default: true });
  const [projectActionsFor, setProjectActionsFor] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState<"workspace" | "file" | "runtime" | "settings" | "account" | "deleteWorkspace" | "directoryPicker" | null>(null);
  const [runtimeWorkspaceId, setRuntimeWorkspaceId] = useState<string | null>(null);
  const [dialogValue, setDialogValue] = useState("");
  const [projectDirectory, setProjectDirectory] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [notice, setNotice] = useState("");
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isGitRepository, setIsGitRepository] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [fileRefresh, setFileRefresh] = useState(0);
  const [showHiddenFiles, setShowHiddenFiles] = useState(false);
  const [expandedFileDirectories, setExpandedFileDirectories] = useState<Set<string>>(new Set());
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [openFilePreviews, setOpenFilePreviews] = useState<Record<string, OpenFilePreview>>({});
  const [workspacePendingDeletion, setWorkspacePendingDeletion] = useState<Workspace | null>(null);
  const [directoryPickerPath, setDirectoryPickerPath] = useState("");
  const [directoryPickerName, setDirectoryPickerName] = useState("");
  const [directoryPickerParentPath, setDirectoryPickerParentPath] = useState<string | null>(null);
  const [directoryPickerEntries, setDirectoryPickerEntries] = useState<DirectoryEntry[]>([]);
  const [directoryPickerLoading, setDirectoryPickerLoading] = useState(false);
  const [directoryPickerError, setDirectoryPickerError] = useState("");
  const editorTabsRef = useRef<HTMLDivElement>(null);
  const [editorTabScroll, setEditorTabScroll] = useState({ left: 0, width: 100, visible: false });

  const workspaceSessions = sessions.filter((session) => session.workspaceId === workspaceId);
  const activeSession = workspaceSessions.find((session) => session.id === activeSessionId) ?? workspaceSessions[0];
  const activeRuntime = activeSession?.runtime ?? "Agent";
  const meta = runtimeMeta[activeRuntime];
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const activeFilePreview = selectedFilePath ? openFilePreviews[selectedFilePath] : undefined;

  useEffect(() => {
    async function loadProjectData() {
      const [workspaceResponse, sessionResponse] = await Promise.all([fetch("/api/workspaces"), fetch("/api/sessions")]);
      if (!workspaceResponse.ok || !sessionResponse.ok) return;
      const workspaceData = await workspaceResponse.json() as { workspaces: Omit<Workspace, "icon">[] };
      const sessionData = await sessionResponse.json() as { sessions: { id: string; workspaceId: string; runtime: string; title: string; status: string; messages: { role: string; content: string }[] }[] };
      const loadedWorkspaces = workspaceData.workspaces.map((workspace) => ({ ...workspace, icon: "⬡" }));
      const loadedSessions = sessionData.sessions.map((session) => {
        const runtime = runtimeName[session.runtime];
        return { id: session.id, workspaceId: session.workspaceId, runtime, title: session.title, status: (session.status === "running" ? "Running" : session.status === "idle" ? "Idle" : "Ready") as Session["status"], ...runtimeMeta[runtime], messages: session.messages.map((item) => item.role === "user" ? `你：${item.content}` : item.content) };
      });
      setWorkspaceItems(loadedWorkspaces);
      setSessions(loadedSessions);
      const preferredProject = loadedWorkspaces.find((workspace) => workspace.name === "langgraph-app")
        ?? loadedWorkspaces.find((workspace) => workspace.id === "default")
        ?? loadedWorkspaces[0];
      if (preferredProject) {
        setWorkspaceId(preferredProject.id);
        setActiveSessionId(loadedSessions.find((session) => session.workspaceId === preferredProject.id)?.id ?? "");
        setExpandedProjects((current) => ({ ...current, [preferredProject.id]: true }));
      }
    }
    void loadProjectData();
  }, []);

  useEffect(() => {
    async function loadFiles() {
      if (!workspaceId) return;
      setFilesLoading(true);
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/files?includeHidden=${showHiddenFiles}`);
        if (!response.ok) return;
        const data = await response.json() as { entries: FileEntry[]; isGitRepository: boolean };
        setFiles(data.entries);
        setIsGitRepository(data.isGitRepository);
      } finally {
        setFilesLoading(false);
      }
    }
    void loadFiles();
  }, [workspaceId, fileRefresh, showHiddenFiles]);

  useEffect(() => {
    setExpandedFileDirectories(new Set());
    setSelectedFilePath("");
    setOpenFilePreviews({});
  }, [workspaceId]);

  useEffect(() => {
    if (!selectedFilePath || !editorTabsRef.current) return;
    const activeTab = Array.from(editorTabsRef.current.querySelectorAll<HTMLElement>("[data-file-tab]")).find((tab) => tab.dataset.fileTab === selectedFilePath);
    activeTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [selectedFilePath, openFilePreviews]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateEditorTabScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [selectedFilePath, openFilePreviews]);

  function updateEditorTabScroll() {
    const container = editorTabsRef.current;
    if (!container) return;
    const visible = container.scrollWidth > container.clientWidth;
    const width = visible ? Math.max(12, (container.clientWidth / container.scrollWidth) * 100) : 100;
    const range = container.scrollWidth - container.clientWidth;
    const left = range > 0 ? (container.scrollLeft / range) * (100 - width) : 0;
    setEditorTabScroll({ left, width, visible });
  }

  function scrollEditorTabsToPointer(clientX: number, track: HTMLDivElement) {
    const container = editorTabsRef.current;
    if (!container || container.scrollWidth <= container.clientWidth) return;
    const bounds = track.getBoundingClientRect();
    const thumbWidth = Math.max(12, (container.clientWidth / container.scrollWidth) * bounds.width);
    const usableTrack = Math.max(1, bounds.width - thumbWidth);
    const thumbLeft = Math.min(usableTrack, Math.max(0, clientX - bounds.left - thumbWidth / 2));
    container.scrollLeft = (thumbLeft / usableTrack) * (container.scrollWidth - container.clientWidth);
  }

  function selectWorkspace(id: string) {
    setWorkspaceId(id);
    const first = sessions.find((session) => session.workspaceId === id);
    setActiveSessionId(first?.id ?? "");
    setExpandedProjects((current) => ({ ...current, [id]: !(current[id] ?? id === workspaceId) }));
    setProjectActionsFor(null);
  }

  function showNotice(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice(""), 2400);
  }

  async function submitDialog() {
    const value = dialogValue.trim();
    if (!value || !dialog) return;
    if (dialog === "workspace") {
      const directory = projectDirectory.trim();
      if (!directory) { setDialogError("请选择项目目录"); return; }
      const response = await fetch("/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: value, workingDirectory: directory }) });
      const data = await response.json() as { workspace?: Omit<Workspace, "icon">; error?: string };
      if (!response.ok || !data.workspace) { setDialogError(data.error ?? "项目创建失败"); return; }
      const workspace = { ...data.workspace, icon: "⬡" };
      setWorkspaceItems((current) => [...current, workspace]);
      setWorkspaceId(workspace.id);
      setActiveSessionId("");
      setExpandedProjects((current) => ({ ...current, [workspace.id]: true }));
      showNotice(`项目 “${value}” 已创建`);
    } else {
      showNotice(`文件 “${value}” 已打开`);
    }
    setDialog(null);
    setDialogValue("");
    setProjectDirectory("");
    setDialogError("");
  }

  async function createSession(runtime: Runtime, targetWorkspaceId = workspaceId): Promise<Session | undefined> {
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: targetWorkspaceId, runtime: runtimeKey[runtime] }),
      });
      if (response.ok) {
        const data = await response.json() as { session: { id: string; workspaceId: string; runtime: string; title: string; status: string; messages: { role: string; content: string }[] } };
        const created: Session = {
          id: data.session.id,
          workspaceId: data.session.workspaceId,
          runtime: runtimeName[data.session.runtime],
          title: data.session.title,
          status: data.session.status === "running" ? "Running" : data.session.status === "idle" ? "Idle" : "Ready",
          ...runtimeMeta[runtime],
          messages: data.session.messages.map((item) => item.role === "user" ? `你：${item.content}` : item.content),
        };
        setSessions((current) => [...current, created]);
        setWorkspaceId(targetWorkspaceId);
        setExpandedProjects((current) => ({ ...current, [targetWorkspaceId]: true }));
        setActiveSessionId(created.id);
        return created;
      }
    } catch {
      showNotice("无法创建真实会话，请检查服务连接");
    }
    return undefined;
  }

  function syncRuntimeSession(sessionId: string, data: { title?: string; status?: string; messages?: { role: string; content: string }[] }) {
    setSessions((current) => current.map((item) => item.id !== sessionId ? item : {
      ...item,
      title: data.title ?? item.title,
      status: data.status === "running" ? "Running" : data.status === "error" ? "Error" : "Ready",
      messages: data.messages ? data.messages.map((entry) => entry.role === "user" ? `你：${entry.content}` : entry.content) : item.messages,
    }));
  }

  async function sendRuntimeMessage(session: Session, value: string) {
    const pendingMessage = `${session.runtime}：正在启动…`;
    setMessage("");
    setSessions((current) => current.map((item) => item.id === session.id ? { ...item, status: "Running", messages: [...item.messages, `你：${value}`, pendingMessage] } : item));
    try {
      const response = await fetch(`/api/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: value }) });
      if (!response.ok || !response.body) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? "Agent 未能完成本次任务");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const event = JSON.parse(line) as { type: string; text?: string; message?: string; status?: string; session?: { title?: string; status?: string; messages?: { role: string; content: string }[] } };
          if (event.type === "progress") setSessions((current) => current.map((item) => item.id === session.id ? { ...item, messages: [...item.messages.slice(0, -1), `${session.runtime}：${event.text ?? "正在运行…"}`] } : item));
          if (event.type === "text") setSessions((current) => current.map((item) => item.id === session.id ? { ...item, messages: [...item.messages.slice(0, -1), event.text ?? pendingMessage] } : item));
          if (event.type === "complete" && event.session) syncRuntimeSession(session.id, event.session);
          if (event.type === "error") { if (event.session) syncRuntimeSession(session.id, event.session); showNotice(event.message ?? "Agent 未能完成本次任务"); }
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "无法连接到 Agent 运行时";
      setSessions((current) => current.map((item) => item.id === session.id ? { ...item, status: "Error", messages: [...item.messages.slice(0, -1), `${session.runtime}：${detail}`] } : item));
      showNotice(detail);
    }
  }

  async function sendMessage() {
    const value = message.trim();
    if (!value || !activeSession || activeSession.status === "Running") return;
    await sendRuntimeMessage(activeSession, value);
  }

  async function startConversation() {
    if (activeSession) return;
    const firstMessage = message.trim();
    const session = await createSession("Agent");
    if (!session) return;
    if (!firstMessage) return;
    await sendRuntimeMessage(session, firstMessage);
  }

  async function chooseRuntime(runtime: Runtime) {
    await createSession(runtime, runtimeWorkspaceId ?? workspaceId);
    setRuntimeWorkspaceId(null);
    setDialog(null);
  }

  async function loadDirectory(directoryPath?: string) {
    setDirectoryPickerLoading(true);
    setDirectoryPickerError("");
    try {
      const query = directoryPath ? `?path=${encodeURIComponent(directoryPath)}` : "";
      const response = await fetch(`/api/directories${query}`);
      const data = await response.json() as { currentPath?: string; currentDirectoryName?: string; parentPath?: string | null; entries?: DirectoryEntry[]; error?: string };
      if (!response.ok || !data.currentPath || !data.currentDirectoryName || !data.entries) {
        setDirectoryPickerError(data.error ?? "无法读取目录");
        return;
      }
      setDirectoryPickerPath(data.currentPath);
      setDirectoryPickerName(data.currentDirectoryName);
      setDirectoryPickerParentPath(data.parentPath ?? null);
      setDirectoryPickerEntries(data.entries);
    } catch {
      setDirectoryPickerError("无法连接到目录浏览服务");
    } finally {
      setDirectoryPickerLoading(false);
    }
  }

  function openDirectoryPicker() {
    setDialog("directoryPicker");
    void loadDirectory(projectDirectory || undefined);
  }

  function chooseCurrentDirectory() {
    if (!directoryPickerPath) return;
    setProjectDirectory(directoryPickerPath);
    setDialogValue(directoryPickerName);
    setDialogError("");
    setDialog("workspace");
  }

  function closeDialog() {
    setDialog(null);
    setWorkspacePendingDeletion(null);
    setDialogError("");
  }

  function requestWorkspaceDeletion(workspace: Workspace) {
    setWorkspacePendingDeletion(workspace);
    setProjectActionsFor(null);
    setDialog("deleteWorkspace");
  }

  async function deleteSelectedWorkspace() {
    if (!workspacePendingDeletion) return;
    const response = await fetch(`/api/workspaces/${workspacePendingDeletion.id}`, { method: "DELETE" });
    const data = await response.json() as { error?: string };
    if (!response.ok) {
      setDialogError(data.error ?? "项目删除失败");
      return;
    }
    const deletedId = workspacePendingDeletion.id;
    setWorkspaceItems((current) => current.filter((workspace) => workspace.id !== deletedId));
    setSessions((current) => current.filter((session) => session.workspaceId !== deletedId));
    setExpandedProjects((current) => {
      const { [deletedId]: _deleted, ...remaining } = current;
      return remaining;
    });
    if (workspaceId === deletedId) {
      setWorkspaceId("default");
      setActiveSessionId("");
      setExpandedProjects((current) => ({ ...current, default: true }));
    }
    showNotice(`项目 “${workspacePendingDeletion.name}” 已删除`);
    setWorkspacePendingDeletion(null);
    setDialogError("");
    setDialog(null);
  }

  async function openFile(path: string) {
    setSelectedFilePath(path);
    if (openFilePreviews[path]) return;
    setOpenFilePreviews((current) => ({ ...current, [path]: { status: "loading" } }));
    const response = await fetch(`/api/workspaces/${workspaceId}/files/content?path=${encodeURIComponent(path)}`);
    const data = await response.json() as { path?: string; content?: string; size?: number; error?: string };
    if (!response.ok || data.content === undefined || !data.path || data.size === undefined) {
      setOpenFilePreviews((current) => ({ ...current, [path]: { status: "error", message: data.error ?? "无法读取文件内容" } }));
      return;
    }
    setOpenFilePreviews((current) => ({ ...current, [path]: { status: "ready", content: data.content!, size: data.size! } }));
  }

  function closeFilePreview(path = selectedFilePath) {
    const remainingPaths = Object.keys(openFilePreviews).filter((item) => item !== path);
    setOpenFilePreviews((current) => {
      const { [path]: _closed, ...remaining } = current;
      return remaining;
    });
    setSelectedFilePath((current) => current === path ? (remainingPaths.at(-1) ?? "") : current);
  }

  function renderFileTreeItems(parentPath = ""): ReactNode[] {
    return files.filter((file) => file.parentPath === parentPath).sort((left, right) => Number(right.type === "directory") - Number(left.type === "directory") || left.name.localeCompare(right.name, "en", { numeric: true, sensitivity: "base" })).map((file) => {
      if (file.type === "directory") {
        return <FileTreeFolder key={file.path} path={file.path} name={file.name}>
          {renderFileTreeItems(file.path)}
        </FileTreeFolder>;
      }
      const language = getFileLanguage(file.path);
      const status = file.gitStatus === "modified" ? "M" : file.gitStatus === "added" ? "A" : file.gitStatus === "untracked" ? "U" : file.gitStatus === "deleted" ? "D" : file.gitStatus === "renamed" ? "R" : file.gitStatus === "conflicted" ? "!" : "";
      return <FileTreeFile className={`git-${file.gitStatus ?? "clean"}`} key={file.path} path={file.path} name={file.name}>
        <span className="size-4 shrink-0"/>
        <FileTreeIcon><span className={`language-icon language-${language.tone}`}>{language.icon}</span></FileTreeIcon>
        <FileTreeName>{file.name}</FileTreeName>
        {status && <FileTreeActions><span className="git-status">{status}</span></FileTreeActions>}
      </FileTreeFile>;
    });
  }

  function renderConversationPane() {
    return activeSession ? <div className="conversation"><div className="messages">{activeSession.messages.map((text, index) => <div className={`message ${index % 2 ? "user" : "assistant"}`} key={`${activeSession.id}-${index}`}><span className="message-label">{index % 2 ? "YOU" : activeSession.runtime.toUpperCase()}</span><p>{text}</p></div>)}<div className="event-row"><span className="check">✓</span><span>workingDirectory connected</span><span className="tree-spacer"/><span className="event-muted">read / write</span></div></div><div className="message-composer"><textarea aria-label="输入消息" placeholder={`Message ${activeSession.runtime}...`} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }}/><button className="send" onClick={() => void sendMessage()}>SEND</button></div></div> : <div className="empty-conversation"><div><span className="empty-conversation-mark">◈</span><h1>开始一个新对话</h1><p>当前项目还没有会话。发送第一条消息后，将创建 Agent 会话。</p></div><div className="message-composer empty-composer"><textarea aria-label="输入第一条消息" placeholder="输入消息，开始新对话..." value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void startConversation(); } }}/><button className="send" onClick={() => void startConversation()}>SEND</button></div></div>;
  }

  return (
    <main className="workspace-app">
      <aside className="sidebar left-sidebar">
        <div className="brand"><span className="brand-mark">◈</span> AI as Workspace</div>
        <div className="new-chat-wrap"><button className="new-chat-button" onClick={() => { setRuntimeWorkspaceId(workspaceId); setDialog("runtime"); }}><span>＋</span> 新对话</button></div>
        <div className="section-label project-label"><span>项目</span><span className="tree-spacer"/><button className="icon-button" aria-label="新建项目" onClick={() => { setDialog("workspace"); setDialogError(""); }}>＋</button></div>
        <div className="tree">
          {workspaceItems.map((workspace) => {
            const projectSessions = sessions.filter((session) => session.workspaceId === workspace.id);
            const expanded = expandedProjects[workspace.id] ?? workspace.id === workspaceId;
            const actionsOpen = projectActionsFor === workspace.id;
            return <div className="project-tree" key={workspace.id}><div className={`tree-row project-row ${workspace.id === workspaceId ? "selected" : ""}`}><button className="project-select" aria-expanded={expanded} onClick={() => selectWorkspace(workspace.id)}><span className="folder">{workspace.icon}</span><span>{workspace.name}</span></button>{workspace.id !== "default" && <div className="project-actions"><button className="icon-button project-actions-button" aria-label={`${workspace.name} 操作`} aria-expanded={actionsOpen} onClick={() => setProjectActionsFor((current) => current === workspace.id ? null : workspace.id)}>⋯</button>{actionsOpen && <div className="project-actions-menu"><button className="delete-project-action" onClick={() => requestWorkspaceDeletion(workspace)}>删除项目</button></div>}</div>}</div>{expanded && <div className="project-sessions">{projectSessions.map((session) => <button className={`project-session ${session.id === activeSessionId ? "active" : ""}`} key={session.id} onClick={() => { setWorkspaceId(workspace.id); setActiveSessionId(session.id); }}><Avatar color={session.color} label={session.icon}/><span>{session.title}</span></button>)}{projectSessions.length === 0 && <button className="empty-project-session" onClick={() => { setWorkspaceId(workspace.id); setRuntimeWorkspaceId(workspace.id); setDialog("runtime"); }}>＋ 在此项目新建对话</button>}</div>}</div>;
          })}
        </div>
        <div className="bottom-actions"><button className="bottom-row bottom-button" onClick={() => setDialog("settings")}><span>⚙</span><span>Settings</span></button><button className="bottom-row bottom-button" onClick={() => setDialog("account")}><span>◉</span><span>Account</span></button></div>
      </aside>

      <section className="main">
        <header className="topbar"><button className="icon-button" aria-label="打开主菜单" onClick={() => setMenuOpen((open) => !open)}>☰</button><div className="top-assistant"><Avatar color={meta.color} label={meta.icon}/><span>{activeSession?.title ?? "新对话"}</span><span className="model-chip">{activeRuntime}</span></div><div className="top-workspace">项目 / {workspaceItems.find((item) => item.id === workspaceId)?.name}</div>{menuOpen && <div className="top-menu"><button onClick={() => { setFileRefresh((current) => current + 1); setMenuOpen(false); }}>刷新文件树</button><button onClick={() => { setDialog("workspace"); setDialogError(""); setMenuOpen(false); }}>新建项目</button><button onClick={() => { showNotice("Enter 发送，Shift + Enter 换行"); setMenuOpen(false); }}>快捷键</button></div>}</header>
        <div className="conversation-content">
          {selectedFilePath ? <div className="split-workspace"><div className="conversation-pane">{renderConversationPane()}</div><section className="editor-pane" aria-label="文件编辑器"><div className="editor-tabs-shell"><div className="editor-tabs" ref={editorTabsRef} onScroll={updateEditorTabScroll}>{Object.keys(openFilePreviews).map((path) => <div className={`editor-tab ${path === selectedFilePath ? "active" : ""}`} data-file-tab={path} key={path} onClick={() => setSelectedFilePath(path)}><span className={`language-icon language-${getFileLanguage(path).tone}`}>{getFileLanguage(path).icon}</span><span>{path.split("/").at(-1)}</span><button className="editor-tab-close" aria-label={`关闭 ${path}`} onClick={(event) => { event.stopPropagation(); closeFilePreview(path); }}>×</button></div>)}</div>{editorTabScroll.visible && <div className="editor-tab-scroll-overlay" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); scrollEditorTabsToPointer(event.clientX, event.currentTarget); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) scrollEditorTabsToPointer(event.clientX, event.currentTarget); }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}><span style={{ left: `${editorTabScroll.left}%`, width: `${editorTabScroll.width}%` }}/></div>}</div><div className="editor-path"><span>{workspaceItems.find((item) => item.id === workspaceId)?.name}</span><span>›</span><span>{selectedFilePath}</span>{activeFilePreview?.status === "ready" && <><span className="tree-spacer"/><span className={`preview-language language-${getFileLanguage(selectedFilePath).tone}`}>{getFileLanguage(selectedFilePath).label}</span><span className="preview-meta">{activeFilePreview.size} bytes</span></>}</div>{activeFilePreview?.status === "ready" ? <pre className="file-preview-content editor-code"><code className={`code-language-${getFileLanguage(selectedFilePath).tone}`}>{highlightCodeLines(activeFilePreview.content, getFileLanguage(selectedFilePath))}</code></pre> : activeFilePreview?.status === "error" ? <div className="editor-message"><strong>文件无法打开</strong><p>{activeFilePreview.message}</p><button className="outline-button" onClick={() => closeFilePreview()}>关闭文件</button></div> : <div className="editor-message"><span className="editor-loading" aria-hidden="true"/><p>正在读取 {selectedFilePath}…</p></div>}</section></div> : renderConversationPane()}
        </div>
      </section>

      <aside className="sidebar right-sidebar file-tree-sidebar">
        <div className="panel-header"><h2>Files</h2><span className="git-badge">{isGitRepository ? "Git" : "Local"}</span><span className="spacer"/><button className={`hidden-files-button ${showHiddenFiles ? "active" : ""}`} aria-label={showHiddenFiles ? "隐藏隐藏文件和目录" : "显示隐藏文件和目录"} aria-pressed={showHiddenFiles} title={showHiddenFiles ? "隐藏隐藏文件和目录" : "显示隐藏文件和目录"} onClick={() => setShowHiddenFiles((current) => !current)}><span className="hidden-files-dot" aria-hidden="true"/></button><button className="icon-button" aria-label="刷新文件树" onClick={() => setFileRefresh((current) => current + 1)}>↻</button></div>
        <div className="file-tree">
          {filesLoading ? <p className="file-tree-message">正在读取文件…</p> : files.length === 0 ? <p className="file-tree-message">当前目录为空</p> : <FileTree expanded={expandedFileDirectories} selectedPath={selectedFilePath} onExpandedChange={setExpandedFileDirectories} onSelect={(path) => { const entry = filesByPath.get(path); if (entry?.type === "file") void openFile(path); }}>
            {renderFileTreeItems()}
          </FileTree>}
        </div>
      </aside>
      {dialog && <div className="modal-backdrop" onClick={closeDialog}>
        <div className={dialog === "directoryPicker" ? "modal directory-picker-modal" : "modal"} onClick={(event) => event.stopPropagation()}>
          {dialog === "runtime" ? <>
            <div className="modal-header"><h2>新对话</h2><button className="icon-button" onClick={closeDialog}>×</button></div>
            <p>选择一个 Agent 创建独立会话。选择后会固定绑定该 Agent，不能在会话内更改；发送首条消息后将自动生成会话标题。</p>
            <div className="runtime-picker">{(["Agent", "OpenCode", "Pi"] as Runtime[]).map((runtime) => <button key={runtime} className="runtime-choice" onClick={() => void chooseRuntime(runtime)}><Avatar color={runtimeMeta[runtime].color} label={runtimeMeta[runtime].icon}/><span><strong>{runtime}</strong><small>{runtimeMeta[runtime].subtitle}</small></span><span className="choice-arrow">›</span></button>)}</div>
          </> : dialog === "workspace" ? <>
            <div className="modal-header"><h2>新建项目</h2><button className="icon-button" onClick={closeDialog}>×</button></div>
            <p>默认项目使用服务端的 <code>data/</code>。为新项目选择服务端宿主机上的目录；同一目录只能绑定一个项目。</p>
            <label className="field-label">项目名称</label>
            <input autoFocus value={dialogValue} placeholder="例如 my-vercel-app" onChange={(event) => setDialogValue(event.target.value)} />
            <label className="field-label">项目目录</label>
            <div className="directory-selection"><span className={projectDirectory ? "selected-directory" : "directory-placeholder"}>{projectDirectory || "尚未选择目录"}</span><button className="outline-button" onClick={openDirectoryPicker}>选择目录</button></div>
            {dialogError && <p className="dialog-error">{dialogError}</p>}
            <div className="modal-actions"><button className="outline-button" onClick={closeDialog}>取消</button><button className="new-session" onClick={() => void submitDialog()}>确认</button></div>
          </> : dialog === "directoryPicker" ? <>
            <div className="modal-header"><h2>选择项目目录</h2><button className="icon-button" aria-label="返回新建项目" onClick={() => setDialog("workspace")}>×</button></div>
            <p>浏览服务端宿主机上的目录，并选择当前目录作为项目目录。</p>
            <div className="directory-path"><span>{directoryPickerPath || "正在读取目录…"}</span><button className="outline-button" disabled={!directoryPickerParentPath || directoryPickerLoading} onClick={() => void loadDirectory(directoryPickerParentPath ?? undefined)}>上一级</button></div>
            <div className="directory-list">
              {directoryPickerLoading ? <p className="directory-list-message">正在读取目录…</p> : directoryPickerError ? <p className="dialog-error">{directoryPickerError}</p> : directoryPickerEntries.length === 0 ? <p className="directory-list-message">当前目录没有可进入的子目录</p> : directoryPickerEntries.map((entry) => <button className="directory-entry" key={entry.path} onClick={() => void loadDirectory(entry.path)}><span>□</span><span>{entry.name}</span><span className="tree-spacer"/><span>›</span></button>)}
            </div>
            <div className="modal-actions"><button className="outline-button" onClick={() => setDialog("workspace")}>取消</button><button className="new-session" disabled={!directoryPickerPath || directoryPickerLoading} onClick={chooseCurrentDirectory}>选择当前目录</button></div>
          </> : dialog === "deleteWorkspace" ? <>
            <div className="modal-header"><h2>删除项目</h2><button className="icon-button" onClick={closeDialog}>×</button></div>
            <p>确定删除项目 “{workspacePendingDeletion?.name}” 吗？该项目下的会话与消息记录也会被删除，但其工作目录和文件不会受到影响。</p>
            {dialogError && <p className="dialog-error">{dialogError}</p>}
            <div className="modal-actions"><button className="outline-button" onClick={closeDialog}>取消</button><button className="danger-button" onClick={() => void deleteSelectedWorkspace()}>删除项目</button></div>
          </> : dialog === "settings" ? <>
            <div className="modal-header"><h2>Settings</h2><button className="icon-button" onClick={closeDialog}>×</button></div>
            <div className="setting-list"><div><span>当前项目</span><strong>{workspaceItems.find((item) => item.id === workspaceId)?.name ?? "—"}</strong></div><div><span>工作目录</span><strong className="setting-path">{workspaceItems.find((item) => item.id === workspaceId)?.workingDirectory ?? "加载中…"}</strong></div><div><span>文件树</span><button className="outline-button" onClick={() => { setFileRefresh((current) => current + 1); showNotice("文件树已刷新"); }}>刷新</button></div></div>
          </> : dialog === "account" ? <>
            <div className="modal-header"><h2>Account</h2><button className="icon-button" onClick={closeDialog}>×</button></div>
            <div className="account-card"><Avatar color="#62558f" label="AI"/><div><strong>Local User</strong><span>本地工作区模式</span></div></div>
            <p>当前版本没有云端账户、同步或团队成员管理。Workspace、Session 与文件信息均保存在当前服务宿主机。</p>
          </> : <>
            <div className="modal-header"><h2>打开文件</h2><button className="icon-button" onClick={closeDialog}>×</button></div>
            <p>输入文件名查看项目文件。</p>
            <input autoFocus value={dialogValue} placeholder="例如 README.md" onChange={(event) => setDialogValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitDialog(); }} />
            <div className="modal-actions"><button className="outline-button" onClick={closeDialog}>取消</button><button className="new-session" onClick={() => void submitDialog()}>确认</button></div>
          </>}
        </div>
      </div>}
      {notice && <div className="toast">✓ {notice}</div>}
    </main>
  );
}
