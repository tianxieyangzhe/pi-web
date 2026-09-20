"use client";

import type { KeyboardEvent } from "react";

export type TabOption<T extends string> = { id: T; label: string };

export function HorizontalTabs<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  options: Array<TabOption<T>>;
  label: string;
  onChange: (value: T) => void;
}) {
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>) {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const tabs = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>(
      'button[role="tab"]',
    )];
    const current = tabs.indexOf(event.currentTarget);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const tab = tabs[next];
    tab.focus();
    tab.click();
  }

  return (
    <div className="flex shrink-0 overflow-x-auto border-b border-slate-200 bg-white px-2" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={value === option.id}
          tabIndex={value === option.id ? 0 : -1}
          className={`min-w-max border-b-2 px-2.5 py-3 text-[11px] ${value === option.id ? "border-teal-700 font-bold text-teal-800" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          onClick={() => onChange(option.id)}
          onKeyDown={moveFocus}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
