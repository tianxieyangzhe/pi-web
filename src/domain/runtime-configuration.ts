type RuntimeConfiguration = {
  workingDirectory: string;
  allowProjectWrite: boolean;
  allowProjectRead?: boolean;
  nativeCodingTools?: boolean;
  workspace?: unknown;
  session: {
    agentSnapshot: unknown;
  };
};
export function sameRuntimeConfiguration(a: RuntimeConfiguration, b: RuntimeConfiguration) {
  return JSON.stringify(a.workspace) === JSON.stringify(b.workspace) && a.workingDirectory === b.workingDirectory && a.allowProjectWrite === b.allowProjectWrite && a.allowProjectRead === b.allowProjectRead && a.nativeCodingTools === b.nativeCodingTools && JSON.stringify(a.session.agentSnapshot) === JSON.stringify(b.session.agentSnapshot);
}
