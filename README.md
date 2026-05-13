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
npx @oasiz/cli create-server skyline-aces
npx @oasiz/cli test-case
npx @oasiz/cli test-case run
```

The CLI expects to be run from the root of a game-studio style repository that
contains game folders, optional `publish.json` metadata, and an optional `.env`
with `OASIZ_UPLOAD_TOKEN`, `OASIZ_EMAIL`, and `OASIZ_API_URL` for upload flows.
Studio workflows use simplified public commands: `oasiz create-server [slug]`
and `oasiz test-case`. Studio/CI/project env should provide defaults such as
`OASIZ_STUDIO_API_URL`, `OASIZ_WORKSPACE_ID`, `OASIZ_GAME_SERVER_PATH`,
`OASIZ_GAME_SERVER_ENTRYPOINT`, `OASIZ_TEST_CASE_NAME`,
`OASIZ_TEST_OBJECTIVE`, `OASIZ_TEST_PATHS`, `OASIZ_TEST_OUTPUT_PATH`, and
`OASIZ_TEST_ARTIFACTS_DIR`, plus replay/Appium/app provider values.

## SDK Releases

The SDK package is configured for `semantic-release` from the `main` branch.
The GitHub Actions workflows live in `.github/workflows/sdk-tests.yml` and
`.github/workflows/sdk-release.yml`.

The CLI package is configured the same way, using
`.github/workflows/cli-tests.yml` and `.github/workflows/cli-release.yml`.
# oasiz-tooling
