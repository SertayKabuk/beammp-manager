"use client"

import { useState } from "react"
import { useActionState } from "react"

import { updateBeammpMapAction, type UpdateMapState } from "@/app/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const CUSTOM_VALUE = "__custom__"

const selectCn =
  "h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"

const initialState: UpdateMapState = {
  status: "idle",
}

type MapEntry = { mapName: string; zipFile: string }

type MapEditorProps = {
  currentMap: string
  canWrite: boolean
  runtimeEnvFile: string | null
  availableMaps: MapEntry[]
}

function mapToPath(mapName: string) {
  return `/levels/${mapName}/info.json`
}

function groupByZip(maps: MapEntry[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const { mapName, zipFile } of maps) {
    const existing = groups.get(zipFile)
    if (existing) existing.push(mapName)
    else groups.set(zipFile, [mapName])
  }
  return groups
}

export function MapEditor({
  currentMap,
  canWrite,
  runtimeEnvFile,
  availableMaps,
}: MapEditorProps) {
  const [state, formAction, isPending] = useActionState(
    updateBeammpMapAction,
    initialState
  )

  const knownEntry = availableMaps.find((e) => mapToPath(e.mapName) === currentMap)
  const [selected, setSelected] = useState<string>(
    knownEntry ? currentMap : CUSTOM_VALUE
  )

  const isCustom = selected === CUSTOM_VALUE
  const groups = groupByZip(availableMaps)

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="map" className="text-sm font-medium">
          BeamMP level / map path
        </label>

        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={!canWrite || isPending}
          className={selectCn}
        >
          {[...groups.entries()].map(([zipFile, mapNames]) => (
            <optgroup key={zipFile} label={zipFile}>
              {mapNames.map((mapName) => (
                <option key={mapName} value={mapToPath(mapName)}>
                  {mapName}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={CUSTOM_VALUE}>Custom path…</option>
        </select>

        {isCustom ? (
          <Input
            id="map"
            name="map"
            defaultValue={currentMap}
            placeholder="/levels/DownhillDestruction/info.json"
            disabled={!canWrite || isPending}
          />
        ) : (
          <input type="hidden" name="map" value={selected} />
        )}
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
