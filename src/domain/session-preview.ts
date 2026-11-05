export type SessionPreview={lastUserInput:string|null;lastActivityAt:string|null;previewUnavailable:boolean};
/** Uses native append order across all branches, never a second conversation store. */
export function sessionPreview(entries:ReadonlyArray<{type:string;timestamp?:unknown;message?:unknown}>,createdAt:string):SessionPreview {
 let lastUserInput:string|null=null,lastActivityAt=createdAt;
 for(const entry of entries){
  if(entry.type!=='message'||!entry.message||typeof entry.message!=='object')continue;
  const message=entry.message as {role?:string;content?:unknown};
  if(typeof entry.timestamp==='string'&&Number.isFinite(Date.parse(entry.timestamp)))lastActivityAt=entry.timestamp;
  if(message.role==='user')lastUserInput=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.flatMap(block=>block&&typeof block==='object'&&block.type==='text'&&typeof block.text==='string'?[block.text]:[]).join('\n'):'';
 }
 return {lastUserInput,lastActivityAt,previewUnavailable:false};
}
