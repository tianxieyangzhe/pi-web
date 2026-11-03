import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type Props = { message?: string | null; onDismiss?: () => void; onRetry?: () => void };

export function ErrorToast(props: Props) {
  return props.message ? <ErrorBubble key={props.message} {...props} message={props.message} /> : null;
}

function ErrorBubble({ message, onDismiss, onRetry }: Props & { message: string }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted || !visible) return null;
  return createPortal(
    <div role="alert" className="fixed right-3 bottom-4 z-[100] flex max-h-[50dvh] w-[calc(100vw-24px)] max-w-sm items-start gap-3 overflow-y-auto rounded-xl border border-red-200 bg-white px-4 py-3 text-sm text-zinc-800 shadow-lg sm:right-5">
      <div className="min-w-0 flex-1">
        <p className="m-0 whitespace-pre-wrap break-words">{message}</p>
        {onRetry && <button type="button" className="mt-2 text-xs font-medium text-red-700 underline underline-offset-2" onClick={onRetry}>重试</button>}
      </div>
      <button type="button" aria-label="关闭错误提示" className="shrink-0 rounded p-1 text-zinc-500 hover:bg-zinc-100" onClick={() => { setVisible(false); onDismiss?.(); }}><X size={16} /></button>
    </div>, document.body,
  );
}
