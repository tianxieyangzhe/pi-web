import { ArrowUp, LoaderCircle, Square } from "lucide-react";
import { useEffect,useState,useRef, type FormEvent, type KeyboardEvent } from "react";
import type { MessageReference, ProjectMessageReference, BotMessageReference } from "../../../src/domain/message-references";
import type { Project } from "../../domain/models";
import { ReferencePicker, ProjectReferencePicker, readReference } from "./reference-picker";
const drafts=new Map<string,string>();
const draftVersions=new Map<string,number>();

export function shouldSubmitOnEnter(event:Pick<KeyboardEvent<HTMLTextAreaElement>,"key"|"shiftKey"|"nativeEvent">,compositionActive:boolean) {
  return event.key==="Enter"&&!event.shiftKey&&!compositionActive&&!event.nativeEvent.isComposing&&event.nativeEvent.keyCode!==229;
}

export function PromptInput({ placeholder, running, stopping = false, blocked = false, draftKey, blockedReason, onSubmit, onStop, referenceProjects = [], referenceWorkspace }: { placeholder: string; running: boolean; stopping?: boolean; blocked?: boolean; draftKey?:string;blockedReason?:string; onSubmit: (value: string, references: MessageReference[]) => void | Promise<void>; onStop?: () => void; referenceProjects?: Project[]; referenceWorkspace?: {botId:string;conversationId:string} }) {
  const [value, setValue] = useState(()=>draftKey?drafts.get(draftKey)??'':'');
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
  useEffect(()=>{const next=draftKey?drafts.get(draftKey)??'':'';currentValue.current=next;setValue(next);},[draftKey]);
  function change(value:string){currentValue.current=value;setValue(value);if(draftKey){drafts.set(draftKey,value);draftVersions.set(draftKey,(draftVersions.get(draftKey)??0)+1);}else localVersion.current++;}
  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const next = value.trim();
    if (!next || running || blocked || submitLock.current) return;
    const submittedKey=draftKey,submittedValue=value;
    submitLock.current=true;setSubmitting(true);
    change("");
    const submittedVersion=submittedKey?draftVersions.get(submittedKey):localVersion.current;
    try{
      setReferenceError("");
      const uploads = references.length ? await Promise.all(references.map(readReference)) : [];
      await onSubmit(next, [...uploads, ...projectReferences]);
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
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (shouldSubmitOnEnter(event,compositionActive.current)) {
      event.preventDefault(); submit();
    }
  }
  return <form className="prompt-input" onSubmit={submit}>
    <textarea value={value} onChange={(event) => change(event.target.value)} onCompositionStart={()=>{compositionActive.current=true;}} onCompositionEnd={()=>{compositionActive.current=false;}} onKeyDown={onKeyDown} placeholder={placeholder} disabled={running||submitting} />
    <div className="prompt-input__references">
      <ReferencePicker selected={references} onChange={setReferences} projectCount={projectReferences.length} disabled={running||submitting||blocked}/>
      <ProjectReferencePicker projects={referenceProjects} workspace={referenceWorkspace} selected={projectReferences} onChange={setProjectReferences} uploadCount={references.length} disabled={running||submitting||blocked}/>
    </div>
    {referenceError && <p role="alert">{referenceError}</p>}
    <div className="prompt-input__footer"><span>{stopping ? "正在停止" : blocked ? blockedReason??"当前暂不能发送" : running||submitting ? "正在处理" : "Enter 发送，Shift+Enter 换行"}</span><div className="prompt-input__actions">{running && onStop && <button type="button" aria-label={stopping?"正在停止":"停止"} disabled={stopping} onClick={onStop}><Square size={14} fill="currentColor" /></button>}<button type="submit" aria-label="发送" disabled={!value.trim() || running || blocked||submitting}>{running||submitting ? <LoaderCircle className="spin" size={15} /> : <ArrowUp size={15} />}</button></div></div>
  </form>;
}
