"use client"

import { useActionState } from "react"
import { FolderUp, Trash2, Upload } from "lucide-react"

import {
  deleteBeammpModAction,
  type ModActionState,
  uploadBeammpModsAction,
} from "@/app/actions"
import type { ModsDirectoryState } from "@/lib/beammp"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const initialState: ModActionState = {
  status: "idle",
}

type ModDirectoryManagerProps = {
  directory: ModsDirectoryState
}

export function ModDirectoryManager({
  directory,
}: ModDirectoryManagerProps) {
  const [uploadState, uploadAction, isUploading] = useActionState(
    uploadBeammpModsAction,
    initialState
  )
  const [deleteState, deleteAction, isDeleting] = useActionState(
    deleteBeammpModAction,
    initialState
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            {directory.label}
          </p>
          <p className="text-xs text-muted-foreground">
            {directory.path ? (
              <code>{directory.path}</code>
            ) : (
              "Path not configured"
            )}
          </p>
        </div>

        <div className="text-xs text-muted-foreground">
          {directory.canManage ? "Writable" : "Read-only"}
        </div>
      </div>

      {directory.error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {directory.error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <form action={uploadAction} className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
          <input type="hidden" name="kind" value={directory.kind} />

          <div className="space-y-1">
            <p className="text-sm font-medium">Upload files</p>
            <p className="text-xs text-muted-foreground">
              Upload zip mods or loose files directly into this folder.
            </p>
          </div>

          <Input
            type="file"
            name="mods"
            multiple
            required
            disabled={!directory.canManage || isUploading}
          />

          <Button type="submit" disabled={!directory.canManage || isUploading}>
            <Upload className="size-4" />
            {isUploading ? "Uploading..." : "Upload ZIP files"}
          </Button>
        </form>

        <form action={uploadAction} className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
          <input type="hidden" name="kind" value={directory.kind} />

          <div className="space-y-1">
            <p className="text-sm font-medium">Upload a mod folder</p>
            <p className="text-xs text-muted-foreground">
              Choose a folder and the manager will recreate its file structure.
            </p>
          </div>

          <Input
            type="file"
            name="mods"
            multiple
            required
            disabled={!directory.canManage || isUploading}
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          />

          <Button type="submit" variant="outline" disabled={!directory.canManage || isUploading}>
            <FolderUp className="size-4" />
            {isUploading ? "Uploading..." : "Upload folder"}
          </Button>
        </form>
      </div>

      {uploadState.status !== "idle" ? (
        <p
          className={
            uploadState.status === "success"
              ? "text-sm text-emerald-600"
              : "text-sm text-destructive"
          }
        >
          {uploadState.message}
        </p>
      ) : null}

      {directory.files.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {directory.files.map((file) => (
            <li
              key={file}
              className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <span className="truncate font-medium">{file}</span>

              <form action={deleteAction}>
                <input type="hidden" name="kind" value={directory.kind} />
                <input type="hidden" name="entryName" value={file} />
                <Button
                  type="submit"
                  variant="destructive"
                  size="sm"
                  disabled={!directory.canManage || isDeleting}
                >
                  <Trash2 className="size-4" />
                  {isDeleting ? "Deleting..." : "Delete"}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {directory.exists
            ? "No mods found in this mounted folder yet."
            : "Mount this folder into the container to manage mods here."}
        </div>
      )}

      {deleteState.status !== "idle" ? (
        <p
          className={
            deleteState.status === "success"
              ? "text-sm text-emerald-600"
              : "text-sm text-destructive"
          }
        >
          {deleteState.message}
        </p>
      ) : null}
    </div>
  )
}
