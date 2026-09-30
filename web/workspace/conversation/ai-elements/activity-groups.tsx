import { BrainCircuit, CheckCircle2, ChevronDown, CircleAlert, LoaderCircle, Wrench } from "lucide-react";

export type VisibleActivity = {
  id: string;
  round?: number;
  source?: "router" | "session" | "direct" | "synthesizer";
  kind: "thinking" | "tool" | "context" | "execution";
  state: "running" | "completed" | "error";
  summary: string;
  detail?: string;
  projectName?: string;
};

function ActivityRows({ activities }: { activities: VisibleActivity[] }) {
  return <div className="activity-list">
    {activities.map((activity) => {
      const Icon = activity.state === "running" ? LoaderCircle : activity.state === "error" ? CircleAlert : CheckCircle2;
      const stateLabel = activity.state === "running" ? "运行中" : activity.state === "error" ? "失败" : "已完成";
      const stateStyle = activity.state === "running"
        ? "border-[#cfddf4] bg-[#f1f6ff] text-[#315d9f]"
        : activity.state === "error" ? "border-[#f2d9d9] bg-[#fff7f7] text-[#9a4d4d]" : "border-[#dce9df] bg-[#f2f8f3] text-[#39704d]";
      return <div className="activity-row" key={activity.id}>
        <Icon className={activity.state === "running" ? "spin" : ""} size={14} aria-hidden="true" />
        <span className="min-w-0 flex-1 break-words">
          {activity.summary}
          {activity.detail && <span className="mt-1 block text-xs leading-5 text-[#687386]">{activity.detail}</span>}
        </span>
        {activity.projectName && <span className="shrink-0 rounded-full border border-[#e1e8f2] bg-white px-2 py-0.5 text-[10px] text-[#63728a]">{activity.projectName}</span>}
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${stateStyle}`} aria-live="polite">{stateLabel}</span>
      </div>;
    })}
  </div>;
}

export function ActivityGroups({ activities, running = false, progress = "", history = false, roomTimeline = false }: { activities: VisibleActivity[]; running?: boolean; progress?: string; history?: boolean; roomTimeline?: boolean }) {
  if (roomTimeline) {
    const sources = [
      { id: "router", title: "路由过程", activities: activities.filter((activity) => activity.source === "router"), icon: <BrainCircuit size={14} aria-hidden="true" /> },
      { id: "session-thinking", title: "项目 Session 分析阶段", activities: activities.filter((activity) => activity.source === "session" && activity.kind === "thinking"), icon: <BrainCircuit size={14} aria-hidden="true" /> },
      { id: "session-execution", title: "项目 Session 执行过程", activities: activities.filter((activity) => activity.source === "session" && activity.kind !== "thinking"), icon: <Wrench size={14} aria-hidden="true" /> },
      { id: "direct", title: "直接回复过程", activities: activities.filter((activity) => activity.source === "direct"), icon: <BrainCircuit size={14} aria-hidden="true" /> },
      { id: "synthesizer", title: "汇总过程", activities: activities.filter((activity) => activity.source === "synthesizer"), icon: <Wrench size={14} aria-hidden="true" /> },
    ];
    const visibleSources = sources.filter((source) => source.activities.length > 0);

    return <div className="activity-groups grid gap-2" aria-live="polite">
      {visibleSources.map((source) => <section className="activity" key={source.id}>
        <div className="activity__heading">{source.icon}{source.title}</div>
        <ActivityRows activities={source.activities} />
      </section>)}
      {!visibleSources.length && (progress || running) && <section className="activity">
        <div className="activity__heading"><LoaderCircle size={14} aria-hidden="true" />请求进度</div>
        <div className="activity-row"><LoaderCircle className="spin" size={14} aria-hidden="true" /><span className="min-w-0 flex-1">{progress || "正在处理请求"}</span><span className="shrink-0 rounded-full border border-[#cfddf4] bg-[#f1f6ff] px-2 py-0.5 text-[10px] text-[#315d9f]">进行中</span></div>
      </section>}
    </div>;
  }

  const rounds = new Map<number, VisibleActivity[]>();
  for (const activity of activities) {
    const round = activity.round ?? 1;
    rounds.set(round, [...(rounds.get(round) ?? []), activity]);
  }
  return <div className="activity-groups grid gap-2" aria-live="polite">
    {[...rounds.entries()].sort(([left], [right]) => left - right).map(([round, roundActivities]) => {
      const thinking = roundActivities.filter((activity) => activity.kind === "thinking");
      const tools = roundActivities.filter((activity) => activity.kind === "tool");
      const otherExecution = roundActivities.filter((activity) => activity.kind !== "thinking" && activity.kind !== "tool");
      const roundRunning = roundActivities.some((activity) => activity.state === "running");
      const latestThinking = thinking.at(-1);
      const analysisLines = thinking.flatMap((activity) => activity.detail?.split("\n").filter(Boolean) ?? []);
      const summaryLines = analysisLines.length
        ? analysisLines
        : [roundRunning && running ? "等待 Pi 提供本轮公开思考摘要。" : "Pi 未提供可展示的公开思考摘要。"];
      const analysisState = latestThinking?.state ?? (roundRunning ? "running" : "completed");
      const analysisStateLabel = analysisState === "running" ? "分析中" : analysisState === "error" ? "异常" : "已完成";
      const analysisStateStyle = analysisState === "running"
        ? "border-[#cfddf4] bg-[#f1f6ff] text-[#315d9f]"
        : analysisState === "error" ? "border-[#f2d9d9] bg-[#fff7f7] text-[#9a4d4d]" : "border-[#dce9df] bg-[#f2f8f3] text-[#39704d]";
      const numberedTools = tools.map((activity, index) => ({
        ...activity,
        summary: `调用 ${index + 1} · ${activity.summary}`,
      }));
      return <details className="activity activity-round" key={round}>
        <summary className="activity__heading activity-round__summary">
          <span className="activity-round__title"><BrainCircuit size={14} aria-hidden="true" />Pi 模型第 {round} 轮</span>
          <span className="activity-round__meta">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] ${analysisStateStyle}`}>{analysisStateLabel}</span>
            <span className="activity-round__tool-count">{tools.length} 次工具调用</span>
            <ChevronDown className="activity-round__chevron" size={15} aria-hidden="true" />
          </span>
        </summary>
        <div className="activity-round__content">
          <div className="activity-row activity-row--label">思考摘要（模型公开的高层目标与方法，不含原始思维链）</div>
          <div className="activity-row"><span className="min-w-0 flex-1">{summaryLines.map((line, index) => <span className="block" key={`${round}-summary-${index}`}>{line}</span>)}</span></div>
          <div className="activity-row activity-row--label"><Wrench size={13} aria-hidden="true" />实际工具调用</div>
          {tools.length ? <ActivityRows activities={numberedTools} /> : <div className="activity-row">{roundRunning && running ? "本轮尚未触发工具调用。" : "本轮未调用工具。"}</div>}
          {otherExecution.length > 0 && <ActivityRows activities={otherExecution} />}
        </div>
      </details>;
    })}
    {!rounds.size && (running || progress || history) && <section className="activity">
      <div className="activity__heading"><LoaderCircle size={14} aria-hidden="true" />{history ? "Session 执行记录" : "Session 执行状态"}</div>
      <div className="activity-row">{history ? "Pi transcript 未提供可恢复的模型轮次记录。" : progress || "等待 Pi 模型轮次事件。"}</div>
    </section>}
  </div>;
}
