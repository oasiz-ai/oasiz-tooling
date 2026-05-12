# @oasiz/cli

Node-compatible CLI for Oasiz game workflows.

## Usage

```bash
npx @oasiz/cli list
npx @oasiz/cli create my-new-game
npx @oasiz/cli upload block-blast --dry-run
npx @oasiz/cli create-server skyline-aces
npx @oasiz/cli test-case
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
- `oasiz create-server [slug]`
- `oasiz game-server status <build_id>`
- `oasiz test-case`
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

Studio workflows such as `create-server` and `test-case` use the same `/cli-auth`
browser route as normal CLI login, but require developer access. The Oasiz
backend only mints that token when the signed-in user has `user.developer = true`.
If an existing saved token is not developer-scoped, these commands will ask you
to sign in again. Unauthorized users see a friendly error with
`contact@oasiz.ai` so they can request access to the developer program.

`oasiz upload` For normal uploads, the CLI initializes an upload with the Oasiz API, requests presigned URLs, uploads build assets directly to R2 for CDN delivery, syncs the final HTML, then uploads a thumbnail if one is present.
Useful upload flags:

- `--dry-run` reports title, slug, verticalOnly, gameId, bundle size, thumbnail state, asset count, asset bytes, and presigned CDN transport without contacting the API.
- `--skip-build` uses the existing `dist/` output.
- `--inline` keeps legacy single-HTML behavior for games that need it.
- `--withlog` injects a preboot log overlay into the uploaded HTML for Unity and non-Unity games without modifying build files on disk.
- `horizontal` or `vertical` overrides `publish.json` orientation for that upload.

Unity WebGL exports are detected under `Unity/<game>/Build/index.html`; the upload includes Build assets, preserves the OasizDefault template marker behavior, and rewrites Unity asset paths for CDN delivery when needed.

## Create Server

`oasiz create-server [slug]` creates a Studio Colyseus game server. The public
CLI surface is intentionally small: Studio, CI, or the local project `.env`
should provide the environment defaults.

```bash
OASIZ_STUDIO_API_URL=https://studio-stage.oasiz.ai/api/controller
OASIZ_WORKSPACE_ID=ed8b065d
OASIZ_GAME_SERVER_PATH=server
OASIZ_GAME_SERVER_ENTRYPOINT=rooms/index.ts
OASIZ_GAME_SERVER_RESUME_WORKSPACE=true
OASIZ_GAME_SERVER_WAIT=true

oasiz create-server skyline-aces
```

Public options:

- `--dry-run` prints the request without contacting the API.
- `--json` prints the raw response, including generated keys. Treat `admin_key` as secret material.

Studio can also set `OASIZ_GAME_SERVER_SLUG` so the command becomes simply `oasiz create-server`.

`oasiz game-server status <build_id> --wait` can also be used to poll a build separately:

```bash
oasiz game-server status gs-build-... --wait
```

Create-server commands are Studio developer workflows. Authenticate with
`oasiz login --studio` or set `OASIZ_CLI_TOKEN` to a Studio developer token;
plain upload tokens are intentionally not used for these requests.

## Studio Mobile Test Cases

`oasiz test-case` imports or updates a Studio mobile test case. Like
`create-server`, the public command expects Studio/CI/project env to provide
the details.

```bash
OASIZ_STUDIO_API_URL=https://studio-stage.oasiz.ai/api/controller
OASIZ_WORKSPACE_ID=ed8b065d
OASIZ_TEST_CASE_NAME="Skyline smoke"
OASIZ_TEST_OBJECTIVE="Verify multiplayer join works."
OASIZ_TEST_REPLAY_PATH=recording.json
OASIZ_TEST_PATHS=appium.json
OASIZ_TEST_LAUNCH_MANIFEST=launch-manifest.json
OASIZ_TEST_APP_URI=bs://app-build
APP_PERCY_DEFAULT_DEVICES="iPhone 14 Pro-16,iPhone 12-15"

oasiz test-case
```

Public options:

- `--dry-run` prints the upload/import requests without contacting the controller.
- `--json` prints the raw controller response.

`oasiz test-case run` performs the Studio worker flow: update or create the
case from the same env defaults, start a provider run, poll until the run is
terminal, then print JSON to stdout or write it to `OASIZ_TEST_OUTPUT_PATH`.
`OASIZ_WORKSPACE_ID` is optional when `OASIZ_TEST_CASE_ID` points at an existing
case. `OASIZ_TEST_OBJECTIVE` is required so an autonomous fixing loop has an
explicit target before it starts. Set `OASIZ_TEST_ARTIFACTS_DIR` to download the
run artifacts as part of the same command.

```bash
OASIZ_CLI_TOKEN="$(node -e 'const fs=require("fs"); const p=process.env.HOME+"/.oasiz/credentials.json"; const j=JSON.parse(fs.readFileSync(p,"utf8")); process.stdout.write(j.token||"");')" \
OASIZ_STUDIO_API_URL=https://studio-stage.oasiz.ai/api/controller \
OASIZ_TEST_CASE_ID=tc-891de5f0 \
OASIZ_TEST_PATHS=/path/to/appium.json \
OASIZ_TEST_APP_URI=bs://uploaded-app \
APP_PERCY_DEFAULT_DEVICES="iPhone 12-17" \
OASIZ_TEST_OUTPUT_PATH=run-result.json \
OASIZ_TEST_ARTIFACTS_DIR=artifacts/tr-latest \
oasiz test-case run --json
```

For multiple generated tests, set `OASIZ_TEST_PATHS` to a comma-separated list
or repeat `--test`. The CLI auto-detects `launch-manifest.json`, `launch.json`,
or `manifest.json` next to each test file. If no manifest file exists,
`OASIZ_TEST_GAME_ID` generates a minimal launch manifest for the game target.
When a manifest includes fields such as `graphics`, `scenario`,
`expected_failure`, `contentUrl`, or `level`, the CLI folds them into the
manifest deep link before sending it to Studio. That keeps Marble Madness-style
launch targeting in one file, for example:

```json
{
  "game_id": "0e174e27-b684-49be-8d48-cbe96bdd9f1e",
  "game_name": "Marble Madness",
  "graphics": "minimal",
  "scenario": "iphone12-minimal-first-level",
  "expected_failure": "blank_screen_or_login_stuck"
}
```

`oasiz test-case artifacts` fetches a completed Studio test run and lists or
downloads its artifacts. Use it after `test-case run` returns a `run_id`.
BrowserStack artifact downloads use `BROWSERSTACK_USERNAME` and
`BROWSERSTACK_ACCESS_KEY` when the provider URL requires basic auth.

```bash
OASIZ_STUDIO_API_URL=https://studio-stage.oasiz.ai/api/controller \
OASIZ_TEST_RUN_ID=tr-891de5f0 \
OASIZ_TEST_ARTIFACTS_DIR=artifacts/tr-891de5f0 \
oasiz test-case artifacts
```

Authenticate with `oasiz login --studio` or set `OASIZ_CLI_TOKEN` to a Studio
developer token; upload tokens are not used for Studio test workflows.

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
OASIZ_STUDIO_API_URL=https://studio-stage.oasiz.ai/api/controller
OASIZ_WORKSPACE_ID=ed8b065d
OASIZ_WEB_URL=http://localhost:5173
OASIZ_EMAIL=your-email@example.com
OASIZ_PROJECT_ROOT=/path/to/your/game-repo
OASIZ_CREDENTIALS_PATH=/path/to/credentials.json
OASIZ_GAME_SERVER_PATH=server
OASIZ_GAME_SERVER_ENTRYPOINT=rooms/index.ts
OASIZ_GAME_SERVER_RESUME_WORKSPACE=true
OASIZ_GAME_SERVER_WAIT=true
OASIZ_TEST_CASE_NAME=Recorded smoke
OASIZ_TEST_OBJECTIVE="Verify the first level loads"
OASIZ_TEST_REPLAY_PATH=recording.json
OASIZ_TEST_PATHS=appium.json
OASIZ_TEST_OUTPUT_PATH=run-result.json
```
