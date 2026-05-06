# @oasiz/cli

Node-compatible CLI for Oasiz game workflows.

## Usage

```bash
npx @oasiz/cli list
npx @oasiz/cli create my-new-game
npx @oasiz/cli upload block-blast --dry-run
npx @oasiz/cli game-server create arena
npx @oasiz/cli game-server create arena --source server --entrypoint rooms/index.ts --wait
```

You can also install it globally:

```bash
npm install -g @oasiz/cli
oasiz login
oasiz upload block-blast
```

## Commands

- `oasiz create [name]`
- `oasiz upload <game>`
- `oasiz game-server create <slug>`
- `oasiz game-server status <build_id>`
- `oasiz versions <game>`
- `oasiz activate <game>`
- `oasiz list`
- `oasiz games`
- `oasiz login`
- `oasiz logout`
- `oasiz whoami`

## Auth

The CLI supports:

- `oasiz login` for browser-based auth
- `OASIZ_CLI_TOKEN`
- `OASIZ_UPLOAD_TOKEN`

`oasiz upload` For normal uploads, the CLI initializes an upload with the Oasiz API, requests presigned URLs, uploads build assets directly to R2 for CDN delivery, syncs the final HTML, then uploads a thumbnail if one is present.
Useful upload flags:

- `--dry-run` reports title, slug, verticalOnly, gameId, bundle size, thumbnail state, asset count, asset bytes, and presigned CDN transport without contacting the API.
- `--skip-build` uses the existing `dist/` output.
- `--inline` keeps legacy single-HTML behavior for games that need it.
- `--withlog` injects a preboot log overlay into the uploaded HTML for Unity and non-Unity games without modifying build files on disk.
- `horizontal` or `vertical` overrides `publish.json` orientation for that upload.

Unity WebGL exports are detected under `Unity/<game>/Build/index.html`; the upload includes Build assets, preserves the OasizDefault template marker behavior, and rewrites Unity asset paths for CDN delivery when needed.

## Game Servers

`oasiz game-server create <slug>` creates a Colyseus game server through the game-server API. The command defaults to `https://api.oasiz.ai`.

Servers are standalone by default. The CLI only uses workspace-scoped routes when `--workspace` or `--workspace-id` is provided.

Create with the platform default template:

```bash
oasiz game-server create arena
```

Create from a custom image:

```bash
oasiz game-server create arena \
  --image us-central1-docker.pkg.dev/refined-area-464120-s5/space-force-servers/oasiz-game-studio/colyseus-game-server-template:auto-20hz
```

Upload and build local server source:

```bash
oasiz game-server create arena \
  --source server \
  --entrypoint rooms/index.ts \
  --build-command "npm run build" \
  --wait
```

This source-bundle flow runs:

```text
POST /game-servers/uploads
PUT {upload_url}
POST /game-servers with source_upload_id
GET /game-servers/status?build_id=... when --wait is set
```

The upload bundle is a `.tar.gz` built from the selected source directory. The CLI excludes `node_modules`, `.git`, `.env`, `.env.local`, `.oasiz`, and `.DS_Store`.

Create from an already-uploaded source bundle:

```bash
oasiz game-server create arena \
  --source-upload-id gs-src_... \
  --path server \
  --entrypoint rooms/index.ts \
  --build-command "npm run build" \
  --wait
```

Create from code in a running workspace:

```bash
oasiz game-server create arena \
  --workspace 0cfd10db \
  --path server \
  --entrypoint rooms/index.ts \
  --build-command "npm run build"
```

Useful flags:

- `--room <name>` sets `room_name` (defaults to the slug).
- `--client-update-hz <n>` defaults to `20` and is capped at `20`.
- `--server-tick-hz <n>` defaults to `0` for unlimited server-side simulation.
- `--min-replicas <n>` and `--max-replicas <n>` default to `1` and `10`.
- `--source <dir>` creates a `.tar.gz` bundle, calls `/game-servers/uploads`, PUTs the bundle, then creates with the returned `source_upload_id`.
- `--source-upload-id <id>` creates from an already-uploaded source bundle.
- `--path <path>` selects the server code root inside a workspace or source bundle. For `--source`, it defaults to the bundled directory name.
- `--entrypoint <path>` selects the runtime entrypoint. For source/workspace servers, it defaults to `rooms/index.ts`.
- `--build-command <command>` runs during source/workspace builds when provided.
- `--wait` polls `/game-servers/status?build_id=...` until the build reaches a terminal status.
- `--timeout-ms <n>` changes the `--wait` timeout. The default is 10 minutes.
- `--api-url <url>` overrides the API base for one run.
- `--dry-run` prints the request without contacting the API.
- `--json` prints the raw response, including generated keys. Treat `admin_key` as secret material.

`oasiz game-server status <build_id> --wait` can also be used to poll a build separately:

```bash
oasiz game-server status gs-build-... --wait
```

### Custom Source Contract

The runtime loads the selected `entrypoint` from the selected `path`. It accepts the supported room registration exports from the game-server API, such as:

```ts
export async function registerRooms(runtime) {
  runtime.defineRoom("arena", ArenaRoom);
}
```

```ts
export const rooms = [
  { name: "arena", room: ArenaRoom }
];
```

```ts
export default class GameRoom extends Room {}
```

If no entrypoint is found, the platform deploys a generic relay room so the URL is still reachable for smoke tests.

When source bundles include a `package.json`, the builder runs dependency install before the optional build command. Keep dependency sources reachable from the build environment; packages that require `git` during install may fail until the builder image includes git.

Environment variables:

```bash
OASIZ_API_URL=http://localhost:3001
OASIZ_GAME_SERVER_API_URL=https://api.oasiz.ai
OASIZ_WEB_URL=http://localhost:5173
OASIZ_EMAIL=your-email@example.com
OASIZ_PROJECT_ROOT=/path/to/your/game-repo
OASIZ_CREDENTIALS_PATH=/path/to/credentials.json
```
