"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type ReactNode } from "react";
import { ChevronDown, Download, Minus, Plus, X } from "lucide-react";
import { Button, buttonStyles } from "../../components/button";
import { settingsSelect, settingsSelectIcon, settingsTextarea } from "../settings-page";
import { Conversation } from "../conversation/project-session/conversation";
import { imageRequest, type ImageRecord as R } from "../../api/image-client";
import { randomUUID } from "../../api/random-uuid";
import type { SessionTree } from "../../domain/models";
import { ImageParameters, emptyParameters } from "./image-parameters";
import type { PreviewImage } from "./image-canvas";

const ImageCanvas = dynamic(() => import("./image-canvas"), { ssr: false });
const emptyTree: SessionTree = { entries: [], activeLeafId: null };
const stages: Record<string, string> = {
  planning: "思考中", queued: "排队中", running: "生成中", processing: "处理中",
  completed: "已完成", failed: "失败", awaiting_input: "待输入", awaiting_confirmation: "待确认",
};
type Input = { text: string; profileId: string | null; parameters: R; referenceIds: string[] };
type LocalFile = { file: File; preview: PreviewImage };
const emptyInput: Input = { text: "", profileId: null, parameters: emptyParameters, referenceIds: [] };
const resultActionWidth = "w-13! shrink-0";
const referenceImageTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

function imageKey(image: PreviewImage) { return `${image.source}:${image.id}`; }

function assetPreview(asset: R, source: string): PreviewImage {
  return { id: asset.id, name: asset.name, url: asset.previewUrl, downloadUrl: asset.downloadUrl, source, width: asset.width, height: asset.height };
}

function Thumbnail({ image, active, downloadSelected, onToggleDownload, onOpen, showActions = true, captionAction, cornerAction }: {
  image: PreviewImage; active?: boolean; downloadSelected?: boolean; onToggleDownload?: () => void;
  onOpen?: () => void; showActions?: boolean; captionAction?: ReactNode; cornerAction?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pixels, setPixels] = useState(image.width && image.height ? `${image.width}×${image.height}` : "");
  const frame = "relative h-16! w-full! overflow-hidden rounded border";
  const content = failed ? <span className="absolute inset-0 grid place-items-center text-xs">预览加载失败</span> : <img key={attempt} src={image.url} alt={image.name} draggable={false}
    onLoad={event => setPixels(`${event.currentTarget.naturalWidth}×${event.currentTarget.naturalHeight}`)}
    onError={() => setFailed(true)} className="absolute inset-0 block h-full w-full object-scale-down"
    style={{ background: "repeating-conic-gradient(#e2e8f0 0% 25%, white 0% 50%) 0 0 / 16px 16px" }} />;
  return <figure className="m-0 flex w-32 shrink-0 flex-col gap-1">
    <div className={`relative flex ${onToggleDownload ? "cursor-pointer p-1" : ""}`} onClick={onToggleDownload ? event => {
      if (event.target === event.currentTarget) onToggleDownload();
    } : undefined}>
      {downloadSelected && <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-xl border-2 border-sky-500" />}
      {active && downloadSelected !== undefined && <span aria-hidden="true" className="pointer-events-none absolute inset-[3px] rounded-[9px] border border-emerald-600" />}
      {onOpen ? <Button type="button" variant="ghost" aria-pressed={downloadSelected === undefined ? active : undefined}
        aria-current={downloadSelected !== undefined && active ? true : undefined} title={image.name} onClick={onOpen}
        className={`${frame} p-0! border-slate-200`}>
        {content}
        {active && downloadSelected === undefined && <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[inherit] ring-2 ring-sky-500 ring-inset" />}
      </Button>
        : <div className={`${frame} border-slate-200`}>{content}</div>}
      {cornerAction && <div className={`absolute z-10 ${downloadSelected === undefined ? "top-1 right-1" : "top-2 right-2"}`}>{cornerAction}</div>}
    </div>
    <figcaption className="flex min-w-0 items-center gap-1 text-xs">
      <span className="min-w-0 flex-1 truncate" title={image.name}>{image.name}{pixels && ` · ${pixels}`}</span>
      {captionAction}
    </figcaption>
    {showActions && onOpen && (failed || image.downloadUrl) && <div className="flex flex-wrap items-center gap-1">
      {failed && <Button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>重试</Button>}
      {image.downloadUrl && <a className={buttonStyles()} href={image.downloadUrl}>下载</a>}
    </div>}
  </figure>;
}

function taskStage(task: R, command?: R | null, execution?: R | null) {
  if (task.interruptPending) return "正在终止…";
  if (task.derivedStage === "failed" && (task.errorCode ?? execution?.error?.code ?? command?.error?.code) === "IMAGE_TASK_INTERRUPTED") return "已终止";
  return stages[task.derivedStage];
}

export function ImageWorkbench() {
  const [selection, setSelection] = useState<{ conversationId: string; taskId: string } | null>(null);
  const { conversationId, taskId } = selection ?? { conversationId: null, taskId: null };
  const [input, setInput] = useState<Input>(emptyInput);
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [versionChoice, setVersionChoice] = useState("latest");
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<string[]>([]);
  const [draft, setDraft] = useState<R | null>(null);
  const [detail, setDetail] = useState<R | null>(null);
  const [conversation, setConversation] = useState<R | null>(null);
  const [tree, setTree] = useState<SessionTree>(emptyTree);
  const [draftAssets, setDraftAssets] = useState<R[]>([]);
  const [tasks, setTasks] = useState<R[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previousPages, setPreviousPages] = useState<(string | null)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<R | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [resourceErrors, setResourceErrors] = useState<Record<string, string>>({});
  const [showTasks, setShowTasks] = useState(true);
  const [showParameters, setShowParameters] = useState(false);
  const [showViewer, setShowViewer] = useState(true);
  const [viewedId, setViewedId] = useState<string | null>(null);
  const [viewedRoot, setViewedRoot] = useState<string | null>(null);
  const [cleanupRetry, setCleanupRetry] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const conversationScroll = useRef<HTMLDivElement>(null);
  const conversationContent = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const requestBusy = useRef(false);
  const dirty = useRef(false);
  const buffers = useRef(new Map<string, Input>());
  const currentDraft = useRef<R | null>(null);
  const firstKey = useRef<string | null>(null);
  const firstMode = useRef<"discuss" | "generate">("discuss");
  const messageAttempt = useRef<{ draftId: string; revision: number; key: string; mode: "discuss" | "generate" } | null>(null);
  const interruptAttempt = useRef<{ signature: string; key: string } | null>(null);
  const objectUrls = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    const urls = objectUrls.current;
    void imageRequest("/capabilities", { signal: controller.signal }).then(setCapabilities).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => {
      controller.abort();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ conversations: JSON.stringify(conversationId ? [conversationId] : []), filter: "all" });
    if (taskId) params.set("taskId", taskId);
    if (cursor) params.set("cursor", cursor);
    const source = new EventSource(`/api/images/events?${params}`);
    setConnected(false);
    setResourceErrors({});
    source.addEventListener("snapshot", event => {
      const { resource, data } = JSON.parse((event as MessageEvent).data);
      setConnected(true);
      setResourceErrors(previous => {
        if (!(resource in previous)) return previous;
        const next = { ...previous };
        delete next[resource];
        return next;
      });
      if (resource === "tasks") {
        setTasks(data.items);
        setNextCursor(data.nextCursor);
      }
      if (resource === `conversation:${conversationId}`) setConversation(data);
      if (resource === `task:${taskId}`) setDetail(data);
      if (resource === `tree:${conversationId}`) setTree(data);
      if (resource.startsWith("draft:")) {
        setResourceErrors(previous => { const next = { ...previous }; delete next[`draft:${taskId ?? conversationId}`]; return next; });
        const next = data.draft;
        const previousDraft = currentDraft.current;
        if (previousDraft && previousDraft.id === next.id && previousDraft.revision > next.revision) return;
        setDraftAssets(previous => [...new Map<string, R>([...previous, ...data.assets].map((asset: R) => [asset.id, asset])).values()]);
        if (dirty.current && previousDraft?.id === next.id) return;
        currentDraft.current = next;
        setDraft(next);
        const buffered = buffers.current.get(next.id);
        dirty.current = !!buffered;
        setInput(buffered ?? { text: next.text, profileId: next.profileId, parameters: next.parameters, referenceIds: next.referenceIds });
      }
    });
    source.addEventListener("resource_error", event => {
      const { resource, error } = JSON.parse((event as MessageEvent).data);
      setResourceErrors(previous => ({ ...previous, [resource]: error.message ?? error.code }));
    });
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [conversationId, taskId, cursor]);

  useEffect(() => {
    const scroll = conversationScroll.current;
    const content = conversationContent.current;
    if (!scroll || !content) return;

    const scrollToLatest = () => {
      if (followLatest.current) scroll.scrollTop = scroll.scrollHeight;
    };
    scrollToLatest();
    const observer = new ResizeObserver(scrollToLatest);
    observer.observe(scroll);
    observer.observe(content);
    return () => observer.disconnect();
  }, [taskId]);

  function edit(patch: Partial<Input>) {
    firstKey.current = null;
    messageAttempt.current = null;
    dirty.current = true;
    setInput(previous => ({ ...previous, ...patch }));
  }
  function clearFiles() {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current.clear();
    setFiles([]);
    firstKey.current = null;
  }
  function reset(next: typeof selection) {
    followLatest.current = true;
    currentDraft.current = null;
    dirty.current = false;
    clearFiles();
    setSelection(next);
    setInput(emptyInput);
    setDraft(null);
    setDraftAssets([]);
    setConversation(null);
    setDetail(null);
    setTree(emptyTree);
    setViewedId(null);
    setViewedRoot(null);
    setCleanupRetry(null);
    setVersionChoice("latest");
    setVersions({});
    setChecked([]);
    setShowViewer(true);
  }
  async function run(operation: () => Promise<unknown> | unknown) {
    if (requestBusy.current || stopping) return;
    requestBusy.current = true;
    setBusy(true);
    setError("");
    try { await operation(); }
    catch (error) { setError(error instanceof Error ? error.message : "操作失败"); }
    finally { requestBusy.current = false; setBusy(false); }
  }
  async function changeReferences(ids: string[]) {
    if (!conversationId || !currentDraft.current) { edit({referenceIds: ids}); return; }
    const current = currentDraft.current;
    const saved = await imageRequest(`/conversations/${conversationId}/draft`, {method: "PATCH", revision: current.revision, body: {draftId: current.id, ...input, referenceIds: ids}});
    currentDraft.current = saved;
    dirty.current = false;
    buffers.current.delete(saved.id);
    setDraft(saved);
    setInput({text: saved.text, profileId: saved.profileId, parameters: saved.parameters, referenceIds: saved.referenceIds});
  }
  async function downloadSelected() {
    const assetIds = displayed.filter(item => checked.includes(item.rootAssetId)).map(item => item.asset.id);
    const response = await fetch(`/api/images/tasks/${taskId}/download`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({assetIds})});
    if (!response.ok) { const value = await response.json(); throw Error(value.error?.message ?? "下载失败"); }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a"); link.href = url; link.download = `images-${taskId}.zip`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function removeImage(asset: R) {
    const label = asset.role === "reference" ? asset.name : `${asset.name} 的 v${asset.versionNumber}`;
    if (!window.confirm(`删除 ${label}？其他版本会保留。`)) return;
    const result = await imageRequest(`/tasks/${taskId}/versions/${asset.id}`, {method: "DELETE", revision: task.revision, body: {}});
    const deletedIds = new Set<string>(result.deletedAssetIds);
    setCleanupRetry(result.cleanup.state === "failed" ? asset.id : null);
    setDraftAssets(previous => previous.filter(item => !deletedIds.has(item.id)));
    setInput(previous => ({ ...previous, referenceIds: previous.referenceIds.filter(id => !deletedIds.has(id)) }));
    const [nextDetail, nextDraft] = await Promise.all([
      imageRequest(`/tasks/${taskId}`),
      imageRequest(`/conversations/${conversationId}/draft?taskId=${taskId}`),
    ]);
    setDetail(nextDetail);
    if (!currentDraft.current || currentDraft.current.revision <= nextDraft.revision) {
      currentDraft.current = nextDraft;
      setDraft(nextDraft);
    }
    if (result.cleanup.state === "failed") throw Error("图片已删除，文件清理失败，请点击重试清理");
  }
  function removeLocalImage(image: PreviewImage) {
    const removed = files.find(file => file.preview.id === image.id);
    if (!removed) return;
    URL.revokeObjectURL(removed.preview.url);
    objectUrls.current.delete(removed.preview.url);
    setFiles(previous => previous.filter(file => file.preview.id !== image.id));
    firstKey.current = null;
  }
  async function save(profileId = input.profileId) {
    const current = currentDraft.current;
    if (!current || !dirty.current && current.profileId === profileId) return current;
    const saved = await imageRequest(`/conversations/${current.conversationId}/draft`, {
      method: "PATCH", revision: current.revision, body: { draftId: current.id, ...input, profileId },
    });
    currentDraft.current = saved;
    setDraft(saved);
    setInput(previous => ({ ...previous, profileId }));
    buffers.current.delete(current.id);
    dirty.current = false;
    return saved;
  }
  function choose(next: typeof selection) {
    if (next && next.conversationId === conversationId && next.taskId === taskId) return;
    const current = currentDraft.current;
    if (current && dirty.current) buffers.current.set(current.id, input);
    reset(next);
  }
  async function addFiles(selected: File[]) {
    if (!selected.length) return;
    if (selected.some(file => !referenceImageTypes.includes(file.type)
      && !((!file.type || file.type === "application/octet-stream") && /\.(png|jpe?g|webp|svg)$/i.test(file.name)))) {
      throw Error("参考图支持 PNG、JPEG、WebP 和 SVG");
    }
    if (files.length + input.referenceIds.length + selected.length > 4) throw Error("最多选择四张参考图");
    if (selected.some(file => file.size > 20 * 1024 * 1024)) throw Error("单张参考图不能超过 20 MiB");
    if (!conversationId) {
      const added = selected.map(file => {
        const url = URL.createObjectURL(file);
        objectUrls.current.add(url);
        return { file, preview: { id: randomUUID(), name: file.name, url, source: "本地参考图" } };
      });
      firstKey.current = null;
      setFiles(previous => [...previous, ...added]);
      return;
    }
    const refs = [...input.referenceIds];
    for (const file of selected) {
      const form = new FormData();
      form.append("file", file);
      const result = await imageRequest(`/tasks/${taskId}/references`, { method: "POST", body: form });
      setDraftAssets(previous => [...previous, result.asset]);
      const updated = await imageRequest(`/conversations/${conversationId}/draft?taskId=${taskId}`);
      currentDraft.current = updated;
      setDraft(updated);
      refs.push(result.asset.id);
      edit({ referenceIds: [...refs] });
    }
  }
  async function send(mode: "discuss" | "generate" = "discuss") {
    if (!conversationId) {
      const form = new FormData();
      form.append("payload", JSON.stringify({ text: input.text, mode, ...(profile ? { profileId: profile.id } : {}), parameters: input.parameters }));
      for (const { file } of files) form.append("files", file);
      if (firstMode.current !== mode) firstKey.current = null;
      firstMode.current = mode;
      firstKey.current ??= randomUUID();
      const result = await imageRequest("/conversations/submit", { method: "POST", body: form, key: firstKey.current });
      reset({ conversationId: result.conversationId, taskId: result.taskId });
      return;
    }
    const saved = await save(profile?.id ?? null);
    if (!saved) return;
    const previous = messageAttempt.current;
    const attempt = previous && previous.draftId === saved.id && previous.mode === mode ? previous : { draftId: saved.id, revision: saved.revision, key: randomUUID(), mode };
    messageAttempt.current = attempt;
    const result = await imageRequest(`/conversations/${conversationId}/messages`, {
      method: "POST", revision: attempt.revision, body: { draftId: saved.id, mode }, key: attempt.key,
    });
    messageAttempt.current = null;
    setInput({ ...emptyInput, profileId: saved.profileId, referenceIds: saved.referenceIds });
    if (result.error) setError(result.error.message);
  }
  async function stop() {
    const target = detail?.task.interruptTarget;
    if (!taskId || !target || requestBusy.current || stopping) return;
    requestBusy.current = true;
    const signature = JSON.stringify(target);
    if (interruptAttempt.current?.signature !== signature) interruptAttempt.current = { signature, key: randomUUID() };
    setStopping(true);
    setError("");
    try {
      const result = await imageRequest(`/tasks/${taskId}/interrupt`, { method: "POST", body: target, key: interruptAttempt.current.key });
      setDetail(previous => previous?.task.id === taskId ? { ...previous, ...result } : previous);
    } catch (error) { setError(error instanceof Error ? error.message : "终止失败"); }
    finally { requestBusy.current = false; setStopping(false); }
  }
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const { files, items } = event.clipboardData;
    const pasted = Array.from(files);
    if (!pasted.length) {
      for (const item of Array.from(items)) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file) pasted.push(file);
      }
    }
    if (!pasted.length) return;
    event.preventDefault();
    if (!locked) void run(() => addFiles(pasted));
  }
  function onDragOver(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = locked ? "none" : "copy";
  }
  function onDrop(event: DragEvent<HTMLElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    const dropped = Array.from(event.dataTransfer.files);
    if (!locked && dropped.length) void run(() => addFiles(dropped));
  }

  const task = detail?.task;
  const execution = detail?.latestExecution;
  const latestCommand = conversation?.conversation.latestCommand;
  const command = latestCommand?.inputSnapshot?.taskId === taskId ? latestCommand : null;
  const profile = capabilities?.profiles.find((candidate: R) => candidate.available && candidate.id === input.profileId)
    ?? capabilities?.profiles.find((candidate: R) => candidate.id === capabilities.defaultProfileId);
  const submittedReferences: R[] = detail?.referenceAssets
    ?? (detail?.assets ?? []).filter((asset: R) => asset.role === "reference" && !asset.sourceAssetId);
  const assetsById = new Map<string, R>([...draftAssets, ...(detail?.assets ?? []), ...submittedReferences].map((asset: R) => [asset.id, asset]));
  const referenceCards = new Map<string, {image: PreviewImage; referenceId: string; selected: boolean}>();
  const originals = (detail?.assets ?? []).filter((asset: R) => asset.role === "reference" && !asset.sourceAssetId && asset.availability === "ready");
  const rasterByOriginal = new Map([...assetsById.values()]
    .filter(asset => asset.role === "reference" && asset.sourceAssetId && asset.availability === "ready")
    .map(asset => [asset.sourceAssetId, asset.id]));
  for (const referenceId of input.referenceIds) {
    const asset = assetsById.get(referenceId);
    if (asset?.availability !== "ready") continue;
    const original = assetsById.get(asset.sourceAssetId) ?? asset;
    const image = assetPreview(original.previewUrl ? original : asset, "参考图");
    referenceCards.set(original.id, {image, referenceId, selected: true});
  }
  for (const original of originals) {
    if (referenceCards.has(original.id)) continue;
    const referenceId = original.mimeType === "image/svg+xml" ? rasterByOriginal.get(original.id) : original.id;
    if (referenceId) referenceCards.set(original.id, {image: assetPreview(original, "参考图"), referenceId, selected: false});
  }
  const references = conversationId ? [...referenceCards.values()] : files.map(({preview: image}) => ({image, referenceId: image.id, selected: true}));
  const displayed: Array<{rootAssetId: string; asset: R; versions: R[]}> = [];
  for (const item of detail?.images ?? []) {
    const outputs = (item.versions as R[]).filter(asset => asset.role === "output");
    const latest = outputs.at(-1);
    if (!latest) continue;
    const desired = versions[item.rootAssetId] ?? versionChoice;
    const asset = outputs.find(asset => String(asset.versionNumber) === desired) ?? latest;
    displayed.push({rootAssetId: item.rootAssetId, asset, versions: outputs});
  }
  const viewedVersion = viewedRoot ? displayed.find(item => item.rootAssetId === viewedRoot) : null;
  const preview = (viewedVersion ? assetPreview(viewedVersion.asset, "成果图") : null) ?? references.find(({image}) => imageKey(image) === viewedId)?.image ?? references.find(item => item.selected)?.image ?? null;
  const active = task?.derivedStage && ["planning", "queued", "running", "processing"].includes(task.derivedStage);
  const interruptPending = stopping || task?.interruptPending;
  const outputProgress: R[] = task?.derivedStage === "processing" && execution?.status === "processing" ? execution.outputResults ?? [] : [];
  const readyOutputs = outputProgress.filter(output => output.availability === "ready").length;
  const progressLabel = interruptPending ? "正在终止" : task ? taskStage(task, command, execution) : undefined;
  const locked = !!(busy || interruptPending);
  const uploadAllowed = !locked && files.length + input.referenceIds.length < 4;
  const show = (image: PreviewImage) => {
    setViewedRoot(image.source === "成果图" ? displayed.find(item => item.asset.id === image.id)?.rootAssetId ?? null : null);
    setViewedId(imageKey(image)); setShowViewer(true);
  };

  return <main className="flex min-h-0 min-w-0 flex-1 overflow-x-auto bg-white" aria-label="图片工作台" onDragOver={onDragOver} onDrop={onDrop}>
    <section className="flex min-w-[24rem] flex-1 flex-col" aria-label="图片任务工作区">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">图片工作台</h1>
          <p className="truncate text-xs text-slate-500">{task ? task.title ?? "未输入文字" : taskId ? "正在读取任务…" : "新对话"}{!connected && " · 正在连接"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={locked} onClick={() => void run(() => choose(null))}>新建对话</Button>
          <Button type="button" aria-expanded={showTasks} onClick={() => setShowTasks(value => !value)}>{showTasks ? "收起任务列表" : "展开任务列表"}</Button>
        </div>
      </header>
      {(error || Object.keys(resourceErrors).length > 0) && <div role="alert" className="bg-red-50 px-4 py-2 text-xs text-red-800">
        {error && <p>{error}</p>}
        {Object.entries(resourceErrors).map(([resource, message]) => <p key={resource}>{message}</p>)}
      </div>}
      <section aria-label="参考图" className="min-w-0 shrink-0 border-b border-slate-200 px-3 py-2">
        <h2 className="text-xs font-medium">参考图</h2>
        {references.length > 0 && <div className="mt-2 flex gap-2 overflow-x-auto">
          {references.map(({image, referenceId, selected}) => {
            const asset = assetsById.get(image.id);
            return <Thumbnail key={`${image.id}:${image.url}`} image={image}
              active={showViewer && !!preview && imageKey(preview) === imageKey(image)} onOpen={() => show(image)} showActions={false}
              cornerAction={<Button type="button" size="iconCompact" title="删除图片" aria-label={`删除图片：${image.name}`}
                disabled={locked || (!!conversationId && (!task || !asset?.allowedActions?.includes("delete")))}
                onClick={() => {
                  if (!conversationId) removeLocalImage(image);
                  else if (asset) void run(() => removeImage(asset));
                }}><X aria-hidden="true" /></Button>}
              captionAction={selected ? conversationId && <Button type="button" variant="ghost" size="iconCompact" title="取消参考" aria-label={`取消参考：${image.name}`} disabled={locked || !draft} onClick={() => void run(() => changeReferences(input.referenceIds.filter(id => id !== referenceId)))}><Minus aria-hidden="true" /></Button> : <>
                <span className="shrink-0 text-slate-500">未选用</span>
                <Button type="button" variant="ghost" size="iconCompact" title="用作参考" aria-label={`用作参考：${image.name}`} disabled={!uploadAllowed || !draft} onClick={() => void run(() => changeReferences([...input.referenceIds, referenceId]))}><Plus aria-hidden="true" /></Button>
              </>} />;
          })}
        </div>}
      </section>
      <div className="flex min-h-0 flex-1 overflow-x-auto">
        {showParameters && <section className="w-56 shrink-0 overflow-y-auto border-r border-slate-200 p-3" aria-label="参数与输出">
          <label className="grid gap-1 text-xs">参考图处理方式
            <select className={settingsSelect} disabled={locked} value={input.parameters.inputMode ?? ""} onChange={event => edit({parameters: {...input.parameters, inputMode: event.target.value || undefined}})}>
              <option value="">请选择（单图自动处理）</option><option value="separate">分别修改每张图片</option><option value="joint">共同参考生成新图</option>
            </select>
          </label>
          <ImageParameters profile={profile} capabilities={capabilities} value={input.parameters} disabled={locked} onChange={parameters => edit({ parameters, ...(profile && Object.keys(parameters.explicitParameters).length ? { profileId: profile.id } : {}) })} />
        </section>}
        <section className="flex min-h-0 min-w-52 flex-1 flex-col" aria-label="图片对话">
          <div ref={conversationScroll} className="min-h-0 flex-1 overflow-y-auto" onScroll={event => {
            const {scrollHeight, scrollTop, clientHeight} = event.currentTarget;
            followLatest.current = scrollHeight - scrollTop - clientHeight <= 24;
          }}>
            <div ref={conversationContent} className="p-3">
              <Conversation tree={tree} temporary={[]} pendingText="" running={false} imageDiscussion />
              {command?.autoExecution?.reason === "AUTO_EXECUTE_LIMIT" && <p role="alert" className="my-2 text-xs text-red-800">本次要求超过单轮执行上限，请在对话中减少图片数量或输出数量后发送。</p>}
              {command?.error && <div className="my-2 text-xs text-red-800">
                <p>{command.error.message}</p>
                {command.allowedActions.includes("restart") && <Button type="button" disabled={locked} onClick={() => void run(() => imageRequest(`/commands/${command.id}/restart`, { method: "POST", revision: command.revision, body: {} }))}>重新开始规划</Button>}
              </div>}
            </div>
          </div>
          {(active || interruptPending) && <div className="shrink-0 border-t border-slate-200 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-x-2 text-xs text-slate-600">
              <span role="status">{progressLabel}…</span>
              {!interruptPending && outputProgress.length > 0 && <span>成果已就绪 {readyOutputs}/{outputProgress.length}</span>}
            </div>
            <progress aria-label="图片任务进度" className="mt-1.5 block h-1.5 w-full accent-emerald-600"
              max={outputProgress.length || 1} value={!interruptPending && outputProgress.length ? readyOutputs : undefined} />
          </div>}
        </section>
        {showViewer && <div className="w-[42%] min-w-56 shrink-0"><ImageCanvas preview={preview} onClose={() => setShowViewer(false)} /></div>}
      </div>
      <section className="min-w-0 shrink-0 border-t border-slate-200 px-3 py-2" aria-label="成果图">
        <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
          <h2 className="text-xs font-medium">成果图</h2>
          {cleanupRetry && <Button type="button" disabled={locked} onClick={() => void run(async () => {
            const result = await imageRequest(`/tasks/${taskId}/versions/${cleanupRetry}`, {method: "DELETE", revision: task.revision, body: {}});
            if (result.cleanup.state !== "done") throw Error("文件清理仍失败，请重试");
            setCleanupRetry(null);
          })}>重试清理</Button>}
          <Button type="button" disabled={locked || !displayed.some(item => checked.includes(item.rootAssetId))} onClick={() => void run(downloadSelected)}>下载成果</Button>
          <div className="relative w-20 shrink-0">
            <select aria-label="统一版本" className={`${settingsSelect} h-8! py-0! pr-5! pl-2!`} value={Object.keys(versions).length ? "custom" : versionChoice} onChange={event => {setVersionChoice(event.target.value); setVersions({});}}>
              <option value="latest">最新版本</option>
              {Object.keys(versions).length > 0 && <option value="custom">自定义</option>}
              {Array.from({length: detail?.maxVersionNumber ?? 0}, (_, index) => <option key={index + 1} value={index + 1}>v{index + 1}</option>)}
            </select>
            <ChevronDown aria-hidden="true" size={12} className={`${settingsSelectIcon} right-1.5!`} />
          </div>
          <Button type="button" disabled={!displayed.length} onClick={() => setChecked(previous => displayed.every(item => previous.includes(item.rootAssetId)) ? [] : displayed.map(item => item.rootAssetId))}>全选／取消全选</Button>
          {execution?.allowedActions.includes("restart") && <Button type="button" disabled={locked} onClick={() => void run(() => {
            const acceptUnknownOutcome = execution.providerOutcome === "unknown";
            if (acceptUnknownOutcome && !window.confirm("此前的供应商请求可能已生成或计费。确定重新开始？")) return;
            return imageRequest(`/executions/${execution.id}/restart`, { method: "POST", body: { planHash: execution.planHash, taskRevision: task.revision, acceptUnknownOutcome } });
          })}>重新开始执行</Button>}
          {task && <span role="status" className="text-xs text-slate-600">{taskStage(task, command, execution)}</span>}
        </div>
        {execution?.error && <p className="text-xs text-red-800">{execution.error.message}{execution.providerOutcome === "unknown" && "。供应商可能仍会生成图片或计费。"}</p>}
        {displayed.length > 0 && <div className="mt-2 flex gap-2 overflow-x-auto">
          {displayed.map(item => {
            const image = assetPreview(item.asset, "成果图");
            const selectedForDownload = checked.includes(item.rootAssetId);
            const toggleDownload = () => setChecked(previous => previous.includes(item.rootAssetId)
              ? previous.filter(id => id !== item.rootAssetId)
              : [...previous, item.rootAssetId]);
            return <div key={item.rootAssetId} className="flex w-max shrink-0 flex-col gap-1">
              <Thumbnail image={image} active={showViewer && viewedVersion?.rootAssetId === item.rootAssetId}
                downloadSelected={selectedForDownload} onToggleDownload={toggleDownload} onOpen={() => show(image)} showActions={false}
                cornerAction={<Button type="button" size="iconCompact" selected={false} aria-pressed={selectedForDownload}
                  aria-label={`选作下载：${image.name}`} title={selectedForDownload ? "取消下载选择" : "选作下载"}
                  onClick={toggleDownload}><Download aria-hidden="true" /></Button>} />
              <span className="text-xs text-slate-500">生成时间：{item.asset.readyAt ? new Date(item.asset.readyAt).toLocaleString() : "未知"}</span>
              <div className="grid grid-cols-[repeat(2,auto)] justify-start gap-1 whitespace-nowrap">
                <a className={`${buttonStyles()} ${resultActionWidth}`} href={item.asset.downloadUrl}>下载</a>
                <div className={`relative ${resultActionWidth}`}>
                  <select aria-label={`${item.asset.name} 版本`} className={`${settingsSelect} h-8! py-0! pr-4! pl-1.5!`} value={item.asset.versionNumber} onChange={event => {setVersions(previous => ({...previous, [item.rootAssetId]: event.target.value})); setViewedId(null);}}>
                    {item.versions.map(asset => <option key={asset.id} value={asset.versionNumber}>{`v${asset.versionNumber}`}</option>)}
                  </select>
                  <ChevronDown aria-hidden="true" size={12} className={`${settingsSelectIcon} right-1!`} />
                </div>
                {item.asset.allowedActions.includes("delete") && <Button type="button" className={resultActionWidth} disabled={locked} onClick={() => void run(() => removeImage(item.asset))}>删除</Button>}
                <Button type="button" className={`${resultActionWidth} col-start-2`} title="用作参考" aria-label="用作参考" disabled={!uploadAllowed || input.referenceIds.includes(image.id)} onClick={() => void run(() => changeReferences([...input.referenceIds, image.id]))}>参考</Button>
              </div>
            </div>;
          })}
        </div>}
      </section>
      <form className="grid gap-2 border-t border-slate-200 p-3" onSubmit={event => { event.preventDefault(); if (!locked && !active && !conversation?.conversation.discussion.busy) void run(() => send()); }}>
        <input ref={fileInput} type="file" multiple accept={referenceImageTypes.join(",")} hidden onChange={event => {
          const selected = [...(event.target.files ?? [])];
          event.target.value = "";
          void run(() => addFiles(selected));
        }} />
        <textarea aria-label="图片要求" className={settingsTextarea} rows={2} placeholder="输入图片要求或问题，可粘贴或拖入图片。「生成」直接出图，「发送」与助手讨论。" onPaste={onPaste} value={input.text} disabled={locked || !!conversationId && !draft} onChange={event => edit({ text: event.target.value })} />
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="图片模型" className={`${settingsSelect} max-w-56`} value={profile?.id ?? ""} disabled={locked || !profile}
            onChange={event => edit({ profileId: event.target.value, parameters: { ...input.parameters, explicitParameters: {} } })}>
            {!profile && <option value="">{capabilities ? "没有可用图片模型" : "正在读取图片模型…"}</option>}
            {capabilities?.profiles.map((item: R) => <option key={item.id} value={item.id} disabled={!item.available}>{item.modelId}{item.available ? "" : "（不可用）"}</option>)}
          </select>
          <Button type="button" disabled={!uploadAllowed} onClick={() => fileInput.current?.click()}>参考图</Button>
          <Button type="button" aria-expanded={showParameters} selected={showParameters} onClick={() => setShowParameters(value => !value)}>参数／输出</Button>
          <Button type="button" className="ml-auto" disabled={locked || !task?.allowedActions.includes("interrupt")} onClick={() => void stop()}>{interruptPending ? "正在终止…" : "终止"}</Button>
          <Button type="button" title="使用当前提示词、参数和参考图直接生成" disabled={locked || active || conversation?.conversation.discussion.busy || (!!conversationId && !draft) || (!input.text.trim() && !files.length && !input.referenceIds.length)} onClick={() => void run(() => send("generate"))}>生成</Button>
          <Button type="submit" variant="primary" title="和助手讨论，由助手决定是否生成图片" disabled={locked || active || conversation?.conversation.discussion.busy || (!!conversationId && !draft) || (!input.text.trim() && !files.length && !input.referenceIds.length)}>发送</Button>
        </div>
      </form>
    </section>
    {showTasks && <aside className="flex w-[20%] min-w-40 max-w-64 shrink-0 flex-col gap-2 border-l border-slate-200 bg-slate-50 p-2" aria-label="图片任务列表">
      <h2 className="px-2 text-sm font-medium">任务列表</h2>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tasks.map(item => <Button key={item.id} type="button" variant="ghost" size="row" aria-pressed={taskId === item.id} disabled={locked}
          className={`mb-1 flex-col items-start! gap-0! ${taskId === item.id ? "bg-sky-100!" : ""}`} onClick={() => void run(() => choose({ conversationId: item.conversationId, taskId: item.id }))}>
          <span className="w-full truncate text-sm" title={item.title ?? undefined}>{item.title ?? "未输入文字"}</span>
          <span className="w-full truncate text-xs text-slate-600" title={new Date(item.createdAt).toLocaleString()}>{new Date(item.createdAt).toLocaleString()} · {taskStage(item)}</span>
        </Button>)}
        {connected && tasks.length === 0 && <p className="px-2 text-xs text-slate-500">暂无任务</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {previousPages.length > 0 && <Button type="button" onClick={() => { setCursor(previousPages.at(-1) ?? null); setPreviousPages(pages => pages.slice(0, -1)); }}>上一页</Button>}
        {nextCursor && <Button type="button" onClick={() => { setPreviousPages(pages => [...pages, cursor]); setCursor(nextCursor); }}>下一页</Button>}
      </div>
    </aside>}
  </main>;
}
