import type Database from 'better-sqlite3';

/** Lightweight ownership and activity projection; never reads Pi files or previews. */
export function createApplicationEventQueries(database: Database.Database) {
  return {
    navigation(projectRunning: (id:string) => boolean, workspaceRunning: (id:string) => boolean) {
      const activity: Record<string, string[]> = {};
      for (const row of database.prepare('SELECT id FROM projects').all() as {id:string}[]) activity[`project:${row.id}`] = [];
      for (const row of database.prepare('SELECT id FROM workspaces').all() as {id:string}[]) activity[`workspace:${row.id}`] = [];
      for (const row of database.prepare('SELECT id,project_id FROM sessions').all() as {id:string;project_id:string}[]) if (projectRunning(row.id)) activity[`project:${row.project_id}`]?.push(row.id);
      for (const row of database.prepare('SELECT id,workspace_id FROM workspace_sessions').all() as {id:string;workspace_id:string}[]) if (workspaceRunning(row.id)) activity[`workspace:${row.workspace_id}`]?.push(row.id);
      return activity;
    },
    ownsSession(kind:'projects'|'workspaces',ownerId:string,sessionId:string) {
      return !!database.prepare(kind === 'projects' ? 'SELECT 1 FROM sessions WHERE id=? AND project_id=?' : 'SELECT 1 FROM workspace_sessions WHERE id=? AND workspace_id=?').get(sessionId,ownerId);
    },
  };
}
