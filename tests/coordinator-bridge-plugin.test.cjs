require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProjectCallTools, reconcileProjectCalls } = require('../src/infrastructure/pi/coordinator-bridge-plugin.ts');

function memoryStore() {
  const calls = [];
  let clock = 0;
  const sessions = new Map();
  const store = {
    now: () => new Date(Date.UTC(2026, 9, 20, 0, 0, clock)).toISOString(),
    nextId: () => `call-${++clock}`,
    get: id => calls.find(call => call.id === id) ?? null,
    findDuplicate: input => calls.find(call => Object.entries(input).every(([key, value]) => call[key] === value)) ?? null,
    list: conversationId => calls.filter(call => call.conversationId === conversationId),
    insert(call) { calls.push({ ...call }); return call; },
    update(id, expected, patch) {
      const call = calls.find(item => item.id === id && item.status === expected);
      if (!call) throw new Error('状态已变化');
      Object.assign(call, patch);
      return { ...call };
    },
    agent: (_conversationId, projectId) => projectId === 'missing' ? null : {
      agentId: 'agent-1', revision: 2, name: '项目角色', responsibility: '读取并修改所属项目', boundary: '不访问其他项目',
    },
    async sessionFor(_conversationId, projectId) {
      if (projectId === 'broken') throw new Error('无法启动');
      if (!sessions.has(projectId)) {
        const listeners = new Set();
        sessions.set(projectId, {
          sessionId: `session-${projectId}`,
          events: [],
          subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
          async prompt(content) {
            this.events.push({ type: 'prompt', content });
            return { startEntryId: `start-${projectId}` };
          },
          async steer(content) { this.events.push({ type: 'steer', content }); },
          async readAssistant(start, end) { return `assistant:${start}:${end}`; },
          settle(aborted, endEntryId) { for (const listener of listeners) listener({ type: 'agent_settled', aborted, endEntryId }); },
        });
      }
      return sessions.get(projectId);
    },
    notifications: [],
    notify(callId, progress) { this.notifications.push({ callId, progress }); },
  };
  return { calls, sessions, store };
}

function tool(tools, name) {
  return tools.find(item => item.name === name);
}

test('project call starts once, reuses the same request, and reads only a completed boundary', async () => {
  const { sessions, store } = memoryStore();
  const tools = createProjectCallTools(store, 'conversation-1', 2);
  const first = await tool(tools, 'bot_start_project_call').execute({ projectId: 'proj-a', sourceEntryId: 'user-1', sentContent: '检查项目' });
  const duplicate = await tool(tools, 'bot_start_project_call').execute({ projectId: 'proj-a', sourceEntryId: 'user-1', sentContent: '检查项目' });
  assert.equal(duplicate.callId, first.callId);
  assert.equal(first.status, 'working');
  assert.equal(first.progress, 'processing');
  assert.equal(sessions.get('proj-a').events.filter(event => event.type === 'prompt').length, 1);
  await assert.rejects(() => tool(tools, 'bot_read_project_result').execute({ callId: first.callId }), /尚未完成/);
  sessions.get('proj-a').settle(false, 'end-a');
  const result = await tool(tools, 'bot_read_project_result').execute({ callId: first.callId });
  assert.equal(result.content, 'assistant:start-proj-a:end-a');
  assert.deepEqual(store.notifications.at(-1), { callId: first.callId, progress: 'finished' });
});

test('one project session stays serial while another project runs in parallel', async () => {
  const { sessions, store } = memoryStore();
  const tools = createProjectCallTools(store, 'conversation-1', 2);
  const first = await tool(tools, 'bot_start_project_call').execute({ projectId: 'proj-a', sourceEntryId: 'user-1', sentContent: '第一次' });
  const queued = await tool(tools, 'bot_start_project_call').execute({ projectId: 'proj-a', sourceEntryId: 'user-2', sentContent: '第二次' });
  const other = await tool(tools, 'bot_start_project_call').execute({ projectId: 'proj-b', sourceEntryId: 'user-1', sentContent: '并行' });
  assert.equal(queued.status, 'accepted');
  assert.equal(other.status, 'working');
  assert.equal(sessions.get('proj-a').events.length, 1);
  sessions.get('proj-a').settle(false, 'end-a');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(store.get(queued.callId).status, 'working');
  assert.equal(sessions.get('proj-a').events.at(-1).content, '第二次');
  assert.equal(first.sessionId, store.get(queued.callId).sessionId);
});

test('unknown calls can only be abandoned and failed startup does not retry', async () => {
  const { store } = memoryStore();
  const tools = createProjectCallTools(store, 'conversation-1', 1);
  const failed = await tool(tools, 'bot_start_project_call').execute({ projectId: 'broken', sourceEntryId: 'user-1', sentContent: '失败' });
  assert.equal(failed.status, 'unknown');
  const again = await tool(tools, 'bot_start_project_call').execute({ projectId: 'broken', sourceEntryId: 'user-1', sentContent: '失败' });
  assert.equal(again.callId, failed.callId);
  assert.equal(again.status, 'unknown');
  const abandoned = await tool(tools, 'bot_abandon_project_call').execute({ callId: failed.callId });
  assert.equal(abandoned.status, 'aborted');
  const agent = await tool(tools, 'bot_read_project_agent').execute({ projectId: 'proj-a' });
  assert.equal(agent.boundary, '不访问其他项目');
  assert.equal(Object.hasOwn(agent, 'rootPath'), false);
});

test('diagnostics capture project startup and failure without content or exception details', async () => {
  const { store } = memoryStore();
  const original = console.info, lines = [];
  console.info = line => lines.push(line);
  try {
    const tools = createProjectCallTools(store, 'conversation-safe', 1);
    await tool(tools, 'bot_start_project_call').execute({ projectId: 'broken', sourceEntryId: 'private-source', sentContent: 'private prompt /secret/path' });
    assert.ok(lines.some(line => line.includes('call_saved')));
    assert.ok(lines.some(line => line.includes('session_handle_start')));
    assert.ok(lines.some(line => line.includes('session_handle_failed') && line.includes('OTHER')));
    assert.doesNotMatch(lines.join('\n'), /private|secret|无法启动|broken/);
    console.info = () => { throw Error('logging failed'); };
    const result = await tool(tools, 'bot_start_project_call').execute({ projectId: 'ok', sourceEntryId: 'x', sentContent: 'message' });
    assert.equal(result.status, 'working');
  } finally { console.info = original; }
});

test('restart marks only calls without a live session as unknown', () => {
  const { calls, store } = memoryStore();
  calls.push(
    { id: 'live', conversationId: 'conversation-1', projectId: 'proj-a', sessionId: 'session-live', status: 'working', startEntryId: 'start', endEntryId: null },
    { id: 'lost', conversationId: 'conversation-1', projectId: 'proj-b', sessionId: 'session-lost', status: 'working', startEntryId: null, endEntryId: null },
    { id: 'done', conversationId: 'conversation-1', projectId: 'proj-c', sessionId: null, status: 'completed', startEntryId: 'start', endEntryId: 'end' },
  );
  const reconciled = reconcileProjectCalls(store, 'conversation-1', new Set(['session-live']));
  assert.deepEqual(reconciled.map(call => [call.id, call.status]), [['live', 'working'], ['lost', 'unknown'], ['done', 'completed']]);
});

test('steering only reaches a working call and does not create another call', async () => {
  const { calls, sessions, store } = memoryStore();
  const tools = createProjectCallTools(store, 'conversation-1', 1);
  const call = await tool(tools, 'bot_start_project_call').execute({ projectId: 'proj-a', sourceEntryId: 'user-1', sentContent: '处理' });
  const steered = await tool(tools, 'bot_steer_project_call').execute({ callId: call.callId, content: '改为只读检查' });
  assert.equal(steered.steered, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(sessions.get('proj-a').events.at(-1), { type: 'steer', content: '改为只读检查' });
  sessions.get('proj-a').settle(false, 'end-a');
  const missed = await tool(tools, 'bot_steer_project_call').execute({ callId: call.callId, content: '太晚了' });
  assert.equal(missed.status, 'completed');
  assert.equal(Object.hasOwn(missed, 'steered'), false);
  assert.equal(sessions.get('proj-a').events.filter(event => event.type === 'steer').length, 1);
});
