import { NextResponse } from "next/server";
import { listRuntimes } from "@/lib/runtimes/runtime-registry.server";

export async function GET() {
  return NextResponse.json({ runtimes: listRuntimes() });
}

