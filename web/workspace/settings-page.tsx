import type {ReactNode} from 'react';
import {LoaderCircle,X} from 'lucide-react';
export const settingsInput='mt-2 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-600 disabled:opacity-50';
export function SettingsPage({kind,title,busy,onClose,children}:{kind:string;title:string;busy:boolean;onClose:()=>void;children:ReactNode}) {
 return <main className="flex min-h-0 flex-1 flex-col overflow-auto bg-white p-5 sm:p-8" aria-label={title}><div className="w-full max-w-4xl"><header className="mb-6 flex items-start justify-between"><div><p className="text-xs text-slate-500">{kind}</p><h1 className="mt-1 text-xl font-semibold text-slate-800">{title}</h1></div><button type="button" aria-label={`关闭${title}`} disabled={busy} className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40" onClick={onClose}><X size={18}/></button></header>{children}</div></main>;
}
export function SettingsActions({busy,disabled,label,onClose,children}:{busy:boolean;disabled:boolean;label:string;onClose:()=>void;children?:ReactNode}) {
 return <footer className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-5">{children}<button type="button" disabled={busy} className="rounded-md px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-40" onClick={onClose}>取消</button><button type="submit" disabled={busy||disabled} className="flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-40">{busy&&<LoaderCircle size={14} className="animate-spin"/>}{busy?'保存中…':label}</button></footer>;
}
