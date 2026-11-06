import { randomUUID } from "../../api/random-uuid";
import { ArrowUp, ChevronDown, Globe, LoaderCircle, Square } from "lucide-react";
import { useEffect,useState,useRef, type FormEvent, type KeyboardEvent, type ClipboardEvent } from "react";
import type { MessageReference, ProjectMessageReference, BotMessageReference } from "../../../src/domain/message-references";
import type { Project } from "../../domain/models";
import { ReferencePicker, ProjectReferencePicker, readReference } from "./reference-picker";
import { attachmentOnlyMessage, clipboardFiles, validateAttachments } from "./clipboard";
import { InlineComposerEditor, type InlineEditorHandle } from "./inline-composer-editor";
import { attachmentIds, attachmentToken, composerText, type InlineAttachment } from "./inline-composer-document";
import { ErrorToast } from "./error-toast";
const drafts=new Map<string,string>();
const draftVersions=new Map<string,number>();
const fileIds = new WeakMap<File, string>();
function fileId(file: File) { let id=fileIds.get(file); if (!id) {id=randomUUID();fileIds.set(file,id);} return id; }
function projectId(item: ProjectMessageReference | BotMessageReference) { return JSON.stringify(item); }
function fileAttachment(file: File): InlineAttachment { return {id:fileId(file),file,label:/^已粘贴 \d+ 行\.txt$/.test(file.name)?file.name.slice(0,-4):file.name}; }

export function shouldSubmitOnEnter(event:Pick<KeyboardEvent<HTMLElement>,"key"|"shiftKey"|"nativeEvent">,compositionActive:boolean) {
  return event.key==="Enter"&&!event.shiftKey&&!compositionActive&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229;
}

export function PromptInput({ placeholder, running, stopping = false, blocked = false, draftKey, blockedReason, onSubmit, onStop, referenceProjects = [], referenceWorkspace, listReferenceFiles }: { placeholder: string; running: boolean; stopping?: boolean; blocked?: boolean; draftKey?:string;blockedReason?:string; onSubmit: (value: string, references: MessageReference[], webSearch?: boolean, toolSearch?: boolean) => void | Promise<void>; onStop?: () => void; referenceProjects?: Project[]; referenceWorkspace?: {botId:string;conversationId:string}; listReferenceFiles?:(projectId:string,path:string)=>Promise<import('../../domain/models').ProjectFileListing> }) {
  const [value, setValue] = useState(()=>draftKey?drafts.get(draftKey)??'':'');
  const [searchMode,setSearchMode]=useState<"builtin"|"tool"|"none">("builtin");
  useEffect(()=>setSearchMode("builtin"),[draftKey]);
  const [submitting,setSubmitting]=useState(false);
  const [references,setReferences]=useState<File[]>([]);
  const [referenceError,setReferenceError]=useState("");
  const [projectReferences,setProjectReferences]=useState<Array<ProjectMessageReference | BotMessageReference>>([]);
  useEffect(()=>{setReferences([]);setProjectReferences([]);setReferenceError("");},[draftKey]);
  const currentKey=useRef(draftKey);currentKey.current=draftKey;
  const currentValue=useRef(value);currentValue.current=value;
  const submitLock=useRef(false);
  const localVersion=useRef(0);
  const compositionActive=useRef(false);
  const editor = useRef<InlineEditorHandle>(null);
  const attachments: InlineAttachment[] = [...references.map(fileAttachment), ...projectReferences.map(item => ({id:projectId(item),label:item.path}))];
  function insert(items: InlineAttachment[]) {
    if (!items.length) return;
    if (editor.current) editor.current.insert(items);
    else change(currentValue.current + items.map(item => attachmentToken(item.id)).join(""));
  }
  function selectFiles(next: File[]) {
    insert(next.filter(file => !references.includes(file)).map(fileAttachment));
    const present = new Set(attachmentIds(currentValue.current));
    setReferences(next.filter(file => present.has(fileId(file))));
  }
  function selectProjects(next: Array<ProjectMessageReference | BotMessageReference>) {
    const keys = new Set(next.map(projectId));
    let nextValue = currentValue.current;
    for (const item of projectReferences) if (!keys.has(projectId(item))) nextValue=nextValue.replaceAll(attachmentToken(projectId(item)), "");
    if (nextValue !== currentValue.current) change(nextValue);
    insert(next.filter(item => !projectReferences.some(previous => projectId(previous)===projectId(item))).map(item => ({id:projectId(item),label:item.path})));
    const present = new Set(attachmentIds(currentValue.current));
    setProjectReferences(next.filter(item => present.has(projectId(item))));
  }
  function edit(event: {target:{value:string}}) {
    change(event.target.value);
    const ids=new Set(attachmentIds(event.target.value));
    setReferences(items=>items.filter(file=>ids.has(fileId(file))));
    setProjectReferences(items=>items.filter(item=>ids.has(projectId(item))));
  }
  useEffect(()=>{const next=composerText(draftKey?drafts.get(draftKey)??'':'');currentValue.current=next;setValue(next);},[draftKey]);
  function change(value:string){currentValue.current=value;setValue(value);if(draftKey){drafts.set(draftKey,value);draftVersions.set(draftKey,(draftVersions.get(draftKey)??0)+1);}else localVersion.current++;}
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const next = composerText(value).trim() || (references.length || projectReferences.length ? attachmentOnlyMessage : "");
    if (!next || running || blocked || submitLock.current) return;
    const submittedKey=draftKey,submittedValue=value;
    submitLock.current=true;setSubmitting(true);
    change("");
    const submittedVersion=submittedKey?draftVersions.get(submittedKey):localVersion.current;
    try{
      setReferenceError("");
      const uploads = references.length ? await Promise.all(references.map(readReference)) : [];
      await onSubmit(next, [...uploads, ...projectReferences], searchMode === "builtin", searchMode === "tool");
      if(currentKey.current===submittedKey){setReferences([]);setProjectReferences([]);}
    }catch(error){
      if (currentKey.current === submittedKey && (references.length || projectReferences.length)) setReferenceError(error instanceof Error ? error.message : "参考文件发送失败");
      // Restore only if the original draft has not been edited since submission.
      if(submittedKey){
        if(draftVersions.get(submittedKey)===submittedVersion){
          drafts.set(submittedKey,submittedValue);
          if(currentKey.current===submittedKey){currentValue.current=submittedValue;setValue(submittedValue);}
        }
      }else if(currentKey.current===submittedKey&&localVersion.current===submittedVersion){currentValue.current=submittedValue;setValue(submittedValue);}
    }finally{submitLock.current=false;setSubmitting(false);}
  }
  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    if (running || submitting || blocked) return;
    try {
      const pasted = clipboardFiles(event.clipboardData);
      if (!pasted) return;
      event.preventDefault();
      const next = [...references, ...pasted];
      validateAttachments(next, projectReferences.length);
      selectFiles(next); setReferenceError("");
    } catch (error) { event.preventDefault(); setReferenceError(error instanceof Error ? error.message : "粘贴失败"); }
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (shouldSubmitOnEnter(event,compositionActive.current)) {
      event.preventDefault(); submit();
    }
  }
  return <form className="prompt-input flex w-full! flex-wrap items-start rounded-lg!" onSubmit={submit}>
    <InlineComposerEditor key={draftKey} editorRef={editor} attachments={attachments} value={value} onChange={edit} onCompositionStart={()=>{compositionActive.current=true;}} onCompositionEnd={()=>{compositionActive.current=false;}} onKeyDown={onKeyDown} onPaste={onPaste} placeholder={placeholder} disabled={running||submitting} />
    <div className="prompt-input__references min-w-0 flex-1 gap-x-3! gap-y-0.5! py-1! [&_.reference-picker__trigger]:py-0.5!">
      <ReferencePicker key={`upload:${draftKey}`} selected={references} onChange={selectFiles} projectCount={projectReferences.length} disabled={running||submitting||blocked}/>
      <ProjectReferencePicker key={`project:${draftKey}`} onDone={() => editor.current?.focus()} projects={referenceProjects} workspace={referenceWorkspace} listFiles={listReferenceFiles} selected={projectReferences} onChange={selectProjects} uploadCount={references.length} disabled={running||submitting||blocked}/>
      <label className={`relative inline-flex h-6 shrink-0 items-center self-center rounded border border-slate-200 bg-white shadow-none [text-shadow:none] ${searchMode!=="none"?"text-sky-700":"text-slate-500"}`} title="内置搜索：OpenAI服务端执行，需Responses模型；工具搜索：使用部署主机网络直接访问网页，无地址时搜索Bing，无需Key">
        <Globe size={12} aria-hidden="true" className="pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2"/>
        <select aria-label="联网搜索" value={searchMode} disabled={running||submitting||blocked} onChange={event=>{setSearchMode(event.target.value as "builtin"|"tool"|"none");editor.current?.focus();}} className="h-full! min-w-0 cursor-pointer appearance-none! rounded! border-0! bg-transparent! py-0! pr-5! pl-6! text-[11px]! leading-normal! font-normal! text-inherit! shadow-none! [text-shadow:none]! disabled:cursor-not-allowed disabled:opacity-50"><option value="builtin">内置搜索 · 服务端</option><option value="tool">工具搜索 · 应用端</option><option value="none">无搜索</option></select>
        <ChevronDown size={10} aria-hidden="true" className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2"/>
      </label>
    </div>
    <ErrorToast message={referenceError} onDismiss={() => setReferenceError("")} />
    <div className="prompt-input__footer min-h-0! max-w-full gap-2 border-0! py-1! pr-2! pl-0!"><span className="max-w-48 text-[10px] leading-tight" role="status">{stopping ? "正在停止" : blocked ? blockedReason??"当前暂不能发送" : running || submitting ? "正在处理" : "Enter 发送 · Shift+Enter 换行"}</span><div className="prompt-input__actions [&_button]:h-7! [&_button]:w-7!">{running && onStop && <button type="button" aria-label={stopping?"正在停止":"停止"} disabled={stopping} onClick={onStop}><Square size={14} fill="currentColor" /></button>}<button type="submit" aria-label="发送" disabled={(!composerText(value).trim() && !references.length && !projectReferences.length) || running || blocked||submitting}>{running||submitting ? <LoaderCircle className="spin" size={15} /> : <ArrowUp size={15} />}</button></div></div>
  </form>;
}
