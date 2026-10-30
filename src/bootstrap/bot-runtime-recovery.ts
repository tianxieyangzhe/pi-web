export type BotRecoveryRepository = { recover(runtimeInstanceId: string): void };
export type BotRecoveryState = { __botRuntimeRecovered?: boolean };

export function recoverBotRuntimeOnce(
  repository: BotRecoveryRepository,
  runtimeInstanceId: string,
  state: BotRecoveryState
): boolean {
  if (state.__botRuntimeRecovered) return false;
  repository.recover(runtimeInstanceId);
  state.__botRuntimeRecovered = true;
  return true;
}
