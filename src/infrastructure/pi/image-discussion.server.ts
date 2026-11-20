import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import {
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  getAgentDir,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { createPersistentAgentSession } from "./create-session.server";
import {
  loadModelConfiguration,
  resolveSessionModel,
} from "./model-config.server";
import { readNativeFile, readTreeFile } from "./session-tree.server";
import {
  canonical,
  imageError,
  type NativeImageRef,
  type StoredRow as Row,
} from "@/domain/images";
import type { ImageDiscussion } from "@/application/ports/images";
const instructions = `你是图片工作台里的对话助手，帮助用户讨论图片细节、解释疑问，并在用户明确要求时生成、修改或导出图片。每轮先判断用户是在讨论还是要求实际执行。解释、比较方案、询问效果、讨论颜色或尺寸、澄清要求时，只回答，不生成图片。上传图片、选择模型、调整参数和历史上生成过图片均不代表本轮要求执行；意图不清时先询问。只有“请生成”“改成蓝色”“导出这些尺寸”等明确操作要求才执行。
只返回一个 JSON 对象，不加 Markdown 代码围栏。讨论返回 {"action":"discuss","reply":"面向用户的自然语言答复，可使用 Markdown"}，不要包含 plan。执行返回 {"action":"execute","reply":"简短说明将进行的操作，不声称已经成功","plan":{...}}。reply 必须非空。plan 字段必须齐全：operation(generate/edit/process)、intent、preserve(字符串)、prompt、profileId、parameters、inputs[{assetId,purpose:base/reference,position}]、outputSpec{schemaVersion:1,format:png/jpeg/webp,fit:contain/cover,background:transparent或#RRGGBB,targets:[{name,width,height,sourceIndex}],resample:lanczos3,quality?}。使用本轮 image-input 提供的有序参考图、模型能力、输出限制和用户约束，补齐未指定字段。输入位置从0连续，sourceIndex从0开始。纯尺寸导出、格式转换或保持原样用 process（全部输入为base，profileId=null，prompt为空，parameters={}）；明确精修或重绘用 edit；新图用 generate（OpenAI生成接口不收参考图）。结合原生历史及 planning.currentPlan 理解后续要求，未要求改变的内容保持。只使用本轮选中的参考，不能从历史自动恢复用户已取消的图片。plan 的 inputMode 使用 separate（逐张修改）或 joint（共同参考）。多张分别修改时，每张单独调用图片模型，n 表示每张的生成数，输出 sourceIndex 按输入顺序及每张生成顺序连续编号；不能把多张待修改图合成一张。用户设置 inputMode 时必须保留。意图有歧义则先询问。plan 增加 outputRoots 数组，与输出 targets 等长，每项为 {rootAssetId:string|null}；根据 planning.images 中的原图身份指定输出归属，分别修改归属各自原图，共同参考生成新图使用 null，不猜测身份。不要让用户操作方案、手动确认执行或重新上传已提供图片。实际图片工作及结果由应用处理。`;
function guardRecovery(session: AgentSession) {
  // Pi 1.5 has an overflow/length compact-and-retry path independent of retry.enabled.
  // Fail closed if this version-specific hook changes; threshold compaction stays enabled.
  const target = session as unknown as {
    _runAutoCompaction?: (
      reason: string,
      willRetry: boolean,
    ) => Promise<boolean>;
  };
  const original = target._runAutoCompaction;
  if (typeof original !== "function")
    imageError("MODEL_UNAVAILABLE", "当前 Pi 版本无法保证禁止隐式重发", 503);
  target._runAutoCompaction = async function (reason, willRetry) {
    if (willRetry)
      imageError(
        "IMAGE_DISCUSSION_FAILED",
        "讨论需要重新发送失败请求，本轮已结束",
        503,
      );
    return original.call(session, reason, false);
  };
}
export function createImageDiscussion(
  root: string,
  configure = loadModelConfiguration,
  createSession = createPersistentAgentSession,
): ImageDiscussion {
  const cwd = path.join(root, "images");
  function manager(ref: NativeImageRef) {
    try {
      if (
        ref.kind !== "pi" ||
        ref.cwd !== cwd ||
        !ref.sessionFile.startsWith(
          path.join(root, ".data", "image-sessions") + path.sep,
        )
      )
        throw Error();
      readNativeFile(ref.sessionFile, ref.cwd, ref.sessionId);
      return SessionManager.open(ref.sessionFile, undefined, ref.cwd);
    } catch {
      return imageError("IMAGE_HISTORY_UNAVAILABLE", "图片讨论历史不可用");
    }
  }
  function baseline(m: SessionManager) {
    return {
      schemaVersion: 1,
      nativeSessionId: m.getSessionId(),
      leafId: m.getLeafId(),
      entryIds: m.getEntries().map((e) => e.id),
    };
  }
  return {
    async capabilities() {
      try {
        const configuration = await configure();
        const model = await resolveSessionModel(configuration);
        return { provider: model.provider, modelId: model.id, available: true, supportsImages: model.input.includes("image") };
      } catch {
        return { provider: null, modelId: null, available: false };
      }
    },
    async create(id) {
      await mkdir(cwd, { recursive: true });
      const directory = path.join(root, ".data", "image-sessions", id);
      await mkdir(directory, { recursive: true });
      const m = SessionManager.create(cwd, directory);
      const sessionFile = m.getSessionFile();
      const header = m.getHeader();
      if (!sessionFile || !header)
        imageError("IMAGE_HISTORY_UNAVAILABLE", "Pi 身份创建失败");
      const file = await open(sessionFile, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify(header) + "\n");
        await file.sync();
      } finally {
        await file.close();
      }
      return { kind: "pi", sessionFile, sessionId: m.getSessionId(), cwd };
    },
    tree(ref) {
      return readTreeFile(ref.sessionFile, ref.cwd, ref.sessionId);
    },
    async recordInput(ref, command, attachments, evidence) {
      const m = manager(ref);
      evidence({ pi_baseline_json: canonical(baseline(m)) });
      const snapshot = JSON.parse(command.request_json).draftSnapshot;
      const startEntryId = m.appendCustomEntry("image-command", {
        schemaVersion: 1, commandId: command.id, taskId: snapshot.taskId, mode: "generate",
      });
      const userEntryId = m.appendMessage({
        role: "user", timestamp: Date.now(),
        content: [
          { type: "text", text: snapshot.text },
          ...attachments.map(image => ({ type: "image" as const, mimeType: image.mimeType, data: Buffer.from(image.bytes).toString("base64") })),
        ],
      });
      evidence({ pi_entry_ids_json: canonical({ schemaVersion: 1, startEntryId, userEntryId }) });
    },
    async prompt(ref, command, planning, attachments, evidence, changed, signal) {
      const m = manager(ref);
      const configuration = await configure();
      const model = await resolveSessionModel(configuration);
      if (attachments.length && !model.input.includes("image"))
        imageError("MODEL_UNAVAILABLE", "当前默认讨论模型不支持图片输入", 503);
      const settingsManager = SettingsManager.inMemory({
        retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
        cacheWarming: "off",
        compaction: { enabled: true },
      });
      const loader = new DefaultResourceLoader({
        cwd,
        settingsManager,
        agentDir: getAgentDir(),
        noExtensions: true,
        noSkills: true,
        noContextFiles: true,
        noPromptTemplates: true,
        noThemes: true,
        systemPrompt: instructions,
      });
      await loader.reload();
      const { session } = await createSession({
        cwd,
        modelRuntime: configuration.runtime,
        model,
        resourceLoader: loader,
        sessionManager: m,
        settingsManager,
        tools: [],
        customTools: [],
        thinkingLevel: model.reasoning ? "medium" : "off",
      });
      let unsubscribe = () => {};
      let aborting: Promise<void> | undefined;
      const abort = () => {
        aborting = Promise.resolve().then(async () => {
          try { session.abortCompaction(); } finally { await session.abort(); }
        });
        void aborting.catch(() => {});
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        signal.throwIfAborted();
        guardRecovery(session);
        const previous = m
          .getBranch()
          .findLast((e) => e.type === "model_change");
        if (
          previous?.type !== "model_change" ||
          previous.provider !== model.provider ||
          previous.modelId !== model.id
        )
          await session.setModel(model, { persist: false });
        const initial = baseline(m);
        evidence({ pi_baseline_json: canonical(initial) });
        const start = m.appendCustomEntry("image-command", {
          schemaVersion: 1,
          commandId: command.id,
          taskId: JSON.parse(command.request_json).draftSnapshot.taskId,
        });
        const entries: Row = {
          schemaVersion: 1,
          startEntryId: start,
        };
        evidence({ pi_entry_ids_json: canonical(entries) });
        unsubscribe = session.subscribe(changed);
        const snapshot = JSON.parse(command.request_json).draftSnapshot;
        // Raw user text remains the user prompt. Typed constraints are a separate native entry/message.
        await session.sendCustomMessage(
          {
            customType: "image-input",
            content: canonical({
              commandId: command.id,
              taskId: snapshot.taskId,
              profileId: snapshot.profileId,
              operation: snapshot.operation ?? null,
              explicitParameters: snapshot.explicitParameters,
              outputSpec: snapshot.outputSpec,
              referenceIds: snapshot.referenceIds,
              planning,
            }),
            display: false,
          },
          { triggerTurn: false },
        );
        signal.throwIfAborted();
        await session.prompt(snapshot.text, {
          expandPromptTemplates: false,
          images: attachments.map((i) => ({
            type: "image",
            mimeType: i.mimeType,
            data: Buffer.from(i.bytes).toString("base64"),
          })),
        });
        signal.throwIfAborted();
        const added = m.getEntries().filter((e) => !initial.entryIds.includes(e.id));
        const user = added.find((e) => e.type === "message" && e.message.role === "user");
        const assistant = added.findLast((e) => e.type === "message" && e.message.role === "assistant");
        if (!assistant || assistant.type !== "message" || assistant.message.role !== "assistant" ||
            ["error", "aborted", "length"].includes(assistant.message.stopReason))
          imageError("IMAGE_DISCUSSION_FAILED", "默认讨论模型请求失败，本轮已结束", 503);
        entries.userEntryId = user?.id;
        entries.assistantEntryId = assistant.id;
        entries.completionEntryId = m.appendCustomEntry(
          "image-command-completed",
          { schemaVersion: 1, commandId: command.id, assistantEntryId: assistant.id, structuredPlan: true },
        );
        evidence({ pi_entry_ids_json: canonical(entries) });
        changed();
        if (assistant.message.content.some(block => block.type !== "text" && block.type !== "thinking"))
          imageError("IMAGE_PLAN_INVALID", "规划回复必须仅包含一个 JSON 方案", 422);
        return assistant.message.content.map(block => block.type === "text" ? block.text : "").join("");
      } finally {
        signal.removeEventListener("abort", abort);
        unsubscribe();
        try { await (aborting ?? session.abort()); } finally { session.dispose(); }
      }
    },
    async notify(ref, payload, evidence) {
      const m = manager(ref);
      evidence({ notification_baseline_json: canonical(baseline(m)) });
      return m.appendCustomMessageEntry(
        "image-execution-result",
        canonical(payload),
        true,
        { executionId: (payload as Row).executionId },
      );
    },
  };
}
