require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildBotRuntimeToolInstructions } = require('../src/infrastructure/pi/bot-runtime-instructions.ts');
const { coordinatorProjectPresenceTools, PROJECT_EXISTENCE_DESCRIPTION } = require('../src/infrastructure/pi/coordinator-project-tools.ts');

test('coordinator instructions require Project Directory awareness and child-Session project operations', () => {
  const prompt = buildBotRuntimeToolInstructions(['bot_project_directory','bot_start_work','bot_continue_work','bot_create_task', 'bot_status'], false);
  assert(prompt.includes('bot_project_directory 是当前总对话绑定 Project/Agent 的权威运行时目录'));
  assert(prompt.includes('项目源码、文件、测试、运行状态的读取或修改一律通过 Work→bot_create_task→项目 Session'));
  assert(prompt.includes('没有 Project 源文件搜索/读取/修改/测试工具'));
  assert(prompt.includes('普通聊天不创建 Work'));
  assert(prompt.includes('reuse(sessionId) 或 new(projectId/agentId/topic/creationReason)'));
  assert(prompt.includes('Session 忙碌时排队'));
  assert(prompt.includes('不得在复用失败时换成新建'));
  assert(prompt.includes('本次执行未提供 bot_message'));
  assert(prompt.includes('不要尝试调用它'));
  assert(!prompt.includes('bot_message 仅用于当前总对话'));
});

test('coordinator without task capability is told not to claim project dispatch', () => {
  const prompt = buildBotRuntimeToolInstructions(['bot_project_directory','bot_status'], false);
  assert(prompt.includes('仍可使用 Project Directory 说明本会话范围'));
  assert(prompt.includes('没有 bot_create_task'));
  assert(prompt.includes('不要声称已创建任务'));
  assert(!prompt.includes('使用 bot_create_task 创建任务'));
});

test('project Agent can use bot_message only when the injected tool exists and cannot dispatch tasks', () => {
  const allowed = buildBotRuntimeToolInstructions(['bot_status', 'bot_message'], true);
  assert(allowed.includes('你正在所属 Project 的 Session'));
  assert(allowed.includes('bot_message 仅用于当前总对话内角色之间的问题/答复'));
  assert(!allowed.includes('bot_create_task'));

  const denied = buildBotRuntimeToolInstructions(['bot_status'], true);
  assert(denied.includes('本次执行未提供 bot_message'));
  assert(denied.includes('不要尝试调用它'));
  assert(!denied.includes('bot_create_task'));
});

test('dynamic project tools only report fixed existence and do not accept project operations', async () => {
  const stored = {
    id: 'proj-b', name: 'B', description: '数据库中的说明', kind: 'code', rootPath: '/data/b',
    status: 'active', createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z',
  };
  const tools = coordinatorProjectPresenceTools([
    { ...stored, id: 'proj-a', name: 'A' },
    stored,
  ]);
  assert.deepEqual(tools.map(tool => tool.name), ['bot_project_proj_a', 'bot_project_proj_b']);
  assert(tools.every(tool => tool.description === PROJECT_EXISTENCE_DESCRIPTION));
  assert(tools[0].description.includes('只用于感知'));
  assert(tools[0].description.includes('不要读取项目'));
  assert(tools[0].description.includes('不要写入项目'));
  assert.deepEqual(tools[0].parameters, { type: 'object', properties: {}, required: [], additionalProperties: false });
  assert.deepEqual(await tools[1].execute({ path: '../secret', command: 'rm -rf /' }), {
    exists: true, source: 'database', project: stored,
  });
  const prompt = buildBotRuntimeToolInstructions(tools.map(tool => tool.name), false);
  assert(prompt.includes('只用于感知该项目存在'));
  assert(prompt.includes('不能读取项目'));
  assert(prompt.includes('也不能写入项目'));
});

test('coordinator without directory tool does not infer Project scope from prompts', () => {
  const prompt=buildBotRuntimeToolInstructions(['bot_status'],false);
  assert(prompt.includes('未提供 bot_project_directory'));
  assert(prompt.includes('不得声称已核实项目存在或权限'));
});
