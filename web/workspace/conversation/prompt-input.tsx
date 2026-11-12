import {Button} from '../../components/button';
import { randomUUID } from '../../api/random-uuid';
import { ArrowUp, ChevronDown, Globe, LoaderCircle, Square, X } from 'lucide-react';
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import type { MessageReference, ProjectMessageReference } from '../../../src/domain/message-references';
import type { SessionContextFile } from '../../../src/application/ports/session-context-files';
import type { Project } from '../../domain/models';
import { ReferencePicker, ProjectReferencePicker, ResourceReferencePicker, readReference } from './reference-picker';
import { attachmentOnlyMessage, clipboardFiles, validateAttachments } from './clipboard';
import { InlineComposerEditor, type InlineEditorHandle } from './inline-composer-editor';
import { attachmentIds, attachmentToken, composerText, type InlineAttachment } from './inline-composer-document';
import { ErrorToast } from './error-toast';

const fileIds = new WeakMap<File,string>();
function fileId(file:File) { let id=fileIds.get(file);if(!id){id=randomUUID();fileIds.set(file,id);}return id; }
function fileAttachment(file:File):InlineAttachment {return {id:fileId(file),file,label:/^已粘贴 \d+ 行\.txt$/.test(file.name)?file.name.slice(0,-4):file.name};}
const drafts = new Map<string, string>();
const draftVersions = new Map<string, number>();
export function shouldSubmitOnEnter(event: Pick<KeyboardEvent<HTMLElement>, 'key' | 'shiftKey' | 'nativeEvent'>, compositionActive: boolean) {
  return event.key === 'Enter' && !event.shiftKey && !compositionActive && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229;
}
export function PromptInput({ placeholder, running, stopping = false, blocked = false, draftKey, blockedReason, inputHistory = [], onSubmit, onStop, referenceProjects = [], listReferenceFiles, assistantProjectId, assistantWorkspaceId, assistantName, onSelectAssistant, contextFiles, onAddContextFiles, onRemoveContextFile }: {
  placeholder: string; running: boolean; stopping?: boolean; blocked?: boolean; draftKey?: string; blockedReason?: string;
  inputHistory?: readonly string[];
  onSubmit: (value: string, references: MessageReference[], webSearch?: boolean, toolSearch?: boolean) => void | Promise<void>;
  onStop?: () => void; referenceProjects?: Project[];
  listReferenceFiles?: (projectId: string, path: string) => Promise<import('../../domain/models').ProjectFileListing>;
  assistantProjectId?:string; assistantWorkspaceId?:string; assistantName?:string;
  onSelectAssistant?:(id:string,signal:AbortSignal)=>Promise<void>;
  contextFiles: SessionContextFile[];
  onAddContextFiles: (items: MessageReference[]) => Promise<void>;
  onRemoveContextFile: (id: string) => Promise<void>;
}) {
  const [value, setValue] = useState(() => draftKey ? drafts.get(draftKey) ?? '' : '');
  const [searchMode, setSearchMode] = useState<'builtin' | 'tool' | 'none'>('builtin');
  const [submitting, setSubmitting] = useState(false), [savingFiles, setSavingFiles] = useState(false), [applyingAssistant,setApplyingAssistant]=useState(false), [referenceError, setReferenceError] = useState('');
  const [references,setReferences]=useState<File[]>([]);
  useEffect(()=>{setReferences([]);setReferenceError('');},[draftKey]);
  const submitLock = useRef(false), fileLock = useRef(false), compositionActive = useRef(false);
  const editor = useRef<InlineEditorHandle>(null), currentValue = useRef(value), currentKey = useRef(draftKey), localVersion = useRef(0);
  const history = useRef<{ items: readonly string[]; index: number; draft: {value:string;references:File[]} } | null>(null);
  currentKey.current = draftKey; currentValue.current = value;
  useEffect(() => {
    setSearchMode('builtin'); history.current = null; compositionActive.current = false;
    const next = composerText(draftKey ? drafts.get(draftKey) ?? '' : '');
    currentValue.current = next; setValue(next);
  }, [draftKey]);
  const filesDisabled = running || submitting || savingFiles || blocked || stopping;
  const projectReferences = contextFiles.filter(item => item.source === 'project').map(item => ({ projectId: item.projectId!, path: item.path! }));
  function change(next: string) {
    currentValue.current = next; setValue(next);
    if (draftKey) { drafts.set(draftKey, next); draftVersions.set(draftKey, (draftVersions.get(draftKey) ?? 0) + 1); }
    else localVersion.current++;
  }
  async function mutateFiles(work: () => Promise<void>) {
    if (fileLock.current || filesDisabled) return;
    fileLock.current = true; setSavingFiles(true); setReferenceError('');
    try { await work(); }
    catch (error) { setReferenceError(error instanceof Error ? error.message : '参考文件保存失败'); }
    finally { fileLock.current = false; setSavingFiles(false); }
  }
  async function selectAssistant(id:string,signal:AbortSignal) {
    if(fileLock.current||submitLock.current||filesDisabled||!onSelectAssistant)throw new Error('当前无法切换助手');
    fileLock.current=true;setSavingFiles(true);setApplyingAssistant(true);
    try { await onSelectAssistant(id,signal); }
    finally { fileLock.current=false;setSavingFiles(false);setApplyingAssistant(false); }
  }
  function selectFiles(next:File[]) {
    history.current=null;
    const added=next.filter(file=>!references.includes(file)).map(fileAttachment);
    if(editor.current)editor.current.insert(added);
    else change(currentValue.current+added.map(item=>attachmentToken(item.id)).join(''));
    const present=new Set(attachmentIds(currentValue.current));
    setReferences(next.filter(file=>present.has(fileId(file))));
  }
  function addFiles(files:File[]) {
    const next=[...references,...files];
    validateAttachments(next,contextFiles.length);
    selectFiles(next);setReferenceError('');
  }
  function selectProjects(next: ProjectMessageReference[]) {
    const removed = contextFiles.find(item => item.source === 'project' && !next.some(candidate => candidate.projectId === item.projectId && candidate.path === item.path));
    const added = next.filter(item => !projectReferences.some(candidate => candidate.projectId === item.projectId && candidate.path === item.path));
    if (removed) void mutateFiles(() => onRemoveContextFile(removed.id));
    else if (added.length) void mutateFiles(() => onAddContextFiles(added));
  }
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const next = composerText(value).trim() || (references.length?attachmentOnlyMessage:'');
    if (!next || blocked || stopping || savingFiles || submitLock.current) return;
    if(running&&references.length){setReferenceError('运行中仅支持文字纠正，请移除上传附件后发送');return;}
    const submittedKey = draftKey, submittedValue = value;
    history.current = null; submitLock.current = true; setSubmitting(true); change('');
    const submittedVersion = submittedKey ? draftVersions.get(submittedKey) : localVersion.current;
    try {
      const uploads=await Promise.all(references.map(readReference));
      await onSubmit(next, uploads, !running && searchMode === 'builtin', !running && searchMode === 'tool');
      if(currentKey.current===submittedKey)setReferences([]);
    }
    catch(error) {
      if(currentKey.current===submittedKey&&references.length)setReferenceError(error instanceof Error?error.message:'上传附件发送失败');
      if (submittedKey) {
        if (draftVersions.get(submittedKey) === submittedVersion) {
          drafts.set(submittedKey, submittedValue);
          if (currentKey.current === submittedKey) { currentValue.current = submittedValue; setValue(submittedValue); }
        }
      } else if (currentKey.current === submittedKey && localVersion.current === submittedVersion) { currentValue.current = submittedValue; setValue(submittedValue); }
    } finally { submitLock.current = false; setSubmitting(false); }
  }
  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    if (filesDisabled) return;
    try {
      const pasted = clipboardFiles(event.clipboardData);
      if (!pasted) return;
      event.preventDefault(); void addFiles(pasted);
    } catch (error) { event.preventDefault(); setReferenceError(error instanceof Error ? error.message : '粘贴失败'); }
  }
  function isFileDrag(data: DataTransfer) { return Array.from(data.types).includes('Files') || Array.from(data.items).some(item => item.kind === 'file'); }
  function onDragOver(event: DragEvent<HTMLFormElement>) {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = filesDisabled ? 'none' : 'copy';
  }
  function onDrop(event: DragEvent<HTMLFormElement>) {
    if (!isFileDrag(event.dataTransfer)) return;
    event.preventDefault(); if (filesDisabled) return;
    try {
      const items = Array.from(event.dataTransfer.items).filter(item => item.kind === 'file');
      if (items.some(item => item.webkitGetAsEntry?.()?.isDirectory)) throw new Error('暂不支持拖入文件夹，请选择其中的文件');
      const files = items.length ? items.map(item => { const file = item.getAsFile(); if (!file) throw new Error('无法读取拖入的文件'); return file; }) : Array.from(event.dataTransfer.files);
      if (files.length) void addFiles(files);
    } catch (error) { setReferenceError(error instanceof Error ? error.message : '拖入文件失败'); }
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
      !compositionActive.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && !running && !submitting && !blocked && !submitLock.current && editor.current?.canRecallHistory(history.current !== null)) {
      let navigation = history.current;
      if (!navigation && event.key === 'ArrowUp' && inputHistory.length) { navigation = { items: [...inputHistory], index: inputHistory.length, draft: {value:currentValue.current,references} }; history.current = navigation; }
      if (navigation) {
        event.preventDefault(); navigation.index = Math.max(0, Math.min(navigation.items.length, navigation.index + (event.key === 'ArrowUp' ? -1 : 1)));
        const draft=navigation.index===navigation.items.length?navigation.draft:null;
        editor.current.focusEnd(); change(draft?draft.value:navigation.items[navigation.index]);
        setReferences(draft?draft.references:[]);
        if (navigation.index === navigation.items.length) history.current = null;
        return;
      }
    }
    if (shouldSubmitOnEnter(event, compositionActive.current)) { event.preventDefault(); void submit(); }
  }
  return <form className="prompt-input flex w-full! flex-wrap items-start rounded-lg!" onSubmit={submit} onDragOver={onDragOver} onDrop={onDrop}>
    <InlineComposerEditor key={draftKey} editorRef={editor} attachments={references.map(fileAttachment)} value={value} onChange={event => { history.current = null; change(event.target.value);const ids=new Set(attachmentIds(event.target.value));setReferences(items=>items.filter(file=>ids.has(fileId(file)))); }} onCompositionStart={() => { compositionActive.current = true; }} onCompositionEnd={() => { compositionActive.current = false; }} onKeyDown={onKeyDown} onPaste={onPaste} placeholder={running ? '输入补充或纠正指令…' : placeholder} disabled={submitting || stopping} />
    <div className="prompt-input__references min-w-0 flex-1 gap-x-3! gap-y-0.5! py-1! [&_.reference-picker__trigger]:py-0.5!">
      <ResourceReferencePicker key={`assistant:${draftKey}`} kind="assistant" assistantName={assistantName} projectId={assistantProjectId} workspaceId={assistantWorkspaceId} disabled={filesDisabled||!onSelectAssistant} onSelect={addFiles} onSelectAssistant={selectAssistant} />
      <ResourceReferencePicker key={`skill:${draftKey}`} kind="skill" disabled={filesDisabled} onSelect={addFiles} />
      <ReferencePicker selected={references} onChange={selectFiles} projectCount={contextFiles.length} disabled={filesDisabled} />
      <ProjectReferencePicker onDone={() => editor.current?.focus()} projects={referenceProjects} listFiles={listReferenceFiles} selected={projectReferences} onChange={selectProjects} uploadCount={contextFiles.length - projectReferences.length} disabled={filesDisabled} />
      <label className={`relative inline-flex h-6 shrink-0 items-center self-center rounded border border-slate-200 bg-white shadow-none [text-shadow:none] ${searchMode !== 'none' ? 'text-sky-700' : 'text-slate-500'}`} title="内置搜索由服务端执行；工具搜索使用部署主机网络">
        <Globe size={12} aria-hidden="true" className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2" />
        <select aria-label="联网搜索" value={searchMode} disabled={filesDisabled} onChange={event => { setSearchMode(event.target.value as 'builtin' | 'tool' | 'none'); editor.current?.focus(); }} className="h-full! min-w-0 cursor-pointer appearance-none! rounded! border-0! bg-transparent! py-0! pr-5! pl-6! text-[11px]! leading-normal! font-normal! text-inherit! shadow-none! [text-shadow:none]! disabled:cursor-not-allowed disabled:opacity-50"><option value="builtin">内置搜索 · 服务端</option><option value="tool">工具搜索 · 应用端</option><option value="none">无搜索</option></select>
        <ChevronDown size={10} aria-hidden="true" className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2" />
      </label>
    </div>
    <div className="prompt-input__footer min-h-0! max-w-full gap-2 border-0! py-1! pr-2! pl-0!">
      <span className="max-w-48 text-[10px] leading-tight" role="status">{applyingAssistant ? '正在应用助手' : savingFiles ? '正在保存参考文件' : stopping ? '正在停止' : blocked ? blockedReason ?? '当前暂不能发送' : submitting ? '正在提交' : running ? '运行中纠正 · Enter 发送' : 'Enter 发送 · Shift+Enter 换行 · ↑↓ 历史输入'}</span>
      <div className="prompt-input__actions">{running && onStop && <Button variant="danger" size="icon" type="button" aria-label={stopping ? '正在停止' : '停止'} disabled={stopping} onClick={onStop}><Square size={14} fill="currentColor" /></Button>}<Button variant="primary" size="icon" type="submit" aria-label={running ? '发送纠正' : '发送'} disabled={(!composerText(value).trim()&&!references.length) || blocked || stopping || submitting || savingFiles}>{submitting ? <LoaderCircle className="spin" size={15} /> : <ArrowUp size={15} />}</Button></div>
    </div>
    {contextFiles.length > 0 && <ul aria-label="会话参考文件" className="m-0 flex w-full list-none flex-wrap gap-1 border-t border-slate-100 px-3 py-2">
      {contextFiles.map(file => <li key={file.id} className="flex min-w-0 max-w-full items-center gap-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600" title={file.path ?? file.name}>
        <span className="truncate">{file.name}</span><Button variant="ghost" size="icon" type="button" aria-label={`删除参考文件 ${file.name}`} title="从此会话移除引用，保留原文件和历史" disabled={filesDisabled} onClick={() => void mutateFiles(() => onRemoveContextFile(file.id))} ><X size={12} /></Button>
      </li>)}
    </ul>}
    <ErrorToast message={referenceError} onDismiss={() => setReferenceError('')} />
  </form>;
}
