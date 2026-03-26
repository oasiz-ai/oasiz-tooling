# @oasiz/cli

Node-compatible CLI for Oasiz game workflows.

## Usage

```bash
npx @oasiz/cli upload block-blast
```

You can also install it globally:

```bash
npm install -g @oasiz/cli
oasiz upload block-blast
```

If a game does not provide a `thumbnail/` image, the CLI generates a simple
title-card thumbnail automatically from the game title.

## Environment

Set these in the repo root `.env` or in your shell:

```bash
OASIZ_UPLOAD_TOKEN=your_upload_token
OASIZ_EMAIL=your-registered-email@example.com
OASIZ_API_URL=https://api.oasiz.ai/api/upload/game
```
