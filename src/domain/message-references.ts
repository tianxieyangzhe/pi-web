import { DomainError } from "./errors";

export type ProjectMessageReference = { projectId: string; path: string };
export type BotMessageReference = { source: "bot"; path: string };
export type MessageReference = { name: string; data: string } | ProjectMessageReference | BotMessageReference;
export type ReferenceContent = Array<{ type: "text"; text: string; referenceName?: string } | { type: "image"; data: string; mimeType: string }>;

export function referenceNames(references?: readonly MessageReference[]): string[] {
  return (references ?? []).map(item => "name" in item ? item.name : item.path.split(/[\\/]/).at(-1) ?? "").filter(Boolean);
}

export function parseMessageReferences(value: unknown, allowedProjectIds: ReadonlySet<string> = new Set(), readProject?: (reference: ProjectMessageReference) => { name: string; data: string }, readBot?: (reference: BotMessageReference) => { name: string; data: string }): ReferenceContent {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) throw new DomainError("INVALID_REFERENCES", "参考文件最多选择 10 个", 400, true);
  const content: ReferenceContent = [];
  let total = 0;
  const seen = new Set<string>();
  for (const original of value) {
    let item = original;
    if (item && typeof item === "object" && !Array.isArray(item) && ("projectId" in item || "path" in item)) {
      const isBot = item.source === "bot" && Object.keys(item).every(key => key === "source" || key === "path");
      const isProject = typeof item.projectId === "string" && Object.keys(item).every(key => key === "projectId" || key === "path");
      if ((!isBot && !isProject) || typeof item.path !== "string" || !item.path || item.path.length > 4096) throw new DomainError("INVALID_REFERENCES", "参考文件格式无效", 400, true);
      if (isBot && !readBot || isProject && !allowedProjectIds.has(item.projectId)) throw new DomainError("REFERENCE_OUTSIDE_SCOPE", "参考文件不属于当前会话范围", 403, true);
      const key = JSON.stringify([isBot ? ["bot"] : ["project", item.projectId], item.path]);
      if (seen.has(key)) throw new DomainError("INVALID_REFERENCES", "不能重复选择参考文件", 400, true);
      seen.add(key);
      if (isBot) item = readBot!({source:"bot",path:item.path});
      else {
        if (!readProject) throw new DomainError("REFERENCE_UNAVAILABLE", "项目参考文件暂不可用", 503, true);
        item = readProject({projectId:item.projectId,path:item.path});
      }
    }
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.name !== "string" || !item.name || item.name.length > 255 || /[\\/\x00-\x1f\x7f]/.test(item.name) || typeof item.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.data)) throw new DomainError("INVALID_REFERENCES", "参考文件格式无效", 400, true);
    if (item.data.length > Math.ceil(2 * 1024 * 1024 / 3) * 4) throw new DomainError("FILE_TOO_LARGE", "参考文件超过容量限制", 413, true);
    const buffer = Buffer.from(item.data, "base64");
    if (buffer.toString("base64") !== item.data) throw new DomainError("INVALID_REFERENCES", "参考文件编码无效", 400, true);
    total += buffer.length;
    if (buffer.length > 2 * 1024 * 1024 || total > 8 * 1024 * 1024) throw new DomainError("FILE_TOO_LARGE", "参考文件超过容量限制", 413, true);
    const mime = buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
      : buffer.subarray(0,3).equals(Buffer.from([255,216,255])) ? "image/jpeg"
      : ["GIF87a","GIF89a"].includes(buffer.subarray(0,6).toString("ascii")) ? "image/gif"
      : buffer.subarray(0,4).toString("ascii") === "RIFF" && buffer.subarray(8,12).toString("ascii") === "WEBP" ? "image/webp" : null;
    const name = JSON.stringify(item.name);
    if (mime) { content.push({type:"text",text:`参考图片 ${name}`,referenceName:item.name},{type:"image",data:item.data,mimeType:mime}); continue; }
    if (buffer.includes(0)) throw new DomainError("BINARY_FILE", "只支持 UTF-8 文本和 PNG、JPEG、GIF、WebP 图片", 415, true);
    let text: string;
    try { text = new TextDecoder("utf-8", {fatal:true}).decode(buffer); } catch { throw new DomainError("BINARY_FILE", "参考文本必须为 UTF-8", 415, true); }
    content.push({type:"text",text:`参考文本 ${name}\n${text}`,referenceName:item.name});
  }
  return content;
}
