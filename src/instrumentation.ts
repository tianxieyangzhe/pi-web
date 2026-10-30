export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { recoverBotRuntimeAtStartup } = await import("@/infrastructure/bots/runtime-recovery.server");
  recoverBotRuntimeAtStartup();
}
