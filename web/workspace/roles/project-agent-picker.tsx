import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { Agent } from "../../domain/models";

export function ProjectAgentPicker({ agents, selectedIds, onChange, emptyMessage }: {
  agents: Agent[];
  selectedIds: string[];
  onChange: (agentIds: string[]) => void;
  emptyMessage?: string;
}) {
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    listId = useId(),
    searchId = useId();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [placement, setPlacement] = useState<"above" | "below">("below");
  const filtered = agents.filter(agent => `${agent.name} ${agent.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())),
    selected = selectedIds.map(id => agents.find(agent => agent.id === id)).filter((agent): agent is Agent => !!agent),
    summary = selected[0]?.name ?? "搜索并选择 Agent";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setQuery("");
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function chooseAgent(agentId: string) {
    onChange(selectedIds.includes(agentId) ? [] : [agentId]);
    setOpen(false);
    setQuery("");
  }

  function toggleMenu() {
    if (open) {
      setOpen(false);
      setQuery("");
      return;
    }
    const triggerRect = trigger.current?.getBoundingClientRect(),
      scrollHost = root.current?.closest("dialog, .surface__body, .context-panel__body") as HTMLElement | null,
      hostRect = scrollHost?.getBoundingClientRect(),
      spaceBelow = triggerRect ? (hostRect?.bottom ?? window.innerHeight) - triggerRect.bottom : window.innerHeight,
      spaceAbove = triggerRect ? triggerRect.top - (hostRect?.top ?? 0) : 0;
    setPlacement(spaceBelow < 280 && spaceAbove > spaceBelow ? "above" : "below");
    setQuery("");
    setOpen(true);
  }

  return <div ref={root} className="project-agent-picker">
    <div className="project-agent-picker__heading"><span>绑定项目 Agent</span><small>单选</small></div>
    <div className="project-agent-picker__control">
      <button ref={trigger} type="button" className="project-agent-picker__trigger" aria-expanded={open} aria-controls={listId} disabled={agents.length === 0} onClick={toggleMenu}>
        <span className="project-agent-picker__trigger-text">{agents.length ? summary : "暂无可绑定的 Agent"}</span>
        <span className="project-agent-picker__count">{selectedIds.length}/{agents.length}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && <div id={listId} className={`project-agent-picker__menu project-agent-picker__menu--${placement}`}>
        <label className="project-agent-picker__search" htmlFor={searchId}><Search size={15} aria-hidden="true" /><input id={searchId} type="search" aria-label="搜索项目 Agent" placeholder="搜索 Agent 名称" autoFocus value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") event.preventDefault(); }} /></label>
        <div className="project-agent-picker__options" role="radiogroup" aria-label="项目 Agent">
          {filtered.map(agent => {
            const checked = selectedIds.includes(agent.id),
              status = agent.status === "active" ? "可用" : agent.status === "disabled" ? "停用 · 仅保留历史" : "已归档 · 仅保留历史";
            return <label className="project-agent-picker__option" key={agent.id}>
              <input type="radio" name={listId} checked={checked} disabled={agent.status !== "active" && !checked} onChange={() => chooseAgent(agent.id)} />
              <span><b>{agent.name}</b><small>v{agent.revision} · {status}</small></span>
            </label>;
          })}
          {filtered.length === 0 && <p className="project-agent-picker__empty">没有匹配的项目 Agent</p>}
        </div>
        <div className="project-agent-picker__footer"><span>{selected[0] ? `已选 ${selected[0].name}` : "未选择"}；筛选不会清除选择</span><button type="button" className="ui-button ui-button--secondary ui-button--small" onClick={() => { setOpen(false); setQuery(""); }}>完成</button></div>
      </div>}
    </div>
    <small className="project-agent-picker__hint">{agents.length ? "搜索并选择一个可供此 Bot 使用的项目角色。" : emptyMessage ?? "请先在角色列表创建项目 Agent。"}</small>
  </div>;
}
