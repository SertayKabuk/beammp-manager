"use client"

import { useActionState } from "react"

import { updateBeammpMapAction, type UpdateMapState } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const initialState: UpdateMapState = {
  status: "idle",
}

type MapEditorProps = {
  currentMap: string
  canWrite: boolean
  runtimeEnvFile: string | null
}

export function MapEditor({
  currentMap,
  canWrite,
  runtimeEnvFile,
}: MapEditorProps) {
  const [state, formAction, isPending] = useActionState(
    updateBeammpMapAction,
    initialState
  )

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="map" className="text-sm font-medium">
          BeamMP level / map path
        </label>
        <Input
          id="map"
          name="map"
          defaultValue={currentMap}
          placeholder="/levels/DownhillDestruction/info.json"
          disabled={!canWrite || isPending}
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" disabled={!canWrite || isPending}>
          {isPending ? "Saving..." : "Save map"}
        </Button>

        <p className="text-sm text-muted-foreground">
          {canWrite
            ? `Writes to ${runtimeEnvFile ?? "the configured runtime env file"}.`
            : "Writeback is disabled until BEAMMP_RUNTIME_ENV_FILE is mounted into the container."}
        </p>
      </div>

      {state.status !== "idle" ? (
        <p
          className={
            state.status === "success"
              ? "text-sm text-emerald-600"
              : "text-sm text-destructive"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  )
}