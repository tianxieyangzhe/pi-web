import type {ComponentProps} from 'react';

export type ButtonVariant='secondary'|'primary'|'danger'|'ghost'|'tab';
export type ButtonSize='default'|'icon'|'row'|'session';
const base='app-button inline-flex! items-center! gap-1.5! rounded-lg! border! border-solid! font-sans! text-xs! font-normal! leading-5! no-underline! shadow-none! transition-colors! duration-150! outline-none! transform-none! cursor-pointer! disabled:cursor-not-allowed! disabled:opacity-40! focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-emerald-600! [&>svg]:size-3.5! [&>svg]:shrink-0! [&>svg]:text-inherit!';
const sizes:Record<ButtonSize,string>={
 default:'h-8! min-h-8! max-h-8! w-auto! max-w-full! shrink-0! justify-center! whitespace-nowrap! px-3! py-0!',
 icon:'size-8! min-h-8! max-h-8! shrink-0! justify-center! p-0!',
 row:'h-auto! min-h-8! max-h-none! w-full! min-w-0! shrink! justify-start! whitespace-normal! px-2! py-1! text-left!',
 session:'h-8! min-h-8! max-h-8! w-full! min-w-0! shrink! justify-start! whitespace-nowrap! px-2! py-0! text-left! [&>span>span:first-child]:text-[11px]!',
};
const variants:Record<ButtonVariant,string>={
 secondary:'border-slate-200! bg-white! text-slate-600! enabled:hover:border-slate-300! enabled:hover:bg-slate-50!',
 primary:'border-emerald-700! bg-emerald-700! text-white! enabled:hover:border-emerald-800! enabled:hover:bg-emerald-800!',
 danger:'border-red-200! bg-white! text-red-700! enabled:hover:border-red-300! enabled:hover:bg-red-50!',
 ghost:'border-transparent! bg-transparent! text-slate-600! enabled:hover:bg-slate-100!',
 tab:'rounded-none! border-0! border-b-2! border-transparent! bg-transparent! text-slate-500! enabled:hover:text-slate-700!',
};
export function buttonStyles({variant='secondary',size='default',selected=false,disabled=false}:{variant?:ButtonVariant;size?:ButtonSize;selected?:boolean;disabled?:boolean}={}){
 return `${base} ${sizes[size]} ${variant==='tab'?`${variants.tab}${selected?' border-b-emerald-600! text-emerald-700! enabled:hover:text-emerald-700!':''}`:selected?'border-emerald-200! bg-emerald-50! text-emerald-800! enabled:hover:bg-emerald-100!':variants[variant]}${disabled?' pointer-events-none! cursor-not-allowed! opacity-40!':''}`;
}
export type ButtonProps=ComponentProps<'button'>&{variant?:ButtonVariant;size?:ButtonSize;selected?:boolean};
/** BUTTON-001: one visual contract; native events, form type, refs and accessibility stay with callers. */
export function Button({variant='secondary',size='default',selected,className='',...props}:ButtonProps){
 const active=selected??(props['aria-pressed']===true||props['aria-pressed']==='true'||props['aria-selected']===true||props['aria-current']==='page'||className.split(/\s+/).includes('active'));
 return <button {...props} className={`${buttonStyles({variant,size,selected:active})} ${className}`}/>;
}
