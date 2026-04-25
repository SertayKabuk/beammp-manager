import "server-only"

import { execFile } from "node:child_process"
import { constants } from "node:fs"
import {
  access,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { promisify } from "node:util"

export type ModFolderKind = "server" | "client"

export type ModsDirectoryState = {
  kind: ModFolderKind
  label: string
  path: string | null
  exists: boolean
  canManage: boolean
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
  serviceStatus: DockerServiceStatus
  error: string | null
}

export type DockerServiceStatus = {
  containerId: string | null
  containerName: string | null
  status: string | null
  health: string | null
  exitCode: number | null
  details: string | null
}

const fileSorter = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
})
const execFileAsync = promisify(execFile)
const dockerSocketPath = "/var/run/docker.sock"

const emptyDockerServiceStatus: DockerServiceStatus = {
  containerId: null,
  containerName: null,
  status: null,
  health: null,
  exitCode: null,
  details: null,
}

function getEnv(name: string) {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function extractEnvValue(contents: string, key: string) {
  const match = contents.match(new RegExp(`^${key}=(.*)$`, "m"))
  return match?.[1]?.trim() ?? null
}

function getModsDirectoryPath(kind: ModFolderKind) {
  return kind === "server"
    ? getEnv("BEAMMP_SERVER_MODS_PATH")
    : getEnv("BEAMMP_CLIENT_MODS_PATH")
}

function getModsDirectoryLabel(kind: ModFolderKind) {
  return kind === "server" ? "Server mods" : "Client mods"
}

function sanitizeModSegment(segment: string) {
  const trimmed = segment.trim()
  const safeSegment = basename(trimmed)

  if (!safeSegment || safeSegment === "." || safeSegment === "..") {
    throw new Error("Invalid mod path.")
  }

  return safeSegment
}

function getUploadedRelativePath(file: File) {
  const relativePath = (
    file as File & {
      webkitRelativePath?: string
    }
  ).webkitRelativePath

  return relativePath?.trim() ? relativePath : file.name
}

function isMeaningfulUploadedFile(file: File) {
  const relativePath = getUploadedRelativePath(file).trim()

  if (!relativePath) {
    return false
  }

  if (file.size === 0 && file.name === "blob" && relativePath === "blob") {
    return false
  }

  return true
}

function sanitizeUploadedRelativePath(rawPath: string) {
  const segments = rawPath
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(sanitizeModSegment)

  if (segments.length === 0) {
    throw new Error("Invalid mod path.")
  }

  return segments
}

async function resolveModEntry(kind: ModFolderKind, rawName: string) {
  const dirPath = getModsDirectoryPath(kind)

  if (!dirPath) {
    throw new Error(`${getModsDirectoryLabel(kind)} path is not configured.`)
  }

  await access(dirPath, constants.R_OK | constants.W_OK)

  const entryName = sanitizeModSegment(rawName.replace(/[\\/]+$/g, ""))

  return {
    dirPath,
    entryName,
    targetPath: join(dirPath, entryName),
  }
}

async function getDockerServiceStatus(
  composeFile: string,
  serviceName: string
): Promise<DockerServiceStatus> {
  const { stdout: idStdout } = await execFileAsync("docker", [
    "compose",
    "-f",
    composeFile,
    "ps",
    "-q",
    serviceName,
  ])

  const containerId = idStdout.trim()

  if (!containerId) {
    return {
      ...emptyDockerServiceStatus,
      details: "Docker Compose did not return a container id for the game server.",
    }
  }

  const { stdout: inspectStdout } = await execFileAsync("docker", [
    "inspect",
    "--format",
    "{{.Name}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.ExitCode}}",
    containerId,
  ])

  const [containerNameRaw, statusRaw, healthRaw, exitCodeRaw] = inspectStdout
    .trim()
    .split("|")

  const containerName = containerNameRaw?.replace(/^\//, "") || null
  const status = statusRaw || null
  const health = healthRaw && healthRaw !== "none" ? healthRaw : null
  const parsedExitCode = Number.parseInt(exitCodeRaw ?? "", 10)

  return {
    containerId,
    containerName,
    status,
    health,
    exitCode: Number.isNaN(parsedExitCode) ? null : parsedExitCode,
    details: null,
  }
}

async function waitForDockerService(
  composeFile: string,
  serviceName: string
): Promise<DockerServiceStatus> {
  let lastStatus: DockerServiceStatus = {
    ...emptyDockerServiceStatus,
    details: "Waiting for the game server container to report status.",
  }

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      lastStatus = await getDockerServiceStatus(composeFile, serviceName)

      if (
        lastStatus.status === "running" &&
        (!lastStatus.health || lastStatus.health === "healthy")
      ) {
        return lastStatus
      }

      if (
        lastStatus.status === "exited" ||
        lastStatus.status === "dead" ||
        lastStatus.status === "removing"
      ) {
        return lastStatus
      }
    } catch (error) {
      lastStatus = {
        ...emptyDockerServiceStatus,
        details:
          error instanceof Error
            ? error.message
            : "Unable to inspect the game server container.",
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  return lastStatus
}

async function inspectModsDirectory(
  kind: ModFolderKind,
  label: string,
  dirPath: string | null
): Promise<ModsDirectoryState> {
  if (!dirPath) {
    return {
      kind,
      label,
      path: null,
      exists: false,
      canManage: false,
      files: [],
      error: "Path is not configured.",
    }
  }

  try {
    await access(dirPath, constants.R_OK)
    let canManage = true

    try {
      await access(dirPath, constants.W_OK)
    } catch {
      canManage = false
    }

    const dirents = await readdir(dirPath, {
      withFileTypes: true,
    })

    const files = dirents
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
      .sort((a, b) => fileSorter.compare(a, b))

    return {
      kind,
      label,
      path: dirPath,
      exists: true,
      canManage,
      files,
      error: null,
    }
  } catch (error) {
    return {
      kind,
      label,
      path: dirPath,
      exists: false,
      canManage: false,
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
      serviceStatus: emptyDockerServiceStatus,
      error: "BEAMMP_DOCKER_COMPOSE_FILE is not configured.",
    }
  }

  try {
    await access(composeFile, constants.R_OK)
    await access(dockerSocketPath, constants.R_OK | constants.W_OK)
    const serviceStatus = await getDockerServiceStatus(composeFile, serviceName)

    return {
      canControl: true,
      composeFile,
      serviceName,
      socketPath: dockerSocketPath,
      serviceStatus,
      error: null,
    }
  } catch (error) {
    return {
      canControl: false,
      composeFile,
      serviceName,
      socketPath: dockerSocketPath,
      serviceStatus: emptyDockerServiceStatus,
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
    inspectModsDirectory("server", "Server mods", serverModsPath),
    inspectModsDirectory("client", "Client mods", clientModsPath),
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

export async function uploadBeammpMods(kind: ModFolderKind, files: File[]) {
  const dirPath = getModsDirectoryPath(kind)

  if (!dirPath) {
    throw new Error(`${getModsDirectoryLabel(kind)} path is not configured.`)
  }

  await access(dirPath, constants.R_OK | constants.W_OK)

  const validFiles = files.filter(isMeaningfulUploadedFile)

  if (validFiles.length === 0) {
    throw new Error("Please choose one or more mod files to upload.")
  }

  const uploadedRoots = new Set<string>()

  for (const file of validFiles) {
    const relativeSegments = sanitizeUploadedRelativePath(
      getUploadedRelativePath(file)
    )
    const rootName = relativeSegments[0]
    const relativePath = join(...relativeSegments)
    const targetPath = join(dirPath, relativePath)

    uploadedRoots.add(rootName)

    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, Buffer.from(await file.arrayBuffer()))
  }

  const uploadedSummary = Array.from(uploadedRoots).join(", ")

  return uploadedRoots.size === 1
    ? `Uploaded ${uploadedSummary} to ${getModsDirectoryLabel(kind).toLowerCase()}.`
    : `Uploaded ${uploadedRoots.size} mods to ${getModsDirectoryLabel(kind).toLowerCase()}: ${uploadedSummary}`
}

export async function deleteBeammpMod(kind: ModFolderKind, rawName: string) {
  const { entryName, targetPath } = await resolveModEntry(kind, rawName)

  try {
    await stat(targetPath)
  } catch {
    throw new Error(
      `${entryName} does not exist in ${getModsDirectoryLabel(kind).toLowerCase()}.`
    )
  }

  await rm(targetPath, { recursive: true, force: false })

  return `Deleted ${entryName} from ${getModsDirectoryLabel(kind).toLowerCase()}.`
}

export async function controlBeammpServer(
  operation: "restart" | "recreate"
) {
  const envFile = getEnv("BEAMMP_RUNTIME_ENV_FILE")
  const composeFile = getEnv("BEAMMP_DOCKER_COMPOSE_FILE")
  const serviceName = getEnv("BEAMMP_DOCKER_SERVICE") ?? "beammp-server"

  if (!composeFile) {
    throw new Error("BEAMMP_DOCKER_COMPOSE_FILE is not configured.")
  }

  await access(composeFile, constants.R_OK)
  await access(dockerSocketPath, constants.R_OK | constants.W_OK)

  if (envFile) {
    await access(envFile, constants.R_OK)
  }

  const composeArgs = ["compose"]

  if (envFile) {
    composeArgs.push("--env-file", envFile)
  }

  composeArgs.push("-f", composeFile)

  const args =
    operation === "restart"
      ? [...composeArgs, "restart", serviceName]
      : [
          ...composeArgs,
          "up",
          "-d",
          "--force-recreate",
          "--no-deps",
          serviceName,
        ]

  try {
    const { stderr, stdout } = await execFileAsync("docker", args)
    const serviceStatus = await waitForDockerService(composeFile, serviceName)

    const detail = `${stdout}\n${stderr}`.trim()

    if (
      serviceStatus.status !== "running" ||
      (serviceStatus.health && serviceStatus.health !== "healthy")
    ) {
      const statusSummary = [
        serviceStatus.containerName ?? serviceName,
        serviceStatus.status ? `status=${serviceStatus.status}` : null,
        serviceStatus.health ? `health=${serviceStatus.health}` : null,
        serviceStatus.exitCode !== null
          ? `exitCode=${serviceStatus.exitCode}`
          : null,
        serviceStatus.details,
      ]
        .filter(Boolean)
        .join(", ")

      throw new Error(
        `${operation === "restart" ? "Restart" : "Recreate"} command ran, but the game server did not become healthy. ${statusSummary}`
      )
    }

    return detail
      ? `${operation === "restart" ? "Restart" : "Recreate"} command completed and ${serviceStatus.containerName ?? serviceName} is running: ${detail}`
      : `${operation === "restart" ? "Restarted" : "Recreated"} ${serviceStatus.containerName ?? serviceName} successfully.`
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(error.message)
    }

    throw new Error(
      `Unable to ${operation} the BeamMP server.`
    )
  }
}