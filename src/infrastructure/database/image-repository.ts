import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { canonical, imageError, isImageAssetDeleted, type StoredRow as Row } from "@/domain/images";
import type { ImageRecordKind } from "@/application/ports/images";
const now = () => new Date().toISOString();
const parse = (value: string | null | undefined, fallback: any = null) => value == null ? fallback : JSON.parse(value);
const kinds = ["create_conversation", "create_task", "update_draft", "upload", "import", "prepare_plan", "confirm", "restart_execution", "interrupt", "delete_version"];
const active = (row: Row | null) => !!row && ["queued", "running", "processing"].includes(row.status);
const held = (row: Row | null) => active(row) || !!row && ["pending", "writing"].includes(row.notification_state);
/** Three physical tables. Draft/plan/execution/receipt reads project their CURRENT owner fields. */
export class ImageRepository {
  constructor(readonly database: Database.Database, private compatible: () => boolean = () => true) {}
  assertReady() {
    const columns = this.database.prepare("PRAGMA table_info(image_assets)").all() as Array<{name:string}>;
    if (!this.compatible() || !["root_asset_id", "version_number", "ready_at", "max_version_number", "deleted_at", "cleanup_state", "cleanup_error"].every(name => columns.some(column => column.name === name))) imageError("SCHEMA_INCOMPATIBLE", "图片表尚未显式升级，图片写入已阻止。", 503);
  }
  transaction<T>(fn: () => T): T { this.assertReady(); return this.database.transaction(fn).immediate(); }
  private physical(kind: string) {
    if (!["conversations", "tasks", "assets"].includes(kind)) throw Error("Invalid physical image table");
    return "image_" + kind;
  }
  private physicalRows(kind: string): Row[] {
    return this.database.prepare(`SELECT * FROM ${this.physical(kind)} ORDER BY created_at,id`).all() as Row[];
  }
  list(kind: ImageRecordKind, where: Record<string, unknown> = {}): Row[] {
    this.assertReady();
    let rows: Row[];
    if (["conversations", "tasks", "assets"].includes(kind)) rows = this.physicalRows(kind);
    else {
      const tasks = this.physicalRows("tasks"), conversations = this.physicalRows("conversations");
      if (kind === "plans") rows = tasks.map(t => parse(t.plan_json)).filter(Boolean);
      else if (kind === "executions") rows = tasks.map(t => parse(t.execution_json)).filter(Boolean);
      else if (kind === "drafts") rows = [...tasks, ...conversations].map(t => parse(t.draft_json)).filter(Boolean);
      else if (kind === "commands") rows = [...tasks, ...conversations].flatMap(t => [...Object.values(parse(t.receipts_json, {})), ...(t.discussion_json ? [parse(t.discussion_json)] : [])]) as Row[];
      else if (kind === "plan_inputs") rows = tasks.flatMap(t => parse(t.plan_inputs_json, []));
      else if (kind === "draft_inputs") rows = this.list("drafts").flatMap(d => (d.referenceIds ?? []).map((asset_id: string, position: number) => ({ draft_id: d.id, asset_id, position })));
      else throw Error("Invalid image projection");
    }
    return rows.filter(row => Object.entries(where).every(([key, value]) => (row[key] ?? null) === value)).sort((a, b) => ["plan_inputs", "draft_inputs"].includes(kind) ? a.position - b.position : String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.id).localeCompare(String(b.id)));
  }
  get(kind: ImageRecordKind, id: string): Row {
    const row = this.find(kind, { id });
    if (!row) imageError("NOT_FOUND", "当前图片对象不存在或已被替换", 404);
    return row;
  }
  find(kind: ImageRecordKind, where: Record<string, unknown>): Row | undefined { return this.list(kind, where)[0]; }
  private write(kind: string, id: string, values: Row, revision?: number) {
    const keys = Object.keys(values);
    if (!keys.length || keys.some(k => !/^[a-z_][a-z_0-9]*$/.test(k))) throw Error("Invalid image columns");
    const result = this.database.prepare(`UPDATE ${this.physical(kind)} SET ${keys.map(k => `${k}=?`).join(",")} WHERE id=?${revision === undefined ? "" : " AND revision=?"}`).run(...Object.values(values), id, ...(revision === undefined ? [] : [revision]));
    if (!result.changes) imageError("VERSION_CONFLICT", "版本已变化，请重新读取", 412);
  }
  private owner(kind: ImageRecordKind, row: Row): { kind: string; row: Row; column: string } {
    if (kind === "drafts") return row.task_id ? { kind: "tasks", row: this.task(row.task_id, row.conversation_id), column: "draft_json" } : { kind: "conversations", row: this.conversation(row.conversation_id), column: "draft_json" };
    if (kind === "plans" || kind === "executions") return { kind: "tasks", row: this.task(row.task_id), column: kind === "plans" ? "plan_json" : "execution_json" };
    if (kind === "commands") {
      if (row.kind === "message") return { kind: "conversations", row: this.conversation(row.conversation_id), column: "discussion_json" };
      for (const ownerKind of ["tasks", "conversations"]) {
        const existing = this.physicalRows(ownerKind).find(owner => Object.values(parse(owner.receipts_json, {})).some((receipt: any) => receipt.id === row.id));
        if (existing) return { kind: ownerKind, row: existing, column: "receipts_json" };
      }
      const taskScope = row.scope_key?.startsWith("task:") ? row.scope_key.slice(5) : null;
      const executionTask = row.kind === "restart_execution" ? this.find("executions", { id: row.scope_key.slice(10) })?.task_id : null;
      const draftTask = row.scope_key?.startsWith("draft:") ? this.find("drafts", { id: row.scope_key.slice(6) })?.task_id : null;
      const taskId = taskScope || executionTask || draftTask;
      if (taskId) return { kind: "tasks", row: this.task(taskId, row.conversation_id), column: "receipts_json" };
      return { kind: "conversations", row: this.conversation(row.conversation_id), column: "receipts_json" };
    }
    throw Error("Invalid current owner");
  }
  private writeCurrent(kind: ImageRecordKind, row: Row) {
    const owner = this.owner(kind, row);
    if (owner.column === "receipts_json") {
      if (!kinds.includes(row.kind)) throw Error("Invalid receipt kind");
      this.write(owner.kind, owner.row.id, { receipts_json: canonical({ ...parse(owner.row.receipts_json, {}), [row.kind]: row }) });
    } else this.write(owner.kind, owner.row.id, { [owner.column]: canonical(row) });
  }
  insert(kind: ImageRecordKind, values: Row): Row {
    return this.transaction(() => {
      if (["conversations", "tasks", "assets"].includes(kind)) {
        if (kind === "tasks") this.conversation(values.conversation_id);
        if (kind === "assets") this.validateAsset(values);
        const row = { ...values };
        delete row.current_plan_id;
        const keys = Object.keys(row);
        if (keys.some(k => !/^[a-z_][a-z_0-9]*$/.test(k))) throw Error("Invalid image columns");
        this.database.prepare(`INSERT INTO ${this.physical(kind)} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(row));
        return this.get(kind, values.id);
      }
      if (kind === "plans") {
        const task = this.task(values.task_id, values.conversation_id);
        if (held(parse(task.execution_json))) imageError("IMAGE_TASK_BUSY", "任务执行或结果通知尚未结束");
        this.write("tasks", task.id, { plan_json: canonical(values), plan_inputs_json: "[]", execution_json: null, receipts_json: canonical(Object.fromEntries(Object.entries(parse(task.receipts_json, {})).filter(([key]) => ["prepare_plan", "update_draft", "upload", "import"].includes(key)))) });
        return this.get(kind, values.id);
      }
      if (kind === "plan_inputs") {
        const plan = this.get("plans", values.plan_id), task = this.task(plan.task_id);
        const asset = this.get("assets", values.asset_id);
        const inputs = parse(task.plan_inputs_json, []);
        if (isImageAssetDeleted(asset) || asset.availability !== "ready" || values.position !== inputs.length || !["base", "reference"].includes(values.purpose) || inputs.some((i: Row) => i.asset_id === values.asset_id)) imageError("IMAGE_PARAMETERS_INVALID", "输入资源、用途或顺序无效", 422);
        this.write("tasks", task.id, { plan_inputs_json: canonical([...inputs, values]) });
        return values;
      }
      if (kind === "executions") {
        const task = this.task(values.task_id), plan = parse(task.plan_json), previous = parse(task.execution_json);
        if (held(previous)) imageError("IMAGE_TASK_BUSY", "任务执行或结果通知尚未结束");
        if (!plan || plan.id !== values.plan_id) imageError("PLAN_STALE", "当前方案已变化");
        const command = this.get("commands", values.authorization_command_id);
        const requiredKind = { confirm: "confirm", skip_once: "message", restart: "restart_execution" }[values.authorization_mode as "confirm"];
        if (command.conversation_id !== task.conversation_id || command.kind !== requiredKind || !["accepted", "running"].includes(command.status) || values.authorization_mode === "skip_once" && !parse(command.request_json).skipConfirmation) imageError("INVALID_INPUT", "执行授权无效", 400);
        if (values.authorization_mode === "restart" ? !previous || previous.status !== "failed" || previous.id !== values.restart_of_execution_id : !!previous) imageError("PLAN_ALREADY_EXECUTED", "当前方案已受理或重新开始来源已变化");
        this.writeCurrent(kind, values);
        return this.get(kind, values.id);
      }
      if (kind === "commands") {
        if (values.kind === "message" && this.busyConversation(values.conversation_id)) imageError("IMAGE_DISCUSSION_BUSY", "讨论正在处理");
        const owner = this.owner(kind, values);
        const previous = owner.column === "receipts_json" ? parse(owner.row.receipts_json, {})[values.kind] : null;
        if (previous && ["accepted", "running"].includes(previous.status)) imageError("IMAGE_TASK_BUSY", "同类请求尚未结束，请等待完成");
        values = { revision: 1, auto_execution_state: "not_requested", auto_execution_reason: null, result_json: canonical({ schemaVersion: 1, taskIds: [], planIds: [], executionIds: [], assetIds: [] }), ...values };
      }
      this.writeCurrent(kind, values);
      return this.get(kind, values.id);
    });
  }
  update(kind: ImageRecordKind, id: string, values: Row, revision?: number): Row {
    return this.transaction(() => {
      const old = this.get(kind, id);
      if (revision !== undefined && old.revision !== revision) imageError("VERSION_CONFLICT", "版本已变化，请重新读取", 412);
      if (kind === "assets" && values.availability === "ready" && old.availability === "staging") {
        values = { ...values };
        if ((old.role === "reference" && !old.source_asset_id) || old.role === "output") {
          let rootId: string | null = null;
          if (old.role === "output") {
            const task = this.task(old.task_id), execution = parse(task.execution_json), plan = parse(task.plan_json);
            if (execution?.id !== old.execution_id || !["running", "processing"].includes(execution.status)) imageError("PLAN_STALE", "执行已结束，拒绝迟到版本");
            const targets = parse(plan.output_spec_json).targets;
            rootId = parse(plan.output_roots_json, [])[targets.findIndex((t: Row) => t.name === old.output_key)]?.rootAssetId ?? null;
          }
          if (rootId) {
            const root = this.get("assets", rootId);
            if (root.task_id !== old.task_id || root.root_asset_id !== root.id) imageError("IMAGE_PARAMETERS_INVALID", "图片原图归属无效", 422);
            const version = root.max_version_number + 1;
            this.write("assets", root.id, { max_version_number: version });
            Object.assign(values, { root_asset_id: root.id, version_number: version });
          } else Object.assign(values, { root_asset_id: old.id, version_number: 0 });
          values.ready_at = now();
        }
        this.write(kind, id, values, revision);
      } else if (["conversations", "tasks", "assets"].includes(kind)) this.write(kind, id, values, revision);
      else {
        if (["commands", "executions"].includes(kind) && ["completed", "failed"].includes(old.status) && ["status", "finished_at", "error_code"].some(k => k in values && values[k] !== old[k])) imageError("INVALID_INPUT", "当前执行已终结，不能恢复", 409);
        const updated = { ...old, ...values };
        if (kind === "executions") this.validateExecution(updated);
        if (kind === "commands" && ["completed", "failed"].includes(updated.status) !== !!updated.finished_at) imageError("INVALID_INPUT", "受理状态和结束时间无效", 400);
        this.writeCurrent(kind, updated);
      }
      return this.get(kind, id);
    });
  }
  private validateAsset(row: Row) {
    const task = this.task(row.task_id);
    if (row.source_asset_id) {
      const source = this.get("assets", row.source_asset_id);
      if (source.task_id !== task.id || source.role !== "reference" || source.mime_type !== "image/svg+xml" || source.availability !== "ready") imageError("IMAGE_PARAMETERS_INVALID", "SVG来源无效", 422);
    }
    if (row.execution_id) {
      const execution = parse(task.execution_json), plan = parse(task.plan_json);
      if (!execution || execution.id !== row.execution_id) imageError("NOT_FOUND", "执行不属于当前任务", 404);
      if (row.role === "output" && !parse(plan.output_spec_json).targets.some((t: Row) => t.name === row.output_key)) imageError("IMAGE_PARAMETERS_INVALID", "输出不在当前方案中", 422);
    }
  }
  private validateExecution(row: Row) {
    if (!["queued", "running", "processing", "completed", "failed"].includes(row.status) || ["completed", "failed"].includes(row.status) !== !!row.finished_at) imageError("INVALID_INPUT", "执行状态或结束时间无效", 400);
    const plan = this.get("plans", row.plan_id);
    if (plan.operation === "process" && row.provider_outcome !== "none") imageError("INVALID_INPUT", "纯处理不能有供应商结果", 400);
    if (row.response_asset_id) {
      const asset = this.get("assets", row.response_asset_id);
      if (asset.task_id !== row.task_id || asset.execution_id !== row.id || asset.role !== "provider_response" || asset.availability !== "ready") imageError("IMAGE_OUTPUT_INVALID", "响应图片归属无效", 422);
    }
    if (row.status === "completed") {
      const spec = parse(plan.output_spec_json), outputs = this.list("assets", { execution_id: row.id, role: "output" });
      if (outputs.length !== spec.targets.length || spec.targets.some((t: Row) => !outputs.some(a => a.output_key === t.name && a.availability === "ready" && a.width === t.width && a.height === t.height && a.mime_type === "image/" + spec.format))) imageError("IMAGE_OUTPUT_INVALID", "输出尚未全部完成", 422);
    }
  }
  conversation(id: string) { return this.get("conversations", id); }
  task(id: string, conversationId?: string) {
    const task = this.get("tasks", id);
    if (conversationId && task.conversation_id !== conversationId) imageError("NOT_FOUND", "图片任务不存在", 404);
    return task;
  }
  draft(conversationId: string, taskId: string | null) {
    this.conversation(conversationId);
    if (taskId) this.task(taskId, conversationId);
    const draft = this.find("drafts", { conversation_id: conversationId, task_id: taskId });
    if (!draft) imageError("NOT_FOUND", "草稿不存在", 404);
    return draft;
  }
  createDraft(conversationId: string, taskId: string | null) {
    const time = now();
    return this.insert("drafts", { schemaVersion: 1, id: randomUUID(), conversation_id: conversationId, task_id: taskId, revision: 1, text: "", profile_id: null, parameters_json: canonical({ schemaVersion: 1, explicitParameters: {} }), referenceIds: [], created_at: time, updated_at: time });
  }
  replaceDraftInputs(id: string, ids: string[]) {
    this.transaction(() => {
      for (const assetId of ids) {
        const asset = this.get("assets", assetId);
        if (isImageAssetDeleted(asset) || asset.availability !== "ready") imageError("IMAGE_RESOURCE_UNAVAILABLE", "参考资源不可用");
      }
      this.update("drafts", id, { referenceIds: ids });
    });
  }
  command(kind: string, scope: string, key: string) { return this.find("commands", { kind, scope_key: scope, idempotency_key: key }); }
  busyTask(id: string) { const e = parse(this.task(id).execution_json); return held(e) ? e as Row : undefined; }
  busyConversation(id: string) { return this.find("commands", { conversation_id: id, kind: "message", status: "accepted" }) ?? this.find("commands", { conversation_id: id, kind: "message", status: "running" }); }
  interruptPreviousProcess(processStartedAt: string) {
    this.transaction(() => {
      const time = now();
      for (const c of this.list("commands")) if (c.created_at < processStartedAt && ["accepted", "running"].includes(c.status)) this.update("commands", c.id, { status: "failed", error_code: "PROCESS_INTERRUPTED", finished_at: time, attempt_ended_at: time, revision: c.revision + 1, ...(c.auto_execution_state === "pending" ? { auto_execution_state: "not_requested", auto_execution_reason: "PROCESS_INTERRUPTED" } : {}) });
      for (const e of this.list("executions").filter(e => e.created_at < processStartedAt && (active(e) || ["pending", "writing"].includes(e.notification_state)))) this.update("executions", e.id, { ...(active(e) ? { status: "failed", error_code: "PROCESS_INTERRUPTED", finished_at: time, attempt_ended_at: time, provider_outcome: e.dispatch_started_at && e.provider_outcome === "none" ? "unknown" : e.provider_outcome } : {}), ...(["pending", "writing"].includes(e.notification_state) || active(e) ? { notification_state: "failed" } : {}), revision: e.revision + 1 });
      for (const a of this.list("assets", { availability: "staging" }).filter(a => a.created_at < processStartedAt)) this.update("assets", a.id, { availability: "missing" });
    });
  }
}
