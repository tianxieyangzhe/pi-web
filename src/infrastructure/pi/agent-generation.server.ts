import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, getAgentDir, estimateTokens } from "@earendil-works/pi-coding-agent";
import path from 'node:path';
import { createConfiguredModelRuntime } from './model-config.server';
import { DomainError, isDomainError } from '@/domain/errors';
import type { AgentGenerationContext } from '@/application/agent-service';

/** A fresh Pi session per project; dependencies also permit controlled API verification. */
export function createAgentGenerator(configure = createConfiguredModelRuntime, createSession = createAgentSession) {
  return async function generate(input:string, signal:AbortSignal, _mode:'import'|'generate'|'revise'='generate', context?:AgentGenerationContext):Promise<string> {
    try {
    const payload=JSON.parse(input) as {assistantMode:string;skill?:{id:string;content:string};projects?:Array<{id:string;name:string}>};
    const projectMode=payload.assistantMode==='generated';
    if(projectMode&&(!context?.cwd||payload.projects?.length!==1))throw new DomainError('INVALID_INPUT','项目生成需要单个项目目录',400,true);
    const cwd=context?.cwd??process.cwd();
    const {runtime,model}=await configure();
    const instructions=projectMode
      ? `你在目标项目根目录工作。${payload.skill?'严格执行下面选定技能的项目调查与编写流程。':'根据项目现有事实自主规划调查与编写步骤。'}主动使用read、grep、find、ls阅读目录、已有AGENTS.md、配置、脚本、CI、设计文档和相关实现；信息不够就继续查询，不受预采集文件数量限制。${payload.skill?`技能关联文件位于${path.resolve(process.cwd(),'skills',payload.skill.id)}，相对引用从该目录解析。`:''}先查证再生成，内容具体、可执行、符合已有项目规范；没有查证的命令不能声称已验证。你只有读取工具，不执行安装、测试或写文件，无法验证的事项放入warnings。最终文件由应用保存。Markdown可以使用清晰标题，不添加XML、frontmatter或占位内容。每次只分析输入的一个项目，不推断其他项目规则或生成工作区自身文件。修改时依据feedback和该项目原草稿；该项目不受意见影响时，返回原正文，逐字符保持不变。最终只输出JSON：{name,rules:[{id,rules}],warnings}；target=auto时输出{name,changes:{rules:[{id,rules}]},warnings}。id必须是输入的唯一项目ID，每次返回这个项目完整的AGENTS.md正文。${payload.skill?`\n\n<selected_skill>\n${payload.skill.content}\n</selected_skill>`:''}`
      : '你负责把用户要求或上传材料润色为完整、清晰、可执行的系统提示词，理解意图并整理歧义与重复，不机械照抄，不凭空增加职责、权限或项目事实。不读取项目文件。最终回答只能是一个JSON对象，不要Markdown、代码块、解释或前后文字。target=systemPrompt时返回{"name":"助手名称","text":"完整系统提示词","warnings":[]}；target=auto时返回{"changes":{"systemPrompt":"完整替换后的系统提示词"},"warnings":[]}。text和systemPrompt都是普通JSON字符串。不要添加XML、frontmatter、元信息或占位。';
    const loader=new DefaultResourceLoader({cwd,agentDir:getAgentDir(),noExtensions:true,noSkills:true,noContextFiles:true,noPromptTemplates:true,noThemes:true,systemPrompt:instructions});
    await loader.reload();
    if(estimateTokens({role:'user',content:input,timestamp:Date.now()})+estimateTokens({role:'user',content:instructions,timestamp:Date.now()})+model.maxTokens>model.contextWindow)throw new DomainError('ROLE_INPUT_TOO_LARGE','材料超过当前默认模型上下文容量',413,true);
    const {session}=await createSession({cwd,modelRuntime:runtime,model,resourceLoader:loader,sessionManager:SessionManager.inMemory(cwd),settingsManager:SettingsManager.inMemory({compaction:{enabled:true}}),tools:projectMode?['read','grep','find','ls']:[],thinkingLevel:model.reasoning?'medium':'off'});
    const unsubscribe=session.subscribe(event=>{if(event.type==='tool_execution_start')context?.onRead?.(event.toolName);});
    const abort=()=>void session.abort();
    signal.addEventListener('abort',abort,{once:true});
    try {
      if(signal.aborted)throw new DomainError('REQUEST_ABORTED','生成已取消',409,true);
      await session.prompt(input,{expandPromptTemplates:false});
      if(signal.aborted)throw new DomainError('REQUEST_ABORTED','生成已取消',409,true);
      const last=session.messages.filter(m=>m.role==='assistant').at(-1);
      if(!last||last.stopReason==='error'||last.stopReason==='aborted'){
        const reason=last?.errorMessage;
        throw new DomainError('ROLE_GENERATION_FAILED',typeof reason==='string'&&reason.trim()?reason:'模型未生成有效助手内容',503,true);
      }
      const text=last.content.filter(p=>p.type==='text').map(p=>p.text).join('');
      if(!text.trim())throw new DomainError('ROLE_GENERATION_FAILED',text?'模型原始内容：'+text:'模型返回空内容',503,true);
      return text;
    }finally{signal.removeEventListener('abort',abort);unsubscribe();session.dispose();}
    } catch(error) {
      if(isDomainError(error))throw error;
      if(signal.aborted)throw new DomainError('REQUEST_ABORTED','生成已取消',409,true);
      const reason=error instanceof Error?error.message:typeof error==='string'?error:'';
      throw new DomainError('ROLE_GENERATION_FAILED',reason.trim()?reason:'模型未生成有效助手内容',503,true);
    }
  };
}
export const generateAgentDefinition=createAgentGenerator();
