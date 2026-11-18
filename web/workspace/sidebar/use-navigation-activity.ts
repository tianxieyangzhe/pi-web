import { useEffect, useState } from 'react';
import { subscribeApplicationResource } from '../../api/application-events';

/** Observe server activity without opening sessions or reading their histories. */
export function useNavigationActivity(projectIds: string[], workspaceIds: string[]) {
  const [activity, setActivity] = useState<Record<string, string[] | null>>({});
  const owners = JSON.stringify([...projectIds.map(id => `project:${id}`), ...workspaceIds.map(id => `workspace:${id}`)]);
  useEffect(() => subscribeApplicationResource<Record<string, string[]>>('navigation', setActivity, () => {
    setActivity(Object.fromEntries((JSON.parse(owners) as string[]).map(key => [key, null])));
  }), [owners]);
  return activity;
}
