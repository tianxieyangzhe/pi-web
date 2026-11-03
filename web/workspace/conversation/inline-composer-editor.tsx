import { useEffect, useImperativeHandle, useRef, type Ref, type ClipboardEvent, type KeyboardEvent } from "react";
import { readComposer, splitComposer, type InlineAttachment } from "./inline-composer-document";

export type InlineEditorHandle = { insert: (items: InlineAttachment[]) => void; focus: () => void };
export function InlineComposerEditor({ value, attachments, onChange, onPaste, onKeyDown, onCompositionStart, onCompositionEnd, placeholder, disabled, editorRef }: {
  value: string; attachments: InlineAttachment[]; onChange: (event: {target: {value: string}}) => void;
  onPaste: (event: ClipboardEvent<HTMLDivElement>) => void; onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onCompositionStart: () => void; onCompositionEnd: () => void; placeholder: string; disabled: boolean; editorRef: Ref<InlineEditorHandle>;
}) {
  const root = useRef<HTMLDivElement>(null), saved = useRef<Range | null>(null);
  const urls = useRef(new Map<string, string>()), composing = useRef(false);
  const latest = useRef({onChange, disabled}); latest.current = {onChange, disabled};
  function save() {
    const selection = window.getSelection();
    if (selection?.rangeCount && root.current?.contains(selection.anchorNode) && root.current.contains(selection.focusNode)) saved.current = selection.getRangeAt(0).cloneRange();
  }
  function isSlot(node: Node | null): node is HTMLElement { return node?.nodeType === 1 && (node as HTMLElement).hasAttribute("data-caret-slot"); }
  function isChip(node: Node | null): node is HTMLElement { return node?.nodeType === 1 && !!(node as HTMLElement).dataset.attachmentId; }
  function slot() {
    const element=document.createElement("span");element.dataset.caretSlot="";
    element.append(document.createTextNode("\u200B"));return element;
  }
  function ensureSlots() {
    // Inserting at a caret stop must produce siblings, never nest an atomic block inside its stop.
    for (const boundary of root.current?.querySelectorAll<HTMLElement>("[data-caret-slot]") ?? []) {
      if (!boundary.querySelector("[data-attachment-id]")) continue;
      for (const child of Array.from(boundary.childNodes)) {
        if (child.nodeType===3 && child.textContent?.includes("\u200B")) { child.textContent=child.textContent.replace("\u200B", "");break; }
      }
      boundary.replaceWith(...Array.from(boundary.childNodes));
    }
    for (const element of root.current?.querySelectorAll<HTMLElement>("[data-attachment-id]") ?? []) {
      if (!isSlot(element.previousSibling)) element.before(slot());
      if (!isSlot(element.nextSibling)) element.after(slot());
    }
    if (root.current && !root.current.querySelector("[data-attachment-id]") && !readComposer(root.current)) root.current.replaceChildren();
  }
  function place(node: Node, atEnd = true) {
    const selected=document.createRange(); selected.selectNodeContents(node);selected.collapse(!atEnd);
    root.current?.focus();const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(selected);save();
  }
  function emit() { if (root.current) { if (!composing.current) ensureSlots(); latest.current.onChange({target:{value:readComposer(root.current)}}); save(); } }
  function atomicKey(event: KeyboardEvent<HTMLDivElement>) {
    if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode===229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    if (!["ArrowLeft","ArrowRight","Backspace","Delete"].includes(event.key)) return false;
    const selection=window.getSelection();if (!selection?.rangeCount || !selection.isCollapsed || !root.current?.contains(selection.anchorNode)) return false;
    const selected=selection.getRangeAt(0), left=event.key==="ArrowLeft" || event.key==="Backspace";
    let current=selected.startContainer, offset=selected.startOffset, adjacent:Node|null=null;
    const inside=(current.nodeType===1?current as HTMLElement:current.parentElement)?.closest<HTMLElement>("[data-attachment-id]");
    if (inside) { event.preventDefault(); ensureSlots(); place(left?inside.previousSibling!:inside.nextSibling!);return true; }
    if (current.nodeType===3) {
      const text=current.textContent??"";
      let boundary=left?text.slice(0,offset):text.slice(offset);
      if (isSlot(current.parentNode)) {
        const probe=document.createRange();probe.selectNodeContents(current.parentNode);
        if (left) probe.setEnd(current,offset); else probe.setStart(current,offset);
        boundary=probe.toString().replace("\u200B", "");current=current.parentNode!;
      }
      if (boundary.length) return false;
      adjacent=left?current.previousSibling:current.nextSibling;
    } else if (isSlot(current)) {
      const probe=document.createRange();probe.selectNodeContents(current);
      if (left) probe.setEnd(current,offset); else probe.setStart(current,offset);
      if (probe.toString().replace("\u200B", "")) return false;
      adjacent=left?current.previousSibling:current.nextSibling;
    } else adjacent=left?current.childNodes[offset-1]??null:current.childNodes[offset]??null;
    while (adjacent && ((adjacent.nodeType===3 && !adjacent.textContent) || (isSlot(adjacent) && !(adjacent.textContent??"").replace("\u200B", "")))) adjacent=left?adjacent.previousSibling:adjacent.nextSibling;
    if (!isChip(adjacent)) return false;
    event.preventDefault();ensureSlots();
    const destination=left?adjacent.previousSibling!:adjacent.nextSibling!;
    if (event.key==="Backspace" || event.key==="Delete") { adjacent.remove();place(destination);emit(); }
    else place(destination,left);
    return true;
  }
  function range() {
    const editor = root.current!;
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) return selection.getRangeAt(0);
    if (saved.current && editor.contains(saved.current.startContainer) && editor.contains(saved.current.endContainer)) return saved.current;
    const end = document.createRange(); end.selectNodeContents(editor); end.collapse(false); return end;
  }
  function chip(item: InlineAttachment) {
    const element = document.createElement("span"); element.dataset.attachmentId = item.id; element.contentEditable = "false";element.setAttribute("contenteditable", "false");element.draggable=false;
    element.onmousedown = event => { if (!(event.target as HTMLElement).closest("button")) event.preventDefault(); };
    element.onclick = event => { if (!(event.target as HTMLElement).closest("button") && !latest.current.disabled) { ensureSlots();place(element.nextSibling!); } };
    element.className = "mx-0.5 inline-flex select-none max-w-full items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 align-middle text-xs leading-5 text-zinc-600";
    if (item.file?.type.startsWith("image/")) {
      let url = urls.current.get(item.id);
      if (!url) { url = URL.createObjectURL(item.file); urls.current.set(item.id, url); }
      const image = document.createElement("img"); image.src = url; image.alt = item.label; image.className = "h-10 w-10 rounded object-contain"; element.append(image);
    }
    const label = document.createElement("span"); label.textContent = item.label; label.className = "min-w-0 break-all"; element.append(label);
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×";
    remove.setAttribute("aria-label", `移除 ${item.label}`); remove.className = "shrink-0 px-1";
    remove.onmousedown = event => event.preventDefault();
    remove.onclick = () => { if (!latest.current.disabled) { element.remove(); emit(); } };
    element.append(remove); return element;
  }
  function insertNodes(nodes: Node[]) {
    if (!root.current || latest.current.disabled) return;
    const selected = range(); selected.deleteContents();
    const fragment = document.createDocumentFragment(); nodes.forEach(node => fragment.append(node));
    const last=nodes.at(-1);if (!last) return;
    selected.insertNode(fragment);ensureSlots();
    place(isChip(last)?last.nextSibling!:last);emit();
  }
  useImperativeHandle(editorRef, () => ({insert(items) { insertNodes(items.map(chip)); }, focus() {
    if (!root.current) return; const selected=range(); root.current.focus();
    const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(selected);save();
  }}));
  useEffect(() => {
    const editor = root.current; if (!editor || composing.current) return;
    if (readComposer(editor) !== value) {
      saved.current = null;
      const byId = new Map(attachments.map(item => [item.id,item]));
      editor.replaceChildren(...splitComposer(value).flatMap<Node>(part => "text" in part ? [document.createTextNode(part.text)] : byId.has(part.id) ? [chip(byId.get(part.id)!)] : []));
    }
    ensureSlots();
    const alive = new Set(attachments.map(item => item.id));
    for (const [id,url] of urls.current) if (!alive.has(id)) { URL.revokeObjectURL(url); urls.current.delete(id); }
  }, [value, attachments]);
  useEffect(() => () => { for (const url of urls.current.values()) URL.revokeObjectURL(url); }, []);
  return <div ref={root} role="textbox" aria-label={placeholder} aria-multiline="true" aria-disabled={disabled} data-placeholder={placeholder}
    title="Enter 发送，Shift+Enter 换行" contentEditable={!disabled} suppressContentEditableWarning
    className="h-28 min-h-28 max-h-[max(112px,40dvh)] w-full flex-none resize-y overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-sm leading-6 outline-none empty:before:pointer-events-none empty:before:text-zinc-400 empty:before:content-[attr(data-placeholder)]"
    onInput={emit} onBlur={save} onMouseUp={save} onKeyUp={save} onKeyDown={event => {
      if ((event.target as HTMLElement).closest("button")) return;
      if (atomicKey(event)) return;
      onKeyDown(event);
      if (!event.defaultPrevented && event.key === "Enter" && event.shiftKey && !composing.current && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.preventDefault(); insertNodes([document.createTextNode("\n")]);
      }
    }}
    onCompositionStart={() => {composing.current=true;onCompositionStart();}} onCompositionEnd={() => {composing.current=false;emit();onCompositionEnd();}}
    onPaste={event => {
      onPaste(event); if (event.defaultPrevented) return;
      event.preventDefault(); insertNodes([document.createTextNode(event.clipboardData.getData("text/plain"))]);
    }}
    onCopy={event => {
      const selected=window.getSelection(); if (!selected?.rangeCount) return;
      const container=document.createElement("div");container.append(selected.getRangeAt(0).cloneContents());
      if (!container.querySelector("[data-attachment-id]")) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain",readComposer(container).replace(/\uE000([^\uE001]+)\uE001/g, (_token,id:string)=>attachments.find(item=>item.id===id)?.label??""));
    }} />;
}
