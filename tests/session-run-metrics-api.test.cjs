require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./workspace-fixture.cjs');
const { createSessionExecutionService } = require('../src/application/session-execution-service.ts');
const { createWorkspaceService } = require('../src/application/workspace-service.ts');
const { createProjectRepository } = require('../src/infrastructure/database/project-repository.ts');
const { createSessionRepository } = require('../src/infrastructure/database/session-repository.ts');
const { workspaceDirectories } = require('../src/infrastructure/workspaces/directories.server.ts');
const { DomainError } = require('../src/domain/errors.ts');
const tick = () => new Promise(setImmediate);
const usage = (n) => ({ input: n, output: 2*n, cacheRead: 3*n, cacheWrite: 4*n, totalTokens: 10*n, reasoning: n });

for (const scope of ['project', 'workspace']) test(`${scope} messages API returns session-wide usage including branches, compaction and cold reads`, async () => {
  const f = fixture();
  let service, owner, id;
  let entries = [], reads = 0;
  f.runtime.readTree = async () => { reads++; return { entries, activeLeafId: entries.at(-1)?.entry.id ?? null }; };
  try {
    if (scope === 'project') {
      const projects = createProjectRepository(f.db), sessions = createSessionRepository(f.db);
      owner = projects.create({ name: 'P', description: null, kind: 'code', rootPath: f.a, status: 'active' }).id;
      id = sessions.create({ projectId: owner, purpose: '', agentId: null, agentSnapshot: null, mcpIds: [], mcpSnapshots: [] }).id;
      service = createSessionExecutionService({ sessions, projects, catalog: {}, runtime: f.runtime });
      await service.open(id, 'open');
    } else {
      service = createWorkspaceService({ repository: f.repository, runtime: f.runtime, directories: workspaceDirectories });
      owner = (await service.save(null, { name: 'W', projects: [{ rootPath: f.a }], defaultProjectIndex: 0 }, 'create')).id;
      id = service.createSession(owner, {}, 'create').id;
      assert.deepEqual((await service.messages(owner, id)).tokenUsage, { totalTokens: 0, complete: true });
      await service.open(owner, id);
    }
    const read = () => scope === 'project' ? service.messages(id) : service.messages(owner, id);
    assert.deepEqual((await read()).tokenUsage, { totalTokens: 0, complete: true });
    const entry = (id, parentId, rest) => ({ entry: { id, parentId, timestamp: new Date().toISOString(), ...rest }, label: null, labelTimestamp: null });
    entries = [
      entry('user', null, { type: 'message', message: { role: 'user', usage: usage(1000) } }),
      entry('branch-a', 'user', { type: 'message', message: { role: 'assistant', usage: usage(1) } }),
      entry('branch-b', 'user', { type: 'message', message: { role: 'assistant', usage: usage(2) } }),
      entry('compact', 'branch-b', { type: 'compaction', usage: usage(3), tokensBefore: 999999 }),
      entry('summary', 'compact', { type: 'branch_summary', usage: usage(4) }),
      entry('native-usage', 'summary', { type: 'usage', usage: usage(5) }),
      entry('tool', 'native-usage', { type: 'message', message: { role: 'toolResult', usage: usage(6) } }),
      entry('tool-no-usage', 'tool', { type: 'message', message: { role: 'toolResult' } }),
    ];
    const before = reads, result = await read();
    assert.equal(reads, before+1, 'reuse a single tree read');
    assert.equal(result.entries.length, 8, 'preserve all original nodes');
    assert.deepEqual(result.tokenUsage, { totalTokens: 210, complete: true });
    assert.deepEqual((await read()).tokenUsage, result.tokenUsage, 'repeat reads do not double count');
    await f.runtime.close(f.runtime.getHandle(id));
    assert.deepEqual((await read()).tokenUsage, result.tokenUsage, 'read persisted entries without a live handle');
    entries.push(entry('legacy', 'tool-no-usage', { type: 'message', message: { role: 'assistant' } }));
    assert.deepEqual((await read()).tokenUsage, { totalTokens: 210, complete: false });
    entries = [entry('unknown', null, { type: 'message', message: { role: 'assistant', usage: { ...usage(1), input: -1 } } })];
    assert.deepEqual((await read()).tokenUsage, { totalTokens: null, complete: false });
    await assert.rejects(() => scope === 'project' ? service.messages('other-session') : service.messages('other-workspace', id), error => error.code === 'NOT_FOUND');
  } finally {
    if (service && id) await service.deleteSession(owner, id);
    f.close();
  }
});

for (const scope of ['project', 'workspace']) test(`${scope} messages/SSE reports only the current root run, including tool loops and incomplete termination`, { timeout: 10000 }, async () => {
  const f = fixture();
  let service, owner, id, lease, disconnect, release, started, scenario, activeEmit;
  const emitMessage = (emit, key, role, value, stopReason = 'stop') => emit({ type: 'pi_event', piType: 'message_end', temporaryId: key, payload: { message: { role, usage: value, stopReason } } });
  f.runtime.steer = async () => emitMessage(activeEmit, 'steered-response', 'assistant', usage(1));
  f.runtime.interrupt = async () => release();
  f.runtime.send = async (handle, text, emit) => {
    activeEmit = emit;
    scenario(emit);
    started();
    await new Promise(resolve => { release = resolve; });
    if (text === 'abort' || text === 'failure') {
      const error = new DomainError(text === 'abort' ? 'REQUEST_ABORTED' : 'MODEL_REQUEST_FAILED', text, 409, true);
      error.requestSettled = true;
      throw error;
    }
  };
  try {
    if (scope === 'project') {
      const projects = createProjectRepository(f.db), sessions = createSessionRepository(f.db);
      owner = projects.create({ name: 'P', description: null, kind: 'code', rootPath: f.a, status: 'active' }).id;
      id = sessions.create({ projectId: owner, purpose: '', agentId: null, agentSnapshot: null, mcpIds: [], mcpSnapshots: [] }).id;
      service = createSessionExecutionService({ sessions, projects, catalog: {}, runtime: f.runtime });
      lease = await service.open(id, 'open');
    } else {
      service = createWorkspaceService({ repository: f.repository, runtime: f.runtime, directories: workspaceDirectories });
      owner = (await service.save(null, { name: 'W', projects: [{ rootPath: f.a }], defaultProjectIndex: 0 }, 'create')).id;
      id = service.createSession(owner, {}, 'create').id;
      lease = await service.open(owner, id);
    }
    const frames = [];
    disconnect = service.events.subscribe(id, lease.leaseId, frame => { if (frame.event === 'message') frames.push(frame.data); }, () => {});
    let previousRequest;
    const cases = [
      { text: 'tool loop', produce(emit) { emitMessage(emit, 'a', 'assistant', usage(1)); emitMessage(emit, 'a', 'assistant', usage(1)); emitMessage(emit, 'tool', 'toolResult', usage(1000)); emitMessage(emit, 'b', 'assistant', usage(2)); }, total: 30, complete: true },
      { text: 'next root', steer: true, produce(emit) { emitMessage(emit, 'a', 'assistant', usage(4)); }, total: 50, complete: true },
      { text: 'partial', produce(emit) { emitMessage(emit, 'a', 'assistant', usage(1)); emitMessage(emit, 'b', 'assistant', undefined); }, total: 10, complete: false },
      { text: 'abort', produce(emit) { emitMessage(emit, 'a', 'assistant', usage(2)); }, total: 20, complete: false },
      { text: 'failure', produce(emit) { emitMessage(emit, 'a', 'assistant', usage(3)); }, total: 30, complete: false },
      { text: 'missing', produce(emit) { emitMessage(emit, 'a', 'assistant', undefined); }, total: null, complete: false },
      { text: 'zero failure placeholder', produce(emit) { emitMessage(emit, 'a', 'assistant', usage(0), 'error'); }, total: null, complete: false },
      { text: 'invalid', produce(emit) { emitMessage(emit, 'a', 'assistant', { ...usage(1), input: -1 }); }, total: null, complete: false },
    ];
    for (const [index, item] of cases.entries()) {
      const from = frames.length;
      const entered = new Promise(resolve => { started = resolve; });
      scenario = item.produce;
      if (scope === 'project') service.accept(id, item.text);
      else await service.accept(owner, id, { content: item.text }, 'message-'+index, lease.leaseId);
      await entered;
      assert.equal(frames.slice(from).filter(f => f.type === 'run_metrics').length, 0, 'no final stats during tool execution');
      if (item.steer) {
        if (scope === 'project') await service.steer(id, 'correction');
        else await service.steer(owner, id, { content: 'correction' }, 'steer-key', lease.leaseId);
      }
      await new Promise(resolve => setTimeout(resolve, 12));
      if (item.text === 'abort') {
        if (scope === 'project') await service.interrupt(id);
        else await service.interrupt(owner, id);
      } else release();
      for (let i=0; i<30 && !frames.slice(from).some(f => f.type === 'run_metrics'); i++) await tick();
      await tick();
      const current = frames.slice(from), starts = current.filter(f => f.type === 'run_started'), summaries = current.filter(f => f.type === 'run_metrics');
      assert.equal(starts.length, 1);
      assert.equal(summaries.length, 1);
      const result = summaries[0].payload;
      assert.equal(result.requestId, starts[0].payload.requestId);
      assert.notEqual(result.requestId, previousRequest);
      previousRequest = result.requestId;
      assert.equal(result.totalTokens, item.total);
      assert.equal(result.complete, item.complete);
      assert(result.durationMs >= 10, 'server duration includes the controlled model/tool wait');
      if (item.total !== null) {
        assert.equal(result.input, item.total/10);
        assert.equal(result.output, item.total/5, 'reasoning is not added twice');
        assert.equal(result.cacheRead, item.total*0.3);
        assert.equal(result.cacheWrite, item.total*0.4);
      } else for (const key of ['input','output','cacheRead','cacheWrite']) assert.equal(result[key], null);
    }
    disconnect();
    const reopened = scope === 'project' ? await service.open(id, 'reopen') : await service.open(owner, id);
    const replay = [];
    disconnect = service.events.subscribe(id, reopened.leaseId, frame => replay.push(frame), () => {});
    await tick();
    assert(!replay.some(frame => ['run_started','run_metrics'].includes(frame.data?.type)), 'opening/subscribing must not replay old stats');
    if (scope === 'workspace') {
      await service.accept(owner, id, { content: 'next root' }, 'message-1', reopened.leaseId);
      await tick();
      assert(!replay.some(frame => ['run_started','run_metrics'].includes(frame.data?.type)), 'idempotent replay must not create a new run');
    }
  } finally {
    release?.(); disconnect?.();
    if (service && id) await service.deleteSession(owner, id);
    f.close();
  }
});
