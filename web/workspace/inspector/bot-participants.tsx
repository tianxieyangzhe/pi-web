import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { botApi } from '../../api/bot-client';
import type { BotDetail, BotParticipant } from '../../domain/bot';
import type { Project, Session } from '../../domain/models';
import type { SessionMemory } from '../../domain/session-memory';
import { RoleSelector } from '../roles/role-selector';
export function BotParticipants({
  detail,
  projects,
  onRefresh,
  onRole
}: {
  detail: BotDetail;
  projects: Project[];
  onRefresh: () => Promise<void>;
  onRole: (id: string) => void;
}) {
  const [projectId, setProjectId] = useState(projects.find(p => p.status === 'active')?.id ?? ''),
    [roleId, setRoleId] = useState(''),
    [existing, setExisting] = useState(''),
    [alias, setAlias] = useState(''),
    [assignment, setAssignment] = useState(''),
    [templateId, setTemplateId] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]),
    [templates, setTemplates] = useState<Array<{
      sessionMemory: SessionMemory;
      writeETag: string;
    }>>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [editName, setEditName] = useState(''),
    [editAssignment, setEditAssignment] = useState('');
  useEffect(() => {
    let alive = true;
    setExisting('');
    setRoleId('');
    void api.listSessions(projectId).then(v => {
      if (alive) setSessions(v);
    }).catch(e => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);
  useEffect(() => {
    let alive = true;
    void api.listSessionMemoryTemplates().then(v => {
      if (alive) setTemplates(v);
    }).catch(e => {
      if (alive) setError(e.message);
    });
    return () => {
      alive = false;
    };
  }, []);
  const template = templates.find(t => t.sessionMemory.id === templateId),
    selected = sessions.find(s => s.id === existing);
  async function act(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      await onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }
  return <><section className="session-inspector__section">{detail.participants.map(p => <div className="bot-role-row" key={p.id}>
    <button type="button" className="ui-button ui-button--secondary ui-button--small" onClick={() => onRole(p.id)}>{p.projectName} · {p.roleName}</button>
    <small>{p.assignment || '尚未补充分工'} · {p.roleState?.available ? '角色可用' : '角色待配置/停用'}</small>
    <div className="bot-role-row__actions"><button type="button" className="ui-button ui-button--secondary ui-button--small" disabled={busy} onClick={() => void act(() => botApi.updateParticipant(detail.bot.id, detail.conversation.id, p.id, {
      collaborationState: p.collaborationState === 'active' ? 'disabled' : 'active'
    }, p.writeETag))}>{p.collaborationState === 'active' ? '停用参与' : '启用参与'}</button><button type="button" className="ui-button ui-button--secondary ui-button--small" onClick={() => {
      setEditing(p.id);
      setEditName(p.participantName ?? '');
      setEditAssignment(p.assignment ?? '');
    }}>修改分工</button></div>
    {editing === p.id && <form className="bot-form" onSubmit={e => {
      e.preventDefault();
      void act(async () => {
        await botApi.updateParticipant(detail.bot.id, detail.conversation.id, p.id, {
          participantName: editName,
          assignment: editAssignment
        }, p.writeETag);
        setEditing(null);
      });
    }}><label>显示别名<input value={editName} onChange={e => setEditName(e.target.value)} maxLength={120} /></label><label>本次分工<textarea value={editAssignment} onChange={e => setEditAssignment(e.target.value)} maxLength={4000} /></label><div className="bot-role-row__edit-actions"><button type="submit" className="ui-button ui-button--primary ui-button--small" disabled={busy}>保存</button><button type="button" className="ui-button ui-button--secondary ui-button--small" onClick={() => setEditing(null)}>取消</button></div></form>}</div>)}</section><form className="bot-form" onSubmit={e => {
      e.preventDefault();
      void act(async () => {
        await botApi.attach(detail.bot.id, detail.conversation.id, {
          projectId,
          agentId: existing ? selected?.agentId : roleId,
          sessionId: existing || undefined,
          participantName: alias,
          assignment,
          ...(!existing && template ? {
            sessionMemoryTemplateId: template.sessionMemory.id,
            templateWriteETag: template.writeETag
          } : {})
        });
        setAssignment('');
        setAlias('');
        setExisting('');
        setSessions(await api.listSessions(projectId));
      });
    }}><h2>添加项目会话</h2><label>项目<select value={projectId} onChange={e => setProjectId(e.target.value)}>{projects.filter(p => p.status === 'active').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>{!existing ? <RoleSelector kind="project" projectId={projectId} projects={projects} value={roleId} onChange={setRoleId} /> : <p>保留原角色：{selected?.agent?.name ?? '待配置'} · 会话 v{selected?.roleState?.boundRevision ?? '—'}</p>}<details><summary>可选分工与初始记忆</summary><label>显示别名<input value={alias} onChange={e => setAlias(e.target.value)} maxLength={120} /></label><label>本次分工<textarea value={assignment} onChange={e => setAssignment(e.target.value)} maxLength={4000} /></label>{!existing && <><label>记忆模板<select value={templateId} onChange={e => setTemplateId(e.target.value)}><option value="">空记忆</option>{templates.map(t => <option key={t.sessionMemory.id} value={t.sessionMemory.id}>{t.sessionMemory.title}</option>)}</select></label>{template && <div className="role-evidence"><p>{template.sessionMemory.contextJson.summary}</p><p>{template.sessionMemory.contextJson.goal}</p><ul>{template.sessionMemory.contextJson.constraints.map((c, i) => <li key={i}>{c}</li>)}</ul></div>}</>}</details><details><summary>纳入已有会话</summary><select aria-label="已有项目会话" value={existing} onChange={e => setExisting(e.target.value)}><option value="">创建独立新会话</option>{sessions.filter(s => !s.botParent).map(s => <option key={s.id} value={s.id} disabled={!s.roleState?.configured || !s.roleState?.available || ['running', 'starting', 'interrupting', 'ended'].includes(s.state)}>{s.memorySummary || '新会话'} · {s.agent?.name ?? '待配置角色'}{!s.roleState?.configured ? '（先在检查配置角色）' : ''}</option>)}</select><small>纳入保留历史、角色和记忆；忙碌或未配置会话暂不可选。</small></details><button type="submit" className="ui-button ui-button--primary" disabled={busy || !projectId || !existing && !roleId}>添加</button></form>{error && <p role="alert">{error}</p>}</>;
}
