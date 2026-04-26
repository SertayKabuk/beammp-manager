"use client"

import { useEffect, useRef, useState } from "react"
import { RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; logs: string }
  | { status: "error"; message: string }

export function ServerLogs({ canControl }: { canControl: boolean }) {
  const [state, setState] = useState<State>({ status: "idle" })
  const preRef = useRef<HTMLPreElement>(null)

  const fetchLogs = async () => {
    setState({ status: "loading" })
    try {
      const res = await fetch("/api/logs")
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setState({ status: "error", message: data.error ?? "Failed to fetch logs." })
        return
      }
      const text = await res.text()
      setState({ status: "success", logs: text })
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to fetch logs.",
      })
    }
  }

  useEffect(() => {
    if (canControl) fetchLogs()
  }, [canControl])

  useEffect(() => {
    if (state.status === "success" && preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight
    }
  }, [state])

  const bodyText =
    state.status === "idle"
      ? "Docker control is disabled — logs unavailable."
      : state.status === "loading"
        ? "Loading logs…"
        : state.status === "error"
          ? `Error: ${state.message}`
          : state.logs

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Last 200 lines</p>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchLogs}
          disabled={!canControl || state.status === "loading"}
        >
          <RotateCcw className="size-3.5" />
          {state.status === "loading" ? "Loading…" : "Refresh"}
        </Button>
      </div>

      <pre
        ref={preRef}
        className="h-96 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-xs whitespace-pre-wrap break-all"
      >
        {bodyText}
      </pre>
    </div>
  )
}
