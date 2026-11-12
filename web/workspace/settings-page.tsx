import {Button} from '../components/button';
import type {ReactNode} from 'react';
import {LoaderCircle,X} from 'lucide-react';
// FORM-001: keep field typography and interaction states consistent across settings pages.
const settingsControl='block w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs! leading-5! font-normal text-slate-700 outline-none transition-colors focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400';
export const settingsInput=`${settingsControl} h-10`;
export const settingsTextarea=`${settingsControl} min-h-24 resize-y`;
export const settingsSelect=`${settingsControl} h-10 appearance-none pr-9`;
export const settingsLabel='block text-xs leading-5 font-normal text-slate-700';
export const settingsInlineLabel='w-16 shrink-0 text-xs leading-5 font-normal text-slate-700';
export const settingsSelectIcon='pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-slate-400';
export function SettingsPage({kind,title,busy,onClose,children,wide=false,fullWidth=false}:{kind:string;title:string;busy:boolean;onClose:()=>void;children:ReactNode;wide?:boolean;fullWidth?:boolean}) {
 return <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-white p-5 sm:p-8" aria-label={title}><div className={`w-full min-w-0 ${fullWidth?'max-w-none':wide?'max-w-6xl':'max-w-4xl'}`}><header className="mb-6 flex items-start justify-between"><div><p className="text-xs text-slate-500">{kind}</p><h1 className="mt-1 text-xl font-semibold text-slate-800">{title}</h1></div><Button variant="ghost" size="icon" type="button" aria-label={`关闭${title}`} disabled={busy}  onClick={onClose}><X size={18}/></Button></header>{children}</div></main>;
}
export function SettingsActions({busy,disabled,label,onClose,children}:{busy:boolean;disabled:boolean;label:string;onClose:()=>void;children?:ReactNode}) {
 return <footer className="mt-5 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">{children}<Button type="button" disabled={busy}  onClick={onClose}>取消</Button><Button variant="primary" type="submit" disabled={busy||disabled} >{busy&&<LoaderCircle size={14} className="animate-spin"/>}{busy?'保存中…':label}</Button></footer>;
}
