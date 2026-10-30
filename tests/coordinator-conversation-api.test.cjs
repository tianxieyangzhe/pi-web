require("./register.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "coordinator-api-"));
process.env.AI_WORKSPACE_DB_PATH = path.join(root, "new.sqlite");
process.env.AI_WORKSPACE_AGENT_DIR = path.join(root, "agents");

const { database } = require("../src/infrastructure/database/database.server.ts");
const { agentRepository: agents } = require("../src/infrastructure/database/agent-repository.server.ts");
const { projectRepository: projects } = require("../src/infrastructure/database/project-repository.server.ts");
const { sessionRepository: sessions } = require("../src/infrastructure/database/session-repository.server.ts");
const { sessionMemoryRepository: memories } = require("../src/infrastructure/database/session-memory-repository.server.ts");
const { createCatalogService } = require("../src/application/catalog-service.ts");
const { createBotRepository } = require("../src/infrastructure/database/bot-repository.ts");
const { createBotService } = require("../src/application/bot-service.ts");
const { DomainError } = require("../src/domain/errors.ts");

test("coordinator conversation API persists project calls without old scheduling tables", async () => {
  assert.equal(fs.existsSync(path.resolve(".data/ai-workspace-v5.sqlite")), true);
  const before = fs.statSync(path.resolve(".data/ai-workspace-v5.sqlite")).mtimeMs;
  const catalog = createCatalogService({ projects, agents, mcps: {}, normalizeProjectRoot: value => value });
  const repository = createBotRepository(database);
  const calls = [];
  const runtime = {
    async run(input, content, onRef) {
      onRef({ kind: "pi", sessionFile: path.join(root, "coordinator.jsonl"), sessionId: "coordinator", cwd: input.cwd });
      const tool = input.tools.find(item => item.name === "bot_start_project_call");
      calls.push(await tool.execute({ projectId: project.id, sourceEntryId: "source-1", sentContent: content }));
      calls.push(await tool.execute({ projectId: project.id, sourceEntryId: "source-1", sentContent: content }));
      return { startId: "a", endId: "z", evidence: [], result: null, messageEntryIds: {} };
    },
    async abort() {}, async steer() {}, async inspect() { return { sessionState: "idle", runtimeReady: true, canCancelCompaction: false, usage: { usedTokens: null, contextWindowTokens: null, remainingTokens: null, usageRatio: null, measurement: "unavailable", measuredAt: null, freshness: "unavailable" }, autoCompactionEnabled: false, compactionState: "idle", canCompact: false, unavailableReason: null, lastCompactedAt: null, error: null }; },
    async compact() {}, cancelCompaction() {}, async messages() { return []; }, async resolve() { return { endId: null, evidence: [], result: null }; }, async resolveMessageDelivery() { return null; },
    async projectHandle() { return { sessionId: "project-session", subscribe: () => () => undefined, prompt: async () => { throw new DomainError("RUNTIME_ERROR", "启动失败", 503, true); }, steer: async () => undefined, readAssistant: async () => "" }; },
  };
  const bots = createBotService({ repository, workspace: { create: async () => ({ workingDirectory: path.join(root, "workspace"), workspaceKind: "managed" }), sessionDirectory: () => path.join(root, "sessions"), validate: async () => undefined }, runtime, runtimeInstanceId: "test", sessions, projects, memories, catalog });
  const project = projects.create({ name: "Alpha", description: null, kind: "code", rootPath: path.join(root, "alpha"), status: "active" });
  const caps = { readFiles: true, writeFiles: false, readProjects: false, dispatchTasks: false, dispatchProjectWrites: false, exchangeMessages: false };
  const coordinator = catalog.createAgent({ name: "协调者", kind: "coordinator", definition: { instructions: "只协调", capabilities: caps } });
  const agent = catalog.createAgent({ name: "项目角色", kind: "project", definition: { instructions: "只处理 Alpha", capabilities: caps } });
  const bot = await bots.create({ name: "Bot", coordinatorAgentId: coordinator.id, projectBindings: [{ projectId: project.id, agentIds: [agent.id] }] });
  assert.throws(() => bots.createConversation(bot.id, { projectId: project.id }), error => error.code === "INVALID_BOT_INPUT");
  const conversation = bots.createConversation(bot.id, { title: "协调" });
  assert.equal(conversation.coordinatorAgentId, coordinator.id);
  assert.throws(() => bots.task(), error => error.code === "NOT_FOUND");
  bots.send(bot.id, conversation.id, "请处理 Alpha", "idempotent-input");
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls[0].callId, calls[1].callId);
  assert.equal(repository.projectCalls(conversation.id)[0].status, "unknown");
  assert.equal(database.prepare("SELECT name FROM sqlite_master WHERE name IN ('bot_works','bot_tasks','bot_executions','bot_messages')").all().length, 0);
  assert.equal(fs.statSync(path.resolve(".data/ai-workspace-v5.sqlite")).mtimeMs, before);
  database.close();
});
