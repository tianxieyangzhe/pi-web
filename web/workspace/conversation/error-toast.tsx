import {Button} from '../../components/button';
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type Props = { message?: string | null; onDismiss?: () => void; onRetry?: () => void };

export function ErrorToast(props: Props) {
  return props.message ? <ErrorBubble key={props.message} {...props} message={props.message} /> : null;
}

function ErrorBubble({ message, onDismiss, onRetry }: Props & { message: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(true);
  // A modal dialog is in the browser top layer; its notices must stay in that layer.
  useEffect(() => { setContainer(anchor.current?.closest('dialog') ?? document.body); }, []);
  return <><span ref={anchor} hidden />{container && visible && createPortal(
    <div role="alert" className="fixed left-1/2 top-4 -translate-x-1/2 z-[100] flex max-h-[50dvh] w-[calc(100vw-24px)] max-w-sm items-start gap-3 overflow-y-auto rounded-xl border border-red-200 bg-white px-4 py-3 text-sm text-zinc-800 shadow-lg">
      <div className="min-w-0 flex-1">
        <p className="m-0 whitespace-pre-wrap break-words">{message}</p>
        {onRetry && <Button type="button" className="mt-2" onClick={onRetry}>重试</Button>}
      </div>
      <Button variant="ghost" size="icon" type="button" aria-label="关闭错误提示"  onClick={() => { setVisible(false); onDismiss?.(); }}><X size={16} /></Button>
    </div>, container,
  )}</>;
}
