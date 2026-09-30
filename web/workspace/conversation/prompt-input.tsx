import { ArrowUp, LoaderCircle, Square } from "lucide-react";
import { useState, type FormEvent, type KeyboardEvent } from "react";

export function PromptInput({ placeholder, running, onSubmit, onStop }: { placeholder: string; running: boolean; onSubmit: (value: string) => void; onStop?: () => void }) {
  const [value, setValue] = useState("");
  function submit(event?: FormEvent) {
    event?.preventDefault();
    const next = value.trim();
    if (!next || running) return;
    setValue(""); onSubmit(next);
  }
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault(); submit();
    }
  }
  return <form className="prompt-input" onSubmit={submit}>
    <textarea value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} disabled={running} />
    <div className="prompt-input__footer"><span>{running ? "正在处理" : "Enter 发送，Shift+Enter 换行"}</span><div className="prompt-input__actions">{running && onStop && <button type="button" aria-label="停止" onClick={onStop}><Square size={14} fill="currentColor" /></button>}<button type="submit" aria-label="发送" disabled={!value.trim() || running}>{running ? <LoaderCircle className="spin" size={15} /> : <ArrowUp size={15} />}</button></div></div>
  </form>;
}
