"use server"

import { revalidatePath } from "next/cache"

import { auth } from "@/auth"
import {
  controlBeammpServer,
  deleteBeammpMod,
  uploadBeammpMods,
  writeBeammpMap,
} from "@/lib/beammp"

export type UpdateMapState = {
  status: "idle" | "success" | "error"
  message?: string
}

export type ServerControlState = {
  status: "idle" | "success" | "error"
  message?: string
}

export type ModActionState = {
  status: "idle" | "success" | "error"
  message?: string
}

export async function updateBeammpMapAction(
  _previousState: UpdateMapState,
  formData: FormData
): Promise<UpdateMapState> {
  void _previousState

  const session = await auth()

  if (!session?.user?.email) {
    return {
      status: "error",
      message: "Your session expired. Please sign in again.",
    }
  }

  const nextMap = String(formData.get("map") ?? "").trim()

  if (!nextMap) {
    return {
      status: "error",
      message: "Please enter a BeamMP map path.",
    }
  }

  try {
    await writeBeammpMap(nextMap)
    revalidatePath("/")

    return {
      status: "success",
      message: "BEAMMP_MAP updated successfully.",
    }
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Unable to update BEAMMP_MAP.",
    }
  }
}

export async function controlBeammpServerAction(
  _previousState: ServerControlState,
  formData: FormData
): Promise<ServerControlState> {
  void _previousState

  const session = await auth()

  if (!session?.user?.email) {
    return {
      status: "error",
      message: "Your session expired. Please sign in again.",
    }
  }

  const operation = String(formData.get("operation") ?? "").trim()

  if (operation !== "restart" && operation !== "recreate") {
    return {
      status: "error",
      message: "Unknown server control action requested.",
    }
  }

  try {
    const result = await controlBeammpServer(operation)
    revalidatePath("/")

    return {
      status: "success",
      message: result,
    }
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to control the BeamMP server.",
    }
  }
}

export async function uploadBeammpModsAction(
  _previousState: ModActionState,
  formData: FormData
): Promise<ModActionState> {
  void _previousState

  const session = await auth()

  if (!session?.user?.email) {
    return {
      status: "error",
      message: "Your session expired. Please sign in again.",
    }
  }

  const kind = String(formData.get("kind") ?? "").trim()

  if (kind !== "server" && kind !== "client") {
    return {
      status: "error",
      message: "Unknown mod folder selected.",
    }
  }

  const files = formData
    .getAll("mods")
    .filter((value): value is File => value instanceof File)

  try {
    const result = await uploadBeammpMods(kind, files)
    revalidatePath("/")

    return {
      status: "success",
      message: result,
    }
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Unable to upload mods.",
    }
  }
}

export async function deleteBeammpModAction(
  _previousState: ModActionState,
  formData: FormData
): Promise<ModActionState> {
  void _previousState

  const session = await auth()

  if (!session?.user?.email) {
    return {
      status: "error",
      message: "Your session expired. Please sign in again.",
    }
  }

  const kind = String(formData.get("kind") ?? "").trim()
  const entryName = String(formData.get("entryName") ?? "").trim()

  if (kind !== "server" && kind !== "client") {
    return {
      status: "error",
      message: "Unknown mod folder selected.",
    }
  }

  if (!entryName) {
    return {
      status: "error",
      message: "Please choose a mod to delete.",
    }
  }

  try {
    const result = await deleteBeammpMod(kind, entryName)
    revalidatePath("/")

    return {
      status: "success",
      message: result,
    }
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "Unable to delete the mod.",
    }
  }
}