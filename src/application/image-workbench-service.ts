import { randomUUID } from "node:crypto";
import { DomainError } from "@/domain/errors";
import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import {
  canonical,
  hash,
  bytesHash,
  imageError,
  integer,
  logoOutput,
  object,
  string,
  validateLimits,
  validatePlan,
  validateDraftParameters,
  imageOperations,
  type PlanInput,
  type ImageProfile,
  isImageAssetDeleted,
  type StoredRow as Row,
  type NativeImageRef,
  type OutputSpec,
} from "@/domain/images";
import type {
  ImageStore,
  ImageFiles,
  ImageDiscussion,
  ImageProviders,
} from "./ports/images";
const now = () => new Date().toISOString();
const parse = (value: string | null | undefined) =>
  value == null ? null : JSON.parse(value);
const active = (e: Row) =>
  ["queued", "running", "processing"].includes(e.status);
const defaultLimits = { maxImageRequests: 4, maxGeneratedImages: 10, maxOutputs: 32 };
const interrupted = () => new DomainError("IMAGE_TASK_INTERRUPTED", "已终止", 409, true);
const emptyResult = () => ({
  schemaVersion: 1,
  taskIds: [] as string[],
  planIds: [] as string[],
  executionIds: [] as string[],
  assetIds: [] as string[],
});
export type ImageIntent = { key: string; match: string | null };
export class ImageWorkbenchService {
  readonly changes = new EventEmitter();
  private working = false;
  private readLeases = new Map<string, number>();
  private deleting = new Set<string>();
  private executions = new Map<string, { controller: AbortController; settled: Promise<void> }>();
  private messages = new Map<string, { controller: AbortController; settled: Promise<unknown> }>();
  private interrupts = new Map<string, { key: string; target: Row; result: Promise<unknown> }>();
  private lanes = new Map<string, Promise<unknown>>();
  constructor(
    private store: ImageStore,
    private files: ImageFiles,
    private discussion: ImageDiscussion,
    private providers: ImageProviders,
  ) {
    this.changes.setMaxListeners(0);
  }
  refreshDiscussion(discussion: ImageDiscussion) {
    this.discussion = discussion;
    this.readLeases ??= new Map();
    this.deleting ??= new Set();
  }
  start(processStartedAt = new Date(performance.timeOrigin).toISOString()) {
    this.store.interruptPreviousProcess(processStartedAt);
  }
  private changed() {
    this.changes.emit("change");
  }
  private revision(row: Row, match: string | null) {
    if (match === null)
      imageError("PRECONDITION_REQUIRED", "需要 If-Match 版本", 428);
    if (match !== String(row.revision) && match !== `"${row.revision}"`)
      imageError("VERSION_CONFLICT", "版本已变化，请重新读取", 412);
  }
  private inputKey(intent: ImageIntent) {
    if (!intent.key || intent.key.length > 200)
      imageError("IDEMPOTENCY_KEY_REQUIRED", "需要 Idempotency-Key", 400);
  }
  private existing(
    kind: string,
    scope: string,
    intent: ImageIntent,
    input: unknown,
  ) {
    this.inputKey(intent);
    const c = this.store.command(kind, scope, intent.key);
    if (c && c.request_hash !== hash({ input, ifMatch: intent.match }))
      imageError("IDEMPOTENCY_CONFLICT", "幂等键已用于其他输入", 409);
    if (c?.status === "failed")
      throw Object.assign(
        new DomainError(
          c.error_code ?? "IMAGE_REQUEST_FAILED",
          "此前请求已经失败，请使用重新开始入口",
          409,
          true,
        ),
        { commandId: c.id },
      );
    return c;
  }
  private command(
    kind: string,
    scope: string,
    intent: ImageIntent,
    input: unknown,
    conversationId: string | null,
    extra: Row = {},
  ) {
    return this.store.insert("commands", {
      id: randomUUID(),
      conversation_id: conversationId,
      kind,
      scope_key: scope,
      idempotency_key: intent.key,
      request_hash: hash({ input, ifMatch: intent.match }),
      request_json: canonical({ schemaVersion: 1, ...object(input) }),
      status: "accepted",
      created_at: now(),
      ...extra,
    });
  }
  private complete(command: Row, result: Row) {
    return this.store.update("commands", command.id, {
      status: "completed",
      finished_at: now(),
      attempt_ended_at: now(),
      revision: this.store.get("commands", command.id).revision + 1,
      result_json: canonical({ ...emptyResult(), ...result }),
    });
  }
  private fail(command: Row, error: unknown) {
    const c = this.store.get("commands", command.id);
    if (["completed", "failed"].includes(c.status)) return c;
    return this.store.update("commands", c.id, {
      status: "failed",
      error_code: this.errorCode(error),
      ...(this.errorCode(error) === "IMAGE_PLAN_INVALID" && error instanceof Error ? { error_message: error.message } : {}),
      finished_at: now(),
      attempt_ended_at: now(),
      revision: c.revision + 1,
      ...(c.auto_execution_state === "pending"
        ? {
            auto_execution_state: "not_requested",
            auto_execution_reason: this.errorCode(error),
          }
        : {}),
    });
  }
  private errorCode(error: unknown) {
    return error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      /^(IMAGE_|MODEL_|PLAN_|AUTO_|PROCESS_|SCHEMA_|INVALID_)/.test(error.code)
      ? error.code
      : "IMAGE_STORAGE_FAILED";
  }
  private lane<T>(id: string, run: () => Promise<T>): Promise<T> {
    const prior = this.lanes.get(id) ?? Promise.resolve();
    const pending = prior.catch(() => {}).then(run);
    this.lanes.set(id, pending);
    void pending
      .finally(() => {
        if (this.lanes.get(id) === pending) this.lanes.delete(id);
      })
      .catch(() => {});
    return pending;
  }
  private asset(row: Row) {
    return {
      id: row.id,
      taskId: row.task_id,
      executionId: row.execution_id,
      role: row.role,
      sourceAssetId: row.source_asset_id ?? null,
      rootAssetId: row.root_asset_id ?? null,
      versionNumber: row.version_number ?? null,
      readyAt: row.ready_at ?? null,
      rootVersionMax: row.root_asset_id ? this.store.get("assets", row.root_asset_id).max_version_number : null,
      createdAt: row.created_at,
      allowedActions: row.availability === "ready" && !isImageAssetDeleted(row)
        ? [...(row.mime_type !== "image/svg+xml" || row.role === "reference" ? ["reference"] : []), "download",
            ...(this.deletableImage(row) && !this.deletionAssets(row).some(asset => this.deletionBlocked(asset)) ? ["delete"] : [])]
        : [],
      outputKey: row.output_key,
      name: row.original_name,
      mimeType: row.mime_type,
      width: row.width,
      height: row.height,
      bytes: row.byte_size,
      availability: row.availability,
      previewUrl:
        row.availability === "ready" && !isImageAssetDeleted(row)
          ? `/api/images/assets/${row.id}/content`
          : null,
      downloadUrl:
        row.availability === "ready" && !isImageAssetDeleted(row)
          ? `/api/images/assets/${row.id}/content?download=1`
          : null,
    };
  }
  commandDTO(c: Row) {
    const request = parse(c.request_json),
      result = parse(c.result_json);
    return {
      id: c.id,
      kind: c.kind,
      revision: c.revision,
      status: c.status,
      autoExecution: {
        state: c.auto_execution_state,
        reason: c.auto_execution_reason ?? null,
      },
      resultIds: result,
      error: c.error_code
        ? {
            code: c.error_code,
            message:
              c.error_message ?? (c.error_code === "IMAGE_TASK_INTERRUPTED" ? "已终止" : c.error_code === "PROCESS_INTERRUPTED"
                ? "服务进程中断，本次工作已结束"
                : "本次工作失败，请查看方案或主动重新开始"),
          }
        : null,
      attemptEndedAt: c.attempt_ended_at ?? null,
      finishedAt: c.finished_at ?? null,
      restartOfCommandId: c.restart_of_command_id ?? null,
      inputSnapshot: c.kind === "message" ? (() => {
        const { taskRevision: _, ...input } = request.draftSnapshot;
        return input;
      })() : null,
      allowedActions:
        c.status === "failed" &&
        ["message", "create_conversation"].includes(c.kind)
          ? ["restart"]
          : [],
    };
  }
  conversationDTO(c: Row) {
    const busy = this.store.busyConversation(c.id);
    return {
      id: c.id,
      title: c.title,
      revision: c.revision,
      discussion: {
        busy: !!busy,
        blockingCommandId: busy?.id ?? null,
        error: (() => { const command = this.store.find("commands", { conversation_id: c.id, kind: "message" }); return command?.status === "failed" ? this.commandDTO(command).error : null; })(),
      },
      nativeHistoryAvailable: !!c.native_ref_json,
      allowedActions: busy ? [] : ["send", "create_task"],
      latestCommand: (()=>{const current=this.store.find("commands",{conversation_id:c.id,kind:"message"})??this.store.find("commands",{conversation_id:c.id,kind:"create_conversation"});return current?this.commandDTO(current):null;})(),
    };
  }
  draftDTO(d: Row) {
    return {
      id: d.id,
      conversationId: d.conversation_id,
      taskId: d.task_id,
      revision: d.revision,
      text: d.text,
      profileId: d.profile_id,
      parameters: parse(d.parameters_json),
      referenceIds: this.store
        .list("draft_inputs", { draft_id: d.id })
        .map((i) => i.asset_id),
      allowedActions: ["save", "send"],
    };
  }
  private taskTitles(conversationId: string) {
    const titles = new Map<string, string>();
    if (!this.store.conversation(conversationId).native_ref_json) return titles;
    const tree = this.tree(conversationId) as { entries: Array<{ entry: Row }> };
    const entries = new Map<string, Row>();
    for (const { entry } of tree.entries) {
      entries.set(entry.id, entry);
      if (entry.type !== "message" || entry.message?.role !== "user") continue;
      const content = entry.message.content;
      if (typeof content !== "string" && !Array.isArray(content))
        imageError("IMAGE_HISTORY_UNAVAILABLE", "Pi 原生用户消息内容无效");
      const title = typeof content === "string" ? content : content.filter((b: Row) => b.type === "text").map((b: Row) => b.text).join("");
      if (!title.trim()) continue;
      let parent = entries.get(entry.parentId);
      let input: Row | null = null;
      while (parent) {
        if (parent.type === "custom_message" && parent.customType === "image-input" && typeof parent.content === "string") {
          try { input = parse(parent.content); } catch { break; }
        }
        if (parent.type === "custom" && parent.customType === "image-command") {
          const taskId = parent.data?.taskId ?? (input?.commandId === parent.data?.commandId ? input?.taskId : null);
          if (typeof taskId === "string") titles.set(taskId, title);
          break;
        }
        if (parent.type === "message" && parent.message?.role === "user") break;
        parent = entries.get(parent.parentId);
      }
    }
    return titles;
  }
  taskDTO(t: Row, titles = this.taskTitles(t.conversation_id)) {
    const execution = parse(t.execution_json);
    const discussion = parse(this.store.conversation(t.conversation_id).discussion_json);
    const command = parse(discussion?.request_json)?.draftSnapshot?.taskId === t.id ? discussion : null;
    const planning = command && ["accepted", "running"].includes(command.status);
    const running = execution && active(execution);
    const interruptTarget = running || planning ? {
      ...(planning ? { commandId: command.id } : {}),
      ...(running ? { executionId: execution.id } : {}),
    } : null;
    const interruptPending = this.interrupts.has(t.id);
    return {
      id: t.id,
      conversationId: t.conversation_id,
      name: t.name,
      title: titles.get(t.id) ?? null,
      createdAt: t.created_at,
      revision: t.revision,
      currentPlanId: t.current_plan_id,
      latestExecutionId: execution?.id ?? null,
      derivedStage: running ? execution.status : planning ? "planning" : execution?.status ??
        (command?.status === "failed" ? "failed" : t.current_plan_id ? "awaiting_confirmation" : "awaiting_input"),
      interruptTarget,
      interruptPending,
      errorCode: running || planning ? null : execution ? execution.error_code ?? null : command?.error_code ?? null,
      allowedActions: ["save_draft", ...(!this.store.busyTask(t.id) && !interruptPending ? ["prepare_plan"] : []),
        ...(interruptTarget && !interruptPending ? ["interrupt"] : [])],
    };
  }
  planDTO(p: Row) {
    const profile = parse(p.profile_snapshot_json) as ImageProfile | null;
    const { credentialRef: _, baseUrl: __, defaults: ___, ...publicProfile } = profile ?? {};
    const outputSpec = parse(p.output_spec_json) as OutputSpec;
    const inputRows = this.store.list("plan_inputs", { plan_id: p.id });
    const bases = inputRows
      .filter((i) => i.purpose === "base")
      .map((i) => this.store.get("assets", i.asset_id));
    const warnings: Array<{ code: string; message: string }> = [];
    if (
      p.operation === "process" &&
      outputSpec.targets.some((target) => {
        const source = bases[target.sourceIndex];
        return (
          source &&
          (target.width > source.width || target.height > source.height)
        );
      })
    )
      warnings.push({
        code: "IMAGE_UPSCALE",
        message: "小图放大不保证增加细节；需要 AI 修复时请另准备修改方案。",
      });
    if (p.operation === "edit")
      warnings.push({
        code: "IMAGE_EDIT_FIDELITY",
        message:
          "模型修改不保证原图文字和图形绝对一致；严格原样缩放请使用精确处理。",
      });
    return {
      id: p.id,
      taskId: p.task_id,
      hash: p.plan_hash,
      operation: p.operation,
      intent: p.intent,
      preserve: p.preserve_text,
      prompt: p.prompt,
      profile: profile ? publicProfile : null,
      parameters: parse(p.parameters_json).values,
      sources: parse(p.parameter_sources_json),
      inputs: this.store.list("plan_inputs", { plan_id: p.id }).map((i) => ({
        assetId: i.asset_id,
        purpose: i.purpose,
        position: i.position,
      })),
      outputSpec,
      outputRoots: p.output_roots_json ? parse(p.output_roots_json) : [],
      inputMode: p.input_mode ?? null,
      warnings,
      validationErrors: [],
      allowedActions: this.store.list("executions", { plan_id: p.id }).length
        ? []
        : ["confirm"],
    };
  }
  executionDTO(e: Row) {
    const assets = this.store.list("assets", { execution_id: e.id });
    const plan = this.store.get("plans", e.plan_id);
    const spec = parse(plan.output_spec_json) as OutputSpec;
    const latest = this.store.list("executions", { task_id: e.task_id }).at(-1);
    const httpStatus = parse(e.provider_evidence_json)?.observations?.at(-1)?.httpStatus;
    const httpFailure = Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599;
    return {
      id: e.id,
      revision: e.revision,
      taskId: e.task_id,
      planId: e.plan_id,
      authorizationMode: e.authorization_mode,
      restartOfExecutionId: e.restart_of_execution_id,
      status: e.status,
      providerOutcome: e.provider_outcome,
      phase: e.phase,
      timestamps: {
        createdAt: e.created_at,
        startedAt: e.started_at,
        finishedAt: e.finished_at,
      },
      assets: assets.map((a) => this.asset(a)),
      inputs: this.store.list("plan_inputs", { plan_id: plan.id }).map((i) => ({
        ...this.asset(this.store.get("assets", i.asset_id)),
        purpose: i.purpose,
        position: i.position,
      })),
      planHash: plan.plan_hash,
      plan: this.planDTO(plan),
      outputResults: spec.targets.map((t) => {
        const a = assets.find((a) => a.output_key === t.name);
        return {
          outputKey: t.name,
          assetId: a?.id ?? null,
          availability: a?.availability ?? "missing",
          expected: {
            name: t.name,
            width: t.width,
            height: t.height,
            mimeType: `image/${spec.format}`,
          },
        };
      }),
      notification: {
        state: e.notification_state,
        notifiedAt: e.notified_at ?? null,
        allowedActions: [],
      },
      error: e.error_code
        ? { code: e.error_code, message: e.error_code === "IMAGE_TASK_INTERRUPTED" ? "已终止" : httpFailure
            ? `图片供应商返回 HTTP ${httpStatus}；执行已结束，已保存的部分产物保留`
            : "执行失败，已保存的部分产物保留" }
        : null,
      allowedActions:
        e.status === "failed" &&
        latest?.id === e.id &&
        !this.store.busyTask(e.task_id)
          ? ["restart"]
          : [],
    };
  }
  private page<T extends Row>(rows: T[], cursor: string | null, limit: number, descending = false) {
    integer(limit, 1, 100);
    let start = 0;
    if (cursor) {
      let identity: unknown;
      try {
        identity = JSON.parse(Buffer.from(cursor, "base64url").toString());
      } catch {
        return imageError("INVALID_CURSOR", "分页游标无效", 400);
      }
      if (
        !Array.isArray(identity) ||
        identity.length !== 2 ||
        identity.some((v) => typeof v !== "string")
      )
        imageError("INVALID_CURSOR", "分页游标无效", 400);
      start = rows.findIndex(
        (r) =>
          (r.created_at.localeCompare(identity[0]) || r.id.localeCompare(identity[1])) * (descending ? -1 : 1) > 0,
      );
      if (start < 0) start = rows.length;
    }
    const items = rows.slice(start, start + limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        start + limit < rows.length && last
          ? Buffer.from(JSON.stringify([last.created_at, last.id])).toString(
              "base64url",
            )
          : null,
    };
  }
  validateSubscription(conversationIds: string[], taskId: string | null, filter: string, cursor: string | null, limit: number) {
    for (const id of conversationIds) this.store.conversation(id);
    const conversationId = taskId ? this.store.task(taskId).conversation_id as string : null;
    if (conversationId && !conversationIds.includes(conversationId))
      imageError("NOT_FOUND", "任务不属于已订阅讨论", 404);
    if (!["all", "active"].includes(filter)) imageError("INVALID_INPUT", "任务筛选无效", 400);
    this.page([], cursor, limit);
    return conversationId;
  }
  getConversation(id: string) {
    const tasks = this.store.list("tasks", { conversation_id: id });
    const titles = this.taskTitles(id);
    return {
      conversation: this.conversationDTO(this.store.conversation(id)),
      tasks: tasks.map((t) => this.taskDTO(t, titles)),
      plans: tasks
        .filter((t) => t.current_plan_id)
        .map((t) => this.planDTO(this.store.get("plans", t.current_plan_id))),
    };
  }
  getDraft(id: string, taskId: string | null) {
    return this.draftDTO(this.store.draft(id, taskId));
  }
  listTasks(
    filter: string,
    conversationId: string | null,
    cursor: string | null,
    limit: number,
  ) {
    if (!["active", "all"].includes(filter))
      imageError("INVALID_INPUT", "任务筛选无效", 400);
    if (conversationId) this.store.conversation(conversationId);
    const rows = this.store
      .list("tasks", conversationId ? { conversation_id: conversationId } : {})
      .filter((t) => {
        const execution=this.store.busyTask(t.id);
        return filter === "all" || !!execution && active(execution);
      });
    const p = this.page(rows.reverse(), cursor, limit, true);
    const titles = new Map<string, Map<string, string>>();
    return { ...p, items: p.items.map(t => {
      let byTask = titles.get(t.conversation_id);
      if (!byTask) {
        byTask = this.taskTitles(t.conversation_id);
        titles.set(t.conversation_id, byTask);
      }
      return this.taskDTO(t, byTask);
    }) };
  }
  getTask(id: string) {
    const t = this.store.task(id);
    const latest = this.store.list("executions", { task_id: id })[0];
    const currentPlan = t.current_plan_id ? this.planDTO(this.store.get("plans", t.current_plan_id)) : null;
    const draft = this.store.draft(t.conversation_id, id);
    const referenceIds: string[] = draft.referenceIds;
    const assets = this.store.list("assets", { task_id: id }).filter(asset => !isImageAssetDeleted(asset));
    const references = referenceIds.map(assetId => this.store.get("assets", assetId)).filter(asset => !isImageAssetDeleted(asset));
    const groups = new Map<string, Row[]>();
    for (const asset of assets) if (asset.root_asset_id && asset.availability === "ready") {
      const versions = groups.get(asset.root_asset_id) ?? [];
      versions.push(asset);
      groups.set(asset.root_asset_id, versions);
    }
    const images = [...groups].sort(([a], [b]) => {
      const left = this.store.get("assets", a), right = this.store.get("assets", b);
      return left.created_at.localeCompare(right.created_at) || a.localeCompare(b);
    }).map(([rootAssetId, versions]) => {
      versions.sort((a, b) => a.version_number - b.version_number);
      return {rootAssetId, latestVersionNumber: versions.at(-1)!.version_number, versions: versions.map(asset => this.asset(asset))};
    });
    return {
      task: this.taskDTO(t),
      currentPlan,
      latestExecution: latest ? this.executionDTO(latest) : null,
      assets: assets.map(a => this.asset(a)),
      referenceAssets: references.map(asset => this.asset(asset)),
      images,
      maxVersionNumber: Math.max(0, ...images.map(image => image.latestVersionNumber)),
    };
  }
  getCommand(id: string) {
    return this.commandDTO(this.store.get("commands", id));
  }
  getExecution(id: string) {
    return this.executionDTO(this.store.get("executions", id));
  }
  listAssets(taskId: string | null, cursor: string | null, limit: number) {
    if (taskId) this.store.task(taskId);
    const p = this.page(
      this.store.list("assets", taskId ? { task_id: taskId } : {}).filter(asset => !isImageAssetDeleted(asset)),
      cursor,
      limit,
    );
    return { ...p, items: p.items.map((a) => this.asset(a)) };
  }
  async content(id: string) {
    const asset = this.readyAsset(id);
    this.readLeases.set(id, (this.readLeases.get(id) ?? 0) + 1);
    try {
      return { asset: this.asset(asset), bytes: await this.files.read(asset) };
    } finally {
      const count = (this.readLeases.get(id) ?? 1) - 1;
      if (count) this.readLeases.set(id, count); else this.readLeases.delete(id);
      this.changed();
    }
  }
  tree(id: string, allowPendingIdentity = false) {
    const c = this.store.conversation(id);
    if (!c.native_ref_json) {
      if (allowPendingIdentity && this.store.busyConversation(id)) return { entries: [], activeLeafId: null };
      imageError("IMAGE_HISTORY_UNAVAILABLE", "图片讨论历史不可用");
    }
    try {
      return this.discussion.tree(parse(c.native_ref_json));
    } catch {
      return imageError(
        "IMAGE_HISTORY_UNAVAILABLE",
        "图片讨论历史损坏或身份不一致",
      );
    }
  }
  async capabilities() {
    const configuration = await this.providers.configuration();
    const profiles = await Promise.all(
      configuration.profiles.map(async (p) => {
        let unavailableReason: string | null = null;
        try {
          await this.providers.authorize(p);
        } catch {
          unavailableReason = "官方图片凭据不可用";
        }
        const { credentialRef: _, baseUrl: __, ...publicProfile } = p;
        return {
          ...publicProfile,
          available: !unavailableReason,
          unavailableReason,
        };
      }),
    );
    return {
      discussionModel: (await this.discussion.capabilities?.()) ?? null,
      profiles,
      defaultProfileId: (profiles.find(p => p.available && p.id === configuration.defaultProfileId) ?? profiles.find(p => p.available))?.id ?? null,
      outputLimits: { maxOutputs: 32, maxOutputPixels: 100_000_000, maxDimension: 8192, formats: ["png", "jpeg", "webp"], fits: ["contain", "cover"] },
      processAvailable: true,
      operations: imageOperations,
      presets: [{ id: "website-logo", name: "网站 Logo 九尺寸" }],
    };
  }
  async submit(input: unknown, files: Array<{ name: string; bytes: Uint8Array }>, intent: ImageIntent) {
    this.inputKey(intent);
    const payload = object(input, ["text", "profileId", "parameters", "mode"]);
    const mode = payload.mode ?? "discuss";
    if (mode !== "discuss" && mode !== "generate") imageError("INVALID_INPUT", "发送模式无效", 400);
    const text = string(payload.text);
    const profileId = payload.profileId === undefined ? null : string(payload.profileId, 200);
    const parameters = validateDraftParameters(payload.parameters === undefined ? { schemaVersion: 1, explicitParameters: {} } : payload.parameters);
    const { explicitParameters, operation, outputSpec } = parameters;
    if (files.length > 4 || (!text.trim() && !files.length))
      imageError("INVALID_INPUT", "请输入要求或选择最多四张参考图", 400);
    if ((operation === "edit" || operation === "process") && !files.length)
      imageError("IMAGE_PARAMETERS_INVALID", "指定的图片操作需要参考图", 422);
    const fingerprints = files.map(file => {
      if (!file.name || file.name.length > 200 || /[/\\\x00-\x1f]/.test(file.name))
        imageError("INVALID_INPUT", "文件名无效", 400);
      if (file.bytes.length > 20 * 1024 * 1024)
        imageError("REQUEST_TOO_LARGE", "参考图超过 20MiB", 413);
      return { name: file.name, sha256: bytesHash(file.bytes) };
    });
    const request = { text, profileId, mode, ...parameters, files: fingerprints };
    const normalizedIntent = { key: intent.key, match: null };
    const conversationId = `submit-${hash({ key: intent.key })}`;
    const scope = `submission:${conversationId}`;
    const replay = () => {
      const receipt = this.existing("create_conversation", scope, normalizedIntent, request);
      if (!receipt) return null;
      const submission = parse(receipt.result_json).submission;
      const current = this.store.find("commands", { id: submission.command.id });
      return { conversationId, taskId: submission.taskId, command: current ? this.commandDTO(current) : submission.command };
    };
    const prior = replay();
    if (prior) return prior;
    const inspected: Array<Awaited<ReturnType<ImageFiles["inspect"]>>> = [];
    for (const file of files) inspected.push(await this.files.inspect(file.bytes));
    const capabilities = await this.capabilities();
    if (mode === "discuss" && capabilities.discussionModel && (!capabilities.discussionModel.available ||
        files.length && capabilities.discussionModel.supportsImages === false))
      imageError("MODEL_UNAVAILABLE", "默认讨论模型不可用或不支持图片输入", 503);
    if (operation !== "process" && (profileId || Object.keys(explicitParameters).length)) {
      const config = await this.providers.configuration();
      const profile = config.profiles.find(p => p.id === (profileId ?? capabilities.defaultProfileId));
      if (!profile) imageError("IMAGE_PROVIDER_UNAVAILABLE", "图片模型不可用", 503);
      await this.providers.authorize(profile);
      this.providers.parameters(profile, explicitParameters);
      if (inspected.length > profile.limits.maxInputs || inspected.some(image =>
          image.bytes.length > profile.limits.maxInputBytes || image.width * image.height > profile.limits.maxInputPixels))
        imageError("IMAGE_PARAMETERS_INVALID", "参考图超过模型限制", 422);
    }
    const accepted = this.store.transaction(() => {
      const duplicate = replay();
      if (duplicate) return { response: duplicate, assets: null };
      const time = now();
      const conversation = this.store.insert("conversations", {
        id: conversationId, title: "图片讨论", native_ref_json: null, revision: 1, created_at: time, updated_at: time,
      });
      this.store.createDraft(conversationId, null);
      const { task } = this.insertTask(conversation, "图片任务");
      const assets = files.map(file => this.reserveAsset(task.id, null, "reference", file.name,
        `${task.id}/references/${randomUUID()}/original.png`));
      const referenceIds = assets.map((asset, index) => inspected[index].mime === "image/svg+xml" ? randomUUID() : asset.id);
      const snapshot = { text, mode, inputMode: parameters.inputMode ?? null, profileId: profileId ?? (Object.keys(explicitParameters).length ? capabilities.defaultProfileId : null), explicitParameters, operation: operation ?? null, outputSpec: outputSpec ?? null, taskId: task.id, taskRevision: task.revision, referenceIds,
        skipConfirmation: true, autoExecuteLimits: defaultLimits };
      const command = this.command("message", `conversation:${conversationId}`, normalizedIntent, { skipConfirmation: true }, conversationId, {
        request_json: canonical({ schemaVersion: 1, skipConfirmation: true, draftSnapshot: snapshot }), auto_execution_state: "pending",
      });
      const response = { conversationId, taskId: task.id, command: this.commandDTO(command) };
      const receipt = this.command("create_conversation", scope, normalizedIntent, request, conversationId, {
        request_json: canonical({ schemaVersion: 1 }),
      });
      this.complete(receipt, { submission: { taskId: task.id, command: { ...response.command, inputSnapshot: null } } });
      return { response, assets };
    });
    if (accepted.assets) {
      const assets = accepted.assets;
      const command = accepted.response.command;
      this.dispatchMessage(command.id, async signal => {
        try {
          signal.throwIfAborted();
          const ref = await this.discussion.create(conversationId);
          this.store.update("conversations", conversationId, { native_ref_json: canonical(ref), updated_at: now() });
          for (const [index, asset] of assets.entries()) {
            signal.throwIfAborted();
            const assetIds = await this.saveReference(asset, files[index].bytes, command.inputSnapshot.referenceIds[index]);
            this.store.transaction(() => this.selectUploaded(accepted.response.taskId, [assetIds[0]]));
          }
        } catch (error) {
          for (const asset of assets) {
            if (this.store.get("assets", asset.id).availability === "staging")
              this.store.update("assets", asset.id, { availability: "missing" });
          }
          throw error;
        }
      });
      this.changed();
    }
    return accepted.response;
  }
  async createConversation(
    input: unknown,
    intent: ImageIntent,
    restartOf: string | null = null,
  ) {
    const v = object(input, ["title"]);
    if (v.title !== undefined) string(v.title, 200);
    const scope = restartOf ? `command:${restartOf}` : "images";
    const old = this.existing("create_conversation", scope, intent, v);
    if (old)
      return {
        command: this.commandDTO(old),
        ...(parse(old.result_json).conversationId
          ? this.getConversation(parse(old.result_json).conversationId)
          : {}),
      };
    const id = randomUUID();
    const command = this.store.transaction(() => {
      const time=now();
      this.store.insert("conversations",{id,title:v.title||"图片讨论",native_ref_json:null,revision:1,created_at:time,updated_at:time});
      this.store.createDraft(id,null);
      return this.command("create_conversation",scope,intent,v,id,{...(restartOf?{restart_of_command_id:restartOf}:{})});
    });
    try {
      const ref = await this.discussion.create(id);
      const result = this.store.transaction(() => {
        const time = now();
        this.store.update("conversations",id,{native_ref_json:canonical(ref),updated_at:time});
        const draft=this.store.draft(id,null);
        this.store.update("commands", command.id, { conversation_id: id });
        const c = this.complete(command, { conversationId: id });
        return {
          command: this.commandDTO(c),
          conversation: this.conversationDTO(this.store.conversation(id)),
          draft: this.draftDTO(draft),
        };
      });
      this.changed();
      return result;
    } catch (e) {
      this.fail(command, e);
      this.changed();
      throw Object.assign(e instanceof Error ? e : new Error("创建失败"), {
        commandId: command.id,
      });
    }
  }
  private insertTask(conversation: Row, name: string) {
    const id = randomUUID(),
      time = now();
    const task = this.store.insert("tasks", {
      id,
      conversation_id: conversation.id,
      name,
      revision: 1,
      current_plan_id: null,
      created_at: time,
      updated_at: time,
    });
    const draft = this.store.createDraft(conversation.id, id);
    this.store.update(
      "conversations",
      conversation.id,
      { revision: conversation.revision + 1, updated_at: time },
      conversation.revision,
    );
    return { task, draft };
  }
  createTask(conversationId: string, input: unknown, intent: ImageIntent) {
    const v = object(input, ["name"]);
    const name = string(v.name, 200);
    if (!name.trim()) imageError("INVALID_INPUT", "任务名称不能为空", 400);
    this.store.conversation(conversationId);
    const old = this.existing(
      "create_task",
      `conversation:${conversationId}`,
      intent,
      v,
    );
    if (old) {
      const t = this.store.task(parse(old.result_json).taskIds[0]);
      return {
        task: this.taskDTO(t),
        draft: this.getDraft(conversationId, t.id),
      };
    }
    const result = this.store.transaction(() => {
      const c = this.store.conversation(conversationId);
      this.revision(c, intent.match);
      const command = this.command(
        "create_task",
        `conversation:${conversationId}`,
        intent,
        v,
        conversationId,
      );
      const { task: t, draft } = this.insertTask(c, name);
      const id = t.id;
      this.complete(command, { taskIds: [id] });
      return { task: this.taskDTO(t), draft: this.draftDTO(draft) };
    });
    this.changed();
    return result;
  }
  saveDraft(conversationId: string, input: unknown, intent: ImageIntent) {
    const v = object(input, [
      "draftId",
      "text",
      "profileId",
      "parameters",
      "referenceIds",
    ]);
    string(v.draftId, 100);
    string(v.text);
    if (v.profileId !== null) string(v.profileId, 200);
    const parameters = validateDraftParameters(v.parameters);
    if (
      !Array.isArray(v.referenceIds) ||
      v.referenceIds.length > 4 ||
      new Set(v.referenceIds).size !== v.referenceIds.length
    )
      imageError("INVALID_INPUT", "参考图数量或身份无效", 400);
    for (const id of v.referenceIds) string(id, 100);
    const draft = this.store.get("drafts", String(v.draftId));
    if (draft.conversation_id !== conversationId)
      imageError("NOT_FOUND", "草稿不存在", 404);
    const old = this.existing("update_draft", `draft:${draft.id}`, intent, v);
    if (old) return this.draftResult(old);
    const result = this.store.transaction(() => {
      const current = this.store.get("drafts", draft.id);
      this.revision(current, intent.match);
      for (const id of v.referenceIds as string[]) {
        const asset = this.readyAsset(id);
        if (current.task_id && asset.task_id !== current.task_id) imageError("NOT_FOUND", "参考图不属于当前任务", 404);
        if (asset.mime_type === "image/svg+xml")
          imageError(
            "IMAGE_PARAMETERS_INVALID",
            "讨论附件请选择 SVG 转换后的 PNG 参考资源",
            422,
          );
      }
      const command = this.command(
        "update_draft",
        `draft:${draft.id}`,
        intent,
        v,
        conversationId,
      );
      const updated = this.store.update(
        "drafts",
        draft.id,
        {
          text: v.text,
          profile_id: v.profileId,
          parameters_json: canonical(v.parameters),
          revision: current.revision + 1,
          updated_at: now(),
        },
        current.revision,
      );
      this.store.replaceDraftInputs(draft.id, v.referenceIds as string[]);
      this.complete(command, {
        draftWrite: { draftId: draft.id, revision: updated.revision },
      });
      return this.draftDTO(this.store.get("drafts", updated.id));
    });
    this.changed();
    return result;
  }
  private draftResult(command: Row) {
    const input = parse(command.request_json),
      result = parse(command.result_json);
    const draft = this.store.get("drafts", result.draftWrite.draftId);
    return {
      id: draft.id,
      conversationId: draft.conversation_id,
      taskId: draft.task_id,
      revision: result.draftWrite.revision,
      text: input.text,
      profileId: input.profileId,
      parameters: input.parameters,
      referenceIds: input.referenceIds,
      allowedActions: ["save", "send"],
    };
  }
  private readyAsset(id: string) {
    const a = this.store.get("assets", id);
    if (isImageAssetDeleted(a)) imageError("IMAGE_VERSION_DELETED", "图片已删除", 410);
    if (this.deleting.has(id)) imageError("IMAGE_ASSET_IN_USE", "图片版本正在清理", 409);
    if (a.availability !== "ready")
      imageError("IMAGE_RESOURCE_UNAVAILABLE", "引用图片未就绪");
    return a;
  }
  private reserveAsset(
    taskId: string,
    executionId: string | null,
    role: string,
    name: string,
    relative: string,
    key: string | null = null,
    sourceAssetId: string | null = null,
    id: string = randomUUID(),
  ) {
    return this.store.insert("assets", {
      id,
      task_id: taskId,
      execution_id: executionId,
      role,
      source_asset_id: sourceAssetId,
      original_name: name,
      relative_path: relative,
      output_key: key,
      availability: "staging",
      created_at: now(),
    });
  }
  private selectUploaded(taskId: string, assetIds: string[]) {
    const task = this.store.task(taskId), draft = this.store.draft(task.conversation_id, taskId);
    const ids = [...new Set([...draft.referenceIds, ...assetIds])];
    if (ids.length > 4) imageError("IMAGE_PARAMETERS_INVALID", "当前参考图最多四张，请先取消参考", 422);
    this.store.update("drafts", draft.id, {referenceIds: ids, revision: draft.revision + 1, updated_at: now()});
  }
  private referenceResult(command: Row) {
    const ids = parse(command.result_json).assetIds;
    return {
      command: this.commandDTO(command),
      asset: ids[0] ? this.asset(this.store.get("assets", ids[0])) : null,
      sourceAsset: ids[1] ? this.asset(this.store.get("assets", ids[1])) : null,
    };
  }
  private async saveReference(asset: Row, bytes: Uint8Array, rasterId?: string) {
    const info = await this.files.inspect(bytes);
    await this.files.save(asset, info.bytes);
    if (info.mime !== "image/svg+xml") return [asset.id];
    const raster = this.reserveAsset(
      asset.task_id,
      null,
      "reference",
      asset.original_name.replace(/\.[^.]+$/, "") + ".png",
      `${asset.task_id}/references/${randomUUID()}/raster.png`,
      null,
      asset.id,
      rasterId,
    );
    try {
      const png = await this.files.process(
        info.bytes,
        { width: info.width, height: info.height },
        {
          schemaVersion: 1,
          format: "png",
          fit: "contain",
          background: "transparent",
          targets: [],
          resample: "lanczos3",
        },
      );
      await this.files.save(raster, png);
      return [raster.id, asset.id];
    } catch (error) {
      const current = this.store.get("assets", raster.id);
      if (current.availability === "staging")
        this.store.update("assets", raster.id, { availability: "missing" });
      throw error;
    }
  }
  async upload(
    taskId: string,
    name: string,
    bytes: Uint8Array,
    intent: ImageIntent,
    kind: "upload" | "import" = "upload",
    candidateId?: string,
  ) {
    this.store.task(taskId);
    if (!name || name.length > 200 || /[\/\\\x00-\x1f]/.test(name))
      imageError("INVALID_INPUT", "文件名无效", 400);
    if (bytes.length > 20 * 1024 * 1024)
      imageError("REQUEST_TOO_LARGE", "参考图超过 20MiB", 413);
    const input = {
      name,
      sha256: bytesHash(bytes),
      ...(candidateId ? { candidateId } : {}),
    };
    const old = this.existing(kind, `task:${taskId}`, intent, input);
    if (old) return this.referenceResult(old);
    const task = this.store.task(taskId);
    if (this.store.draft(task.conversation_id, taskId).referenceIds.length >= 4)
      imageError("IMAGE_PARAMETERS_INVALID", "当前参考图最多四张，请先取消参考", 422);
    const { command, asset } = this.store.transaction(() => {
      const command = this.command(
        kind,
        `task:${taskId}`,
        intent,
        input,
        task.conversation_id,
      );
      const directory = randomUUID();
      return {
        command,
        asset: this.reserveAsset(
          taskId,
          null,
          "reference",
          name,
          `${taskId}/references/${directory}/original.png`,
        ),
      };
    });
    try {
      const assetIds = await this.saveReference(asset, bytes);
      const c = this.store.transaction(() => {
        this.selectUploaded(taskId, [assetIds[0]]);
        return this.complete(command, { assetIds });
      });
      this.changed();
      return this.referenceResult(c);
    } catch (e) {
      const current = this.store.get("assets", asset.id);
      if (current.availability === "staging")
        this.store.update("assets", asset.id, { availability: "missing" });
      this.fail(command, e);
      this.changed();
      throw Object.assign(e instanceof Error ? e : new Error("上传失败"), {
        commandId: command.id,
      });
    }
  }
  async candidates(taskId: string, cursor: string | null, limit: number) {
    this.store.task(taskId);
    const all = await this.files.candidates(taskId);
    return this.page(
      all.map((a) => ({ ...a, id: a.candidateId, created_at: a.name })),
      cursor,
      limit,
    );
  }
  async import(taskId: string, input: unknown, intent: ImageIntent) {
    const v = object(input, ["candidateId", "expectedSha256"]);
    const id = string(v.candidateId, 1000),
      expected = string(v.expectedSha256, 64);
    const task = this.store.task(taskId);
    const previous = this.existing("import", `task:${taskId}`, intent, v);
    if (previous) return this.referenceResult(previous);
    const { command, asset } = this.store.transaction(() => {
      const command = this.command(
        "import",
        `task:${taskId}`,
        intent,
        v,
        task.conversation_id,
      );
      return {
        command,
        asset: this.reserveAsset(
          taskId,
          null,
          "reference",
          "导入图片.png",
          `${taskId}/references/${randomUUID()}/original.png`,
        ),
      };
    });
    try {
      const source = await this.files.importCandidate(taskId, id, expected);
      const reference = this.store.update("assets", asset.id, {
        original_name: source.name,
      });
      const assetIds = await this.saveReference(reference, source.bytes);
      const completed = this.store.transaction(() => {
        this.selectUploaded(taskId, [assetIds[0]]);
        return this.complete(command, { assetIds });
      });
      this.changed();
      return this.referenceResult(completed);
    } catch (error) {
      const current = this.store.get("assets", asset.id);
      if (current.availability === "staging")
        this.store.update("assets", asset.id, { availability: "missing" });
      this.fail(command, error);
      this.changed();
      throw Object.assign(
        error instanceof Error ? error : new Error("导入失败"),
        { commandId: command.id },
      );
    }
  }
  private async profile(input: PlanInput) {
    if (input.operation === "process") return null;
    const configuration = await this.providers.configuration();
    const id = input.profileId ?? configuration.defaultProfileId;
    const profile = configuration.profiles.find((p) => p.id === id);
    if (!profile)
      imageError(
        "IMAGE_PROVIDER_UNAVAILABLE",
        "请选择已配置的官方图片模型",
        503,
      );
    await this.providers.authorize(profile);
    return profile;
  }
  async preparePlan(
    taskId: string,
    input: unknown,
    intent: ImageIntent,
    planning?: { command: Row; snapshot: Row; signal: AbortSignal; profiles: Row[] },
    forceNew = false,
  ) {
    const v = validatePlan(input);
    const userSnapshot = planning?.snapshot;
    if (planning && userSnapshot) {
      if (!v.intent.trim() || (v.operation !== "process" && !v.prompt.trim()))
        imageError("IMAGE_PARAMETERS_INVALID", "intent 和生成／修改的 prompt 必须包含正文", 422);
      if (userSnapshot.inputMode && v.inputMode !== userSnapshot.inputMode)
        imageError("IMAGE_PARAMETERS_INVALID", "图片处理方式与用户选择不一致", 422);
      if (userSnapshot.operation && v.operation !== userSnapshot.operation)
        imageError("IMAGE_PARAMETERS_INVALID", "operation 与用户指定的图片操作不一致", 422);
      if (canonical(v.inputs.map(i => i.assetId)) !== canonical(userSnapshot.referenceIds))
        imageError("IMAGE_PARAMETERS_INVALID", "inputs 必须保留本次参考图及其顺序", 422);
      if (userSnapshot.outputSpec && canonical(v.outputSpec) !== canonical(userSnapshot.outputSpec))
        imageError("IMAGE_PARAMETERS_INVALID", "outputSpec 与用户指定的输出规范不一致", 422);
      if (v.operation !== "process" && (!v.profileId ||
          userSnapshot.profileId && v.profileId !== userSnapshot.profileId))
        imageError("IMAGE_PARAMETERS_INVALID", "profileId 与本轮图片模型不一致", 422);
      for (const [key, value] of Object.entries(userSnapshot.explicitParameters)) {
        if (v.operation === "process" || (key in v.parameters && canonical(v.parameters[key]) !== canonical(value)))
          imageError("IMAGE_PARAMETERS_INVALID", `parameters.${key} 与用户指定值不一致`, 422);
        v.parameters[key] = value;
      }
    }
    this.store.task(taskId);
    const profile = await this.profile(v);
    const values = profile ? this.providers.parameters(profile, v.parameters) : {};
    const bases = v.inputs.filter(input => input.purpose === "base").map(input => {
      const asset = this.readyAsset(input.assetId);
      if (asset.task_id !== taskId) imageError("NOT_FOUND", "输入图片不属于当前任务", 404);
      return asset.source_asset_id ? this.store.get("assets", asset.source_asset_id) : asset;
    });
    v.inputMode ??= userSnapshot?.inputMode ?? (bases.length <= 1 || v.operation === "process" ? "separate" : undefined);
    if (!v.inputMode && bases.length > 1 && v.operation === "edit") imageError("IMAGE_TARGET_AMBIGUOUS", "请选择分别修改或共同参考", 422);
    v.inputMode ??= "joint";
    if (!v.outputRoots) v.outputRoots = v.outputSpec.targets.map(target => {
      if (v.operation === "generate" || v.inputMode === "joint" && v.operation === "edit") return {rootAssetId: null};
      const perInput = Number(values.n ?? 1);
      const base = v.operation === "process" ? bases[target.sourceIndex] : bases[Math.floor(target.sourceIndex / perInput)];
      if (!base?.root_asset_id) imageError("IMAGE_TARGET_AMBIGUOUS", "请选择输出对应的原图，或明确共同参考生成新图", 422);
      return {rootAssetId: base.root_asset_id};
    });
    for (const [index, root] of v.outputRoots.entries()) {
      if ((v.operation === "generate" || v.operation === "edit" && v.inputMode === "joint") && root.rootAssetId !== null) imageError("IMAGE_TARGET_AMBIGUOUS", "共同参考成果须作为新图", 422);
      if (v.operation === "process" || v.operation === "edit" && v.inputMode === "separate") {
        const target = v.outputSpec.targets[index];
        const base = bases[v.operation === "process" ? target.sourceIndex : Math.floor(target.sourceIndex / Number(values.n ?? 1))];
        if (!base || root.rootAssetId !== base.root_asset_id) imageError("IMAGE_TARGET_AMBIGUOUS", "分别修改的输出与原图不匹配", 422);
      }
      if (root.rootAssetId === null) continue;
      const original = this.store.get("assets", root.rootAssetId);
      if (original.task_id !== taskId || original.root_asset_id !== original.id || !bases.some(base => base.root_asset_id === original.id)) imageError("IMAGE_TARGET_AMBIGUOUS", "输出原图不属于本次输入", 422);
    }
    const old = this.existing("prepare_plan", `task:${taskId}`, intent, v);
    if (old) return this.planResult(old);
    if (profile && planning && !planning.profiles.some(p => p.id === profile.id && p.configHash === profile.configHash))
      imageError("IMAGE_PARAMETERS_INVALID", "profileId 在规划期间发生变化或不可用", 422);
    if (profile && planning) await this.providers.authorize(profile);
    if (profile && v.inputs.length > profile.limits.maxInputs)
      imageError("IMAGE_PARAMETERS_INVALID", "参考图片数量超过模型限制", 422);
    if (
      profile?.provider === "openai" &&
      v.operation === "generate" &&
      v.inputs.length
    )
      imageError(
        "IMAGE_PARAMETERS_INVALID",
        "该官方生成接口不接受参考图，请使用修改操作",
        422,
      );
    for (const i of v.inputs) {
      const a = this.readyAsset(i.assetId);
      if (a.task_id !== taskId) imageError("NOT_FOUND", "输入图片不属于当前任务", 404);
      if (
        profile &&
        (a.byte_size > (profile.limits.maxInputBytes ?? 20 * 1024 * 1024) ||
          a.width * a.height > (profile.limits.maxInputPixels ?? 40_960_000))
      )
        imageError("IMAGE_PARAMETERS_INVALID", "参考图片超过模型容量限制", 422);
      if (v.operation !== "process" && a.mime_type === "image/svg+xml")
        imageError(
          "IMAGE_PARAMETERS_INVALID",
          "官方图片接口请选择 SVG 转换后的 PNG 参考资源",
          422,
        );
      await this.files.read(a);
    }
    if (
      v.outputSpec.targets.some(
        (t) =>
          t.sourceIndex >=
          (v.operation === "process" ? v.inputs.length : Number(values.n ?? 1) * (v.operation === "edit" && v.inputMode === "separate" ? bases.length : 1)),
      )
    )
      imageError("IMAGE_PARAMETERS_INVALID", "输出源图序号超出母图数", 422);
    const { credentialRef: _, defaults: __, baseUrl: ___, ...publicProfile } = profile ?? {};
    const planHash = hash({
      ...v,
      profileId: undefined,
      profile: profile ? publicProfile : null,
      parameters: values,
    });
    planning?.signal.throwIfAborted();
    const result = this.store.transaction(() => {
      if (planning && this.store.get("commands", planning.command.id).status !== "running")
        imageError("PLAN_STALE", "本轮规划已经结束");
      const replay = this.existing("prepare_plan", `task:${taskId}`, intent, v);
      if (replay) return this.planResult(replay);
      const current = this.store.task(taskId);
      if (planning && String(current.revision) !== intent.match)
        imageError("PLAN_STALE", "任务已变化，拒绝本轮迟到方案");
      this.revision(current, intent.match);
      if(this.interrupts.has(taskId) || this.store.busyTask(taskId))imageError("IMAGE_TASK_BUSY","任务执行或结果通知尚未结束");
      const command = this.command(
        "prepare_plan",
        `task:${taskId}`,
        intent,
        v,
        current.conversation_id,
      );
      let plan = forceNew ? undefined : this.store.find("plans", {
        task_id: taskId,
        plan_hash: planHash,
      });
      const planCreated = !plan;
      if (!plan) {
        const time = now();
        plan = this.store.insert("plans", {
          id: randomUUID(),
          task_id: taskId,
          conversation_id: current.conversation_id,
          command_id: command.id,
          operation: v.operation,
          intent: v.intent,
          preserve_text: v.preserve,
          prompt: v.prompt,
          profile_snapshot_json: profile ? canonical(profile) : null,
          parameters_json: canonical({ schemaVersion: 1, values }),
          parameter_sources_json: canonical({
            schemaVersion: 1,
            fields: Object.fromEntries([
              ...Object.keys(values).map((k) => [
                `parameters.${k}`,
                {
                  source:
                    k in v.parameters
                      ? planning &&
                        !(k in (userSnapshot?.explicitParameters ?? {}))
                        ? "llm"
                        : "user"
                      : "default",
                  ...(planning ? { originCommandId: planning.command.id } : {}),
                },
              ]),
              ...[
                "format",
                "fit",
                "background",
                "targets",
                "resample",
                ...(v.outputSpec.quality ? ["quality"] : []),
              ].map((k) => [
                `outputSpec.${k}`,
                {
                  source: planning && !userSnapshot?.outputSpec ? "llm" : "user",
                  ...(planning ? { originCommandId: planning.command.id } : {}),
                },
              ]),
            ]),
          }),
          output_spec_json: canonical(v.outputSpec),
          output_roots_json: canonical(v.outputRoots),
          input_mode: v.inputMode,
          plan_hash: planHash,
          created_at: time,
        });
        for (const i of v.inputs)
          this.store.insert("plan_inputs", {
            plan_id: plan.id,
            asset_id: i.assetId,
            purpose: i.purpose,
            position: i.position,
          });
      }
      const execution = this.store.find("executions", { plan_id: plan.id });
      let selected = false;
      let updated = current;
      if (!execution) {
        updated = planCreated
          ? this.store.update("tasks", current.id, {revision:current.revision+1,updated_at:now()}, current.revision)
          : current;
        selected = true;
      }
      const c = this.complete(command, {
        planIds: [plan.id],
        selection: { taskRevision: updated.revision, selected },
        existingExecutionId: execution?.id ?? null,
        planCreated,
      });
      if (planning) this.finishPlanning(planning.command, plan, userSnapshot!, !!execution);
      return this.planResult(c);
    });
    this.changed();
    return result;
  }
  private planResult(command: Row) {
    const r = parse(command.result_json);
    return {
      plan: this.planDTO(this.store.get("plans", r.planIds[0])),
      taskRevision: r.selection.taskRevision,
      selected: r.selection.selected,
      existingExecutionId: r.existingExecutionId ?? null,
      created: r.planCreated ?? false,
    };
  }
  private validateConfirm(taskId: string, input: Record<string, unknown>) {
    const t=this.store.task(taskId);
    const p=this.store.find("plans",{id:String(input.planId)});
    if(!p)imageError("PLAN_STALE","当前方案已被替换");
    if (p.task_id !== t.id) imageError("NOT_FOUND", "方案不属于该任务", 404);
    if (
      t.current_plan_id !== p.id ||
      t.revision !== input.taskRevision ||
      p.plan_hash !== input.hash
    )
      imageError("PLAN_STALE", "方案或任务版本已变化");
    return p;
  }
  private validateReady(plan: Row) {
    for (const i of this.store.list("plan_inputs", { plan_id: plan.id }))
      this.readyAsset(i.asset_id);
    if (this.interrupts.has(plan.task_id) || this.store.busyTask(plan.task_id))
      imageError("IMAGE_TASK_BUSY", "任务已有活动执行");
  }
  private createExecution(
    plan: Row,
    command: Row,
    mode: "confirm" | "skip_once" | "restart",
    source: Row | null = null,
  ) {
    const id = randomUUID();
    const e = this.store.insert("executions", {
      id,
      task_id: plan.task_id,
      plan_id: plan.id,
      restart_of_execution_id: source?.id ?? null,
      authorization_command_id: command.id,
      authorization_mode: mode,
      revision: 1,
      status: "queued",
      phase: "queued",
      provider_outcome: "none",
      notification_state: "none",
      created_at: now(),
    });
    for (const target of (parse(plan.output_spec_json) as OutputSpec).targets)
      this.reserveAsset(
        plan.task_id,
        id,
        "output",
        target.name,
        `${plan.task_id}/executions/${id}/outputs/${target.name}`,
        target.name,
      );
    return e;
  }
  async confirm(taskId: string, input: unknown, intent: ImageIntent) {
    const v = object(input, ["planId", "hash", "taskRevision"]);
    string(v.planId, 100);
    string(v.hash, 100);
    integer(v.taskRevision, 1, Number.MAX_SAFE_INTEGER);
    const task = this.store.task(taskId);
    const result = (c: Row) => ({
      command: this.commandDTO(c),
      execution: this.getExecution(parse(c.result_json).executionIds[0]),
    });
    const old = this.existing("confirm", `task:${taskId}`, intent, v);
    if (old) return result(old);
    const plan = this.validateConfirm(taskId, v);
    if (plan.profile_snapshot_json)
      await this.providers.authorize(parse(plan.profile_snapshot_json));
    for (const i of this.store.list("plan_inputs", { plan_id: plan.id }))
      await this.files.read(this.readyAsset(i.asset_id));
    const command = this.store.transaction(() => {
      const replay = this.existing("confirm", `task:${taskId}`, intent, v);
      if (replay) return replay;
      const current = this.validateConfirm(taskId, v);
      this.validateReady(current);
      if (this.store.list("executions", { plan_id: current.id }).length)
        imageError("PLAN_ALREADY_EXECUTED", "方案已经受理，请查看原执行");
      const c = this.command(
        "confirm",
        `task:${taskId}`,
        intent,
        v,
        task.conversation_id,
      );
      const e = this.createExecution(current, c, "confirm");
      return this.complete(c, { executionIds: [e.id], planIds: [current.id] });
    });
    this.changed();
    this.wake();
    return result(command);
  }
  async restartExecution(id: string, input: unknown, intent: ImageIntent) {
    const v = object(input, [
      "planHash",
      "taskRevision",
      "acceptUnknownOutcome",
    ]);
    string(v.planHash, 100);
    integer(v.taskRevision, 1, Number.MAX_SAFE_INTEGER);
    if (
      v.acceptUnknownOutcome !== undefined &&
      typeof v.acceptUnknownOutcome !== "boolean"
    )
      imageError("INVALID_INPUT", "未知结果确认值无效", 400);
    const successor = this.store.find("executions", { restart_of_execution_id: id });
    if (successor)
      return {
        command: this.getCommand(successor.authorization_command_id),
        execution: this.executionDTO(successor),
      };
    const source=this.store.get("executions",id),plan=this.store.get("plans",source.plan_id);
    const old = this.existing(
      "restart_execution",
      `execution:${id}`,
      intent,
      v,
    );
    if (old)
      return {
        command: this.commandDTO(old),
        execution: this.getExecution(parse(old.result_json).executionIds[0]),
      };
    if (plan.profile_snapshot_json)
      await this.providers.authorize(parse(plan.profile_snapshot_json));
    for (const i of this.store.list("plan_inputs", { plan_id: plan.id }))
      await this.files.read(this.readyAsset(i.asset_id));
    const result = this.store.transaction(() => {
      const successor = this.store.find("executions", {
        restart_of_execution_id: id,
      });
      if (successor)
        return {
          command: this.getCommand(successor.authorization_command_id),
          execution: this.executionDTO(successor),
        };
      const s = this.store.get("executions", id),
        t = this.store.task(s.task_id);
      if(this.interrupts.has(t.id) || this.store.busyTask(t.id))imageError("IMAGE_TASK_BUSY","任务执行或结果通知尚未结束");
      if (
        s.status !== "failed" ||
        this.store.list("executions", { task_id: t.id }).at(-1)?.id !== id
      )
        imageError("IMAGE_RESTART_NOT_ALLOWED", "仅最新失败执行可以重新开始");
      if (t.revision !== v.taskRevision || plan.plan_hash !== v.planHash)
        imageError("PLAN_STALE", "方案或任务版本已变化");
      if (s.provider_outcome === "unknown" && v.acceptUnknownOutcome !== true)
        imageError(
          "IMAGE_RESTART_ACK_REQUIRED",
          "上次请求可能已生成或计费，重新开始会发起新请求",
          422,
        );
      this.validateReady(plan);
      const command = this.command(
        "restart_execution",
        `execution:${id}`,
        intent,
        v,
        t.conversation_id,
      );
      const e = this.createExecution(plan, command, "restart", s);
      const c = this.complete(command, {
        executionIds: [e.id],
        planIds: [plan.id],
      });
      return { command: this.commandDTO(c), execution: this.executionDTO(e) };
    });
    this.changed();
    this.wake();
    return result;
  }
  async message(conversationId: string, input: unknown, intent: ImageIntent) {
    const v = object(input, [
      "draftId",
      "skipConfirmation",
      "autoExecuteLimits",
      "mode",
    ]);
    const mode = v.mode ?? "discuss";
    if (mode !== "discuss" && mode !== "generate") imageError("INVALID_INPUT", "发送模式无效", 400);
    if (mode === "generate" && v.skipConfirmation === false) imageError("INVALID_INPUT", "直接生成不能仅规划", 400);
    string(v.draftId, 100);
    if (v.skipConfirmation === undefined) v.skipConfirmation = true;
    if (v.skipConfirmation === true && v.autoExecuteLimits === undefined)
      v.autoExecuteLimits = defaultLimits;
    if (typeof v.skipConfirmation !== "boolean")
      imageError("INVALID_INPUT", "需要明确本次确认方式", 400);
    if (v.skipConfirmation) validateLimits(v.autoExecuteLimits);
    else if (v.autoExecuteLimits !== undefined)
      imageError("INVALID_INPUT", "未跳过确认时不接受自动执行限额", 400);
    this.store.conversation(conversationId);
    const draft = this.store.get("drafts", String(v.draftId));
    if (draft.conversation_id !== conversationId)
      imageError("NOT_FOUND", "草稿不存在", 404);
    const old = this.existing(
      "message",
      `conversation:${conversationId}`,
      intent,
      v,
    );
    if (old) return this.commandDTO(old);
    const command = this.store.transaction(() => {
      const d = this.store.get("drafts", draft.id);
      this.revision(d, intent.match);
      if (this.store.busyConversation(conversationId))
        imageError("IMAGE_DISCUSSION_BUSY", "讨论正在处理上一条输入");
      let referenceIds = this.store
        .list("draft_inputs", { draft_id: d.id })
        .map((i) => i.asset_id);
      if (!d.text.trim() && !referenceIds.length)
        imageError("INVALID_INPUT", "请输入要求或选择图片", 400);
      const parameters = parse(d.parameters_json);
      let taskId = d.task_id;
      if (!taskId) {
        const tasks = this.store.list("tasks", {
          conversation_id: conversationId,
        });
        if (tasks.length > 1)
          imageError("IMAGE_TASK_REQUIRED", "请先选择本次图片任务", 400);
        taskId =
          tasks[0]?.id ??
          this.insertTask(this.store.conversation(conversationId), "图片任务")
            .task.id;
      }
      const task = this.store.task(taskId, conversationId);
      if (this.interrupts.has(taskId)) imageError("IMAGE_TASK_BUSY", "任务正在终止");
      for (const assetId of referenceIds) {
        const asset = this.readyAsset(assetId);
        if (asset.task_id !== taskId) imageError("NOT_FOUND", "参考图不属于当前任务", 404);
      }
      const snapshot = {
        text: d.text,
        mode,
        taskId,
        taskRevision: task.revision,
        profileId: d.profile_id,
        operation: parameters.operation ?? null,
        inputMode: parameters.inputMode ?? null,
        explicitParameters: parameters.explicitParameters,
        outputSpec: parameters.outputSpec ?? null,
        referenceIds,
        skipConfirmation: v.skipConfirmation,
        autoExecuteLimits: v.autoExecuteLimits ?? null,
      };
      const c = this.command(
        "message",
        `conversation:${conversationId}`,
        intent,
        v,
        conversationId,
        {
          request_json: canonical({
            schemaVersion: 1,
            ...v,
            draftSnapshot: snapshot,
          }),
          auto_execution_state: v.skipConfirmation
            ? "pending"
            : "not_requested",
        },
      );
      this.store.update(
        "drafts",
        d.id,
        {
          text: "",
          parameters_json: canonical({
            schemaVersion: 1,
            explicitParameters: {},
          }),
          revision: d.revision + 1,
          updated_at: now(),
        },
        d.revision,
      );
      this.store.replaceDraftInputs(d.id, referenceIds);
      return c;
    });
    this.changed();
    this.dispatchMessage(command.id);
    return this.commandDTO(command);
  }
  private dispatchMessage(id: string, initialize?: (signal: AbortSignal) => Promise<void>) {
    const command = this.store.get("commands", id);
    const controller = new AbortController();
    const settled = this.lane(command.conversation_id, async () => {
      try {
        await initialize?.(controller.signal);
        await this.runMessage(id, controller.signal);
      } catch (error) {
        this.fail(command, controller.signal.aborted ? interrupted() : error);
        this.changed();
      } finally {
        this.messages.delete(id);
      }
    });
    this.messages.set(id, { controller, settled });
    void settled.catch(() => {});
  }
  private async runMessage(id: string, signal: AbortSignal) {
    let command = this.store.get("commands", id);
    const snapshot = parse(command.request_json).draftSnapshot;
    try {
      signal.throwIfAborted();
      const conversation = this.store.conversation(command.conversation_id);
      if (!conversation.native_ref_json)
        imageError("IMAGE_HISTORY_UNAVAILABLE", "图片历史缺失");
      const taskRevision = snapshot.taskRevision ?? this.store.task(snapshot.taskId, command.conversation_id).revision;
      command = this.store.update("commands", id, {
        status: "running", dispatch_started_at: now(), revision: command.revision + 1,
      });
      this.changed();
      const attachments = [];
      const references = [];
      for (const assetId of snapshot.referenceIds) {
        signal.throwIfAborted();
        const asset = this.readyAsset(assetId);
        references.push({ assetId, name: asset.original_name, width: asset.width, height: asset.height, mimeType: asset.mime_type });
        attachments.push({ bytes: await this.files.read(asset), mimeType: asset.mime_type });
      }
      if (snapshot.mode === "generate") {
        signal.throwIfAborted();
        await this.discussion.recordInput(parse(conversation.native_ref_json), command, attachments, patch => {
          const current = this.store.get("commands", id);
          this.store.update("commands", id, { ...patch, revision: current.revision + 1 });
        });
        const operation = snapshot.operation ?? (snapshot.referenceIds.length ? "edit" : "generate");
        const configuration = await this.providers.configuration();
        const profile = operation === "process" ? null : configuration.profiles.find(p => p.id === (snapshot.profileId ?? configuration.defaultProfileId));
        if (operation !== "process" && !profile) imageError("IMAGE_PROVIDER_UNAVAILABLE", "没有可用图片模型", 503);
        if (operation === "process" && Object.keys(snapshot.explicitParameters).length)
          imageError("IMAGE_PARAMETERS_INVALID", "本地处理不接受图片模型参数", 422);
        const parameters = operation === "process" ? {} : snapshot.explicitParameters;
        const inputMode = snapshot.inputMode ?? (snapshot.referenceIds.length <= 1 || operation === "process" ? "separate" : null);
        if (!inputMode && operation === "edit") imageError("IMAGE_TARGET_AMBIGUOUS", "请选择分别修改或共同参考", 422);
        const count = operation === "process" ? snapshot.referenceIds.length : Number(parameters.n ?? profile?.defaults.n ?? 1) * (operation === "edit" && inputMode === "separate" ? snapshot.referenceIds.length : 1);
        const outputSpec = snapshot.outputSpec ?? {
          schemaVersion: 1, format: "png", fit: "contain", background: "transparent", resample: "lanczos3",
          targets: Array.from({ length: Math.min(33, Math.max(1, count)) }, (_, index) => ({
            name: `image-${index + 1}.png`, width: 1024, height: 1024, sourceIndex: index,
          })),
        };
        if (operation !== "process" && !snapshot.text.trim()) imageError("IMAGE_PARAMETERS_INVALID", "直接生成需要提示词", 422);
        signal.throwIfAborted();
        await this.preparePlan(snapshot.taskId, {
          operation, inputMode: inputMode ?? "joint", intent: snapshot.text || "按参数处理图片", preserve: "", prompt: operation === "process" ? "" : snapshot.text,
          profileId: profile?.id ?? null, parameters,
          inputs: snapshot.referenceIds.map((assetId: string, position: number) => ({ assetId, purpose: operation === "generate" ? "reference" : "base", position })), outputSpec,
        }, { key: id, match: String(taskRevision) }, {command, snapshot, signal, profiles: configuration.profiles}, true);
        const plan = this.store.get("plans", this.store.task(snapshot.taskId).current_plan_id);
        this.store.transaction(() => {
          signal.throwIfAborted();
          if (this.store.get("commands", id).status !== "running") imageError("PLAN_STALE", "本次生成已结束");
          this.finishPlanning(command, plan, snapshot, false);
        });
        return;
      }
      const capabilities = await this.capabilities();
      const profiles = capabilities.profiles.filter(p => p.available);
      const planning = {
        profiles, defaultProfileId: capabilities.defaultProfileId,
        outputLimits: capabilities.outputLimits, references, logoPreset: logoOutput,
        operations: capabilities.operations,
        images: this.getTask(snapshot.taskId).images,
        currentPlan: (() => {
          const task = this.store.task(snapshot.taskId, conversation.id);
          return task.current_plan_id ? this.planDTO(this.store.get("plans", task.current_plan_id)) : null;
        })(),
      };
      signal.throwIfAborted();
      const raw = await this.discussion.prompt(
        parse(conversation.native_ref_json), command, planning, attachments,
        patch => {
          const current = this.store.get("commands", id);
          this.store.update("commands", id, { ...patch, revision: current.revision + 1 });
        },
        () => this.changed(), signal,
      );
      signal.throwIfAborted();
      let response: unknown;
      try { response = JSON.parse(raw); } catch {
        imageError("IMAGE_PLAN_INVALID", "规划响应必须是一个完整的 JSON 对象", 422);
      }
      if (response && typeof response === "object" && !Array.isArray(response) && "action" in response) {
        const reply = response as Record<string, unknown>;
        const keys = reply.action === "discuss" ? ["action", "reply"] : ["action", "reply", "plan"];
        if (!["discuss", "execute"].includes(String(reply.action)) ||
            typeof reply.reply !== "string" || !reply.reply.trim() ||
            Object.keys(reply).some(key => !keys.includes(key)) ||
            (reply.action === "execute" && (!reply.plan || typeof reply.plan !== "object" || Array.isArray(reply.plan))))
          imageError("IMAGE_PLAN_INVALID", "回复必须是有效的讨论或执行对象，并包含非空 reply", 422);
        if (reply.action === "discuss") {
          this.store.transaction(() => {
            signal.throwIfAborted();
            const current = this.store.get("commands", id);
            if (current.status !== "running") imageError("IMAGE_DISCUSSION_BUSY", "当前消息已结束");
            this.store.update("commands", id, { auto_execution_state: "not_requested", auto_execution_reason: "DISCUSSION_ONLY" });
            this.complete(current, { planIds: [], executionIds: [] });
          });
          return;
        }
        response = reply.plan;
      }
      try {
        await this.preparePlan(snapshot.taskId, response, { key: id, match: String(taskRevision) },
          { command, snapshot, signal, profiles });
      } catch (error) {
        if (error instanceof DomainError && [400, 404, 413, 415, 422].includes(error.status))
          imageError("IMAGE_PLAN_INVALID", `规划校验失败：${error.message}`, 422);
        throw error;
      }
    } catch (error) {
      this.fail(command, signal.aborted ? interrupted() : error);
    } finally {
      this.changed();
      this.wake();
    }
  }
  private finishPlanning(command: Row, plan: Row, snapshot: Row, executed: boolean) {
    let execution: Row | null = null;
    if (snapshot.skipConfirmation) {
      const limits = validateLimits(snapshot.autoExecuteLimits);
      const requests = plan.operation === "process" ? 0 : plan.operation === "edit" && plan.input_mode === "separate" ? this.store.list("plan_inputs", {plan_id: plan.id}).length : 1;
      const generated = requests * Number(parse(plan.parameters_json).values.n ?? 1);
      const outputs = parse(plan.output_spec_json).targets.length;
      const allowed = requests <= limits.maxImageRequests && generated <= limits.maxGeneratedImages && outputs <= limits.maxOutputs;
      if (!executed && allowed) {
        this.validateReady(plan);
        execution = this.createExecution(plan, command, "skip_once");
      }
      this.store.update("commands", command.id, {
        auto_execution_state: execution ? "admitted" : executed ? "not_requested" : "needs_confirmation",
        auto_execution_reason: execution ? null : executed ? "PLAN_ALREADY_EXECUTED" : "AUTO_EXECUTE_LIMIT",
      });
    }
    this.complete(command, { planIds: [plan.id], executionIds: execution ? [execution.id] : [] });
  }
  async restartCommand(id: string, input: unknown, intent: ImageIntent) {
    object(input, []);
    const successor = this.store.find("commands", { restart_of_command_id: id });
    if (successor) return this.commandDTO(successor);
    const source = this.store.get("commands", id);
    this.inputKey(intent);
    this.revision(source, intent.match);
    if (
      !["message", "create_conversation"].includes(source.kind) ||
      source.status !== "failed"
    )
      imageError(
        source.status === "running" || source.status === "accepted"
          ? "IMAGE_DISCUSSION_BUSY"
          : "IMAGE_RESTART_NOT_ALLOWED",
        "该命令当前不能重新开始",
      );
    if (source.kind === "create_conversation") {
      const { schemaVersion: _, ...original } = parse(source.request_json);
      const result = await this.createConversation(original, intent, id);
      return result.command;
    }
    this.tree(source.conversation_id);
    const c = this.store.transaction(() => {
      if (this.store.busyConversation(source.conversation_id))
        imageError("IMAGE_DISCUSSION_BUSY", "讨论正在处理");
      const request = parse(source.request_json);
      if (this.interrupts.has(request.draftSnapshot.taskId)) imageError("IMAGE_TASK_BUSY", "任务正在终止");
      request.skipConfirmation = false;
      request.draftSnapshot.skipConfirmation = false;
      request.draftSnapshot.taskRevision = this.store.task(request.draftSnapshot.taskId, source.conversation_id).revision;
      request.draftSnapshot.autoExecuteLimits = null;
      delete request.autoExecuteLimits;
      return this.command(
        "message",
        `command:${id}`,
        intent,
        request,
        source.conversation_id,
        { restart_of_command_id: id },
      );
    });
    this.changed();
    this.dispatchMessage(c.id);
    return this.commandDTO(c);
  }
  async interrupt(taskId: string, input: unknown, intent: ImageIntent) {
    this.inputKey(intent);
    const target = object(input, ["commandId", "executionId"]);
    for (const id of Object.values(target)) if (!string(id, 100)) imageError("INVALID_INPUT", "终止对象无效", 400);
    if (!target.commandId && !target.executionId)
      imageError("INVALID_INPUT", "必须指定要终止的规划或执行", 400);
    const task = this.store.task(taskId);
    const scope = `task:${taskId}`;
    const noVersion = { key: intent.key, match: null };
    const old = this.existing("interrupt", scope, noVersion, target);
    const pending = this.interrupts.get(taskId);
    if (pending) {
      if (canonical(target) !== canonical(pending.target))
        imageError(pending.key === intent.key ? "IDEMPOTENCY_CONFLICT" : "PLAN_STALE", "正在终止的对象不同");
      return this.waitForInterrupt(pending.result);
    }
    const discussion = parse(this.store.conversation(task.conversation_id).discussion_json);
    const execution = parse(task.execution_json);
    if (target.commandId && (target.commandId !== discussion?.id ||
        parse(discussion.request_json)?.draftSnapshot?.taskId !== taskId)) {
      const other = this.store.find("commands", { id: target.commandId });
      const receipt = parse(task.receipts_json)?.interrupt;
      const previousTarget = parse(receipt?.request_json)?.commandId === target.commandId ||
        discussion?.restart_of_command_id === target.commandId;
      let nativeTaskId: string | undefined;
      if (!other && !previousTarget && this.store.conversation(task.conversation_id).native_ref_json) {
        const tree = this.tree(task.conversation_id) as { entries: Array<{ entry: Row }> };
        nativeTaskId = tree.entries.find(({ entry }) => entry.type === "custom" && entry.customType === "image-command" &&
          entry.data?.commandId === target.commandId)?.entry.data?.taskId;
      }
      if (previousTarget || nativeTaskId === taskId || parse(other?.request_json)?.draftSnapshot?.taskId === taskId)
        imageError("PLAN_STALE", "当前规划已经替换");
      imageError("NOT_FOUND", "该规划不存在或不属于当前任务", 404);
    }
    if (target.executionId && target.executionId !== execution?.id) {
      const oldAssets = this.store.list("assets", { task_id: taskId, execution_id: target.executionId });
      if (oldAssets.length || execution?.restart_of_execution_id === target.executionId)
        imageError("PLAN_STALE", "当前执行已经替换");
      imageError("NOT_FOUND", "该执行不存在或不属于当前任务", 404);
    }
    if (old) {
      const detail = this.getTask(taskId);
      return { task: detail.task, latestExecution: detail.latestExecution };
    }
    const planning = target.commandId && ["accepted", "running"].includes(discussion.status);
    const running = target.executionId && active(execution);
    const chat = planning ? this.messages.get(discussion.id) : null;
    const work = running ? this.executions.get(execution.id) : null;
    if (planning && !chat || running && execution.status !== "queued" && !work)
      imageError("IMAGE_INTERRUPT_UNCERTAIN", "无法确认该活动请求的控制句柄");
    const result = Promise.resolve().then(async () => {
      try {
        chat?.controller.abort(interrupted());
        if (work) work.controller.abort(interrupted());
        else if (running && this.store.get("executions", execution.id).status === "queued") {
          this.finishExecution(execution.id, "failed", "IMAGE_TASK_INTERRUPTED");
          void this.lane(task.conversation_id, () => this.notify(execution.id)).catch(() => {});
        }
        await Promise.all([chat?.settled, work?.settled]);
        if (planning && ["accepted", "running"].includes(this.store.get("commands", discussion.id).status) ||
            running && active(this.store.get("executions", execution.id)))
          imageError("IMAGE_INTERRUPT_UNCERTAIN", "尚未确认工作结束");
        this.interrupts.delete(taskId);
        const detail = this.getTask(taskId);
        const response = { task: detail.task, latestExecution: detail.latestExecution };
        this.store.transaction(() => {
          const receipt = this.command("interrupt", scope, noVersion, target, task.conversation_id);
          this.complete(receipt, {});
        });
        return response;
      } finally {
        this.interrupts.delete(taskId);
        this.changed();
      }
    });
    this.interrupts.set(taskId, { key: intent.key, target, result });
    this.changed();
    return this.waitForInterrupt(result);
  }
  private async waitForInterrupt(result: Promise<unknown>) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([result, new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new DomainError("IMAGE_INTERRUPT_UNCERTAIN", "仍在等待实际工作结束", 409, true)), 15_000);
        timeout.unref();
      })]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  private wake() {
    if (this.working) return;
    this.working = true;
    setImmediate(() => {
      void this.drain().finally(() => {
        this.working = false;
        if (this.store.list("executions", { status: "queued" }).length)
          this.wake();
      });
    });
  }
  private async drain() {
    let concurrency = 1;
    try {
      concurrency = (await this.providers.configuration()).concurrency;
    } catch {
      /* Invalid configuration fails generation inside its execution; process remains available. */
    }
    while (true) {
      const queued = this.store
        .list("executions", { status: "queued" })
        .slice(0, concurrency);
      if (!queued.length) return;
      await Promise.allSettled(queued.map(e => {
        const previous = this.executions.get(e.id);
        if (previous) return previous.settled;
        const controller = new AbortController();
        const settled = Promise.resolve().then(() => this.runExecution(e.id, controller))
          .finally(() => { this.executions.delete(e.id); });
        this.executions.set(e.id, { controller, settled });
        return settled;
      }));
    }
  }
  private updateExecution(id: string, patch: Row) {
    const e = this.store.get("executions", id);
    if (!active(e)) return e;
    const updated = this.store.update("executions", id, {
      ...patch,
      revision: e.revision + 1,
    });
    this.changed();
    return updated;
  }
  private async runExecution(id: string, controller: AbortController) {
    let dispatched = false;
    let e = this.store.get("executions", id);
    const plan = this.store.get("plans", e.plan_id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (e.status !== "queued") return;
      controller.signal.throwIfAborted();
      e = this.updateExecution(id, {
        status: "running",
        phase: "validation",
        started_at: now(),
      });
      const inputs = [];
      for (const input of this.store.list("plan_inputs", {
        plan_id: plan.id,
      })) {
        controller.signal.throwIfAborted();
        const a = this.readyAsset(input.asset_id);
        inputs.push({
          bytes: await this.files.read(a),
          mimeType: a.mime_type,
          purpose: input.purpose,
        });
      }
      controller.signal.throwIfAborted();
      let sources: Uint8Array[] = [];
      if (plan.operation === "process") {
        sources = inputs
          .filter((i) => i.purpose === "base")
          .map((i) => i.bytes);
        e = this.updateExecution(id, { status: "processing", phase: "resize" });
      } else {
        const profile = parse(plan.profile_snapshot_json) as ImageProfile;
        await this.providers.authorize(profile);
        controller.signal.throwIfAborted();
        const preparedAt = now();
        const evidence = {
          schemaVersion: 1,
          attempt: {
            preparedAt,
            dispatchMarkedAt: preparedAt,
            requestHash: hash({ plan: plan.plan_hash }),
            adapterVersion: profile.capabilityVersion,
          },
          observations: [] as Row[],
        };
        e = this.updateExecution(id, {
          phase: "generation",
          dispatch_started_at: preparedAt,
          provider_evidence_json: canonical(evidence),
        });
        dispatched = true;
        const batches = plan.operation === "edit" && plan.input_mode === "separate" ? inputs.map(input => [input]) : [inputs];
        for (const batch of batches) {
        controller.signal.throwIfAborted();
        e = this.updateExecution(id, {phase: "generation", provider_outcome: "none"});
        const deadline = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              new DomainError(
                "IMAGE_PROVIDER_UNCERTAIN",
                "图片调用已超时，可能已生成或计费",
                503,
                true,
              ),
            );
          }, profile.timeoutMs);
        });
        const response = await Promise.race([
          this.providers.generate(
            profile,
            plan.operation,
            parse(this.store.find("commands", { id: e.authorization_command_id })?.request_json)?.draftSnapshot?.mode === "generate"
              ? plan.prompt
              : [
                  plan.prompt,
                  `修改目标：${plan.intent}`,
                  `保持内容：${plan.preserve_text}`,
                  `输入图片用途：${inputs.map((i, index) => `${index + 1}=${i.purpose}`).join("，")}`,
                ].join("\n\n"),
            parse(plan.parameters_json).values,
            batch,
            controller.signal,
          ),
          deadline,
        ]);
        clearTimeout(timer);
        if (controller.signal.aborted && this.errorCode(controller.signal.reason) !== "IMAGE_TASK_INTERRUPTED")
          imageError("IMAGE_PROVIDER_UNCERTAIN", "图片调用已超时", 503);
        evidence.observations.push({
          observedAt: now(),
          outcome: "success",
          responseId: response.responseId ?? null,
          sourceAssetIds: [],
        });
        e = this.updateExecution(id, {
          status: "processing",
          phase: "response_save",
          provider_outcome: "success",
          provider_response_id: response.responseId ?? null,
          provider_evidence_json: canonical(evidence),
        });
        for (const bytes of response.images) {
          controller.signal.throwIfAborted();
          const asset = this.reserveAsset(
            plan.task_id,
            id,
            "provider_response",
            "生成母图.png",
            `${plan.task_id}/executions/${id}/response/${randomUUID()}.png`,
          );
          await this.files.save(asset, bytes);
          const ready = this.readyAsset(asset.id);
          sources.push(await this.files.read(ready));
          evidence.observations.at(-1)!.sourceAssetIds.push(asset.id);
          e = this.updateExecution(id, {
            response_asset_id: e.response_asset_id ?? asset.id,
            provider_evidence_json: canonical(evidence),
          });
        }
        e = this.updateExecution(id, { phase: "resize" });
        const partialSpec = parse(plan.output_spec_json) as OutputSpec;
        for (const target of partialSpec.targets) {
          if (!sources[target.sourceIndex]) continue;
          const output = this.store.find("assets", {execution_id: id, role: "output", output_key: target.name});
          if (!output || output.availability === "ready") continue;
          const bytes = await this.files.process(sources[target.sourceIndex], target, partialSpec);
          await this.files.save(output, bytes, () => controller.signal.throwIfAborted());
          this.changed();
        }
        }
      }
      const spec = parse(plan.output_spec_json) as OutputSpec;
      for (const target of spec.targets) {
        controller.signal.throwIfAborted();
        if (!sources[target.sourceIndex])
          imageError("IMAGE_OUTPUT_INVALID", "源图序号不存在", 422);
        const output = this.store.find("assets", {
          execution_id: id,
          role: "output",
          output_key: target.name,
        });
        if (!output) imageError("IMAGE_OUTPUT_INVALID", "预留输出缺失");
        if (output.availability === "ready") continue;
        e = this.updateExecution(id, { phase: "resize" });
        const bytes = await this.files.process(
          sources[target.sourceIndex],
          target,
          spec,
        );
        controller.signal.throwIfAborted();
        e = this.updateExecution(id, { phase: "output_save" });
        await this.files.save(output, bytes, () => controller.signal.throwIfAborted());
      }
      const outputs = this.store.list("assets", {
        execution_id: id,
        role: "output",
      });
      if (
        outputs.length !== spec.targets.length ||
        spec.targets.some(
          (t) =>
            !outputs.some(
              (a) =>
                a.output_key === t.name &&
                a.availability === "ready" &&
                a.width === t.width &&
                a.height === t.height &&
                a.mime_type === `image/${spec.format}`,
            ),
        )
      )
        imageError("IMAGE_OUTPUT_INVALID", "输出键、尺寸或格式未全部完成");
      controller.signal.throwIfAborted();
      this.finishExecution(id, "completed", null);
    } catch (error) {
      e = this.store.get("executions", id);
      if (active(e)) {
        const rejected = !!(
          error &&
          typeof error === "object" &&
          "providerRejected" in error
        );
        if (
          plan.operation !== "process" &&
          e.provider_outcome === "none" &&
          dispatched
        ) {
          const evidence = parse(e.provider_evidence_json);
          evidence.observations.push({
            observedAt: now(),
            outcome: rejected ? "rejected" : "uncertain",
            ...(error &&
            typeof error === "object" &&
            "httpStatus" in error
              ? { httpStatus: error.httpStatus }
              : {}),
            sourceAssetIds: [],
          });
          this.updateExecution(id, {
            provider_outcome: rejected ? "failure" : "unknown",
            provider_evidence_json: canonical(evidence),
          });
        }
        const reason = this.errorCode(controller.signal.reason);
        this.finishExecution(id, "failed", reason === "IMAGE_TASK_INTERRUPTED" ? reason : this.errorCode(error));
      }
    } finally {
      if (timer) clearTimeout(timer);
      const done = this.store.get("executions", id);
      if (done.notification_state === "pending")
        void this.lane(plan.conversation_id, () => this.notify(done.id)).catch(
          () => {},
        );
    }
  }
  private finishExecution(
    id: string,
    status: "completed" | "failed",
    errorCode: string | null,
  ) {
    this.store.transaction(() => {
      const e = this.store.get("executions", id);
      if (status === "failed")
        for (const asset of this.store.list("assets", {
          execution_id: id,
          availability: "staging",
        }))
          this.store.update("assets", asset.id, { availability: "missing" });
      const assetIds = this.store
        .list("assets", { execution_id: id })
        .filter((a) => a.availability === "ready")
        .map((a) => a.id);
      this.updateExecution(id, {
        status,
        error_code: errorCode,
        error_detail_json: errorCode
          ? canonical({
              schemaVersion: 1,
              phase: e.phase,
              reason: errorCode,
              partialAssetIds: assetIds,
            })
          : null,
        finished_at: now(),
        attempt_ended_at: now(),
        notification_state: "pending",
        notification_payload_json: canonical({
          schemaVersion: 1,
          executionId: id,
          taskId: e.task_id,
          status,
          assetIds,
          ...(errorCode ? { errorCode } : {}),
        }),
      });
    });
    this.changed();
  }
  getDraftSnapshot(id: string, taskId: string | null) {
    const draft = this.getDraft(id, taskId);
    return {
      draft,
      assets: draft.referenceIds.map((assetId: string) =>
        this.asset(this.store.get("assets", assetId)),
      ),
    };
  }
  private async notify(id: string) {
    let e = this.store.get("executions", id);
    if (e.notification_state !== "pending") return;
    const t = this.store.task(e.task_id);
    try {
      const c = this.store.conversation(t.conversation_id);
      e = this.store.update("executions", id, {
        notification_state: "writing",
        notification_dispatch_started_at: now(),
        revision: e.revision + 1,
      });
      this.changed();
      const entry = await this.discussion.notify(
        parse(c.native_ref_json),
        parse(e.notification_payload_json),
        (patch) => {
          const current = this.store.get("executions", id);
          this.store.update("executions", id, {
            ...patch,
            revision: current.revision + 1,
          });
        },
      );
      const current = this.store.get("executions", id);
      this.store.update("executions", id, {
        notification_state: "delivered",
        notification_entry_id: entry,
        notified_at: now(),
        revision: current.revision + 1,
      });
    } catch {
      const current = this.store.get("executions", id);
      this.store.update("executions", id, {
        notification_state: "failed",
        revision: current.revision + 1,
      });
    } finally {
      this.changed();
    }
  }
  private assetInUse(id: string) {
    if ((this.readLeases.get(id) ?? 0) > 0 || this.deleting.has(id)) return true;
    const asset = this.store.get("assets", id);
    const busy = this.store.busyTask(asset.task_id);
    if (busy && (busy.id === asset.execution_id || this.store.list("plan_inputs", {plan_id: busy.plan_id}).some(input => input.asset_id === id))) return true;
    return this.store.list("commands", {kind: "message"}).some(command => ["accepted", "running"].includes(command.status) && parse(command.request_json)?.draftSnapshot?.referenceIds?.includes(id));
  }
  async downloadVersions(taskId: string, input: unknown) {
    const value = object(input, ["assetIds"]);
    if (!Array.isArray(value.assetIds) || !value.assetIds.length || value.assetIds.length > 1000 || new Set(value.assetIds).size !== value.assetIds.length) imageError("INVALID_INPUT", "请选择不重复的图片版本", 400);
    this.store.task(taskId);
    const ids = value.assetIds as unknown[];
    const assets: Row[] = this.store.transaction(() => ids.map((id: unknown) => {
      string(id, 100);
      const asset = this.readyAsset(id as string);
      if (asset.task_id !== taskId || !asset.root_asset_id) imageError("NOT_FOUND", "图片版本不属于当前任务", 404);
      return asset;
    }));
    if (assets.reduce((sum, asset) => sum + Number(asset.byte_size), 0) > 256 * 1024 * 1024) imageError("REQUEST_TOO_LARGE", "所选下载超过256MiB，请分批下载", 413);
    for (const asset of assets) this.readLeases.set(asset.id, (this.readLeases.get(asset.id) ?? 0) + 1);
    try {
      const files = [];
      for (const asset of assets) {
        try { files.push({name: `${asset.root_asset_id}-v${asset.version_number}-${asset.original_name}`, bytes: await this.files.read(asset)}); }
        catch (error) { if (this.errorCode(error) === "IMAGE_RESOURCE_UNAVAILABLE") imageError("IMAGE_ASSET_UNAVAILABLE", "所选版本文件不可用", 409); throw error; }
      }
      return files;
    } finally {
      for (const asset of assets) { const count = (this.readLeases.get(asset.id) ?? 1) - 1; if (count) this.readLeases.set(asset.id, count); else this.readLeases.delete(asset.id); }
    }
  }
  private deletableImage(asset: Row) {
    return Boolean(asset.root_asset_id && (asset.role === "output" || (asset.role === "reference" && !asset.source_asset_id)));
  }
  private deletionAssets(asset: Row) {
    if (asset.role !== "reference" || asset.mime_type !== "image/svg+xml") return [asset];
    return [asset, ...this.store.list("assets", {task_id: asset.task_id, role: "reference", source_asset_id: asset.id})];
  }
  private deletionBlocked(asset: Row) {
    return asset.availability === "staging" || this.assetInUse(asset.id);
  }
  async deleteVersion(taskId: string, assetId: string, input: unknown, intent: ImageIntent) {
    object(input, []);
    this.inputKey(intent);
    const request = {assetId};
    const ids = this.store.transaction(() => {
      const prior = this.existing("delete_version", `task:${taskId}`, intent, request);
      const asset = this.store.get("assets", assetId);
      if (asset.task_id !== taskId || !this.deletableImage(asset)) imageError("NOT_FOUND", "可删除图片不存在", 404);
      const assets = this.deletionAssets(asset);
      if (assets.some(item => this.deletionBlocked(item))) imageError("IMAGE_ASSET_IN_USE", "图片正在使用，请等待或终止后删除", 409);
      const ids = assets.map(item => item.id as string);
      if (prior || isImageAssetDeleted(asset)) return ids;
      const task = this.store.task(taskId);
      this.revision(task, intent.match);
      if (asset.availability !== "ready") imageError("IMAGE_ASSET_UNAVAILABLE", "图片不可删除", 409);
      const command = this.command("delete_version", `task:${taskId}`, intent, request, task.conversation_id);
      const deletedAt = now();
      for (const item of assets) {
        this.store.update("assets", item.id, {
          ...(item.role === "output" ? {deleted_at: deletedAt} : {}),
          cleanup_state: "pending", cleanup_error: null,
        });
      }
      this.store.update("tasks", taskId, {revision: task.revision + 1, updated_at: deletedAt});
      for (const draft of this.store.list("drafts")) {
        const referenceIds = draft.referenceIds.filter((id: string) => !ids.includes(id));
        if (referenceIds.length !== draft.referenceIds.length) this.store.update("drafts", draft.id, {
          referenceIds, revision: draft.revision + 1, updated_at: deletedAt,
        });
      }
      this.complete(command, {assetIds: ids});
      return ids;
    });
    for (const id of ids) this.deleting.add(id);
    try {
      let failed = false;
      for (const id of ids) {
        const asset = this.store.get("assets", id);
        if (asset.cleanup_state === "done") continue;
        try {
          await this.files.remove(asset);
          this.store.update("assets", id, {cleanup_state: "done", cleanup_error: null});
        } catch {
          failed = true;
          this.store.update("assets", id, {cleanup_state: "failed", cleanup_error: "图片文件清理失败，请重试"});
        }
      }
      return {task: this.taskDTO(this.store.task(taskId)), deletedAssetId: assetId, deletedAssetIds: ids, cleanup: {state: failed ? "failed" : "done"}};
    } finally {
      for (const id of ids) this.deleting.delete(id);
      this.changed();
    }
  }
  download(id: string) {
    const e = this.store.get("executions", id);
    const outputs = this.store
      .list("assets", { execution_id: e.id, role: "output" })
      .filter((a) => a.availability === "ready" && !a.deleted_at);
    const service = this;
    return (async function* () {
      for (const asset of outputs)
        yield {
          name: asset.output_key as string,
          bytes: (await service.content(asset.id)).bytes,
        };
    })();
  }
}
