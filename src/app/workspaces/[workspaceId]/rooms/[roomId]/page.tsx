import { AppShell } from "@/features/app-shell/app-shell";

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; roomId: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const [{ workspaceId, roomId }, query] = await Promise.all([params, searchParams]);
  return (
    <AppShell
      initialWorkspaceId={workspaceId}
      initialRoomId={roomId}
      initialSessionId={query.session ?? null}
    />
  );
}
