import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { DomainError } from '@/domain/errors';

export function assertServerWebSearch(model: { api: string } | undefined) {
  if (model?.api !== 'openai-responses') throw new DomainError('WEB_SEARCH_UNSUPPORTED', '当前模型API不支持OpenAI服务端搜索，请关闭联网搜索或切换Responses模型', 422, true);
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
        const payload = event.payload as Record<string, unknown> & { tools?: Array<{ type: string }> };
        const tools = payload.tools ?? [];
        return { ...payload, tools: tools.some(tool => tool.type === 'web_search') ? tools : [...tools, { type: 'web_search' }] };
      });
      pi.on('provider_stream_event', event => {
        if (!enabled || event.api !== 'openai-responses') return;
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
