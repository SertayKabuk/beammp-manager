import { NextResponse } from "next/server"

import { auth } from "@/auth"
import { fetchContainerLogs } from "@/lib/beammp"

export async function GET() {
  const session = await auth()

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const logs = await fetchContainerLogs(200)
    return new NextResponse(logs || "(no output)", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch logs." },
      { status: 500 }
    )
  }
}
