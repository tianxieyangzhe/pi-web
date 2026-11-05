import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";
import { DomainError } from "@/domain/errors";
import { boundRole, requireRole, isRoleSnapshot } from "@/domain/agent-definition";
import { botText, botETag, type Bot, type BotConversation, type BotProjectAgentBinding } from "@/domain/bot";
import type { AgentSnapshot,Session } from "@/domain/models";
import type { BotServiceDependencies } from "../bot-service";
import type { BotRepositoryPort } from "../ports/bot";
import { sessionLocks } from "../session-lock";
const stamp = () => new Date().toISOString(),
  id = () => randomUUID();
function parseProjectBindings(d:BotServiceDependencies,value:unknown):{projectIds:string[];agents:BotProjectAgentBinding[]} {
  if(!Array.isArray(value)||value.length>100)throw new DomainError("INVALID_BOT_INPUT","项目绑定最多 100 项",422,true);
  const projectIds:string[]=[],agents:BotProjectAgentBinding[]=[],seenProjects=new Set<string>(),seenPairs=new Set<string>();
  for(const item of value){
    if(!item||typeof item!=="object"||Array.isArray(item)||Object.keys(item).some(k=>!["projectId","agentIds"].includes(k)))throw new DomainError("INVALID_BOT_INPUT","项目 Agent 绑定格式无效",422,true);
    const row=item as Record<string,unknown>,projectId=botText(row.projectId,"项目",256),project=d.projects.get(projectId);
    if(!project||project.status!=="active")throw new DomainError("PROJECT_UNAVAILABLE","所选项目不可用",409,true);
    if(seenProjects.has(projectId))throw new DomainError("INVALID_BOT_INPUT","项目不能重复选择",422,true);
    seenProjects.add(projectId);projectIds.push(projectId);
    if(!Array.isArray(row.agentIds)||row.agentIds.length>1)throw new DomainError("INVALID_BOT_INPUT","每个项目只能绑定一个 Agent",422,true);
    for(const valueId of row.agentIds){
      const agentId=botText(valueId,"项目 Agent",256),agent=requireRole(d.catalog?.getAgent(agentId)??null,"project",projectId),pair=`${projectId}\0${agentId}`;
      if(seenPairs.has(pair))throw new DomainError("INVALID_BOT_INPUT","同一项目 Agent 不能重复绑定",422,true);
      seenPairs.add(pair);agents.push({projectId,agentId:agent.agentId,agentRevision:agent.revision,contentSha256:agent.contentSha256});
    }
  }
  return {projectIds,agents};
}
function readCoordinator(d:BotServiceDependencies,value:unknown) {
  if(value===undefined||value===null||value==="")return null;
  return requireRole(d.catalog?.getAgent(botText(value,"协调 Agent",256))??null,"coordinator","");
}
function withConfiguration<T extends Bot>(bot:T,projectBindings:ReturnType<BotRepositoryPort["botConfiguration"]>) {
  const value={...bot,projectBindings};
  return {...value,writeETag:botETag(value)};
}
function sameConfiguration(current:ReturnType<BotRepositoryPort["botConfiguration"]>,next:{projectIds:string[];agents:BotProjectAgentBinding[]}) {
  const left=[...current.flatMap(project=>[project.projectId,...project.agents.map(agent=>`${project.projectId}\0${agent.agentId}`)])].sort(),
    right=[...next.projectIds,...next.agents.map(agent=>`${agent.projectId}\0${agent.agentId}`)].sort();
  return JSON.stringify(left)===JSON.stringify(right);
}
function sameBindingSelection(current:ReturnType<BotRepositoryPort["botConfiguration"]>,value:unknown){
  if(!Array.isArray(value))return false;
  const normalize=(items:Array<{projectId:string;agentIds:string[]}>)=>items.flatMap(item=>[item.projectId,...item.agentIds.map(id=>`${item.projectId}\0${id}`)]).sort();
  try{return JSON.stringify(normalize(current.map(project=>({projectId:project.projectId,agentIds:project.agents.map(agent=>agent.agentId)}))))===JSON.stringify(normalize(value as Array<{projectId:string;agentIds:string[]}>));}catch{return false;}
}
function withConversationConfiguration<T extends BotConversation>(conversation:T,r:BotRepositoryPort) {
  const projectBindings=r.conversationConfiguration(conversation.id),value={...conversation,projectBindings};
  return {...value,writeETag:botETag(value)};
}
export function createBotConfiguration<T>(d: BotServiceDependencies, context: {
  bot: (id: string) => Bot;
  conversation: (id: string, botId?: string) => BotConversation;
  eligible: (id: string) => unknown;
  role: (c: BotConversation, s?: Session | null) => AgentSnapshot;
  participantForSession: (id: string) => Session | null;
  wake: () => void;
  detail: (id: string, cursors?: Record<string, string | undefined>) => T;
}) {
  const r = d.repository;
  const {
    bot,
    conversation,
    eligible,
    role,
    participantForSession,
    wake,
    detail
  } = context;
  return {
    async create(body: Record<string, unknown>, stableId?: string) {
      r.assertAvailable();
      const name = botText(body.name, 'Bot 名称', 120),
        botId = stableId ?? id(),
        description = body.description ? botText(body.description, '描述', 2000) : null,
        coordinator = readCoordinator(d,body.coordinatorAgentId),
        configuration = parseProjectBindings(d,body.projectBindings??[]);
      const old = r.get('bots', botId);
      if (old) {
        const oldConfig=r.botConfiguration(botId);
        if (old.name !== name || old.description !== description || body.workingDirectory && old.workingDirectory !== body.workingDirectory || old.coordinatorAgentId!==coordinator?.agentId || !sameConfiguration(oldConfig,configuration)) throw new DomainError('IDEMPOTENCY_CONFLICT', 'Bot 创建内容已改变', 409, true);
        return withConfiguration(old,oldConfig);
      }
      const workspace = await d.workspace.create(botId, typeof body.workingDirectory === 'string' ? body.workingDirectory : undefined);
      const now = stamp();
      const b = r.transaction(() => {
        const created=r.get('bots',botId)??r.insert('bots',{
          id:botId,name,description,...workspace,
          coordinatorAgentId:coordinator?.agentId??null,
          coordinatorAgentSnapshot:coordinator,
          maxParallelExecutions:4,status:'active',createdAt:now,updatedAt:now
        });
        r.replaceBotConfiguration(botId,configuration.projectIds,configuration.agents,now);
        return created;
      });
      return withConfiguration(b,r.botConfiguration(botId));
    },
    updateBot(botId: string, body: Record<string, unknown>, etag: string | null) {
      return r.transaction(() => {
        const b = bot(botId);
        if (!etag) throw new DomainError('PRECONDITION_REQUIRED', '缺少条件凭据', 428, true);
        const currentBindings=r.botConfiguration(botId);
        if (botETag({...b,projectBindings:currentBindings}) !== etag) throw new DomainError('BOT_CONFLICT', 'Bot 已更新', 409, true);
        const patch: Partial<Bot> = {};
        if (body.name !== undefined) patch.name = botText(body.name, '名称', 120);
        if (body.coordinatorAgentId !== undefined && (body.coordinatorAgentId !== b.coordinatorAgentId || body.adoptLatest === true)) {
          const selected = readCoordinator(d,body.coordinatorAgentId);
          patch.coordinatorAgentId = selected?.agentId??null;
          patch.coordinatorAgentSnapshot = selected;
        }
        if (body.maxParallelExecutions !== undefined) {
          const n = Number(body.maxParallelExecutions);
          if (!Number.isInteger(n) || n < 1 || n > 8) throw new DomainError('INVALID_BOT_INPUT', '并发数为 1～8', 422, true);
          patch.maxParallelExecutions = n;
        }
        if (body.status !== undefined) {
          if (!['active', 'disabled', 'archived'].includes(String(body.status))) throw new DomainError('INVALID_BOT_INPUT', '状态不正确', 422, true);
          if (r.list('bot_conversations', { botId }).some(c => r.projectCalls(c.id).some(call => ['accepted','working','unknown'].includes(call.status)))) throw new DomainError('SESSION_BUSY', '请先核对未完成的项目调用', 409, true);
          patch.status = body.status as Bot['status'];
        }
        if(body.projectBindings!==undefined&&(body.adoptLatest===true||!sameBindingSelection(currentBindings,body.projectBindings))){const configuration=parseProjectBindings(d,body.projectBindings);r.replaceBotConfiguration(botId,configuration.projectIds,configuration.agents,stamp());}
        const next = r.update('bots', botId, patch);
        wake();
        return withConfiguration(next,r.botConfiguration(botId));
      });
    },
    createConversation(botId: string, body: Record<string, unknown>, stableId?: string) {
      const b = bot(botId);
      if (b.status !== 'active') throw new DomainError('BOT_UNAVAILABLE', 'Bot 已停用', 409, true);
      if (body.projectId || body.targetSessionId || body.sessionId) throw new DomainError('INVALID_BOT_INPUT', '创建协调会话不能指定项目目标', 422, true);
      const title = botText(body.title ?? '新对话', '对话标题', 120),
        old = stableId ? r.get('bot_conversations', stableId) : null;
      if (old) {
        if (old.botId !== botId || old.title !== title) throw new DomainError('IDEMPOTENCY_CONFLICT', '协调会话创建内容已改变', 409, true);
        return withConversationConfiguration(old, r);
      }
      const now = stamp();
      if(!b.coordinatorAgentId||!b.coordinatorAgentSnapshot)throw new DomainError("ROLE_NOT_CONFIGURED","请先为 Bot 选择协调 Agent",409,true);
      const bound=boundRole(d.catalog?.getAgent(b.coordinatorAgentId)??null,b.coordinatorAgentSnapshot,"coordinator",b.id);
      const c=r.transaction(()=>{
        const created=r.insert('bot_conversations',{
          id:stableId??id(),botId,title,coordinatorAgentId:b.coordinatorAgentId!,coordinatorAgentSnapshot:bound,
          nativeRef:null,createdAt:now,updatedAt:now,lastActivityAt:null
        });
        r.snapshotBotConfiguration(botId,created.id,now);
        return created;
      });
      return withConversationConfiguration(c, r);
    },
    detail(botId: string, conversationId: string, cursors: Record<string, string | undefined> = {}) {
      conversation(conversationId, botId);
      return detail(conversationId, cursors);
    },
    updateConversation(botId: string, conversationId: string, body: Record<string, unknown>, etag: string | null) {
      return r.transaction(() => {
        const c = conversation(conversationId, botId);
        if (!etag) throw new DomainError('PRECONDITION_REQUIRED', '缺少条件凭据', 428, true);
        if (botETag({...c,projectBindings:r.conversationConfiguration(c.id)}) !== etag) throw new DomainError('BOT_CONFLICT', '总对话已更新', 409, true);
        const patch: Partial<BotConversation> = {};
        if (body.title !== undefined) patch.title = botText(body.title, '标题', 120);
        if (body.status !== undefined) {
          if (body.status !== 'deleted') throw new DomainError('INVALID_BOT_INPUT', '总对话删除必须明确请求直接删除', 422, true);
          const participants=r.participants(conversationId).map(participant=>d.sessions.get(participant.id)).filter((session):session is NonNullable<typeof session>=>!!session);
          for(const identity of ['bot:'+conversationId,...participants.map(session=>session.id)]){if(sessionLocks.has(identity))void d.runtime.abort(identity).catch(()=>{});sessionLocks.delete(identity);}
          if(d.compactions?.get(conversationId)?.state==='running'){try{d.runtime.cancelCompaction('bot:'+conversationId);}catch{/* 删除不等待压缩结束 */ }d.compactions.delete(conversationId);}
          const files=[c.nativeRef?.sessionFile,...participants.map(session=>session.nativeRef&&typeof session.nativeRef.sessionFile==='string'?session.nativeRef.sessionFile:null)].filter((file):file is string=>typeof file==='string');
          const roots=[path.resolve(d.workspace.sessionDirectory(botId)),...participants.map(session=>d.projects.get(session.projectId)?.rootPath).filter((root):root is string=>typeof root==='string').map(root=>path.resolve(root))];
          r.deleteConversation(conversationId);
          for(const file of files){const target=path.resolve(file);if(roots.some(root=>target===root||target.startsWith(root+path.sep)))rmSync(target,{force:true});}
          return c;
        }
        return withConversationConfiguration(r.update('bot_conversations', conversationId, patch),r);
      });
    },
    attach(botId: string, conversationId: string, body: Record<string, unknown>, stableId?: string) {
      conversation(conversationId, botId);
      eligible(conversationId);
      return r.transaction(() => {
        const p = d.projects.get(botText(body.projectId, '项目', 256));
        if (!p || p.status !== 'active') throw new DomainError('PROJECT_UNAVAILABLE', '项目不可用', 409, true);
        const projectBinding=r.conversationConfiguration(conversationId).find(binding=>binding.projectId===p.id);
        if(!projectBinding)throw new DomainError('PROJECT_OUT_OF_SCOPE','项目不在当前总对话快照范围内',409,true);
        const old = stableId ? d.sessions.get(stableId) : null;
        if (old) {
          const s = old;
          if (s.projectId !== p.id || s.botConversationId !== conversationId || s.agentId !== String(body.agentId ?? s.agentId) || s.assignment !== (body.assignment || null) || s.participantName !== (body.participantName || null)) throw new DomainError('IDEMPOTENCY_CONFLICT', '添加内容已改变', 409, true);
          return s;
        }
        let s = body.sessionId ? d.sessions.get(String(body.sessionId)) : null;
        if (s?.botConversationId === conversationId) {
          if (s.projectId === p.id && s.assignment === (body.assignment || null) && s.participantName === (body.participantName || null) && (!body.agentId || body.agentId === s.agentId)) return s;
          throw new DomainError('IDEMPOTENCY_CONFLICT', '已有归属会话配置不同', 409, true);
        }
        if (body.sessionId && (!s || s.projectId !== p.id || s.status!=='open' || s.botConversationId || sessionLocks.has(s.id) || !['idle', 'not_started', 'unavailable'].includes(s.state))) throw new DomainError('SESSION_ALREADY_ATTACHED', '会话已归属或不可用', 409, true);
        if (s) {
          if (r.projectCalls(conversationId).some(call => call.sessionId === s!.id && ['accepted','working','unknown'].includes(call.status))) throw new DomainError('SESSION_BUSY', '已有会话仍有未完成或未知的项目调用', 409, true);
          const selectedRole=role(conversation(conversationId), s);
          if(!projectBinding.agents.some(a=>a.agentId===selectedRole.agentId))throw new DomainError('ROLE_BINDING_INVALID','所选项目 Agent 未绑定到当前 Bot 项目',409,true);
        } else {
          const agentId=botText(body.agentId,'项目 Agent',256),binding=projectBinding.agents.find(item=>item.agentId===agentId);
          if(!binding)throw new DomainError('ROLE_BINDING_INVALID','请选择已绑定到此 Bot 项目的 Agent',409,true);
          const version=d.catalog?.getAgentVersion(binding.agentId,binding.revision,binding.contentSha256)??null,
            selected= requireRole(version,'project',p.id);
          if(selected.contentSha256!==binding.contentSha256||selected.revision!==binding.revision)throw new DomainError('ROLE_BINDING_INVALID','项目 Agent 版本与 Bot 绑定不一致',409,true);
          s = d.sessions.create({projectId:p.id,purpose:'项目会话',agentId:selected.agentId,agentSnapshot:selected,mcpIds:[],mcpSnapshots:[]});
        }
        r.updateParticipant(s.id, {
          botConversationId: conversationId,
          participantName: body.participantName ? botText(body.participantName, '别名', 120) : null,
          assignment: body.assignment ? botText(body.assignment, '分工', 4000) : null,
          collaborationState: 'active',
          botJoinedAt: stamp()
        });
        return d.sessions.get(s.id)!;
      });
    },
    participantForSession,
    configureSession(projectId: string, sessionId: string, agentId: string, expected: string | null, revision?:number, contentSha256?:string) {
      return r.transaction(() => {
        const s = d.sessions.get(sessionId);
        if (!s || s.projectId !== projectId) throw new DomainError('NOT_FOUND', '会话不存在', 404, true);
        if(s.status!=='open')throw new DomainError('SESSION_ENDED','已关闭的项目 Session 不能升级角色版本',409,true);
        if (!expected || botETag(s) !== expected) throw new DomainError('BOT_CONFLICT', '会话已更新，请刷新', 409, true);
        if (sessionLocks.has(s.id) || ['starting', 'running', 'interrupting'].includes(s.state) || r.projectCalls(s.botConversationId ?? '').some(call => call.sessionId === s.id && ['accepted','working','unknown'].includes(call.status))) throw new DomainError('SESSION_BUSY', '请先处理未完成或未知的项目调用', 409, true);
        if (s.agentId && s.agentId !== agentId) throw new DomainError('ROLE_BINDING_INVALID', '历史角色身份不可更换', 409, true);
        let selected:AgentSnapshot;
        if(!Number.isInteger(revision)||typeof contentSha256!=='string'||contentSha256.length!==64)throw new DomainError('PRECONDITION_REQUIRED','请先查看并确认要采用的精确角色版本',428,true);
        const latest=d.catalog?.getAgent(agentId);
        if(!latest||latest.revision!==revision||latest.contentSha256!==contentSha256)throw new DomainError('AGENT_VERSION_CHANGED','角色目录已更新，请刷新差异后重新确认',409,true);
        if(s.botConversationId){
          const parent=conversation(s.botConversationId);
          if(bot(parent.botId).status!=='active')throw new DomainError('CONVERSATION_NOT_ACTIVE','Bot 已停用，不能采用角色版本',409,true);
          const binding=r.conversationConfiguration(s.botConversationId).find(row=>row.projectId===projectId)?.agents.find(item=>item.agentId===agentId);
          if(!binding)throw new DomainError('ROLE_BINDING_INVALID','项目 Agent 未绑定到当前 Bot 项目',409,true);
          selected=requireRole(d.catalog?.getAgentVersion(agentId,revision,contentSha256)??null,'project',projectId);
          if(selected.agentId!==binding.agentId)throw new DomainError('ROLE_BINDING_INVALID','不能更换总对话中的项目 Agent 身份',409,true);
          if(selected.revision!==binding.revision||selected.contentSha256!==binding.contentSha256){
            if(sessionLocks.has('bot:'+s.botConversationId)||r.participants(s.botConversationId).some(session=>sessionLocks.has(session.id))||r.projectCalls(s.botConversationId).some(call=>['accepted','working','unknown'].includes(call.status)))throw new DomainError('SESSION_BUSY','请先处理此协调会话所有未完成或未知的项目调用',409,true);
            r.adoptConversationProjectAgent(s.botConversationId,projectId,agentId,selected.revision,selected.contentSha256);
          }
        }else selected=requireRole(d.catalog?.getAgentVersion(agentId,revision,contentSha256)??null,'project',projectId);
        r.setSessionRole(s.id, selected.agentId, selected);
        return d.sessions.get(s.id)!;
      });
    },
    configureConversation(botId: string, conversationId: string, agentId: string, expected: string | null, revision?:number, contentSha256?:string) {
      return r.transaction(() => {
        const c = conversation(conversationId, botId);
        if(bot(botId).status!=='active')throw new DomainError('CONVERSATION_NOT_ACTIVE','Bot 已停用，不能采用角色版本',409,true);
        if (!expected || botETag({...c,projectBindings:r.conversationConfiguration(c.id)}) !== expected) throw new DomainError('BOT_CONFLICT', '总对话已更新', 409, true);
        if (sessionLocks.has('bot:' + c.id) || r.projectCalls(c.id).some(call => ['accepted','working','unknown'].includes(call.status))) throw new DomainError('SESSION_BUSY', '请先处理未完成或未知的项目调用', 409, true);
        if (c.coordinatorAgentId !== agentId) throw new DomainError('ROLE_BINDING_INVALID', '会话角色身份不可更换', 409, true);
        if(!Number.isInteger(revision)||typeof contentSha256!=='string'||contentSha256.length!==64)throw new DomainError('PRECONDITION_REQUIRED','请先查看并确认要采用的精确角色版本',428,true);
        const latest=d.catalog?.getAgent(agentId);
        if(!latest||latest.revision!==revision||latest.contentSha256!==contentSha256)throw new DomainError('AGENT_VERSION_CHANGED','角色目录已更新，请刷新差异后重新确认',409,true);
        const selected = requireRole(d.catalog?.getAgentVersion(agentId,revision,contentSha256) ?? null, 'coordinator', botId);
        return withConversationConfiguration(r.update('bot_conversations', c.id, {
          coordinatorAgentSnapshot: selected
        }),r);
      });
    },
    updateParticipant(botId: string, conversationId: string, sessionId: string, body: Record<string, unknown>, etag: string | null) {
      conversation(conversationId, botId);
      const current = r.participants(conversationId).find(x => x.id === sessionId);
      if (!current) throw new DomainError('NOT_FOUND', '参与项目会话不存在', 404, true);
      if (!etag || botETag(current) !== etag) throw new DomainError('BOT_CONFLICT', '参与会话已更新', 409, true);
      if ((body.assignment !== undefined || body.participantName !== undefined) && (sessionLocks.has(sessionId) || r.projectCalls(conversationId).some(call => call.sessionId === sessionId && ['accepted','working','unknown'].includes(call.status)))) throw new DomainError('SESSION_BUSY', '请先处理未完成或未知的项目调用', 409, true);
      const patch: Record<string, unknown> = {};
      if (body.collaborationState !== undefined) {
        if (!['active', 'disabled'].includes(String(body.collaborationState))) throw new DomainError('INVALID_BOT_INPUT', '参与状态无效', 422, true);
        patch.collaborationState = body.collaborationState;
      }
      for (const k of ['assignment', 'participantName']) if (body[k] !== undefined) patch[k] = body[k] ? botText(body[k], k, k === 'assignment' ? 4000 : 120) : null;
      r.updateParticipant(sessionId, patch);
      wake();
      return d.sessions.get(sessionId);
    }
  };
}
