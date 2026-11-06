import { lookup } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';
import { Agent, EnvHttpProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { DomainError } from '@/domain/errors';

type Address = { address: string; family: number };
export type ToolSearchDependencies = {
  fetch?: typeof fetch;
  readEnvironment?: () => NodeJS.ProcessEnv;
  lookup?: (hostname: string) => Promise<Address[]>;
};
export type ToolSearchConfiguration = { httpProxy?: string; httpsProxy?: string; noProxy?: string };

export function toolSearchConfiguration(dependencies: ToolSearchDependencies = {}): ToolSearchConfiguration {
  const env = dependencies.readEnvironment?.() ?? process.env;
  try {
    const httpProxy = env.http_proxy || env.HTTP_PROXY;
    const httpsProxy = env.https_proxy || env.HTTPS_PROXY;
    for (const value of [httpProxy, httpsProxy]) {
      if (!value) continue;
      if (!['http:', 'https:'].includes(new URL(value).protocol)) throw new Error();
    }
    return { httpProxy, httpsProxy, noProxy: env.no_proxy ?? env.NO_PROXY };
  } catch {
    throw new DomainError('TOOL_SEARCH_UNAVAILABLE', '工具搜索配置无效，请检查服务端HTTP(S)代理地址', 422, true);
  }
}

const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked.addSubnet(address, prefix, 'ipv6');
function publicAddress(address: string) {
  const family = isIP(address);
  return family !== 0 && !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}
export function publicWebUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('网页地址必须是HTTP(S) URL'); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      (isIP(host) ? !publicAddress(host) : !host.includes('.'))) throw new Error('仅支持不含凭据的公开HTTP(S)网页地址');
  url.hash = '';
  return url.href;
}

export function createLocalSearchClient(configuration: ToolSearchConfiguration, dependencies: ToolSearchDependencies = {}) {
  let proxy: EnvHttpProxyAgent | undefined;
  const dispatchers: Dispatcher[] = [];
  function proxyDispatcher() {
    if (!configuration.httpProxy && !configuration.httpsProxy) return undefined;
    if (!proxy) {
      proxy = new EnvHttpProxyAgent({ httpProxy: configuration.httpProxy ?? '', httpsProxy: configuration.httpsProxy ?? '', noProxy: configuration.noProxy ?? '' });
      dispatchers.push(proxy);
    }
    return proxy;
  }
  async function addresses(url: URL, signal: AbortSignal) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    let resolved: Address[];
    try {
      if (isIP(host)) resolved = [{ address: host, family: isIP(host) }];
      else resolved = await new Promise<Address[]>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(() => {
          signal.throwIfAborted();
          return (dependencies.lookup ?? (name => lookup(name, { all: true })))(host);
        }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      });
    }
    catch { throw new Error('网页域名解析失败'); }
    if (!resolved.length || resolved.some(item => !publicAddress(item.address))) throw new Error('网页地址解析到非公开网络，已拒绝读取');
    return resolved;
  }
  async function request(url: URL, signal: AbortSignal): Promise<Response> {
    signal.throwIfAborted();
    const resolved = await addresses(url, signal);
    signal.throwIfAborted();
    // Direct connections use the validated DNS snapshot; a configured proxy owns its DNS/route.
    let dispatcher: Dispatcher | undefined = proxyDispatcher();
    if (!dispatcher && resolved && !dependencies.fetch) {
      dispatcher = new Agent({ connect: { lookup: (_host, options, callback) => {
        const family = typeof options === 'object' ? options.family : undefined;
        const candidates = family ? resolved.filter(item => item.family === family) : resolved;
        const found = candidates[0];
        if (!found) { callback(new Error('网页地址族不可用'), '', 4); return; }
        if (typeof options === 'object' && options.all) (callback as (...args: unknown[]) => void)(null, candidates);
        else callback(null, found.address, found.family);
      } } });
      dispatchers.push(dispatcher);
    }
    const options = { method: 'GET', headers: { accept: 'text/html,application/xhtml+xml,text/plain,text/markdown,application/json', 'user-agent': 'Pi-Web/0.1 (web research)' }, redirect: 'manual' as const, signal, ...(dispatcher ? { dispatcher } : {}) };
    if (dependencies.fetch) return dependencies.fetch(url.href, options);
    return await undiciFetch(url, options) as unknown as Response;
  }
  async function read(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('联网请求返回空响应');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('联网响应超过2MiB限制，请缩小范围'); }
        chunks.push(chunk.value);
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally { reader.releaseLock(); }
  }
  async function operation<T>(signal: AbortSignal | undefined, run: (combined: AbortSignal) => Promise<T>) {
    const combined = AbortSignal.any([AbortSignal.timeout(20_000), ...(signal ? [signal] : [])]);
    try { return await run(combined); }
    catch (error) {
      if (signal?.aborted) throw new Error('工具搜索已取消');
      if (combined.aborted) throw new Error('工具搜索超时（20秒）');
      if (error instanceof SearchError) throw new Error(error.message);
      // Do not disclose proxy credentials, endpoint internals or response error pages.
      if (error instanceof Error && /^(网页|仅支持|联网|搜索服务|Bing)/.test(error.message)) throw new Error(error.message);
      throw new Error('联网请求失败，请检查部署主机网络、代理及目标站点');
    }
  }
  async function retrieve(initial: URL, combined: AbortSignal) {
    let url = initial;
    for (let redirects = 0; ; redirects++) {
      const response = await request(url, combined);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location || redirects >= 5) throw new SearchError('网页重定向无效或超过5次限制');
        url = new URL(publicWebUrl(new URL(location, url).href)); continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new SearchError(`网页读取失败（HTTP ${response.status}）`); }
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
      if (!['text/html', 'application/xhtml+xml', 'text/plain', 'text/markdown', 'application/json'].includes(contentType)) { await response.body?.cancel(); throw new SearchError('网页内容类型不支持，仅支持HTML和文本内容'); }
      const text = await read(response);
      if (!text.trim()) throw new SearchError('网页返回空正文');
      return {url: url.href, text, contentType};
    }
  }

  return {
    async search(query: string, maxResults: number, signal?: AbortSignal) {
      const url = new URL("https://www.bing.com/search");
      url.searchParams.set("q", query);
      return operation(signal, async combined => {
        const page = await retrieve(url, combined);
        if (!["text/html", "application/xhtml+xml"].includes(page.contentType)) throw new SearchError("Bing未返回HTML搜索结果");
        return parseBingResults(page.text, query, page.url, maxResults);
      });
    },
    async fetchPage(value: string, signal?: AbortSignal) {
      return operation(signal, async combined => {
        const page = await retrieve(new URL(publicWebUrl(value)), combined);
        const { text, contentType } = page;
        const url = new URL(page.url);
        if (!['text/html', 'application/xhtml+xml'].includes(contentType)) return { url: page.url, title: '', content: text, contentType };
        const { document } = parseHTML(text);
        // Readability resolves links using documentURI. The parser never executes scripts or fetches resources.
        Object.defineProperty(document, 'documentURI', { value: url.href });
        const article = new Readability(document as unknown as Document).parse();
        if (!article?.textContent?.trim()) throw new SearchError('网页未提取到正文，可能需要登录、JavaScript渲染或遇到反爬限制');
        return { url: url.href, title: article.title ?? '', content: article.textContent.trim(), contentType };
      });
    },
    async close() { await Promise.allSettled(dispatchers.map(dispatcher => dispatcher.close())); },
  };
}
class SearchError extends Error {}


export function parseBingResults(html: string, query: string, sourceUrl: string, maxResults: number) {
  const { document } = parseHTML(html);
  if (document.querySelector('#b_captcha, #captcha, form[action*="captcha"], iframe[src*="captcha"]') || /verify (?:you are|that you are) (?:a )?human|检测到异常流量/i.test(document.body?.textContent ?? '')) throw new SearchError('Bing要求验证码或限制访问，请检查部署主机网络或稍后重试');
  const results: Array<{ title: string; url: string; content: string }> = [];
  const seen = new Set<string>();
  for (const item of document.querySelectorAll('#b_results .b_algo')) {
    const link = item.querySelector('h2 a');
    if (!link?.getAttribute('href')) continue;
    let url: URL;
    try {
      url = new URL(link.getAttribute('href')!, sourceUrl);
      if (/(^|\.)bing\.com$/i.test(url.hostname) && url.pathname.startsWith('/ck/')) {
        const encoded = url.searchParams.get('u');
        if (!encoded?.startsWith('a1')) continue;
        url = new URL(Buffer.from(encoded.slice(2), 'base64url').toString('utf8'));
      }
      if (/(^|\.)bing\.com$/i.test(url.hostname) && ['/ck/', '/search'].some(path => url.pathname.startsWith(path))) continue;
      url = new URL(publicWebUrl(url.href));
    } catch { continue; }
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    results.push({ title: link.textContent?.trim() || url.href, url: url.href, content: (item.querySelector('.b_caption p') ?? item.querySelector('p'))?.textContent?.trim() ?? '' });
    if (results.length >= maxResults) break;
  }
  if (!results.length) throw new SearchError('Bing未返回可解析的搜索结果，可能无匹配结果、页面格式变化或遇到反爬限制');
  return { query, url: sourceUrl, results };
}
