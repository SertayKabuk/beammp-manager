# BeamMP Manager

BeamMP mod and map admin built with Next.js, shadcn/ui, and Google login.

## Features

- Google sign-in with cookie/JWT sessions
- Allowlist-only access via `ALLOWED_EMAILS`
- No database required
- Reads mounted BeamMP server/client mod folders
- Free-text `BEAMMP_MAP` editor
- Docker-based BeamMP server restart and recreate from the dashboard
- Safe map writeback through a shared runtime env file instead of rewriting `docker-compose.yaml`

## Required environment variables

Create a local `.env` file:

- `AUTH_SECRET`
- `AUTH_URL` (your public app URL, for example `https://beamng-manager.sertay.com`)
- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `ALLOWED_EMAILS`
- `BEAMMP_MAP`
- `BEAMMP_SERVER_MODS_PATH`
- `BEAMMP_CLIENT_MODS_PATH`
- `BEAMMP_RUNTIME_ENV_FILE` (optional but required for saving map changes)
- `BEAMMP_DOCKER_COMPOSE_FILE` (required for restart control)
- `BEAMMP_DOCKER_SERVICE` (optional, defaults to `beammp-server`)

## Google OAuth setup

Create a Google OAuth app and add this callback URL:

`http://localhost:3000/api/auth/callback/google`

For production, use your public domain instead, for example:

`https://beamng-manager.sertay.com/api/auth/callback/google`

If redirects ever show a Docker/container hostname like `https://acfccdd5eadd:3000`, set `AUTH_URL` to your real public domain. Auth.js will then use that canonical URL for callback and sign-in redirects.

If you see `AccessDenied` in the manager logs during Google sign-in, this app's sign-in callback is rejecting the login. In practice that almost always means one of these is true:

- the Google email is not listed in `ALLOWED_EMAILS`
- `ALLOWED_EMAILS` is empty or missing inside the running `beammp-manager` container

Because the compose file uses container environment variables for `AUTH_*` and `ALLOWED_EMAILS`, make sure those values are really present on the host where Docker Compose runs (for example via a host `.env` file or explicit values in the compose file).

## Local development

```bash
pnpm install
pnpm dev
```

## Runtime contract

This app expects the BeamMP mod folders to be mounted into the manager container.

Recommended container paths:

- server mods: `/beammp-mounted/server`
- client mods: `/beammp-mounted/client`

The dashboard reads mod listings directly from those mounted paths.

## Map editing

The UI reads the current map from:

1. `BEAMMP_RUNTIME_ENV_FILE` if present
2. otherwise `BEAMMP_MAP`

The UI only saves map changes when `BEAMMP_RUNTIME_ENV_FILE` points to a writable mounted env file.

Example `beammp-runtime.env`:

```dotenv
BEAMMP_MAP=/levels/DownhillDestruction/info.json
```

Your external BeamMP compose can then consume that file with `env_file`.

## Docker server control

To restart or recreate the BeamMP server from the manager UI, mount both of these into the
manager container:

- the host compose file, for example `/home/ubuntu/docker-compose/beammp/docker-compose.yaml`
- the Docker socket at `/var/run/docker.sock`

Recommended runtime values inside the manager container:

- `BEAMMP_RUNTIME_ENV_FILE=/beammp-runtime.env`
- `BEAMMP_DOCKER_COMPOSE_FILE=/beammp-compose/docker-compose.yaml`
- `BEAMMP_DOCKER_SERVICE=beammp-server`

This lets the app run either `docker compose -f ... restart beammp-server` or
`docker compose -f ... up -d --force-recreate --no-deps beammp-server` without
editing the compose file directly.

## Example Docker Compose wiring

The repo includes `docker-compose.manager-example.yml` showing the recommended setup.

Your existing BeamMP compose already uses:

- `/home/ubuntu/docker-compose/beammp/client-mods:/beammp/Resources/Client`
- `/home/ubuntu/docker-compose/beammp/server-mods:/beammp/Resources/Server`

For the manager app, mirror those folders into the manager container as read-only mounts, mount `/home/ubuntu/docker-compose/beammp/beammp-runtime.env` to `/beammp-runtime.env`, mount the host compose file, and mount `/var/run/docker.sock` for restart/recreate control.

## Notes

- Uploading new mods is intentionally not included.
- Access is restricted to Google accounts listed in `ALLOWED_EMAILS`.
- If `BEAMMP_RUNTIME_ENV_FILE` is not mounted, map editing becomes read-only.
- Mounting the Docker socket gives this admin app permission to control Docker on the host, so keep the allowlist tight.
