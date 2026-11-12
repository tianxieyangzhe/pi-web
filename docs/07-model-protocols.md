# OpenAI / Google 协议与联网搜索参考

本文是协议选型参考，不新增模型或 API 契约。应用架构、持久事实、请求流程、页面、验收及 Workspace 仍分别以 `01`～`06` 为唯一权威；搜索实施契约见 `03` SEARCH-001，证据归属见 `02`，Workspace 引用 `06`。

## 1. 供应商与协议不同

Pi 的 `provider` 标识供应商，`api` 标识请求适配协议。模型名称不能决定协议，第三方网关可能将 Gemini 转为 OpenAI 协议。以当前会话由 Pi 解析后的 `model.api` 分派，不按 `gemini-*` 或供应商名称改写协议，也不修改用户 models.json。

当前 Pi 内置聊天协议共10种；本文仅覆盖 OpenAI、Google 两个协议族，不退役其他模型协议。

| 协议族 | Pi `api` | 接口 | 本次内置搜索适配 |
| --- | --- | --- | --- |
| OpenAI | `openai-completions` | Chat Completions；Google 官方也提供此兼容接口 | 不支持，不能直接加入 Responses 的 web_search；可明确选应用端工具搜索 |
| OpenAI | `openai-responses` | Responses；当前 Pi 的内置 xAI/Grok 也使用它 | 保留现有 `{type:"web_search"}` 注入；网关/型号是否接受由上游决定 |
| Google | `google-generative-ai` | Google 原生 GenerateContent / StreamGenerateContent | 在 Pi 的 Google SDK payload.config.tools 添加 `{googleSearch:{}}` |
| Google | `google-vertex` | Vertex AI 的 GenerateContent | 同上，认证、项目及位置继续交给 Pi |

`azure-openai-responses`、`openai-codex-responses` 是 Pi 的其他 OpenAI 专用适配类型，本次不扩展它们的内置搜索许可。其他协议仍返回 WEB_SEARCH_UNSUPPORTED，不静默改协议或降级为工具搜索。

## 2. Google 官方接口

- **GenerateContent**：原生接口，Google 仍支持；当前 Pi 的 `google-generative-ai` 调用 Google GenAI SDK 的 `models.generateContentStream`。
- **Interactions API**：Google 推荐的新原生接口，与 GenerateContent 不同；当前 Pi 没有独立的对应聊天协议，本次不新增 Pi adapter。
- **OpenAI compatibility**：官方示例使用 `chat/completions`，对应 Pi `openai-completions`。本次查阅的兼容文档未确认官方支持 OpenAI Responses；Gemini 经 Responses 网关接入不代表 Google 原生支持。
- **Vertex AI**：Google Cloud 接入方式，在 Pi 中有单独的 `google-vertex` 类型。

## 3. 搜索结构与证据

OpenAI Responses 使用 `tools:[{type:"web_search"}]`。Google GenerateContent 的 JavaScript SDK 使用 `config.tools:[{googleSearch:{}}]`；REST 文档使用 `tools:[{google_search:{}}]`。Pi 的 hook 接收到的是 SDK 参数，不是 REST 原始 JSON，因此本应用使用 camelCase，不能把 Google 参数加到 OpenAI payload 中。

Google Interactions 的 `tools:[{type:"google_search"}]` 不适用于当前 GenerateContent adapter。

保留原有编程工具、系统配置、thinking、abort signal及每轮生命周期。Google 返回 `candidates[].groundingMetadata`，包含查询、来源、引用关系和 Search Suggestions 等；携带此字段的原始流 chunk保存至所属 Pi 树。仅启用工具不等于模型实际搜索。Google 模型对内置工具与 function calling 组合的支持受型号限制；官方当前列出 Gemini 3/4 支持组合，旧型号或网关可能拒绝，不自动移除编程工具绕过。

原生来源完整保留，HTML证据作为原文而非可执行页面。Google Search 的显示及使用条款须在真实供应商与浏览器验收时核对，本次受控测试不证明生产使用、Search Suggestions 展示或引用质量已经验收。

## 4. 官方来源

本次实现前读取：

- [Google OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai)
- [Google GenerateContent](https://ai.google.dev/gemini-api/docs/text-generation?generate-content=true)
- [Google Interactions](https://ai.google.dev/gemini-api/docs/interactions)
- [Google Search grounding / GenerateContent](https://ai.google.dev/gemini-api/docs/google-search?generate-content=true)
- [Google tool combinations](https://ai.google.dev/gemini-api/docs/tool-combination)
- [OpenAI web search](https://platform.openai.com/docs/guides/tools-web-search)：本次抓取返回403，OpenAI分支沿用既有已记录契约，不宣称重新验证官网内容。

接口版本与型号能力以供应商最新文档及实际端点为准。本文不记录密钥、用户端点或会话运行句柄。
