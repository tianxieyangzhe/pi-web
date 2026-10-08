import { DomainError } from "@/domain/errors";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export const workspaceModelProviderId = "workspace-openai";

type OpenAIModelEnvironment = {
  baseUrl: string;
  apiKey: string;
  modelId: string;
};

function readLocalEnvFile(): Record<string, string> {
  const filePath = path.join(process.cwd(), ".env.local");
  let source: string;
  try {
    source = readFileSync(filePath, "utf8");
  } catch {
    throw new DomainError(
      "MODEL_CONFIGURATION_ERROR",
      "缺少项目根目录 .env.local，无法读取模型配置",
      503,
      true,
    );
  }
  try {
    return parseEnv(source) as Record<string, string>;
  } catch {
    throw new DomainError(
      "MODEL_CONFIGURATION_ERROR",
      ".env.local 不是有效的环境变量文件",
      503,
      true,
    );
  }
}

function requiredEnvironment(
  values: Record<string, string>,
  name: "OPENAI_BASE_URL" | "OPENAI_API_KEY" | "OPENAI_MODEL_ID",
) {
  const value = values[name]?.trim();
  if (!value) {
    throw new DomainError(
      "MODEL_CONFIGURATION_ERROR",
      `缺少 .env.local 中的模型字段 ${name}`,
      503,
      true,
    );
  }
  return value;
}

export function readOpenAIModelEnvironment(): OpenAIModelEnvironment {
  const values = readLocalEnvFile();
  const baseUrl = requiredEnvironment(values, "OPENAI_BASE_URL");
  const apiKey = requiredEnvironment(values, "OPENAI_API_KEY");
  const modelId = requiredEnvironment(values, "OPENAI_MODEL_ID");
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
    if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) throw new Error();
    if (parsed.username || parsed.password) throw new Error();
  } catch {
    throw new DomainError(
      "MODEL_CONFIGURATION_ERROR",
      "OPENAI_BASE_URL 必须是无内嵌凭据的 HTTP(S) URL",
      503,
      true,
    );
  }
  return {
    baseUrl: parsed.toString().replace(/\/$/, ""),
    apiKey,
    modelId,
  };
}

export async function createOpenAIModelRuntime() {
  const environment = readOpenAIModelEnvironment();
  type ModelRuntimeOptions = NonNullable<Parameters<typeof ModelRuntime.create>[0]>;
  const credentials: NonNullable<ModelRuntimeOptions["credentials"]> = {
    async read() { return undefined; },
    async list() { return []; },
    async modify() { return undefined; },
    async delete() {},
  };
  const runtime = await ModelRuntime.create({
    credentials,
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const capacities=[...new Set(runtime.getModels().filter(item=>item.id===environment.modelId&&item.contextWindow>0).map(item=>item.contextWindow))];
  const knownContextWindow=capacities.length===1?capacities[0]:null;
  runtime.registerProvider(workspaceModelProviderId, {
    name: "Workspace OpenAI Compatible",
    baseUrl: environment.baseUrl,
    apiKey: environment.apiKey,
    api: "openai-completions",
    authHeader: true,
    models: [{
      id: environment.modelId,
      name: environment.modelId,
      api: "openai-completions",
      baseUrl: environment.baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: knownContextWindow ?? 128_000,
      maxTokens: 16_384,
    }],
  });
  const model = runtime.getModel(workspaceModelProviderId, environment.modelId);
  if (!model) {
    throw new DomainError(
      "MODEL_CONFIGURATION_ERROR",
      "无法注册 OPENAI_MODEL_ID 指定的模型",
      503,
      true,
    );
  }
  return { runtime, model, knownContextWindow };
}
