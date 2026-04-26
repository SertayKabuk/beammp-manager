import {
  Container,
  FolderOpen,
  LogOut,
  MapPinned,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react"
import { redirect } from "next/navigation"

import { auth, signOut } from "@/auth"
import { MapEditor } from "@/components/map-editor"
import { ModDirectoryManager } from "@/components/mod-directory-manager"
import { RestartServerForm } from "@/components/restart-server-form"
import { ServerLogs } from "@/components/server-logs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { readBeammpState } from "@/lib/beammp"

function sourceLabel(source: "runtime-env-file" | "process-env" | "missing") {
  if (source === "runtime-env-file") {
    return "runtime env file"
  }

  if (source === "process-env") {
    return "process env"
  }

  return "missing"
}

export default async function Home() {
  const session = await auth()

  if (!session?.user?.email) {
    redirect("/login")
  }

  const state = await readBeammpState()

  return (
    <main className="min-h-screen bg-muted/40">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 rounded-2xl border border-border bg-background p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheck className="size-5" />
              <span className="text-sm font-medium">Protected admin area</span>
            </div>

            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                BeamMP Manager
              </h1>
              <p className="text-muted-foreground">
                Manage the current map and inspect mounted server/client mod
                folders without a database.
              </p>
            </div>
          </div>

          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <div className="rounded-xl border border-border bg-muted/50 px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Signed in as
              </p>
              <p className="text-sm font-medium">{session.user.email}</p>
            </div>

            <form
              action={async () => {
                "use server"
                await signOut({ redirectTo: "/login" })
              }}
            >
              <Button type="submit" variant="outline">
                <LogOut className="size-4" />
                Sign out
              </Button>
            </form>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <MapPinned className="size-5 text-primary" />
                    Map / level selection
                  </CardTitle>
                  <CardDescription>
                    Select from maps detected in the client mods folder, or
                    enter a custom path. Saved to <code>BEAMMP_MAP</code>.
                  </CardDescription>
                </div>

                <Badge variant="outline">{sourceLabel(state.source)}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Current map
                </p>
                <p className="mt-2 break-all font-mono text-sm">
                  {state.currentMap || "No BEAMMP_MAP value detected yet."}
                </p>
              </div>

              <MapEditor
                currentMap={state.currentMap}
                canWrite={state.canWrite}
                runtimeEnvFile={state.runtimeEnvFile}
                availableMaps={state.availableMaps}
              />

              {state.runtimeEnvError ? (
                <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">Runtime env file warning</p>
                    <p>{state.runtimeEnvError}</p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Runtime contract</CardTitle>
              <CardDescription>
                This app does not rewrite <code>docker-compose.yaml</code>.
                Instead, it reads mounted folders and can optionally write{" "}
                <code>BEAMMP_MAP</code> into a shared runtime env file.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="font-medium text-foreground">Server mods path</p>
                <p className="break-all">{state.serverMods.path ?? "Not configured"}</p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="font-medium text-foreground">Client mods path</p>
                <p className="break-all">{state.clientMods.path ?? "Not configured"}</p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="font-medium text-foreground">Runtime env file</p>
                <p className="break-all">{state.runtimeEnvFile ?? "Not configured"}</p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="font-medium text-foreground">Docker compose file</p>
                <p className="break-all">
                  {state.dockerControl.composeFile ?? "Not configured"}
                </p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.1fr_1fr]">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <RotateCcw className="size-5 text-primary" />
                    Game server control
                  </CardTitle>
                  <CardDescription>
                    Restart or recreate the BeamMP Docker service from the
                    dashboard when the Docker socket and compose file are mounted
                    into this app.
                  </CardDescription>
                </div>

                <Badge
                  variant={
                    state.dockerControl.canControl ? "secondary" : "destructive"
                  }
                >
                  {state.dockerControl.canControl ? "ready" : "disabled"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <RestartServerForm canControl={state.dockerControl.canControl} />

              {state.dockerControl.error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {state.dockerControl.error}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Container className="size-5 text-primary" />
                Docker control wiring
              </CardTitle>
              <CardDescription>
                The manager reads the host runtime env file and restarts the game
                server with Docker Compose.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="font-medium text-foreground">Compose service</p>
                <p>{state.dockerControl.serviceName}</p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="font-medium text-foreground">Container status</p>
                <p>
                  {state.dockerControl.serviceStatus.status ??
                    "Unknown / not created"}
                </p>
                {state.dockerControl.serviceStatus.health ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Health: {state.dockerControl.serviceStatus.health}
                  </p>
                ) : null}
                {state.dockerControl.serviceStatus.exitCode !== null ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Exit code: {state.dockerControl.serviceStatus.exitCode}
                  </p>
                ) : null}
                {state.dockerControl.serviceStatus.containerName ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Container: {state.dockerControl.serviceStatus.containerName}
                  </p>
                ) : null}
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="font-medium text-foreground">Docker socket</p>
                <p>{state.dockerControl.socketPath}</p>
              </div>

              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <p className="font-medium text-foreground">Runtime file mount</p>
                <p className="break-all">
                  {state.runtimeEnvFile ?? "/beammp-runtime.env"}
                </p>
              </div>

              {state.dockerControl.serviceStatus.details ? (
                <div className="rounded-lg border border-border bg-muted/30 p-3">
                  <p className="font-medium text-foreground">Status details</p>
                  <p className="break-words">
                    {state.dockerControl.serviceStatus.details}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Container className="size-5 text-primary" />
              Container logs
            </CardTitle>
            <CardDescription>
              Last 200 lines from the BeamMP server container.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ServerLogs canControl={state.dockerControl.canControl} />
          </CardContent>
        </Card>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <FolderOpen className="size-5 text-primary" />
              <h2 className="text-xl font-semibold">Mounted mod folders</h2>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Server mod management</CardTitle>
                <CardDescription>
                  Upload zip files, upload folder-based mods, or delete existing
                  server-side mods from the mounted BeamMP server folder.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ModDirectoryManager directory={state.serverMods} />
              </CardContent>
            </Card>
          </div>

          <div className="pt-9 lg:pt-0">
            <Card>
              <CardHeader>
                <CardTitle>Client mod management</CardTitle>
                <CardDescription>
                  Upload zip files, upload folder-based mods, or delete existing
                  client-side mods from the mounted BeamMP client folder.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ModDirectoryManager directory={state.clientMods} />
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  )
}
