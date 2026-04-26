"use client"

import { useActionState } from "react"

import {
  controlBeammpServerAction,
  type ServerControlState,
} from "@/app/actions"
import { Button } from "@/components/ui/button"

const initialState: ServerControlState = {
  status: "idle",
}

type RestartServerFormProps = {
  canControl: boolean
}

export function RestartServerForm({
  canControl,
}: RestartServerFormProps) {
  const [state, formAction, isPending] = useActionState(
    controlBeammpServerAction,
    initialState
  )

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          type="submit"
          name="operation"
          value="recreate"
          disabled={!canControl || isPending}
        >
          {isPending ? "Working..." : "Recreate BeamMP server"}
        </Button>
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
