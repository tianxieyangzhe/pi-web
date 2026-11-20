import { createHash } from "node:crypto";
import { DomainError } from "./errors";
export function imageError(code: string, message: string, status = 409): never {
  throw new DomainError(code, message, status, true);
}
export function object(
  value: unknown,
  keys?: string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    imageError("INVALID_INPUT", "需要 JSON 对象", 400);
  const record = value as Record<string, unknown>;
  if (keys && Object.keys(record).some((key) => !keys.includes(key)))
    imageError("INVALID_INPUT", "包含未知字段", 400);
  return record;
}
export function string(value: unknown, max = 20000): string {
  if (typeof value !== "string" || value.length > max)
    imageError("INVALID_INPUT", "文本字段无效", 400);
  return value;
}
export function integer(value: unknown, min: number, max: number): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < min ||
    Number(value) > max
  )
    imageError("INVALID_INPUT", "数值超出范围", 400);
  return Number(value);
}
export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return imageError("INVALID_INPUT", "JSON 值无效", 400);
}
export function hash(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function bytesHash(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
export type OutputSpec = {
  schemaVersion: 1;
  format: "png" | "jpeg" | "webp";
  fit: "contain" | "cover";
  background: string;
  targets: Array<{
    name: string;
    width: number;
    height: number;
    sourceIndex: number;
  }>;
  resample: "lanczos3";
  quality?: number;
};
export function validateOutput(value: unknown): OutputSpec {
  const v = object(value, [
    "schemaVersion",
    "format",
    "fit",
    "background",
    "targets",
    "resample",
    "quality",
  ]);
  if (
    v.schemaVersion !== 1 ||
    !["png", "jpeg", "webp"].includes(String(v.format)) ||
    !["contain", "cover"].includes(String(v.fit)) ||
    v.resample !== "lanczos3" ||
    typeof v.background !== "string" ||
    !/^(transparent|#[\da-fA-F]{6})$/.test(v.background)
  )
    imageError("IMAGE_PARAMETERS_INVALID", "输出规范无效", 422);
  if (
    (v.format === "jpeg" && v.background === "transparent") ||
    (v.format === "png" && v.quality !== undefined)
  )
    imageError(
      "IMAGE_PARAMETERS_INVALID",
      "输出格式与透明／质量参数不兼容",
      422,
    );
  if (v.quality !== undefined) integer(v.quality, 1, 100);
  if (!Array.isArray(v.targets) || !v.targets.length || v.targets.length > 32)
    imageError("IMAGE_PARAMETERS_INVALID", "输出数须为 1～32", 422);
  const names = new Set<string>();
  let pixels = 0;
  for (const entry of v.targets) {
    const t = object(entry, ["name", "width", "height", "sourceIndex"]);
    const name = string(t.name, 180);
    if (
      !/^[^/\\\x00-\x1f]+$/.test(name) ||
      name.includes("..") ||
      !name.endsWith("." + (v.format === "jpeg" ? "jpg" : v.format)) ||
      names.has(name)
    )
      imageError("IMAGE_PARAMETERS_INVALID", "输出文件名无效或重复", 422);
    names.add(name);
    pixels += integer(t.width, 1, 8192) * integer(t.height, 1, 8192);
    integer(t.sourceIndex, 0, 31);
  }
  if (pixels > 100_000_000)
    imageError("IMAGE_PARAMETERS_INVALID", "输出总像素超过一亿", 422);
  return v as OutputSpec;
}
export const logoOutput: OutputSpec = {
  schemaVersion: 1,
  format: "png",
  fit: "contain",
  background: "transparent",
  targets: [16, 20, 24, 32, 40, 48, 64, 128, 256].map((size) => ({
    name: `logo-${size}.png`,
    width: size,
    height: size,
    sourceIndex: 0,
  })),
  resample: "lanczos3",
};
export const imageOperations = {
  process: "原图尺寸导出或格式转换，使用原图为base，零图片模型请求",
  edit: "明确精修或重绘，至少一个base，遵守模型协议参数和输入限制",
  generate: "生成新图，不使用base，OpenAI不接受参考图",
};
export function validateDraftParameters(value: unknown) {
  const parameters = object(value, ["schemaVersion", "explicitParameters", "operation", "outputSpec", "inputMode"]);
  if (parameters.schemaVersion !== 1) imageError("INVALID_INPUT", "参数版本无效", 400);
  const explicitParameters = object(parameters.explicitParameters);
  if (parameters.inputMode !== undefined && !["separate", "joint"].includes(String(parameters.inputMode))) imageError("INVALID_INPUT", "图片处理方式无效", 400);
  if (parameters.operation !== undefined && !Object.hasOwn(imageOperations, string(parameters.operation)))
    imageError("IMAGE_PARAMETERS_INVALID", "指定的图片操作无效", 422);
  if (parameters.operation === "process" && Object.keys(explicitParameters).length)
    imageError("IMAGE_PARAMETERS_INVALID", "精确处理不使用图片生成参数", 422);
  return {
    schemaVersion: 1,
    explicitParameters,
    ...(parameters.operation !== undefined ? { operation: parameters.operation } : {}),
    ...(parameters.inputMode !== undefined ? { inputMode: parameters.inputMode } : {}),
    ...(parameters.outputSpec !== undefined ? { outputSpec: validateOutput(parameters.outputSpec) } : {}),
  };
}
export type ImageInput = {
  assetId: string;
  purpose: "reference" | "base";
  position: number;
};
export type PlanInput = {
  operation: "generate" | "edit" | "process";
  intent: string;
  preserve: string;
  prompt: string;
  profileId: string | null;
  parameters: Record<string, unknown>;
  inputs: ImageInput[];
  outputSpec: OutputSpec;
  outputRoots?: Array<{rootAssetId: string | null}>;
  inputMode?: "separate" | "joint";
};
export function validatePlan(value: unknown): PlanInput {
  const fields = ["operation", "intent", "preserve", "prompt", "profileId", "parameters", "inputs", "outputSpec"];
  const v = object(value);
  const unknown = Object.keys(v).find(key => !fields.includes(key) && key !== "outputRoots" && key !== "inputMode");
  if (unknown) imageError("INVALID_INPUT", `方案包含未知字段 ${unknown}`, 400);
  const missing = fields.find(key => !Object.hasOwn(v, key));
  if (missing) imageError("IMAGE_PARAMETERS_INVALID", `方案缺少 ${missing}`, 422);
  if (!Object.hasOwn(imageOperations, String(v.operation)))
    imageError("IMAGE_PARAMETERS_INVALID", "operation 必须是 generate、edit 或 process", 422);
  for (const field of ["intent", "preserve", "prompt"]) {
    if (typeof v[field] !== "string" || v[field].length > 20000)
      imageError("INVALID_INPUT", `${field} 必须是长度不超过 20000 的字符串`, 400);
  }
  if (v.profileId !== null && (typeof v.profileId !== "string" || v.profileId.length > 200))
    imageError("INVALID_INPUT", "profileId 必须是模型标识或 null", 400);
  if (!v.parameters || typeof v.parameters !== "object" || Array.isArray(v.parameters))
    imageError("INVALID_INPUT", "parameters 必须是 JSON 对象", 400);
  if (!Array.isArray(v.inputs) || v.inputs.length > 4)
    imageError("IMAGE_PARAMETERS_INVALID", "inputs 必须是最多四项的数组", 422);
  const seen = new Set<string>();
  v.inputs.forEach((entry, index) => {
    const i = object(entry, ["assetId", "purpose", "position"]);
    string(i.assetId, 100);
    if (
      i.position !== index ||
      !["reference", "base"].includes(String(i.purpose)) ||
      seen.has(String(i.assetId))
    )
      imageError("IMAGE_PARAMETERS_INVALID", "输入用途、顺序或身份无效", 422);
    seen.add(String(i.assetId));
  });
  const bases = v.inputs.filter((i) => i.purpose === "base").length;
  if (
    (v.operation === "generate" && bases) ||
    (v.operation !== "generate" && !bases) ||
    (v.operation === "process" &&
      (v.inputs.some((i) => i.purpose !== "base") ||
        v.profileId !== null ||
        v.prompt !== "" ||
        Object.keys(object(v.parameters)).length))
  )
    imageError("IMAGE_PARAMETERS_INVALID", "输入用途与操作不兼容", 422);
  let outputSpec: OutputSpec;
  try { outputSpec = validateOutput(v.outputSpec); }
  catch (error) {
    if (error instanceof DomainError) imageError(error.code, `outputSpec：${error.message}`, error.status);
    throw error;
  }
  if (
    v.operation === "process" &&
    outputSpec.targets.some((t) => t.sourceIndex >= bases)
  )
    imageError("IMAGE_PARAMETERS_INVALID", "输出源图序号无效", 422);
  if (v.inputMode !== undefined && !["separate", "joint"].includes(String(v.inputMode))) imageError("INVALID_INPUT", "图片处理方式无效", 400);
  if (v.outputRoots !== undefined) {
    if (!Array.isArray(v.outputRoots) || v.outputRoots.length !== outputSpec.targets.length) imageError("IMAGE_TARGET_AMBIGUOUS", "outputRoots 必须与输出一一对应", 422);
    for (const entry of v.outputRoots) {
      const root = object(entry, ["rootAssetId"]);
      if (root.rootAssetId !== null) string(root.rootAssetId, 100);
    }
  }
  return { ...v, outputSpec } as PlanInput;
}
export type AutoLimits = {
  maxImageRequests: number;
  maxGeneratedImages: number;
  maxOutputs: number;
};
export function validateLimits(value: unknown): AutoLimits {
  const v = object(value, [
    "maxImageRequests",
    "maxGeneratedImages",
    "maxOutputs",
  ]);
  integer(v.maxImageRequests, 0, 10);
  integer(v.maxGeneratedImages, 0, 32);
  integer(v.maxOutputs, 1, 32);
  return v as AutoLimits;
}
export type NativeImageRef = {
  kind: "pi";
  sessionFile: string;
  sessionId: string;
  cwd: string;
};
export type ImageProfile = {
  schemaVersion: 1;
  id: string;
  provider: "openai" | "google";
  adapter: "openai-images-v1" | "google-generate-content-v1";
  modelId: string;
  capabilityVersion: string;
  configHash: string;
  timeoutMs: number;
  credentialRef: string;
  baseUrl?: string;
  parameters: Parameter[];
  limits: {
    maxInputs: number;
    maxGeneratedImages: number;
    maxInputBytes: number;
    maxInputPixels: number;
    maxOutputPixels: number;
    maxOutputs: number;
  };
  defaults: Record<string, unknown>;
};
export type Parameter = {
  key: string;
  type: "string" | "integer" | "number" | "boolean";
  required: boolean;
  default?: unknown;
  enum?: unknown[];
  min?: number;
  max?: number;
  description: string;
};
export type StoredRow = Record<string, any>;

export function isImageAssetDeleted(asset: StoredRow) {
  return Boolean(asset.deleted_at || (asset.role === "reference" && asset.cleanup_state && asset.cleanup_state !== "none"));
}
