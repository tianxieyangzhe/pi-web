import { BotParticipants } from './bot-participants';
import { BotSettings } from './bot-settings';
import { RoleSelector } from '../roles/role-selector';
import { useEffect, useState, useRef } from 'react';
import { createAdaptivePoller } from '../conversation/project-session/session-memory-polling';
import type { BotDetail } from '../../domain/bot';
import type { Project, Session, FilePreview, FileEntry } from '../../domain/models';
import { api } from '../../api/client';
import { botApi } from '../../api/bot-client';
import type { NativeContextInspection } from '../../domain/native-context';
export function BotPanel({
  detail,
  view,
  projects,
  onClose,
  onRefresh,
  onRole,
  onOpenFile
}: {
  detail: BotDetail;
  view: 'sessions' | 'files' | 'check';
  projects: Project[];
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onRole: (id: string) => void;
  onOpenFile: (p: FilePreview) => void;
}) {
  const [roleId, setRoleId] = useState('');
  const [coordinatorId, setCoordinatorId] = useState(detail.bot.coordinatorAgentId ?? '');
  const [history, setHistory] = useState<BotDetail | null>(null);
  const b = detail.bot.id,
    c = detail.conversation.id;
  const [error, setError] = useState(''),
    [usage, setUsage] = useState<NativeContextInspection | null>(null),
    [path, setPath] = useState(''),
    [files, setFiles] = useState<FileEntry[]>([]);
  const latestUsage = useRef<NativeContextInspection | null>(null);
  const coordinatorNativeState=detail.executions.some(execution=>execution.targetSessionId===null&&execution.status==='unknown')?'待核对':detail.executions.some(execution=>execution.targetSessionId===null&&execution.status==='running')?'运行中':detail.executions.some(execution=>execution.targetSessionId===null&&execution.status==='queued')?'排队中':detail.conversation.status==='archived'?'已归档':'可用';
  useEffect(() => {
    if (view !== 'check') return;
    const loop = createAdaptivePoller({
      request: () => botApi.inspect(b, c),
      receive: v => {
        latestUsage.current = v;
        setUsage(v);
      },
      error: e => setError(e instanceof Error ? e.message : '无法读取上下文'),
      delay: () => latestUsage.current?.compactionState === 'running' ? 2000 : 30000,
      visible: () => !document.hidden
    });
    void loop.refresh();
    const visible = () => document.hidden ? loop.pause() : void loop.refresh();
    document.addEventListener('visibilitychange', visible);
    return () => {
      loop.dispose();
      document.removeEventListener('visibilitychange', visible);
    };
  }, [b, c, view]);
  useEffect(() => {
    let active = true;
    if (view === 'files') void botApi.files(b, c, path).then(v => active && setFiles(v.entries)).catch(e => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [b, c, view, path, detail.busy]);
  async function act(fn: () => Promise<unknown>) {
    try {
      setError('');
      await fn();
      await onRefresh();
      if (view === 'check') setUsage(await botApi.inspect(b, c));
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    }
  }
  return <aside className="context-panel bot-panel"><header className="context-panel__header"><b>{view === 'sessions' ? '项目会话' : view === 'files' ? 'Bot 文件' : '检查'}</b><button className="context-panel__close" onClick={onClose} aria-label="关闭面板">×</button></header><div className="context-panel__body">{view === 'sessions' ? <BotParticipants detail={detail} projects={projects} onRefresh={onRefresh} onRole={onRole} /> : view === 'files' ? <div className="file-panel"><div className="file-panel__toolbar"><button className="ui-button ui-button--secondary ui-button--small" onClick={() => setPath('')}>工作目录</button><span className="file-panel__absolute-path">{detail.bot.workingDirectory}/{path}</span></div>{files.map(x => <button className="file-entry" key={x.path} onClick={() => x.type === 'directory' ? setPath(x.path) : void act(async () => onOpenFile(await botApi.read(b, c, x.path)))}>{x.type === 'directory' ? '▸' : '·'} {x.name}</button>)}</div> : <><section className="session-inspector__section"><h2>Pi 上下文</h2>{[['状态', coordinatorNativeState], ['已用 Token', usage?.usage.usedTokens?.toLocaleString() ?? '未知'], ['模型容量', usage?.usage.contextWindowTokens?.toLocaleString() ?? '未知'], ['剩余 Token', usage?.usage.remainingTokens?.toLocaleString() ?? '未知'], ['测量口径', usage?.usage.measurement === 'estimated' ? 'Pi 估算' : '暂不可用'], ['采样时间', usage?.usage.measuredAt ? new Date(usage.usage.measuredAt).toLocaleTimeString('zh-CN') : '暂无'], ['最近压缩', usage?.lastCompactedAt ? new Date(usage.lastCompactedAt).toLocaleString('zh-CN') : '尚无记录'], ['压缩策略', '仅手动']].map(([k, v]) => <div className="session-inspector__row" key={k}><span>{k}</span><b>{v}</b></div>)}{usage?.usage.usageRatio != null && <><progress max={1} value={Math.min(1, usage.usage.usageRatio)} /><p>{(usage.usage.usageRatio * 100).toFixed(1)}%</p></>}<div className="pi-context-section__actions"><button className="ui-button ui-button--secondary ui-button--small" onClick={() => void act(async () => setUsage(await botApi.inspect(b, c)))}>刷新</button><button className="ui-button ui-button--secondary ui-button--small" disabled={!usage?.canCompact} onClick={() => void act(() => botApi.compact(b, c))}>压缩上下文</button>{usage?.compactionState === 'running' && <button className="ui-button ui-button--secondary ui-button--small" onClick={() => void act(() => botApi.cancelCompact(b, c))}>取消压缩</button>}</div></section><BotSettings detail={detail} projects={projects} onRefresh={onRefresh} /></>}{Object.values(history?.nextCursors ?? detail.nextCursors).some(Boolean) && <button className="ui-button ui-button--secondary ui-button--small" onClick={() => void act(async () => {
        const next = await botApi.detail(b, c, {
          tasks: (history?.nextCursors ?? detail.nextCursors).tasks ?? undefined,
          works:(history?.nextCursors??detail.nextCursors).works??undefined,
          executions: (history?.nextCursors ?? detail.nextCursors).executions ?? undefined,
          messages: (history?.nextCursors ?? detail.nextCursors).messages ?? undefined
        });
        setHistory(current => {
          if (!current) return next;
          const merge = <T extends {
            id: string;
          },>(a: T[], v: T[]) => [...v.filter(x => !a.some(y => y.id === x.id)), ...a];
          return {
            ...next,
            tasks: merge(current.tasks, next.tasks),
            works:merge(current.works,next.works),
            executions: merge(current.executions, next.executions),
            messages: merge(current.messages, next.messages)
          };
        });
      })}>查看更早的协作记录</button>}{history && <details open><summary>更早记录</summary>{history.works.map(work=><p key={work.id}>{work.title} · {work.status}</p>)}{history.tasks.map(task => <p key={task.id}>{task.title} · {task.status}</p>)}{history.executions.map(execution => <p key={execution.id}>{execution.resultJson?.summary ?? execution.errorMessage ?? execution.status}</p>)}{history.messages.map(message => <p key={message.id}>{message.kind} · {message.deliveryStatus} · {message.content.slice(0, 160)}</p>)}</details>}{error && <p role="alert">{error}</p>}</div></aside>;
}
