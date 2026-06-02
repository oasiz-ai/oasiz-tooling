---
name: oasiz-cli-usage
description: "Guide Oasiz CLI usage for game creation, authentication, local target discovery, dry-run uploads, CDN uploads, versions, activation, public publishing, and Colyseus game-server commands. Use when running or explaining @oasiz/cli commands such as oasiz list, games, login, whoami, create, upload, versions, activate, or game-server create/status."
---

# Oasiz CLI Usage

Use this skill when working with the Oasiz CLI. Favor dry-runs and explicit confirmation before commands that publish, activate, or change live multiplayer server state.

## Workflow

1. Identify the target:
   - Determine the game folder, slug, build output, and whether it is a browser game or Unity WebGL export.
   - Use `oasiz list` to inspect local upload targets when the project structure is unclear.
   - Check local publishing metadata such as `publish.json` when present.

2. Check authentication:
   - Use `oasiz whoami` before uploads or platform reads.
   - Use `oasiz login` when the CLI is not authenticated.
   - Respect environment tokens such as `OASIZ_CLI_TOKEN` and `OASIZ_UPLOAD_TOKEN` when already configured.

3. Dry-run before upload:
   - Run `oasiz upload <game> --dry-run` before the first real upload or after build-path changes.
   - Use dry-run output to catch missing dist files, Unity export issues, large assets, or metadata mistakes.

4. Upload and review:
   - Run `oasiz upload <game>` only after dry-run passes or the user explicitly accepts the risk.
   - Use `oasiz versions <game>` to review uploaded versions with upload time, public state, and live status.
   - Use `oasiz upload <game> --activate` only when the user wants the uploaded version live immediately.

5. Activate carefully:
   - Use `oasiz activate <game>` to choose an existing uploaded version and publish it live.
   - Treat activation as a live publishing step because it sets the game public and updates the live version.

6. Manage game servers:
   - Use `oasiz game-server create <slug>` for Colyseus server creation.
   - Pass `--source`, `--entrypoint`, `--build-command`, or `--image` only when the server source/image is clear.
   - Use `oasiz game-server status <build_id> --wait` to poll server build completion.

## Command Map

```sh
oasiz list
oasiz games
oasiz login
oasiz whoami
oasiz logout
oasiz create neon-dash
oasiz upload neon-dash --dry-run
oasiz upload neon-dash
oasiz versions neon-dash
oasiz activate neon-dash
oasiz game-server create arena --wait
oasiz game-server status gs-build-... --wait
```

## Upload Flags

- `--dry-run` checks the bundle without contacting the upload API.
- `--skip-build` reuses an existing build output.
- `--inline` uses the legacy single-HTML upload path.
- `--withlog` injects a preboot log overlay into uploaded HTML.
- `--public` marks the game public during upload.
- `--activate` publishes the uploaded game or version live.

## Safety Rules

- Do not run upload, activate, public publishing, or game-server creation commands unless the user asked for that action.
- Prefer a dry-run first when command output can affect production content.
- Do not print or store auth tokens in notes, docs, screenshots, or Linear updates.
- Do not claim a version is live unless `oasiz versions <game>` or the command output confirms it.
- If a command fails, report the command, the meaningful error, and the next safe command to try.

## Final Response

When finishing CLI work, state:

- Which command was run or recommended.
- Whether it was a dry-run, upload, activation, version review, or game-server operation.
- The important result from the CLI output.
- Any command that still needs user confirmation before it changes live state.
