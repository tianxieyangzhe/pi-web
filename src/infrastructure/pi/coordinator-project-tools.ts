export const PROJECT_EXISTENCE_DESCRIPTION = "只用于感知当前协调会话范围内的一个项目存在。返回数据库已保存的项目信息。不要读取项目，不要写入项目，不要搜索、测试或运行项目。";

export type CoordinatorProjectRecord = {
  id: string;
  name: string;
  description: string | null;
  kind: "code" | "knowledge" | "general";
  rootPath: string;
  status: "active" | "disabled" | "archived";
  createdAt: string;
  updatedAt: string;
};

export function coordinatorProjectToolName(projectId: string): string {
  const suffix = projectId.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  if (!suffix) throw new Error("项目 ID 不能生成存在性工具名");
  return `bot_project_${suffix}`;
}

export function coordinatorProjectPresenceTools(projects: readonly CoordinatorProjectRecord[]) {
  const seen = new Set<string>();
  return projects.map(project => {
    const name = coordinatorProjectToolName(project.id);
    if (seen.has(name)) throw new Error("项目存在性工具名冲突");
    seen.add(name);
    const record = {
      id: project.id,
      name: project.name,
      description: project.description,
      kind: project.kind,
      rootPath: project.rootPath,
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    return {
      name,
      description: PROJECT_EXISTENCE_DESCRIPTION,
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      execute: async () => ({ exists: true, source: "database", project: record }),
    };
  });
}
