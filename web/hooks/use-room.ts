import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import type { RoomContent, RoomEvent, RoomView } from "../domain/models";

type Activity = Extract<RoomEvent, { type: "activity" }>;

export function useRoom(roomId: string | null) {
  const [view, setView] = useState<RoomView | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [progress, setProgress] = useState("");
  const [response, setResponse] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!roomId) return;
    setView(await api.getRoom(roomId));
  }, [roomId]);

  useEffect(() => { void load().catch((cause) => setError(cause instanceof Error ? cause.message : "无法加载跨项目会话")); }, [load]);

  async function submit(request: string) {
    if (!roomId || running) return;
    setRunning(true); setProgress("请求已提交，正在启动"); setResponse(""); setActivities([]);
    try {
      for await (const event of api.submitRoomRun(roomId, request)) {
        if (event.type === "progress") setProgress(event.summary);
        if (event.type === "response_delta") setResponse((current) => current + event.text);
        if (event.type === "activity") setActivities((current) => {
          const index = current.findIndex((item) => item.id === event.id);
          if (index < 0) return [...current, event];
          const next = [...current]; next[index] = event; return next;
        });
        if (event.type === "run_state") setProgress(event.state);
        if (event.type === "error") {
          setError(event.message);
          setActivities((current) => current.map((activity) => activity.state === "running" ? { ...activity, state: "error" } : activity));
        }
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法提交跨项目请求");
      setActivities((current) => current.map((activity) => activity.state === "running" ? { ...activity, state: "error" } : activity));
    }
    finally { setRunning(false); setProgress(""); setResponse(""); }
  }

  async function approve(runId: string) {
    if (!roomId || running) return;
    setRunning(true); setActivities([]); setResponse("");
    try { for await (const event of api.approveRoomRun(roomId, runId)) { if (event.type === "progress") setProgress(event.summary); if (event.type === "response_delta") setResponse((current) => current + event.text); if (event.type === "activity") setActivities((current) => [...current.filter((item) => item.id !== event.id), event]); } await load(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法批准计划");
      setActivities((current) => current.map((activity) => activity.state === "running" ? { ...activity, state: "error" } : activity));
    }
    finally { setRunning(false); setProgress(""); setResponse(""); }
  }
  async function cancel(runId: string) { if (!roomId) return; try { await api.cancelRoomRun(roomId, runId); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法停止请求"); } }
  async function saveContent(id: string | null, body: Record<string, unknown>) { if (!roomId) return; try { id ? await api.updateRoomContent(roomId, id, body) : await api.createRoomContent(roomId, body); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法保存内容"); } }
  async function deleteContent(id: string) { if (!roomId) return; try { await api.deleteRoomContent(roomId, id); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : "无法删除内容"); } }

  return { view, activities, progress, response, running, error, setError, submit, approve, cancel, saveContent, deleteContent };
}
