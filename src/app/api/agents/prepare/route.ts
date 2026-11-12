import { services } from '@/bootstrap/composition-root.server';
import { createAgentPreparationApi } from '@/shared/protocol/agent-preparation-api.server';
export const runtime='nodejs';
export const POST=createAgentPreparationApi(services.agentPreparation);
