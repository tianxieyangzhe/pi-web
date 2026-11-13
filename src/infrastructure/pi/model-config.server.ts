import { ModelRuntime, getAgentDir, resolveModelScopeWithDiagnostics } from '@earendil-works/pi-coding-agent';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DomainError } from '@/domain/errors';

import { applicationConfigRoot } from '../application-config-root';
export { applicationConfigRoot } from '../application-config-root';
export type ConfigurationSource = 'local' | 'global' | 'native';
function configurationError(): never {
  throw new DomainError('MODEL_CONFIGURATION_ERROR', 'Pi 模型或默认设置配置无效，请检查启动目录中的配置文件', 503, true);
}
export function selectConfiguration(name: 'models.json' | 'settings.json', root = applicationConfigRoot, agentDir = getAgentDir()) {
  for (const [directory, source] of [[root, 'local'], [agentDir, 'global']] as const) {
    const file = path.join(directory, name);
    let text: string;
    try { text = readFileSync(file, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; return configurationError(); }
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return configurationError();
      return { path: file, source, value: value as Record<string, unknown>, text };
    } catch { return configurationError(); }
  }
  return { path: null, source: 'native' as const, value: {} as Record<string, unknown>, text:null };
}
export async function loadModelConfiguration(root = applicationConfigRoot, agentDir = getAgentDir()) {
  const models = selectConfiguration('models.json', root, agentDir);
  const settings = selectConfiguration('settings.json', root, agentDir);
  for (const key of ['defaultProvider', 'defaultModel']) {
    if (settings.value[key] !== undefined && (typeof settings.value[key] !== 'string' || !String(settings.value[key]).trim())) configurationError();
  }
  const patterns=settings.value.enabledModels;
  if(patterns!==undefined&&(!Array.isArray(patterns)||patterns.some(value=>typeof value!=='string'||!value.trim())))configurationError();
  let runtime: ModelRuntime;
  try {
    runtime = await ModelRuntime.create({ modelsPath: models.path, authPath: path.join(agentDir, 'auth.json'), allowModelNetwork: false, refreshOnCreate: false });
    if (runtime.getError()) configurationError();
    const currentModels=selectConfiguration('models.json',root,agentDir),currentSettings=selectConfiguration('settings.json',root,agentDir);
    if(currentModels.path!==models.path||currentModels.text!==models.text||currentSettings.path!==settings.path||currentSettings.text!==settings.text)configurationError();
  } catch { return configurationError(); }
  const defaults = typeof settings.value.defaultProvider === 'string' && typeof settings.value.defaultModel === 'string'
    ? { provider: settings.value.defaultProvider, modelId: settings.value.defaultModel } : null;
  // Resolve Pi scope patterns against the catalog so enabled models without auth
  // remain visible as unavailable choices. Authentication is checked separately.
  const catalogRuntime = new Proxy(runtime, {
    get(target, property) {
      if (property === 'getAvailable') return async () => target.getModels();
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const permittedModels = Array.isArray(patterns) && patterns.length
    ? (await resolveModelScopeWithDiagnostics(patterns, catalogRuntime)).scopedModels.map(item => item.model)
    : runtime.getModels();
  return { runtime, defaults, models:permittedModels, configuration: { models: models.source, settings: settings.source } };
}
export async function resolveConfiguredModel(configuration: Awaited<ReturnType<typeof loadModelConfiguration>>, selected?: { provider: string; modelId: string } | null) {
  const identity = selected ?? configuration.defaults;
  if (!identity) configurationError();
  const model = configuration.runtime.getModel(identity.provider, identity.modelId);
  if (!model||(configuration.models&&!configuration.models.some(item=>item.provider===model.provider&&item.id===model.id))) throw Object.assign(new DomainError('MODEL_NOT_FOUND', '所选模型不存在或未在 enabledModels 中启用', 422, true),{noSideEffects:true});
  try {
    const auth = await configuration.runtime.getAuth(model);
    if (!auth || ('ok' in auth && !auth.ok)) throw new Error();
  } catch { throw Object.assign(new DomainError('MODEL_UNAVAILABLE', '所选模型的认证不可用', 409, true),{noSideEffects:true}); }
  return model;
}
export async function resolveSessionModel(configuration:Awaited<ReturnType<typeof loadModelConfiguration>>,selected?:{provider:string;modelId:string}|null) {
  try {
    if (selected || configuration.defaults) return await resolveConfiguredModel(configuration, selected);
  } catch (error) {
    if (!(error instanceof DomainError) || !['MODEL_NOT_FOUND','MODEL_UNAVAILABLE'].includes(error.code)) throw error;
  }
  throw Object.assign(new DomainError('MODEL_UNAVAILABLE',selected ? '会话保存的模型不可用，请检查 enabledModels 和认证配置，或在Session设置中选择可用模型' : '默认模型不可用，请检查默认模型、enabledModels 和认证配置',409,true),{noSideEffects:true});
}
export async function createConfiguredModelRuntime() {
  const configuration = await loadModelConfiguration();
  const model = await resolveConfiguredModel(configuration);
  return { ...configuration, model, knownContextWindow: model.contextWindow > 0 ? model.contextWindow : null };
}
