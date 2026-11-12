import {Button} from '../components/button';
import { useLayoutEffect, useId, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { X } from 'lucide-react';
export function AuxiliaryDialog({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null),label=useId(),close=useRef(onClose);close.current=onClose;
  const [position,setPosition]=useState<{left:number;top:number}|null>(null);
  const positionRef=useRef(position);positionRef.current=position;
  const drag=useRef<{pointerId:number;x:number;y:number;left:number;top:number}|null>(null);
  function move(left:number,top:number){
    const dialog=ref.current;if(!dialog)return;
    const rect=dialog.getBoundingClientRect(),margin=8;
    const next={left:Math.max(margin,Math.min(left,window.innerWidth-rect.width-margin)),top:Math.max(margin,Math.min(top,window.innerHeight-rect.height-margin))};
    if(positionRef.current?.left===next.left&&positionRef.current?.top===next.top)return;
    positionRef.current=next;setPosition(next);
  }
  function startDrag(event:PointerEvent<HTMLElement>){
    if(!event.isPrimary||event.button!==0||(event.target as HTMLElement).closest('button'))return;
    const rect=ref.current!.getBoundingClientRect();
    event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
    drag.current={pointerId:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top};
  }
  function endDrag(event:PointerEvent<HTMLElement>){
    if(drag.current?.pointerId!==event.pointerId)return;
    drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  }
  useLayoutEffect(()=>{
    const constrain=()=>{const current=positionRef.current;if(current)move(current.left,current.top);};
    window.addEventListener('resize',constrain);
    const observer=new ResizeObserver(constrain);if(ref.current)observer.observe(ref.current);
    return()=>{window.removeEventListener('resize',constrain);observer.disconnect();drag.current=null;};
  },[]);
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
  return <dialog ref={ref} style={position?{left:position.left,top:position.top,right:'auto'}:undefined} aria-labelledby={label} aria-modal="false" onCancel={event=>{event.preventDefault();close.current();}} className="fixed top-16 right-4 bottom-auto left-auto z-40 m-0 h-auto max-h-[calc(100dvh-5rem)] w-[min(860px,calc(100vw-2rem))] max-w-none overflow-hidden rounded-xl border border-slate-200 bg-white p-0 text-slate-800 shadow-2xl">
    <div className="flex max-h-[inherit] min-h-0 flex-col"><header tabIndex={0} aria-label={`${title}标题栏，可拖动或使用方向键移动`} onPointerDown={startDrag} onPointerMove={event=>{const current=drag.current;if(current?.pointerId===event.pointerId)move(current.left+event.clientX-current.x,current.top+event.clientY-current.y);}} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={()=>{drag.current=null;}} onKeyDown={event=>{if(event.target!==event.currentTarget||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();const rect=ref.current!.getBoundingClientRect(),step=event.shiftKey?48:16;move(rect.left+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),rect.top+(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0));}} className="flex shrink-0 touch-none select-none items-center justify-between border-b border-slate-200 px-5 py-3 cursor-grab active:cursor-grabbing outline-none focus-visible:[&>h2]:underline focus-visible:[&>h2]:underline-offset-4"><h2 id={label} className="font-semibold">{title}</h2><Button variant="ghost" size="icon" type="button" aria-label={`关闭${title}`} onClick={onClose} ><X size={18}/></Button></header><div className={`flex min-h-0 flex-1 flex-col ${title==='会话检查'?'overflow-hidden':'overflow-auto'}`}>{children}</div></div>
  </dialog>;
}
