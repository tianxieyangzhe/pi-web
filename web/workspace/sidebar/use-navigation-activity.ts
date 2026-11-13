import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { workspaceApi } from '../../api/workspace-client';

/** Navigation observes execution without opening sessions or extending their leases. */
export function useNavigationActivity(projectIds: string[], workspaceIds: string[]) {
  const [activity, setActivity] = useState<Record<string, string[] | null>>({});
  const owners = JSON.stringify([projectIds, workspaceIds]);
  useEffect(() => {
    const [projects, workspaces] = JSON.parse(owners) as [string[], string[]];
    let disposed = false, pending = false;
    async function refresh() {
      if (disposed || pending || document.hidden) return;
      pending = true;
      try {
        await Promise.allSettled([
          ...projects.map(async id => {
            const key = `project:${id}`;
            try {
              const sessions = await api.listSessions(id);
              if (!disposed) setActivity(current => ({ ...current, [key]: sessions.filter(s => s.allowedActions.interrupt.allowed).map(s => s.id) }));
            } catch { if (!disposed) setActivity(current => ({ ...current, [key]: null })); }
          }),
          ...workspaces.map(async id => {
            const key = `workspace:${id}`;
            try {
              const sessions = await workspaceApi.sessions(id);
              if (!disposed) setActivity(current => ({ ...current, [key]: sessions.filter(s => s.allowedActions.includes('interrupt')).map(s => s.id) }));
            } catch { if (!disposed) setActivity(current => ({ ...current, [key]: null })); }
          }),
        ]);
      } finally { pending = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    const onVisible = () => { void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { disposed = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [owners]);
  return activity;
}
