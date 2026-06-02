# Oasiz Developer Site

Static developer documentation for the Oasiz CLI, JavaScript SDK, and Unity WebGL SDK.

The site is built from `oasiz-tooling` and served at `/developers/*` on the main Oasiz domains by a Cloudflare Worker. The Worker owns only that route prefix, so changes here can deploy without rebuilding the Railway-backed Oasiz app.

## Local Development

```bash
npm run developers:dev
```

The local Vite server runs at `http://localhost:5174/developers/`.

## Build

```bash
npm run developers:build
```

## Edge Preview

```bash
npm run developers:edge:dev
```

This builds the static site and serves it through Wrangler locally.

## Deploy

```bash
npm run developers:edge:deploy
```

The Worker routes configured in `wrangler.jsonc` are:

- `oasiz.gg/developers*`
- `www.oasiz.gg/developers*`
- `oasiz.ai/developers*`
- `www.oasiz.ai/developers*`

Cloudflare account access for the `oasiz.gg` and `oasiz.ai` zones is required.
