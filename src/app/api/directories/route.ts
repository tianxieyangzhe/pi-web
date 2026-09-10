import { NextResponse } from "next/server";
import { listDirectories } from "@/lib/files/directory-browser.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const directoryPath = new URL(request.url).searchParams.get("path") ?? undefined;
  try {
    return NextResponse.json(listDirectories(directoryPath));
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法读取目录";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
