import { NextResponse } from "next/server";
import { deleteRoom, getRoom, updateRoom } from "@/lib/rooms/room-store.server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const room = getRoom(roomId);
  return room ? NextResponse.json({ room }) : NextResponse.json({ error: "Room not found" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const body = await request.json() as { status?: "active" | "archived" };
  if (body.status !== "active" && body.status !== "archived") {
    return NextResponse.json({ error: "Only active or archived status can be changed here" }, { status: 400 });
  }
  const room = updateRoom(roomId, { status: body.status });
  return room ? NextResponse.json({ room }) : NextResponse.json({ error: "Room not found" }, { status: 404 });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return deleteRoom(roomId)
    ? NextResponse.json({ deleted: true })
    : NextResponse.json({ error: "Room not found" }, { status: 404 });
}
