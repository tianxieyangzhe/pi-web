"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: T;
  options: Array<SelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function choose(next: T) {
    onChange(next);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      setOpen((current) => !current || event.key.startsWith("Arrow"));
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        className="flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-left text-sm font-medium text-slate-700 shadow-sm outline-none transition hover:border-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onKeyDown}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? "请选择"}</span>
        <ChevronDown className={`size-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div id={listboxId} className="absolute z-[110] mt-1 max-h-60 w-full overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/15" role="listbox" aria-label={ariaLabel}>
        {options.map((option) => {
          const active = option.value === value;
          return <button key={option.value} type="button" role="option" aria-selected={active} disabled={option.disabled} className={`flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm transition ${active ? "bg-teal-50 font-semibold text-teal-800" : "text-slate-700 hover:bg-slate-100"} disabled:cursor-not-allowed disabled:opacity-50`} onClick={() => choose(option.value)}><span className="min-w-0 flex-1 truncate">{option.label}</span>{active && <Check className="size-4 shrink-0 text-teal-700" />}</button>;
        })}
      </div>}
    </div>
  );
}
