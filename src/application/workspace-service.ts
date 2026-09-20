import { DomainError, enumValue, optionalText, requiredText } from "@/domain/errors";
import type { WorkspaceRepositoryPort } from "@/application/ports/core";

export function createWorkspaceService(repository: WorkspaceRepositoryPort) {
  return {
    list: () => repository.list(),
    get(id: string) {
      const workspace = repository.get(id);
      if (!workspace) throw new DomainError("NOT_FOUND", "工作空间不存在", 404, true);
      return workspace;
    },
    create(body: Record<string, unknown>) {
      return repository.create({
        name: requiredText(body.name, "name", "工作空间名称"),
        description: optionalText(body.description),
      });
    },
    update(id: string, body: Record<string, unknown>) {
      if (!repository.get(id)) throw new DomainError("NOT_FOUND", "工作空间不存在", 404, true);
      return repository.update(id, {
        ...(body.name !== undefined
          ? { name: requiredText(body.name, "name", "工作空间名称") }
          : {}),
        ...(body.description !== undefined
          ? { description: optionalText(body.description) }
          : {}),
        ...(body.status !== undefined
          ? {
              status: enumValue(
                body.status,
                ["active", "archived"] as const,
                "status",
              ),
            }
          : {}),
      })!;
    },
    delete(id: string) {
      if (!repository.delete(id)) throw new DomainError("NOT_FOUND", "工作空间不存在", 404, true);
    },
  };
}
