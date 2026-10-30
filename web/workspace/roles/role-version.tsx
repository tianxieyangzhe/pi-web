import { api } from '../../api/client';
import { RoleEditor } from './role-editor';
import type { Agent,Project,RoleState,AgentSnapshot } from '../../domain/models';
import { RoleSelector } from './role-selector';
import { useState, useEffect } from 'react';

const capabilityLabels:Record<string,string>={readFiles:'读取项目文件',writeFiles:'修改项目文件',readProjects:'历史项目直读（已停用）',dispatchTasks:'派发项目任务',dispatchProjectWrites:'派发项目修改',exchangeMessages:'角色间协作消息'};
type DefinedAgent=Omit<Agent,'definition'>&{definition:NonNullable<Agent['definition']>};
export function compareAgentVersion(snapshot:AgentSnapshot,latest:DefinedAgent){
  const keys=Object.keys(capabilityLabels),changes=keys.filter(key=>snapshot.definition.capabilities[key as keyof typeof snapshot.definition.capabilities]!==latest.definition.capabilities[key as keyof typeof latest.definition.capabilities]).map(key=>({key,label:capabilityLabels[key],before:snapshot.definition.capabilities[key as keyof typeof snapshot.definition.capabilities],after:latest.definition.capabilities[key as keyof typeof latest.definition.capabilities]}));
  return {instructionsChanged:snapshot.definition.instructions!==latest.definition.instructions,capabilityChanges:changes};
}
export function RoleVersion({
  state,
  agentId,
  kind,
  botId,
  projectId,
  projects,
  onAdopt,
  onView,
  onRefresh,
  snapshot
}: {
  state?: RoleState | null;
  agentId: string | null;
  kind: 'coordinator' | 'project';
  botId?: string;
  projectId?: string;
  projects: Project[];
  onAdopt: (id: string,revision?:number,contentSha256?:string) => Promise<unknown>;
  onView?: (id: string) => void;
  onRefresh?: () => Promise<void>;
  snapshot?:AgentSnapshot|null;
}) {
  const [selected, setSelected] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [latestAgent,setLatestAgent]=useState<DefinedAgent|null>(null),
    [editing, setEditing] = useState<Agent | null>(null);
  useEffect(() => {
    setSelected('');
    setError('');
    setEditing(null);
  }, [agentId, projectId, botId]);
  const selectedAgentId=selected||agentId;
  useEffect(()=>{
    setLatestAgent(null);
    setError('');
    if(!selectedAgentId||!(state?.canAdoptLatest||!state?.configured))return;
    let active=true;
    void api.getAgent(selectedAgentId).then(value=>{if(!value.definition||typeof value.contentSha256!=='string'||value.contentSha256.length!==64)throw new Error('新版 Agent 定义或摘要不可用');if(active)setLatestAgent(value as DefinedAgent);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'无法读取新版 Agent 定义');});
    return()=>{active=false;};
  },[selectedAgentId,state?.canAdoptLatest,state?.configured,state?.currentRevision]);
  const versionDiff=snapshot&&latestAgent?compareAgentVersion(snapshot,latestAgent):null;
  return <section className="session-inspector__section"><h2>角色版本</h2><p>{state?.name ?? '待配置角色'} · 会话 v{state?.boundRevision ?? '—'} / 目录 v{state?.currentRevision ?? '—'}</p>{state?.status && state.status !== 'active' && <p>角色{state.status === 'archived' ? '已归档' : '已停用'}，新执行暂停。</p>}{state?.reason && <small>{state.reason}</small>}{snapshot&&<details><summary>查看会话绑定指导（只读）</summary><pre className="role-evidence">{snapshot.definition.instructions}</pre></details>}{versionDiff&&<details className="role-version-diff"><summary>采用前查看新版差异</summary><p>{versionDiff.instructionsChanged?'新版指导正文有变化。':'指导正文未变化。'}</p>{versionDiff.capabilityChanges.length>0?<ul>{versionDiff.capabilityChanges.map(change=><li key={change.key}>{change.label}：{change.before?'开启':'关闭'} → {change.after?'开启':'关闭'}</li>)}</ul>:<p>运行能力没有变化。</p>}<details><summary>当前会话版本 v{snapshot!.revision}</summary><pre className="role-evidence">{snapshot!.definition.instructions}</pre></details><details><summary>目录新版 v{latestAgent!.revision}</summary><pre className="role-evidence">{latestAgent!.definition.instructions}</pre></details><small>采用只影响后续执行；历史 Execution 保留原版本。只有角色、范围和运行状态检查通过后才能采用。</small></details>}{state?.canAdoptLatest || !state?.configured ? <><RoleSelector fixedId={agentId || undefined} kind={kind} botId={botId} projectId={projectId} projects={projects} value={selected || agentId || ''} onChange={setSelected} /><button className={`ui-button ui-button--small ${state?.configured ? 'ui-button--secondary' : 'ui-button--primary'}`} disabled={busy || !(selected || agentId) || state?.status === 'disabled' || state?.status === 'archived' || !!state?.reason && state.reason.includes('排队') || !!(state?.canAdoptLatest||!state?.configured)&&!latestAgent} onClick={() => {
        setBusy(true);
        setError('');
        void onAdopt(selected || agentId || '',latestAgent?.revision,latestAgent?.contentSha256??undefined).catch(async e => {setError(e instanceof Error ? e.message : '角色配置失败');await onRefresh?.();}).finally(() => setBusy(false));
      }}>{state?.configured ? '采用同一角色最新版' : '保留历史，配置角色'}</button></> : <p>{state?.configured?'当前会话已使用目录最新版本。':'请先配置一个可用角色。'}</p>}{agentId && <button className="ui-button ui-button--secondary ui-button--small" onClick={() => {
      if (onView) onView(agentId);else void api.getAgent(agentId).then(setEditing).catch(e => setError(e.message));
    }}>查看/修改目录角色</button>}{editing && <RoleEditor target={{
      kind: editing.kind ?? kind,
      resource: editing
    }} projects={projects} onClose={() => setEditing(null)} onSaved={() => {
      setEditing(null);
      window.dispatchEvent(new Event('roles-updated'));
      void onRefresh?.();
    }} />}{error && <p role="alert">{error}</p>}</section>;
}
