import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { DomainError } from '@/domain/errors';

export function assertServerWebSearch(model: { api: string } | undefined) {
  if (!model || !['openai-responses','google-generative-ai','google-vertex'].includes(model.api)) throw new DomainError('WEB_SEARCH_UNSUPPORTED', '当前模型协议不支持内置搜索，请使用OpenAI Responses或Google原生协议，或明确选择工具搜索', 422, true);
}

// One instance per handle; enabled only for the duration of a user prompt.
export function createServerWebSearchScope() {
  let enabled = false;
  return {
    begin(value: boolean) { enabled = value; },
    end() { enabled = false; },
    extension(pi: ExtensionAPI) {
      pi.on('before_provider_request', (event, ctx) => {
        if (!enabled) return;
        assertServerWebSearch(ctx.model);
        const payload = event.payload as Record<string, unknown> & { tools?: Array<{ type: string }>;config?:Record<string,unknown>&{tools?:Array<Record<string,unknown>>} };
        if(ctx.model?.api==='google-generative-ai'||ctx.model?.api==='google-vertex'){
          const config=payload.config??{},tools=config.tools??[];
          return {...payload,config:{...config,tools:tools.some(tool=>Object.hasOwn(tool,'googleSearch')||Object.hasOwn(tool,'google_search'))?tools:[...tools,{googleSearch:{}}]}};
        }
        const tools = payload.tools ?? [];
        return { ...payload, tools: tools.some(tool => tool.type === 'web_search') ? tools : [...tools, { type: 'web_search' }] };
      });
      pi.on('provider_stream_event', event => {
        if (!enabled) return;
        if(event.api==='google-generative-ai'||event.api==='google-vertex'){
          const chunk=event.data as {candidates?:Array<Record<string,unknown>>}|null;
          if(chunk?.candidates?.some(candidate=>candidate&&Object.hasOwn(candidate,'groundingMetadata'))){
            pi.appendEntry('server_web_search',JSON.parse(JSON.stringify({api:event.api,provider:event.provider,model:event.model,data:event.data})));
          }
          return;
        }
        if(event.api!=='openai-responses')return;
        const data = event.data as { type?: string; item?: { type?: string; content?: Array<{ annotations?: unknown[] }> } };
        if (data?.type !== 'response.output_item.done') return;
        if (data.item?.type === 'web_search_call' || (data.item?.type === 'message' && data.item.content?.some(part => part.annotations?.length))) {
          // Pi's normalizer drops these provider fields. Keep original evidence in its own tree.
          pi.appendEntry('server_web_search', JSON.parse(JSON.stringify(data)));
        }
      });
    },
  };
}
