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

Optional environment variables:

```bash
OASIZ_API_URL=http://localhost:3001
OASIZ_WEB_URL=http://localhost:5173
OASIZ_EMAIL=your-email@example.com
OASIZ_PROJECT_ROOT=/path/to/your/game-repo
```
