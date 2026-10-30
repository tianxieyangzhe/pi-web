import { isAbsolute, relative, resolve, sep } from "node:path";

export function safeToolTarget(toolName: string, args: unknown, workingDirectory: string): string | undefined {
  if (!["project_read", "project_list", "project_edit", "project_write"].includes(toolName)) return undefined;
  if (!args || typeof args !== "object") return undefined;
  if (!("path" in args) || typeof args.path !== "string") return toolName === "project_list" ? "目标：项目根目录" : undefined;
  const target = resolve(workingDirectory, args.path);
  const relativePath = relative(workingDirectory, target);
  if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) return undefined;
  const segments = relativePath.split(sep).filter(Boolean);
  const sensitiveSegment = /^(?:\.env(?:\.|$)|\.git$|\.ssh$|\.aws$|\.codex$|\.npmrc$|\.pypirc$|credentials?\.|id_(?:rsa|dsa|ecdsa|ed25519)|node_modules$)/i;
  if (segments.some(segment => sensitiveSegment.test(segment))) return undefined;
  return `目标：${segments.join("/") || "项目根目录"}`;
}
