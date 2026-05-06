# Oasiz Tooling

Developer tooling for the Oasiz platform.

This repo now owns:

- `@oasiz/sdk`: the browser/runtime SDK used inside games
- `@oasiz/cli`: the Node-compatible CLI for build and upload workflows

## Packages

### `@oasiz/sdk`

```bash
npm install @oasiz/sdk
```

```ts
import { oasiz } from "@oasiz/sdk";

oasiz.submitScore(1200);
```

### `@oasiz/cli`

```bash
npx @oasiz/cli upload block-blast
npx @oasiz/cli game-server create arena
npx @oasiz/cli game-server create arena --source server --entrypoint rooms/index.ts --wait
```

The CLI expects to be run from the root of a game-studio style repository that
contains game folders, optional `publish.json` metadata, and an optional `.env`
with `OASIZ_UPLOAD_TOKEN`, `OASIZ_EMAIL`, and `OASIZ_API_URL`.
Game server creation defaults to
`https://api.oasiz.ai` and can be overridden with
`OASIZ_GAME_SERVER_API_URL` or `--api-url`.
Game servers are standalone unless `--workspace`/`--workspace-id` is provided.
Local custom server code can be uploaded with `--source <dir>`, which creates a
source bundle, uploads it through `/game-servers/uploads`, creates with the
returned `source_upload_id`, and can poll the build with `--wait`.

## SDK Releases

The SDK package is configured for `semantic-release` from the `main` branch.
The GitHub Actions workflows live in `.github/workflows/sdk-tests.yml` and
`.github/workflows/sdk-release.yml`.

The CLI package is configured the same way, using
`.github/workflows/cli-tests.yml` and `.github/workflows/cli-release.yml`.
# oasiz-tooling
