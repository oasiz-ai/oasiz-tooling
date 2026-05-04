# @oasiz/cli

Node-compatible CLI for Oasiz game workflows.

## Usage

```bash
npx @oasiz/cli list
npx @oasiz/cli create my-new-game
npx @oasiz/cli upload block-blast --dry-run
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

Environment variables:

```bash
OASIZ_API_URL=http://localhost:3001
OASIZ_WEB_URL=http://localhost:5173
OASIZ_EMAIL=your-email@example.com
OASIZ_PROJECT_ROOT=/path/to/your/game-repo
OASIZ_CREDENTIALS_PATH=/path/to/credentials.json
```
