import { useLayoutEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export function AuxiliaryDialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null),label=useId(),close=useRef(onClose);close.current=onClose;
  useLayoutEffect(()=>{
    const dialog=ref.current!,previous=document.activeElement as HTMLElement|null;
    // show(), unlike showModal(), leaves the conversation and navigation interactive.
    if(typeof dialog.show==='function')dialog.show();else dialog.setAttribute('open','');
    previous?.focus?.({preventScroll:true});
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();close.current();}};
    document.addEventListener('keydown',escape);
    return ()=>{
      document.removeEventListener('keydown',escape);
      const restore=dialog.contains(document.activeElement);
      if(typeof dialog.close==='function'&&dialog.open)dialog.close();
      if(restore&&previous?.isConnected)previous.focus({preventScroll:true});
    };
  },[]);
  return <dialog ref={ref} aria-labelledby={label} aria-modal="false" onCancel={event=>{event.preventDefault();close.current();}} className="fixed top-16 right-4 bottom-auto left-auto z-40 m-0 h-auto max-h-[calc(100dvh-5rem)] w-[min(860px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl">
    <div className="flex max-h-[inherit] min-h-0 flex-col"><header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-3"><h2 id={label} className="font-semibold">{title}</h2><button type="button" aria-label={`关闭${title}`} onClick={onClose} className="rounded p-1 hover:bg-slate-100"><X size={18}/></button></header><div className={`flex min-h-0 flex-1 flex-col ${title==='会话检查'?'overflow-hidden':'overflow-auto'}`}>{children}</div></div>
  </dialog>;
}
