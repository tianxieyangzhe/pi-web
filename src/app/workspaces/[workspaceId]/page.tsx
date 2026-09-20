import { AppShell } from "@/features/app-shell/app-shell";

export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <AppShell initialWorkspaceId={workspaceId} />;
}
