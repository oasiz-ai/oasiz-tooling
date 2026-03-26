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

oasiz.emitScoreConfig({
  anchors: [
    { raw: 30, normalized: 100 },
    { raw: 60, normalized: 300 },
    { raw: 120, normalized: 600 },
    { raw: 300, normalized: 950 }
  ]
});
```

### `@oasiz/cli`

```bash
npx @oasiz/cli upload block-blast
```

The CLI expects to be run from the root of a game-studio style repository that
contains game folders, optional `publish.json` metadata, and an optional `.env`
with `OASIZ_UPLOAD_TOKEN`, `OASIZ_EMAIL`, and `OASIZ_API_URL`.

## SDK Releases

The SDK package is configured for `semantic-release` from the `main` branch.
The GitHub Actions workflows live in `.github/workflows/sdk-tests.yml` and
`.github/workflows/sdk-release.yml`.

The CLI package is configured the same way, using
`.github/workflows/cli-tests.yml` and `.github/workflows/cli-release.yml`.
# oasiz-tooling
