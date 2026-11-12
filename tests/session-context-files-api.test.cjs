require('./register.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { fixture } = require('./workspace-fixture.cjs');
const { createSessionContextFilesStore } = require('../src/infrastructure/references/session-context-files.server.ts');
const { createWorkspaceService } = require('../src/application/workspace-service.ts');
const { createWorkspaceApi } = require('../src/shared/protocol/workspace-api.server.ts');
const { createSessionExecutionService } = require('../src/application/session-execution-service.ts');
const { createSessionRepository } = require('../src/infrastructure/database/session-repository.ts');
const { createProjectRepository } = require('../src/infrastructure/database/project-repository.ts');
// The path reader shares a module with catalog operations; do not load the production database.
const loadBeforeReader = Module._load;
Module._load = function(name, ...args) {
  if (name === '@/infrastructure/database/project-repository.server') return { projectRepository: { get() { throw new Error('Production catalog is forbidden in this test'); } } };
  return loadBeforeReader.call(this, name, ...args);
};
let readProjectBytes;
try { ({ readProjectBytes } = require('../src/infrastructure/projects/project-files.server.ts')); } finally { Module._load = loadBeforeReader; }
const tick = () => new Promise(resolve => setImmediate(resolve));

async function setup(mode, actualRuntime) {
  const f = fixture(); f.a=fs.realpathSync(f.a);f.b=fs.realpathSync(f.b);
  const storeRoot = path.join(f.root, 'contexts'), store = createSessionContextFilesStore(storeRoot);
  fs.writeFileSync(path.join(f.a, 'rules.md'), '约束正文：每次修改先核对接口。');
  fs.writeFileSync(path.join(f.a, 'second.md'), 'Second document');
  fs.writeFileSync(path.join(f.a, 'binary.pdf'), '%PDF-invalid');
  const runtime = actualRuntime ?? f.runtime;
  let owner, session, lease, route, execution, service, sessions, projects;
  const read = root => reference => ({ name: path.basename(reference.path), bytes: readProjectBytes(root, reference.path, 50_000_000) });
  if (mode === 'workspace') {
    service = createWorkspaceService({ repository: f.repository, runtime, directories: { ...require('../src/infrastructure/workspaces/directories.server.ts').workspaceDirectories }, contextFiles: store,
      readContextFile(workspaceId, reference) { const p = f.repository.get(workspaceId)?.projects.find(p => p.id === reference.projectId); if (!p) throw new (require('../src/domain/errors.ts').DomainError)('REFERENCE_OUTSIDE_SCOPE', 'wrong scope', 403, true); return read(p.rootPath)(reference); } });
    owner = await service.save(null, { name: 'W', projects: [{ rootPath: f.a }], defaultProjectIndex: 0 }, 'create');
    session = service.createSession(owner.id, {}, 'create'); lease = await service.open(owner.id, session.id);
    route = createWorkspaceApi(service);
  } else {
    projects = createProjectRepository(f.db); sessions = createSessionRepository(f.db);
    owner = projects.create({ name: 'P', description: null, kind: 'code', rootPath: f.a, status: 'active' });
    session = sessions.create({ projectId: owner.id, purpose: 'context', agentId: null, agentSnapshot: null, mcpIds: [], mcpSnapshots: [] });
    if (actualRuntime) {
      const { initializeSession } = require('./support/initialize-pi-session.ts');
      const manager = initializeSession('fixture', f.a, f.root);
      sessions.setNativeRefIfAbsent(session.id, { kind: 'pi', sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), cwd: f.a });
    }
    execution = createSessionExecutionService({ sessions, projects, catalog: {}, runtime, contextFiles: store, readContextFile: read(f.a) });
    lease = await execution.open(session.id, 'open');
    const original = Module._load, shared = require.resolve('../src/shared/protocol/project-session-api.server.ts');
    delete require.cache[shared];
    Module._load = function(name, ...args) {
      if (name === '@/bootstrap/composition-root.server') return { services: { execution, projectSessions: { get(p, id) { if (p !== owner.id || id !== session.id) throw new (require('../src/domain/errors.ts').DomainError)('NOT_FOUND', 'wrong scope', 404, true); } } } };
      return original.call(this, name, ...args);
    };
    try { route = require(shared).projectSessionAction; } finally { Module._load = original; }
  }
  const projectId = mode === 'workspace' ? owner.projects[0].id : owner.id;
  async function call(method = 'GET', body, etag, overrides = {}) {
    const request = new Request('http://localhost/context-files', { method, headers: { 'content-type': 'application/json', 'x-session-lease-id': overrides.lease ?? lease.leaseId, ...(etag ? { 'if-match': etag } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const response = mode === 'workspace' ? await route(request, [overrides.owner ?? owner.id, 'sessions', session.id, 'context-files']) : await route(request, { params: Promise.resolve({ projectId: overrides.owner ?? owner.id, sessionId: session.id }) }, 'context-files');
    return { status: response.status, ...await response.json() };
  }
  return { ...f, store, storeRoot, owner, session, projectId, execution, service, lease, runtime, call,
    async cleanup() { f.finish(); await tick(); if (execution) await execution.deleteSession(owner.id, session.id); else await service.deleteSession(owner.id, session.id); f.close(); } };
}

for (const mode of ['project', 'workspace']) test(`${mode} context-files API persists project snapshots until explicit deletion and enforces scope, lease, ETag and atomic validation`, async () => {
  const f = await setup(mode);
  try {
    const original = await f.call(); assert.equal(original.status, 200); assert.deepEqual(original.data.files, []);
    assert.equal((await f.call('GET', undefined, undefined, { owner: 'wrong' })).status, 404);
    const reference = { projectId: f.projectId, path: 'rules.md' };
    assert.equal((await f.call('POST', { references: [reference] }, original.data.writeETag, { lease: 'wrong' })).status, 409);
    assert.equal((await f.call('POST', { references: [reference] })).status, 428);
    assert.equal((await f.call('POST', { references: [{ name: 'upload.md', data: 'YWJj' }] }, original.data.writeETag)).status, 400);
    assert.equal((await f.call('POST', { references: [{ ...reference, projectId: 'outside' }] }, original.data.writeETag)).status, 403);
    assert.equal((await f.call('POST', { references: [reference, { ...reference, path: 'binary.pdf' }] }, original.data.writeETag)).status, 422);
    assert.deepEqual((await f.call()).data, original.data, 'invalid batch must not publish first item');
    const added = await f.call('POST', { references: [reference] }, original.data.writeETag); assert.equal(added.status, 200); assert.equal(added.data.files.length, 1);
    assert(!JSON.stringify(added.data).includes(f.a), 'DTO must not expose absolute source paths');
    assert.equal((await f.call('POST', { references: [reference] }, original.data.writeETag)).status, 409);
    assert.deepEqual((await f.call('POST', { references: [reference] }, added.data.writeETag)).data, added.data, 'same bytes and source deduplicate');
    fs.writeFileSync(path.join(f.a, 'rules.md'), 'Changed source');
    assert.equal(createSessionContextFilesStore(f.storeRoot).documents(f.session.id)[0].content, '约束正文：每次修改先核对接口。', 'fresh store restores exact selected snapshot');
    assert.deepEqual(f.store.read('unrelated-session').files, []);
    fs.writeFileSync(path.join(f.a, 'large.md'), 'x'.repeat(1_048_577));
    assert.equal((await f.call('POST', { references: [{ ...reference, path: 'large.md' }] }, added.data.writeETag)).status, 413);
    assert.deepEqual((await f.call()).data, added.data);
    const removed = await f.call('DELETE', { id: added.data.files[0].id }, added.data.writeETag); assert.equal(removed.status, 200); assert.deepEqual(removed.data.files, []);
    assert.equal(fs.readFileSync(path.join(f.a, 'rules.md'), 'utf8'), 'Changed source');
  } finally { await f.cleanup(); }
});

for (const mode of ['project', 'workspace']) test(`${mode} context-files API blocks mutations during execution without blocking reads`, async () => {
  const f = await setup(mode);
  try {
    const current = await f.call();
    let consuming;
    if (mode === 'project') consuming = (async () => { for await (const _ of f.execution.send(f.session.id, 'working')) {} })();
    else await f.service.accept(f.owner.id, f.session.id, { content: 'working' }, 'message', f.lease.leaseId);
    await tick();
    assert.equal((await f.call('POST', { references: [{ projectId: f.projectId, path: 'rules.md' }] }, current.data.writeETag)).status, 409);
    assert.equal((await f.call()).status, 200);
    f.finish(); if (consuming) await consuming;
  } finally { await f.cleanup(); }
});

test('project application send API uses full selected context on consecutive Pi requests, preserves upload behavior, and stops re-injecting removed files after restore', async () => {
  const pi = await import('@earendil-works/pi-coding-agent'), ai = await import('@earendil-works/pi-ai');
  const original = Module._load;
  Module._load = function(name, ...args) { return name === '@earendil-works/pi-coding-agent' ? pi : name === '@earendil-works/pi-ai' ? ai : original.call(this, name, ...args); };
  let PiSessionRuntime;
  try { ({ PiSessionRuntime } = require('../src/infrastructure/pi/pi-session-runtime.server.ts')); require('./support/initialize-pi-session.ts'); } finally { Module._load = original; }
  const modelRuntime = await pi.ModelRuntime.create({ credentials: { async read() {}, async list() { return []; }, async modify() {}, async delete() {} }, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  modelRuntime.registerProvider('fake', { name: 'fake', baseUrl: 'http://localhost', apiKey: 'fake', api: 'openai-completions', models: [{ id: 'fake', name: 'fake', api: 'openai-completions', baseUrl: 'http://localhost', reasoning: false, input: ['text', 'image'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1000 }] });
  let selectedStore;
  const runtime = new PiSessionRuntime(async () => ({ runtime: modelRuntime, model: modelRuntime.getModel('fake', 'fake') }), {}, id => ({ documents: selectedStore ? selectedStore.documents(id) : [] }));
  const f = await setup('project', runtime); selectedStore = f.store;
  const prompts = [], messages = [];
  function capture() {
    runtime.getHandle(f.session.id).session.agent.streamFunction = (_model, context) => {
      prompts.push(ai.getCurrentSystemPrompt(context.messages)); messages.push(structuredClone(context.messages));
      const stream = ai.createAssistantMessageEventStream();
      const message = { role: 'assistant', content: [{ type: 'text', text: 'ok' }], api: 'openai-completions', provider: 'fake', model: 'fake', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };
      stream.push({ type: 'done', reason: 'stop', message }); stream.end(); return stream;
    };
  }
  async function send(text, refs) { const events = []; for await (const event of f.execution.send(f.session.id, text, 'project_write', refs)) events.push(event); assert(!events.some(event => event.type === 'error'), JSON.stringify(events)); }
  try {
    const initial = await f.call();
    const added = await f.call('POST', { references: [{ projectId: f.projectId, path: 'rules.md' }] }, initial.data.writeETag); assert.equal(added.status, 200);
    capture(); await send('first'); await send('second');
    for (const prompt of prompts) { assert(prompt.includes('约束正文：每次修改先核对接口。')); assert(prompt.includes('<project_context>')); }
    assert.equal((await f.call()).data.files.length, 1, 'sending must not remove selected project references');
    await runtime.close(runtime.getHandle(f.session.id)); await f.execution.open(f.session.id, 'reopen'); capture(); await send('restored');
    assert(prompts.at(-1).includes('约束正文：每次修改先核对接口。'));
    const current = await f.call(); await f.call('DELETE', { id: added.data.files[0].id }, current.data.writeETag);
    await send('without context'); assert(!prompts.at(-1).includes('约束正文：每次修改先核对接口。'));
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
    await send('uploaded image', [{name:'pixel.png',data:png}]);
    assert(messages.at(-1).some(message=>Array.isArray(message.content)&&message.content.some(block=>block.type==='image'&&block.data===png)), 'uploaded images still use native message content');
    assert.deepEqual((await f.call()).data.files, [], 'uploads must not become persistent context files');
  } finally { await f.cleanup(); }
});
