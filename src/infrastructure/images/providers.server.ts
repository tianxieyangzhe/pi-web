import {loadModelConfiguration,selectConfiguration} from "@/infrastructure/pi/model-config.server";
import { DomainError } from "@/domain/errors";
import {
  canonical,
  hash,
  imageError,
  object,
  type ImageProfile,
  type Parameter,
} from "@/domain/images";
import type { ImageProviders } from "@/application/ports/images";
// Register wire protocols and their versions; deployment supplies model IDs independently.
const definitions: Record<
  string,
  {
    provider: "openai" | "google";
    adapter: ImageProfile["adapter"];
    parameters: Parameter[];
  }
> = {
  "openai-images-v1/v1": {
    provider: "openai",
    adapter: "openai-images-v1",
    parameters: [
      {
        key: "size",
        type: "string",
        required: true,
        default: "1024x1024",
        enum: ["1024x1024", "1536x1024", "1024x1536"],
        description: "母图尺寸",
      },
      {
        key: "quality",
        type: "string",
        required: true,
        default: "auto",
        enum: ["auto", "low", "medium", "high"],
        description: "生成质量",
      },
      {
        key: "background",
        type: "string",
        required: true,
        default: "auto",
        enum: ["auto", "transparent", "opaque"],
        description: "母图背景",
      },
      {
        key: "n",
        type: "integer",
        required: true,
        default: 1,
        min: 1,
        max: 10,
        description: "生成母图数量",
      },
    ],
  },
  "google-generate-content-v1/v1": {
    provider: "google",
    adapter: "google-generate-content-v1",
    parameters: [],
  },
};
const normalizeBaseUrl = (value: string) => new URL(value).toString().replace(/\/$/, '');
export function createImageProviders(
  root: string,
  fetcher: typeof fetch = fetch,
  credential?: (profile: ImageProfile) => Promise<string>,
): ImageProviders {
  async function configuration() {
    try{
      const config=await loadModelConfiguration(root);
      const raw=selectConfiguration('models.json',root).value;
      const configuredOrder = Object.entries((raw.providers ?? {}) as Record<string, { models?: Array<{ id: string }> }>)
        .flatMap(([provider, config]) => (config.models ?? []).map(model => `${encodeURIComponent(provider)}/${encodeURIComponent(model.id)}`));
      const order = new Map(configuredOrder.map((id, index) => [id, index]));
      const profiles=config.imageModels.map(model=>{
        const registered=definitions[model.api+'/v1'];
        if(!registered)throw Error();
        const address=new URL(model.baseUrl);
        if(!['http:','https:'].includes(address.protocol)||address.username||address.password||address.search||address.hash)throw Error();
        const defaults=object(model.samplingParams??{});
        const providerConfig=(raw.providers as Record<string,any>|undefined)?.[model.provider];
        const configuredModel=providerConfig?.models?.find((entry:any)=>entry.id===model.id);
        const profile:ImageProfile={schemaVersion:1,id:encodeURIComponent(model.provider)+'/'+encodeURIComponent(model.id),provider:registered.provider,adapter:registered.adapter,modelId:model.id,credentialRef:model.provider,baseUrl:normalizeBaseUrl(model.baseUrl),capabilityVersion:'v1',timeoutMs:600000,defaults,parameters:registered.parameters,configHash:'',limits:{maxInputs:4,maxGeneratedImages:registered.provider==='openai'?10:1,maxInputBytes:20*1024*1024,maxInputPixels:40_960_000,maxOutputPixels:100_000_000,maxOutputs:32}};
        parameters(profile,defaults);
        profile.configHash=hash({...profile,headerReferences:{provider:providerConfig?.headers,model:configuredModel?.headers},authHeader:providerConfig?.authHeader});
        return profile;
      }).sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
      const selected=config.defaults?profiles.find(p=>p.credentialRef===config.defaults!.provider&&p.modelId===config.defaults!.modelId):null;
      return {profiles,defaultProfileId:selected?.id??(profiles.length===1?profiles[0].id:null),concurrency:1};
    }catch{return imageError('IMAGE_CONFIG_INVALID','models.json 图片模型配置无效',503);}
  }
  async function requestAuth(profile:ImageProfile){
    if(credential){const key=await credential(profile);return {apiKey:key,headers:{} as Record<string,string>};}
    try{
      const config=await loadModelConfiguration(root);
      const model=config.imageModels.find(m=>m.provider===profile.credentialRef&&m.id===profile.modelId&&m.api===profile.adapter);
      if(!model||normalizeBaseUrl(model.baseUrl)!==profile.baseUrl)throw Error();
      const auth=await config.runtime.getAuth(model);
      if(!auth?.auth.apiKey||/oauth/i.test(auth.source??''))throw Error();
      if(auth.auth.baseUrl&&normalizeBaseUrl(auth.auth.baseUrl)!==profile.baseUrl)throw Error();
      return {apiKey:auth.auth.apiKey,headers:auth.auth.headers??{}};
    }catch{return imageError('IMAGE_PROVIDER_UNAVAILABLE','图片模型认证不可用',503);}
  }
  function parameters(profile: ImageProfile, values: Record<string, unknown>) {
    object(values);
    const result: Record<string, unknown> = {};
    if (
      Object.keys(values).some(
        (key) => !profile.parameters.some((p) => p.key === key),
      )
    )
      throw new DomainError(
        "IMAGE_PARAMETERS_INVALID",
        "图片参数包含不支持的字段",
        422,
        true,
        Object.fromEntries(
          Object.keys(values)
            .filter((key) => !profile.parameters.some((p) => p.key === key))
            .map((key) => [key, ["不支持的参数"]]),
        ),
      );
    for (const p of profile.parameters) {
      const v = values[p.key] ?? profile.defaults[p.key] ?? p.default;
      if (v === undefined) {
        if (p.required)
          throw new DomainError(
            "IMAGE_PARAMETERS_INVALID",
            `缺少图片参数 ${p.key}`,
            422,
            true,
            { [p.key]: ["必填"] },
          );
        continue;
      }
      if (
        typeof v !== (p.type === "integer" ? "number" : p.type) ||
        (p.type === "integer" && !Number.isSafeInteger(v)) ||
        (p.enum && !p.enum.includes(v)) ||
        (p.min !== undefined && Number(v) < p.min) ||
        (p.max !== undefined && Number(v) > p.max)
      )
        throw new DomainError(
          "IMAGE_PARAMETERS_INVALID",
          `图片参数 ${p.key} 无效`,
          422,
          true,
          { [p.key]: ["类型、范围或枚举值无效"] },
        );
      result[p.key] = v;
    }
    return result;
  }
  return {
    configuration,
    parameters,
    async authorize(profile) {
      const current = (await configuration()).profiles.find(
        (p) => p.id === profile.id,
      );
      if (!current || current.configHash !== profile.configHash)
        imageError(
          "IMAGE_PROVIDER_UNAVAILABLE",
          "方案固定的图片配置已改变",
          503,
        );
      await requestAuth(profile);
    },
    async generate(profile, operation, prompt, params, inputs, signal) {
      const auth = await requestAuth(profile);
      const key=auth.apiKey;
      let url: string;
      let body: BodyInit;
      let headers: Record<string, string>;
      if (profile.provider === "openai") {
        url =
          (profile.baseUrl??"https://api.openai.com/v1") + "/images/" +
          (operation === "edit" ? "edits" : "generations");
        headers = { Authorization: "Bearer " + key, ...auth.headers };
        if (operation === "edit") {
          const form = new FormData();
          form.set("model", profile.modelId);
          form.set("prompt", prompt);
          for (const [k, v] of Object.entries(params)) form.set(k, String(v));
          inputs.forEach((i, index) =>
            form.append(
              "image[]",
              new Blob([new Uint8Array(i.bytes)], { type: i.mimeType }),
              `input-${index}.png`,
            ),
          );
          body = form;
        } else {
          if (inputs.length)
            imageError(
              "IMAGE_PARAMETERS_INVALID",
              "OpenAI 生成接口不接受参考图，请使用修改操作",
              422,
            );
          headers["Content-Type"] = "application/json";
          body = canonical({ model: profile.modelId, prompt, ...params });
        }
      } else {
        url = `${profile.baseUrl??"https://generativelanguage.googleapis.com/v1beta"}/models/${encodeURIComponent(profile.modelId)}:generateContent`;
        headers = { "x-goog-api-key": key, "Content-Type": "application/json", ...auth.headers };
        body = canonical({
          contents: [
            {
              role: "user",
              parts: [
                { text: prompt },
                ...inputs.map((i) => ({
                  inlineData: {
                    mimeType: i.mimeType,
                    data: Buffer.from(i.bytes).toString("base64"),
                  },
                })),
              ],
            },
          ],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        });
      }
      let response: Response;
      try {
        response = await fetcher(url, {
          method: "POST",
          headers,
          body,
          signal,
          redirect: "error",
        });
      } catch {
        return imageError(
          "IMAGE_PROVIDER_UNCERTAIN",
          "图片请求中断，可能已生成或计费",
          503,
        );
      }
      if (!response.ok) {
        const uncertain = response.status === 408 || response.status >= 500;
        const error = Object.assign(new Error(`图片供应商返回 HTTP ${response.status}`), {
          code: uncertain ? "IMAGE_PROVIDER_UNCERTAIN" : "IMAGE_PROVIDER_REJECTED",
          httpStatus: response.status,
          ...(!uncertain ? { providerRejected: true } : {}),
        });
        throw error;
      }
      const length = Number(response.headers.get("content-length"));
      if (length > 64 * 1024 * 1024)
        imageError("IMAGE_PROVIDER_UNCERTAIN", "图片响应超过容量上限", 503);
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader)
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 64 * 1024 * 1024) {
            void reader.cancel();
            imageError("IMAGE_PROVIDER_UNCERTAIN", "图片响应超过容量上限", 503);
          }
          chunks.push(value);
        }
      let result: Record<string, any>;
      try {
        result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return imageError("IMAGE_PROVIDER_UNCERTAIN", "图片响应无法解析", 503);
      }
      const images: Uint8Array[] =
        profile.provider === "openai"
          ? (result.data ?? [])
              .filter((i: any) => typeof i.b64_json === "string")
              .map((i: any) => Buffer.from(i.b64_json, "base64"))
          : (result.candidates ?? []).flatMap((c: any) =>
              (c.content?.parts ?? [])
                .filter(
                  (p: any) =>
                    p.inlineData?.data &&
                    String(p.inlineData.mimeType).startsWith("image/"),
                )
                .map((p: any) => Buffer.from(p.inlineData.data, "base64")),
            );
      if (
        !images.length ||
        images.length > profile.limits.maxGeneratedImages ||
        (profile.provider === "openai" &&
          images.length !== Number(params.n ?? 1))
      )
        imageError(
          "IMAGE_PROVIDER_UNCERTAIN",
          "供应商返回的母图数量不符合能力约束",
          503,
        );
      return {
        images,
        responseId:
          typeof result.responseId === "string" ? result.responseId : undefined,
      };
    },
  };
}
