type RuntimeConfiguration = {
  workingDirectory: string;
  allowProjectWrite: boolean;
  allowProjectRead?: boolean;
  independentProjectTools?: boolean;
  roleInstructions?: string;
  executionIdentity?: string;
  session: {
    agentSnapshot: unknown;
  };
  collaborationTools?: Array<{
    name: string;
    parameters: unknown;
  }>;
};
export function sameRuntimeConfiguration(a: RuntimeConfiguration, b: RuntimeConfiguration) {
  return a.workingDirectory === b.workingDirectory && a.allowProjectWrite === b.allowProjectWrite && a.allowProjectRead === b.allowProjectRead && a.independentProjectTools === b.independentProjectTools && a.roleInstructions === b.roleInstructions && a.executionIdentity === b.executionIdentity && JSON.stringify(a.session.agentSnapshot) === JSON.stringify(b.session.agentSnapshot) && JSON.stringify((a.collaborationTools ?? []).map(t => ({
    name: t.name,
    parameters: t.parameters
  }))) === JSON.stringify((b.collaborationTools ?? []).map(t => ({
    name: t.name,
    parameters: t.parameters
  })));
}
