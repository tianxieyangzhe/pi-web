"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

type DialogFormProps = {
  eyebrow?: string;
  title: string;
  children: ReactNode;
  submitLabel?: string;
  dangerAction?: { label: string; onClick: () => void };
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function DialogForm({
  eyebrow = "CONFIGURATION",
  title,
  children,
  submitLabel = "保存",
  dangerAction,
  onClose,
  onSubmit,
}: DialogFormProps) {
  const titleId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const form = formRef.current;
    const first = form?.querySelector<HTMLElement>("[autofocus], input, textarea, select, button");
    first?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previousFocus?.focus();
    };
  }, [onClose]);

  function trapFocus(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/40 p-5 backdrop-blur-sm" onMouseDown={onClose}>
      <form
        ref={formRef}
        className="max-h-[calc(100vh-40px)] w-full max-w-[540px] overflow-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-950/20"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={onSubmit}
        onKeyDown={trapFocus}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="mb-4 flex items-start justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{eyebrow}</span>
            <h2 className="mt-1 text-lg font-bold text-slate-900" id={titleId}>{title}</h2>
          </div>
          <button type="button" className="grid size-[34px] place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="关闭" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        {children}
        <footer className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
          {dangerAction && <button type="button" className="mr-auto min-h-9 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700" onClick={dangerAction.onClick}>{dangerAction.label}</button>}
          <button type="button" className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50" onClick={onClose}>取消</button>
          <button type="submit" className="min-h-9 rounded-lg bg-teal-700 px-3 text-xs font-bold text-white hover:bg-teal-800">{submitLabel}</button>
        </footer>
      </form>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "确认删除",
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <DialogForm
      eyebrow="CONFIRMATION"
      title={title}
      submitLabel={confirmLabel}
      onClose={onClose}
      onSubmit={(event) => { event.preventDefault(); onConfirm(); }}
    >
      <p className="my-1 text-sm leading-6 text-slate-600">{body}</p>
    </DialogForm>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="mb-3 grid min-w-0 gap-1.5 text-[11px] font-bold text-slate-600 [&_input:not([type=checkbox])]:w-full [&_input:not([type=checkbox])]:rounded-lg [&_input:not([type=checkbox])]:border [&_input:not([type=checkbox])]:border-slate-300 [&_input:not([type=checkbox])]:px-3 [&_input:not([type=checkbox])]:py-2 [&_input:not([type=checkbox])]:outline-none [&_input:not([type=checkbox]):focus]:border-teal-600 [&_input:not([type=checkbox]):focus]:ring-2 [&_input:not([type=checkbox])]:ring-teal-100 [&_select]:w-full [&_select]:rounded-lg [&_select]:border [&_select]:border-slate-300 [&_select]:px-3 [&_select]:py-2 [&_select]:outline-none [&_textarea]:w-full [&_textarea]:rounded-lg [&_textarea]:border [&_textarea]:border-slate-300 [&_textarea]:px-3 [&_textarea]:py-2 [&_textarea]:outline-none [&_textarea:focus]:border-teal-600 [&_textarea:focus]:ring-2 [&_textarea:focus]:ring-teal-100">
      <span>{label}</span>
      {children}
      {hint && <small className="text-[10px] font-normal text-slate-400">{hint}</small>}
    </label>
  );
}
