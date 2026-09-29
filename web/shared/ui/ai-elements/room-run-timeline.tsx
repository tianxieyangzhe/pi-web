import type { Project, RoomEvent, RoomRun, Task } from "../../../domain/models";
import { ActivityGroups } from "./activity-groups";
import { Response } from "./response";

type Activity = Extract<RoomEvent, { type: "activity" }>;

export function RoomRunTimeline({ runs, tasks, activities, progress, response, running, projects, onApprove, onCancel, pendingTasks }: { runs: RoomRun[]; tasks: Task[]; activities: Activity[]; progress: string; response: string; running: boolean; projects: Project[]; onApprove?: (id: string) => void; onCancel?: (id: string) => void; pendingTasks?: Task[] }) {
  const visibleActivities = activities.map((activity) => ({
    ...activity,
    projectName: activity.projectId ? projects.find((project) => project.id === activity.projectId)?.name : undefined,
  }));
  return <div className="conversation">
    {[...runs].reverse().map((run) => <article className="run-card" key={run.id}><div className="message message--user"><div className="message__role">你</div><div className="message__content">{run.requestText}</div></div><div className="run-card__body"><div className="message__role">AI 工作区 · {run.state}{run.route ? ` · ${run.route}` : ""}</div>{tasks.filter((task) => task.runId === run.id).map((task) => <div className="task-card" key={task.id}><div className="task-card__heading"><b>{task.instruction}</b>{["running", "queued"].includes(task.state) && <button onClick={() => onCancel?.(run.id)}>取消</button>}</div><span>{task.state}</span>{task.result && <p>{task.result.summary}</p>}</div>)}{run.finalResponse && <div className="message__content"><Response>{run.finalResponse}</Response></div>}</div></article>)}
    {pendingTasks && pendingTasks.length > 0 && <section className="review-panel"><b>待审查任务</b>{pendingTasks.map((task) => <div className="review-row" key={task.id}><span><strong>{task.instruction}</strong><small>{task.operation} · {task.risk} · 验收：{task.acceptance.join("；")}</small></span><button onClick={() => onApprove?.(task.runId)}>批准并执行</button></div>)}</section>}
    <ActivityGroups activities={visibleActivities} running={running} progress={progress} roomTimeline />
    {response && <article className="message message--assistant"><div className="message__role">AI 工作区</div><div className="message__content"><Response>{response}</Response></div></article>}
  </div>;
}
