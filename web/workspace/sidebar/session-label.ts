import type {SessionPreview} from '../../../src/domain/session-preview';
export function sessionLabel(session:Partial<SessionPreview>&{purpose:string}) {
 if(session.previewUnavailable)return '历史预览不可用';
 if(session.lastUserInput==null)return '新会话';
 return session.lastUserInput.replace(/\s+/g,' ').trim()||'非文本输入';
}
export function sessionActivity(session:{lastOpenedAt?:string|null}) {
 if(!session.lastOpenedAt)return '尚无打开记录';
 const date=new Date(session.lastOpenedAt);
 if(!Number.isFinite(date.getTime()))return '打开时间不可用';
 return `打开于 ${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}
