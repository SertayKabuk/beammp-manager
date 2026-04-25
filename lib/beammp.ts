import "server-only"

import { execFile } from "node:child_process"
import { constants } from "node:fs"
import { access, readFile, readdir, writeFile } from "node:fs/promises"
import { promisify } from "node:util"

export type ModsDirectoryState = {
  label: string
  path: string | null
  exists: boolean
  files: string[]
  error: string | null
}

export type BeammpState = {
  currentMap: string
  source: "runtime-env-file" | "process-env" | "missing"
  canWrite: boolean
  runtimeEnvFile: string | null
  runtimeEnvError: string | null
  dockerControl: DockerControlState
  serverMods: ModsDirectoryState
  clientMods: ModsDirectoryState
}

export type DockerControlState = {
  canControl: boolean
  composeFile: string | null
  serviceName: string
  socketPath: string
  error: string | null
}

const fileSorter = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
})
const execFileAsync = promisify(execFile)
const dockerSocketPath = "/var/run/docker.sock"

function getEnv(name: string) {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function extractEnvValue(contents: string, key: string) {
  const match = contents.match(new RegExp(`^${key}=(.*)$`, "m"))
  return match?.[1]?.trim() ?? null
}

async function inspectModsDirectory(
  label: string,
  dirPath: string | null
): Promise<ModsDirectoryState> {
  if (!dirPath) {
    return {
      label,
      path: null,
      exists: false,
      files: [],
      error: "Path is not configured.",
    }
  }

  try {
    await access(dirPath, constants.R_OK)

    const dirents = await readdir(dirPath, {
      withFileTypes: true,
    })

    const files = dirents
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort((a, b) => fileSorter.compare(a, b))

    return {
      label,
      path: dirPath,
      exists: true,
      files,
      error: null,
    }
  } catch (error) {
    return {
      label,
      path: dirPath,
      exists: false,
      files: [],
      error:
        error instanceof Error
          ? error.message
          : "Unable to read the mounted folder.",
    }
  }
}

async function inspectDockerControl(): Promise<DockerControlState> {
  const composeFile = getEnv("BEAMMP_DOCKER_COMPOSE_FILE")
  const serviceName = getEnv("BEAMMP_DOCKER_SERVICE") ?? "beammp-server"

  if (!composeFile) {
    return {
      canControl: false,
      composeFile: null,
      serviceName,
      socketPath: dockerSocketPath,
      error: "BEAMMP_DOCKER_COMPOSE_FILE is not configured.",
    }
  }

  try {
    await access(composeFile, constants.R_OK)
    await access(dockerSocketPath, constants.R_OK | constants.W_OK)

    return {
      canControl: true,
      composeFile,
      serviceName,
      socketPath: dockerSocketPath,
      error: null,
    }
  } catch (error) {
    return {
      canControl: false,
      composeFile,
      serviceName,
      socketPath: dockerSocketPath,
      error:
        error instanceof Error
          ? error.message
          : "Docker control is not available.",
    }
  }
}

export async function readBeammpState(): Promise<BeammpState> {
  const runtimeEnvFile = getEnv("BEAMMP_RUNTIME_ENV_FILE")
  const serverModsPath = getEnv("BEAMMP_SERVER_MODS_PATH")
  const clientModsPath = getEnv("BEAMMP_CLIENT_MODS_PATH")
  const processEnvMap = getEnv("BEAMMP_MAP")

  let currentMap = processEnvMap ?? ""
  let source: BeammpState["source"] = currentMap ? "process-env" : "missing"
  let canWrite = false
  let runtimeEnvError: string | null = null

  if (runtimeEnvFile) {
    try {
      const runtimeContents = await readFile(runtimeEnvFile, "utf8")
      const runtimeMap = extractEnvValue(runtimeContents, "BEAMMP_MAP")

      if (runtimeMap) {
        currentMap = runtimeMap
        source = "runtime-env-file"
      }

      canWrite = true
    } catch (error) {
      runtimeEnvError =
        error instanceof Error
          ? error.message
          : "Unable to read the runtime env file."
    }
  }

  const [dockerControl, serverMods, clientMods] = await Promise.all([
    inspectDockerControl(),
    inspectModsDirectory("Server mods", serverModsPath),
    inspectModsDirectory("Client mods", clientModsPath),
  ])

  return {
    currentMap,
    source,
    canWrite,
    runtimeEnvFile,
    runtimeEnvError,
    dockerControl,
    serverMods,
    clientMods,
  }
}

export async function writeBeammpMap(nextMap: string) {
  const runtimeEnvFile = getEnv("BEAMMP_RUNTIME_ENV_FILE")

  if (!runtimeEnvFile) {
    throw new Error(
      "BEAMMP_RUNTIME_ENV_FILE is not configured, so map updates are disabled."
    )
  }

  const normalizedMap = nextMap.trim()

  if (!normalizedMap) {
    throw new Error("Map value is required.")
  }

  if (/[\r\n]/.test(normalizedMap)) {
    throw new Error("Map value must be a single line.")
  }

  let contents = ""

  try {
    contents = await readFile(runtimeEnvFile, "utf8")
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException

    if (nodeError.code !== "ENOENT") {
      throw new Error(
        nodeError.message || "Unable to read the runtime env file."
      )
    }
  }

  const nextLine = `BEAMMP_MAP=${normalizedMap}`
  const hasExistingLine = /^BEAMMP_MAP=.*$/m.test(contents)

  const nextContents = hasExistingLine
    ? contents.replace(/^BEAMMP_MAP=.*$/m, nextLine)
    : `${contents.trimEnd()}${contents.trim() ? "\n" : ""}${nextLine}\n`

  await writeFile(runtimeEnvFile, nextContents, "utf8")
}

export async function controlBeammpServer(
  operation: "restart" | "recreate"
) {
  const composeFile = getEnv("BEAMMP_DOCKER_COMPOSE_FILE")
  const serviceName = getEnv("BEAMMP_DOCKER_SERVICE") ?? "beammp-server"

  if (!composeFile) {
    throw new Error("BEAMMP_DOCKER_COMPOSE_FILE is not configured.")
  }

  await access(composeFile, constants.R_OK)
  await access(dockerSocketPath, constants.R_OK | constants.W_OK)

  const args =
    operation === "restart"
      ? ["compose", "-f", composeFile, "restart", serviceName]
      : [
          "compose",
          "-f",
          composeFile,
          "up",
          "-d",
          "--force-recreate",
          "--no-deps",
          serviceName,
        ]

  try {
    const { stderr, stdout } = await execFileAsync("docker", args)

    const detail = `${stdout}\n${stderr}`.trim()

    return detail
      ? `${operation === "restart" ? "Restart" : "Recreate"} command completed: ${detail}`
      : `${operation === "restart" ? "Restarted" : "Recreated"} ${serviceName} successfully.`
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message)
    }

    throw new Error(
      `Unable to ${operation} the BeamMP server.`
    )
  }
}