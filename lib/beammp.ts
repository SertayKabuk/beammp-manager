import "server-only"

import { execFile } from "node:child_process"
import { constants } from "node:fs"
import {
  access,
  mkdir,
  open,
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
  availableMaps: string[]
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

async function readZipEntryPaths(filePath: string): Promise<string[]> {
  const fh = await open(filePath, "r")
  try {
    const { size } = await fh.stat()
    if (size < 22) return []

    const tailSize = Math.min(65558, size)
    const tail = Buffer.allocUnsafe(tailSize)
    await fh.read(tail, 0, tailSize, size - tailSize)

    let eocdPos = -1
    for (let i = tailSize - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocdPos = i
        break
      }
    }
    if (eocdPos === -1) return []

    const cdOffset = tail.readUInt32LE(eocdPos + 16)
    const cdSize = tail.readUInt32LE(eocdPos + 12)
    if (cdSize === 0 || cdOffset + cdSize > size) return []

    const cd = Buffer.allocUnsafe(cdSize)
    await fh.read(cd, 0, cdSize, cdOffset)

    const paths: string[] = []
    let pos = 0
    while (pos + 46 <= cdSize) {
      if (cd.readUInt32LE(pos) !== 0x02014b50) break
      const filenameLen = cd.readUInt16LE(pos + 28)
      const extraLen = cd.readUInt16LE(pos + 30)
      const commentLen = cd.readUInt16LE(pos + 32)
      if (pos + 46 + filenameLen > cdSize) break
      paths.push(cd.toString("utf8", pos + 46, pos + 46 + filenameLen))
      pos += 46 + filenameLen + extraLen + commentLen
    }
    return paths
  } finally {
    await fh.close()
  }
}

async function scanClientModsForMaps(clientModsPath: string | null): Promise<string[]> {
  if (!clientModsPath) {
    console.log("[map-scan] BEAMMP_CLIENT_MODS_PATH not set — skipping map detection")
    return []
  }
  console.log(`[map-scan] Scanning ${clientModsPath}`)
  try {
    const entries = await readdir(clientModsPath)
    const zips = entries.filter((e) => e.toLowerCase().endsWith(".zip"))
    console.log(`[map-scan] Found ${zips.length} zip(s) in client mods folder`)
    const found = new Set<string>()
    await Promise.all(
      zips.map(async (zipFile) => {
          try {
            const paths = await readZipEntryPaths(join(clientModsPath, zipFile))
            const mapsInZip = new Set<string>()
            for (const p of paths) {
              const m = p.match(/^levels\/([^/]+)\//)
              if (m) {
                found.add(m[1])
                mapsInZip.add(m[1])
              }
            }
            if (mapsInZip.size > 0) {
              console.log(`[map-scan] ${zipFile} → maps: ${[...mapsInZip].join(", ")}`)
            } else {
              console.log(`[map-scan] ${zipFile} → no levels/ hierarchy (mod, not a map)`)
            }
          } catch (err) {
            console.warn(`[map-scan] ${zipFile} → skipped (${err instanceof Error ? err.message : err})`)
          }
        })
    )
    const result = [...found].sort(fileSorter.compare)
    console.log(`[map-scan] Detected maps: ${result.length > 0 ? result.join(", ") : "(none)"}`)
    return result
  } catch (err) {
    console.error(`[map-scan] Failed to read ${clientModsPath}:`, err)
    return []
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

  const [dockerControl, serverMods, clientMods, availableMaps] = await Promise.all([
    inspectDockerControl(),
    inspectModsDirectory("server", "Server mods", serverModsPath),
    inspectModsDirectory("client", "Client mods", clientModsPath),
    scanClientModsForMaps(clientModsPath),
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
    availableMaps,
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

export async function fetchContainerLogs(lines = 200): Promise<string> {
  const composeFile = getEnv("BEAMMP_DOCKER_COMPOSE_FILE")
  const serviceName = getEnv("BEAMMP_DOCKER_SERVICE") ?? "beammp-server"

  if (!composeFile) {
    throw new Error("BEAMMP_DOCKER_COMPOSE_FILE is not configured.")
  }

  await access(dockerSocketPath, constants.R_OK | constants.W_OK)

  const { stdout, stderr } = await execFileAsync("docker", [
    "compose",
    "-f",
    composeFile,
    "logs",
    "--tail",
    String(lines),
    "--no-color",
    serviceName,
  ])

  return (stdout + stderr).trim()
}