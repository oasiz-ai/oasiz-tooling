# @oasiz/cli

Node-compatible CLI for Oasiz game workflows.

## Usage

```bash
npx @oasiz/cli list
npx @oasiz/cli create my-new-game
npx @oasiz/cli upload block-blast --dry-run
npx @oasiz/cli game-server create arena --image us-central1-docker.pkg.dev/.../template:auto-20hz
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

Create with the platform default template:

```bash
oasiz game-server create arena
```

Create from a custom image:

```bash
oasiz game-server create arena \
  --image us-central1-docker.pkg.dev/refined-area-464120-s5/space-force-servers/oasiz-game-studio/colyseus-game-server-template:auto-20hz
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
- `--source-upload-id <id>` can create from a source bundle once the upload endpoint is available.
- `--api-url <url>` overrides the API base for one run.
- `--dry-run` prints the request without contacting the API.
- `--json` prints the raw response, including generated keys. Treat `admin_key` as secret material.

Environment variables:

```bash
OASIZ_API_URL=http://localhost:3001
OASIZ_GAME_SERVER_API_URL=https://api.oasiz.ai
OASIZ_WEB_URL=http://localhost:5173
OASIZ_EMAIL=your-email@example.com
OASIZ_PROJECT_ROOT=/path/to/your/game-repo
OASIZ_CREDENTIALS_PATH=/path/to/credentials.json
```
