import type { RuntimeDefinition, RuntimeType } from "@/lib/runtimes/runtime-types";
import { runtimeAdapters, type RuntimeAdapter } from "@/lib/runtimes/runtime-adapter.server";

const definitions: RuntimeDefinition[] = [
  { type: "agent", name: "Agent", subtitle: "AI SDK Harness" },
  { type: "opencode", name: "OpenCode", subtitle: "OpenCode Harness" },
  { type: "pi", name: "Pi", subtitle: "Pi Harness" },
];

export function listRuntimes() {
  return definitions;
}

export function getRuntime(runtime: RuntimeType) {
  return definitions.find((definition) => definition.type === runtime);
}

export function getRuntimeAdapter(runtime: RuntimeType) {
  return runtimeAdapters[runtime];
}
