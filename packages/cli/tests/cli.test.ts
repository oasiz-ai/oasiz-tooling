import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runCli } from "../src/index.ts";
import { getWebBaseUrl } from "../src/lib/auth.ts";
import { __uploadTestHooks, runUploadCli, runUploadCommand } from "../src/upload-cli.ts";

async function withTempProject(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "oasiz-cli-test-"));
  const previousRoot = process.env.OASIZ_PROJECT_ROOT;
  try {
    process.env.OASIZ_PROJECT_ROOT = root;
    await fn(root);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.OASIZ_PROJECT_ROOT;
    } else {
      process.env.OASIZ_PROJECT_ROOT = previousRoot;
    }
    await rm(root, { recursive: true, force: true });
  }
}

async function captureOutput(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return lines.join("\n");
}

async function writeViteFixture(root: string, name = "kite"): Promise<string> {
  const gamePath = join(root, name);
  await mkdir(join(gamePath, "dist", "assets"), { recursive: true });
  await mkdir(join(gamePath, "dist", "images"), { recursive: true });
  await mkdir(join(gamePath, "thumbnail"), { recursive: true });
  await writeFile(
    join(gamePath, "publish.json"),
    JSON.stringify(
      {
        title: "Kite Runner",
        description: "asset-heavy test",
        category: "arcade",
        gameId: "game-existing",
        runtimeManifest: {
          artifactSchemaVersion: 1,
          runtime: "web",
          engine: "phaser",
          entry: "index.html",
          orientation: "landscape",
          sdkVersion: "fixture",
          capabilities: ["score", "saveState"],
        },
        verticalOnly: false,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    join(gamePath, "dist", "index.html"),
    '<!doctype html><html><head><script type="module" src="./assets/index.js"></script></head><body><img src="./images/pic.png"></body></html>',
    "utf8",
  );
  await writeFile(
    join(gamePath, "dist", "assets", "index.js"),
    'const configUrl = "./assets/config.json"; const imageUrl = "./images/pic.png?cache=1"; console.log(configUrl, imageUrl);',
    "utf8",
  );
  await writeFile(join(gamePath, "dist", "assets", "config.json"), '{"url":"images/pic.png"}', "utf8");
  await writeFile(join(gamePath, "dist", "images", "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(join(gamePath, "thumbnail", "cover.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return gamePath;
}

async function requestBodyText(body: BodyInit | null | undefined): Promise<string> {
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return body;
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString("utf8");
  return String(body);
}

async function requestBodyBuffer(body: BodyInit | null | undefined): Promise<Buffer> {
  if (body === undefined || body === null) return Buffer.alloc(0);
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  return Buffer.from(String(body), "utf8");
}

test("runCli shows root help without throwing", async () => {
  await assert.doesNotReject(async () => {
    await runCli(["--help"]);
  });
});

test("runUploadCli shows help without throwing", async () => {
  await assert.doesNotReject(async () => {
    await runUploadCli(["--help"]);
  });
});

test("runCli supports info without throwing", async () => {
  await assert.doesNotReject(async () => {
    await runCli(["info"]);
  });
});

test("runUploadCli supports deprecated list flag without throwing", async () => {
  await assert.doesNotReject(async () => {
    await runUploadCli(["--list"]);
  });
});

test("browser login callback binds listeners on localhost", async () => {
  const authPath = fileURLToPath(new URL("../src/lib/auth.ts", import.meta.url));
  const source = await readFile(authPath, "utf8");

  assert.match(source, /server\.listen\(0,\s*"localhost"/);
  assert.match(source, /server\.listen\(callbackPort,\s*"localhost"/);
});

test("browser login callback settles and clears timeout", async () => {
  await withTempProject(async (root) => {
    const credentialsPath = join(root, "credentials.json");
    const previousCredentials = process.env.OASIZ_CREDENTIALS_PATH;
    const previousWeb = process.env.OASIZ_WEB_URL;
    const originalLog = console.log;
    const logs: string[] = [];
    let loginUrl = "";

    process.env.OASIZ_CREDENTIALS_PATH = credentialsPath;
    process.env.OASIZ_WEB_URL = "http://login.test";
    console.log = (...args: unknown[]) => {
      const line = args.map(String).join(" ");
      logs.push(line);
      if (line.includes("/cli-auth?")) {
        loginUrl = line.trim();
      }
    };

    try {
      const loginPromise = runCli(["login", "--no-open"]);
      const start = Date.now();
      while (!loginUrl && Date.now() - start < 2000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(loginUrl, "expected login URL to be printed");

      const parsed = new URL(loginUrl);
      const callbackPort = parsed.searchParams.get("port");
      const state = parsed.searchParams.get("state");
      assert.ok(callbackPort);
      assert.ok(state);

      const callbackUrl =
        "http://localhost:" +
        callbackPort +
        "/callback?token=test-token&email=test%40example.com&state=" +
        encodeURIComponent(state);
      const callbackResponse = await fetch(callbackUrl);
      assert.equal(callbackResponse.status, 200);

      await Promise.race([
        loginPromise,
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("login did not settle")), 2000);
        }),
      ]);

      assert.match(logs.join("\n"), /Login successful\./);
      const saved = JSON.parse(await readFile(credentialsPath, "utf8")) as { token?: string; email?: string };
      assert.equal(saved.token, "test-token");
      assert.equal(saved.email, "test@example.com");
    } finally {
      console.log = originalLog;
      if (previousCredentials === undefined) delete process.env.OASIZ_CREDENTIALS_PATH;
      else process.env.OASIZ_CREDENTIALS_PATH = previousCredentials;
      if (previousWeb === undefined) delete process.env.OASIZ_WEB_URL;
      else process.env.OASIZ_WEB_URL = previousWeb;
    }
  });
});

test("api errors include target request URL", async () => {
  const apiPath = fileURLToPath(new URL("../src/lib/api.ts", import.meta.url));
  const source = await readFile(apiPath, "utf8");

  assert.match(source, /function summarizeErrorBody\(raw: string\)/);
  assert.match(source, /const requestUrl = getApiUrl\(path\)/);
  assert.match(source, /Unable to connect to API\./);
  assert.match(source, /Target URL: " \+ requestUrl/);
  assert.match(source, /Request failed \(/);
  assert.match(source, /\) for " \+/);
  assert.match(source, /requestUrl \+/);
  assert.match(source, /Response preview: "/);
});

test("game-server create posts standalone request to api.oasiz.ai by default", async () => {
  await withTempProject(async (root) => {
    const previousGameServerApi = process.env.OASIZ_GAME_SERVER_API_URL;
    const previousToken = process.env.OASIZ_CLI_TOKEN;
    const previousUploadToken = process.env.OASIZ_UPLOAD_TOKEN;
    const previousCredentials = process.env.OASIZ_CREDENTIALS_PATH;
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; body: string; headers?: HeadersInit }> = [];

    delete process.env.OASIZ_GAME_SERVER_API_URL;
    process.env.OASIZ_CLI_TOKEN = "env-token";
    delete process.env.OASIZ_UPLOAD_TOKEN;
    process.env.OASIZ_CREDENTIALS_PATH = join(root, "missing-credentials.json");
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init.method || "GET";
      const body = await requestBodyText(init.body);
      calls.push({ url, method, body, headers: init.headers });

      return Response.json({
        scope: "standalone",
        slug: "arena",
        status: "deployed",
        url: "https://gs-standalone-arena.games.studio-stage.oasiz.ai",
        public_key: "pub_test",
        admin_key: "adm_test",
      });
    }) as typeof fetch;

    try {
      const output = await captureOutput(async () => {
        await runCli(["game-server", "create", "arena", "--image", "registry.test/template:auto", "--json"]);
      });

      assert.match(output, /"public_key": "pub_test"/);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousGameServerApi === undefined) delete process.env.OASIZ_GAME_SERVER_API_URL;
      else process.env.OASIZ_GAME_SERVER_API_URL = previousGameServerApi;
      if (previousToken === undefined) delete process.env.OASIZ_CLI_TOKEN;
      else process.env.OASIZ_CLI_TOKEN = previousToken;
      if (previousUploadToken === undefined) delete process.env.OASIZ_UPLOAD_TOKEN;
      else process.env.OASIZ_UPLOAD_TOKEN = previousUploadToken;
      if (previousCredentials === undefined) delete process.env.OASIZ_CREDENTIALS_PATH;
      else process.env.OASIZ_CREDENTIALS_PATH = previousCredentials;
    }

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.oasiz.ai/game-servers");
    assert.equal(calls[0].method, "POST");
    assert.equal((calls[0].headers as Record<string, string>).Authorization, "Bearer env-token");
    assert.deepEqual(JSON.parse(calls[0].body), {
      custom_slug: "arena",
      room_name: "arena",
      entrypoint: "server",
      client_update_hz: 20,
      server_tick_hz: 0,
      min_replicas: 1,
      max_replicas: 10,
      template_image: "registry.test/template:auto",
    });
  });
});

test("game-server create supports workspace-backed route and api-stage shorthand", async () => {
  await withTempProject(async (root) => {
    const previousGameServerApi = process.env.OASIZ_GAME_SERVER_API_URL;
    const previousToken = process.env.OASIZ_CLI_TOKEN;
    const previousUploadToken = process.env.OASIZ_UPLOAD_TOKEN;
    const previousCredentials = process.env.OASIZ_CREDENTIALS_PATH;
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; body: string }> = [];

    delete process.env.OASIZ_GAME_SERVER_API_URL;
    delete process.env.OASIZ_CLI_TOKEN;
    delete process.env.OASIZ_UPLOAD_TOKEN;
    process.env.OASIZ_CREDENTIALS_PATH = join(root, "missing-credentials.json");
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init.method || "GET";
      const body = await requestBodyText(init.body);
      calls.push({ url, method, body });

      return Response.json({
        workspace_id: "0cfd10db",
        scope: "workspace",
        build_id: "gs-build-test",
        slug: "arena",
        status: "building",
        url: "https://gs-0cfd10db-arena.games.studio-stage.oasiz.ai",
      });
    }) as typeof fetch;

    let output = "";
    try {
      output = await captureOutput(async () => {
        await runCli([
          "servers",
          "create",
          "arena",
          "--workspace",
          "0cfd10db",
          "--api-url",
          "api-stage",
          "--path",
          "server",
          "--entrypoint",
          "rooms/index.ts",
          "--build-command",
          "npm run build",
          "--min-replicas",
          "2",
          "--max-replicas",
          "4",
        ]);
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (previousGameServerApi === undefined) delete process.env.OASIZ_GAME_SERVER_API_URL;
      else process.env.OASIZ_GAME_SERVER_API_URL = previousGameServerApi;
      if (previousToken === undefined) delete process.env.OASIZ_CLI_TOKEN;
      else process.env.OASIZ_CLI_TOKEN = previousToken;
      if (previousUploadToken === undefined) delete process.env.OASIZ_UPLOAD_TOKEN;
      else process.env.OASIZ_UPLOAD_TOKEN = previousUploadToken;
      if (previousCredentials === undefined) delete process.env.OASIZ_CREDENTIALS_PATH;
      else process.env.OASIZ_CREDENTIALS_PATH = previousCredentials;
    }

    assert.match(output, /Build ID: gs-build-test/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api-stage.oasiz.ai/workspaces/0cfd10db/game-servers");
    assert.equal(calls[0].method, "POST");
    assert.deepEqual(JSON.parse(calls[0].body), {
      custom_slug: "arena",
      room_name: "arena",
      entrypoint: "rooms/index.ts",
      client_update_hz: 20,
      server_tick_hz: 0,
      min_replicas: 2,
      max_replicas: 4,
      path: "server",
      build_command: "npm run build",
    });
  });
});

test("game-server create uploads local source bundle before creating server", async () => {
  await withTempProject(async (root) => {
    const sourcePath = join(root, "server");
    await mkdir(join(sourcePath, "rooms"), { recursive: true });
    await writeFile(
      join(sourcePath, "package.json"),
      JSON.stringify({ name: "arena-server", scripts: { build: "echo build" } }, null, 2),
      "utf8",
    );
    await writeFile(join(sourcePath, "rooms", "index.ts"), "export async function registerRooms() {}\n", "utf8");
    await mkdir(join(sourcePath, "node_modules", "ignored"), { recursive: true });
    await writeFile(join(sourcePath, "node_modules", "ignored", "index.js"), "ignored\n", "utf8");

    const previousGameServerApi = process.env.OASIZ_GAME_SERVER_API_URL;
    const previousToken = process.env.OASIZ_CLI_TOKEN;
    const previousUploadToken = process.env.OASIZ_UPLOAD_TOKEN;
    const previousCredentials = process.env.OASIZ_CREDENTIALS_PATH;
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; body: Buffer; headers?: HeadersInit }> = [];

    delete process.env.OASIZ_GAME_SERVER_API_URL;
    process.env.OASIZ_CLI_TOKEN = "env-token";
    delete process.env.OASIZ_UPLOAD_TOKEN;
    process.env.OASIZ_CREDENTIALS_PATH = join(root, "missing-credentials.json");
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init.method || "GET";
      const body = await requestBodyBuffer(init.body);
      calls.push({ url, method, body, headers: init.headers });

      if (url === "https://api.oasiz.ai/game-servers/uploads") {
        return Response.json({
          source_upload_id: "gs-src_test",
          upload_url: "https://api.oasiz.ai/game-servers/uploads/token-test",
          expires_at: "2026-05-05T23:59:00Z",
        });
      }

      if (url === "https://api.oasiz.ai/game-servers/uploads/token-test") {
        return new Response("", { status: 200 });
      }

      if (url === "https://api.oasiz.ai/game-servers") {
        return Response.json({
          scope: "standalone",
          build_id: "gs-build-test",
          slug: "arena",
          status: "building",
          url: "https://gs-standalone-arena.games.studio-stage.oasiz.ai",
        });
      }

      throw new Error("Unexpected fetch: " + method + " " + url);
    }) as typeof fetch;

    try {
      const output = await captureOutput(async () => {
        await runCli([
          "game-server",
          "create",
          "arena",
          "--source",
          "server",
          "--entrypoint",
          "rooms/index.ts",
          "--build-command",
          "npm run build",
        ]);
      });

      assert.match(output, /Source upload id: gs-src_test/);
      assert.match(output, /Build ID: gs-build-test/);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousGameServerApi === undefined) delete process.env.OASIZ_GAME_SERVER_API_URL;
      else process.env.OASIZ_GAME_SERVER_API_URL = previousGameServerApi;
      if (previousToken === undefined) delete process.env.OASIZ_CLI_TOKEN;
      else process.env.OASIZ_CLI_TOKEN = previousToken;
      if (previousUploadToken === undefined) delete process.env.OASIZ_UPLOAD_TOKEN;
      else process.env.OASIZ_UPLOAD_TOKEN = previousUploadToken;
      if (previousCredentials === undefined) delete process.env.OASIZ_CREDENTIALS_PATH;
      else process.env.OASIZ_CREDENTIALS_PATH = previousCredentials;
    }

    assert.equal(calls.length, 3);
    const initCall = calls[0];
    const putCall = calls[1];
    const createCall = calls[2];
    assert.equal(initCall.url, "https://api.oasiz.ai/game-servers/uploads");
    assert.equal(initCall.method, "POST");
    assert.equal((initCall.headers as Record<string, string>).Authorization, "Bearer env-token");
    const initBody = JSON.parse(initCall.body.toString("utf8")) as {
      filename: string;
      content_type: string;
      sha256: string;
    };
    assert.equal(initBody.filename, "arena-server.tar.gz");
    assert.equal(initBody.content_type, "application/gzip");

    assert.equal(putCall.url, "https://api.oasiz.ai/game-servers/uploads/token-test");
    assert.equal(putCall.method, "PUT");
    assert.deepEqual([...putCall.body.slice(0, 2)], [0x1f, 0x8b]);
    assert.equal(initBody.sha256, createHash("sha256").update(putCall.body).digest("hex"));
    assert.equal((putCall.headers as Record<string, string>)["Content-Type"], "application/gzip");

    assert.equal(createCall.url, "https://api.oasiz.ai/game-servers");
    assert.equal(createCall.method, "POST");
    assert.deepEqual(JSON.parse(createCall.body.toString("utf8")), {
      custom_slug: "arena",
      room_name: "arena",
      entrypoint: "rooms/index.ts",
      client_update_hz: 20,
      server_tick_hz: 0,
      min_replicas: 1,
      max_replicas: 10,
      source_upload_id: "gs-src_test",
      path: "server",
      build_command: "npm run build",
    });
  });
});

test("getWebBaseUrl defaults to production oasiz.ai", () => {
  const originalWeb = process.env.OASIZ_WEB_URL;
  const originalApi = process.env.OASIZ_API_URL;

  delete process.env.OASIZ_WEB_URL;
  delete process.env.OASIZ_API_URL;

  try {
    assert.equal(getWebBaseUrl(), "https://oasiz.ai");
  } finally {
    if (originalWeb === undefined) {
      delete process.env.OASIZ_WEB_URL;
    } else {
      process.env.OASIZ_WEB_URL = originalWeb;
    }

    if (originalApi === undefined) {
      delete process.env.OASIZ_API_URL;
    } else {
      process.env.OASIZ_API_URL = originalApi;
    }
  }
});

test("upload CLI keeps login-based auth flow", async () => {
  const uploadCliPath = fileURLToPath(new URL("../src/upload-cli.ts", import.meta.url));
  const source = await readFile(uploadCliPath, "utf8");

  assert.match(source, /await resolveAuthToken\(\)/);
  assert.match(source, /await readStoredCredentials\(\)/);
  assert.match(source, /process\.env\.OASIZ_EMAIL \|\| storedCredentials\?\.email/);
  assert.match(source, /await runBrowserLoginFlow\(true\)/);
  assert.match(source, /await saveStoredCredentials\(/);
  assert.match(source, /if \(!token\)/);
  assert.match(source, /if \(!creatorEmail\)/);
});

test("upload dry-run reports presigned CDN upload shape", async () => {
  await withTempProject(async (root) => {
    await writeViteFixture(root);

    const output = await captureOutput(async () => {
      await runUploadCommand("kite", ["--dry-run", "--skip-build"]);
    });

    assert.match(output, /Type: CDN Assets \(presigned\)/);
    assert.match(output, /Assets: 3 files \(/);
    assert.match(output, /Asset Transport: CDN assets via presigned R2 upload/);
    assert.match(output, /Has Thumbnail: true/);
    assert.match(output, /Vertical Only: false/);
    assert.match(output, /Runtime Manifest: web\/phaser/);
    assert.match(output, /Game ID: game-existing/);
    assert.match(output, /Bundle Size:/);
  });
});

test("real upload uses init, presign, R2 PUTs, sync-html, and non-blocking thumbnail", async () => {
  await withTempProject(async (root) => {
    await writeViteFixture(root);
    const credentialsPath = join(root, "credentials.json");
    await writeFile(
      credentialsPath,
      JSON.stringify({
        token: "stored-token",
        email: "dev@example.com",
        createdAt: new Date(0).toISOString(),
      }),
      "utf8",
    );

    const previousApi = process.env.OASIZ_API_URL;
    const previousToken = process.env.OASIZ_CLI_TOKEN;
    const previousCredentials = process.env.OASIZ_CREDENTIALS_PATH;
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; body: string; headers?: HeadersInit }> = [];

    process.env.OASIZ_API_URL = "http://api.test";
    process.env.OASIZ_CLI_TOKEN = "env-token";
    process.env.OASIZ_CREDENTIALS_PATH = credentialsPath;
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init.method || "GET";
      const body = await requestBodyText(init.body);
      calls.push({ url, method, body, headers: init.headers });

      if (url.endsWith("/api/upload/game/init")) {
        return Response.json({ gameId: "game-123", draftId: "draft-init", isUpdate: true });
      }

      if (url.endsWith("/api/upload/game/game-123/presign")) {
        const request = JSON.parse(body) as { assets: Array<{ path: string }> };
        return Response.json({
          cdnBaseUrl: "https://cdn.test",
          urls: Object.fromEntries(request.assets.map((asset) => [asset.path, "https://r2.test/" + encodeURIComponent(asset.path)])),
        });
      }

      if (method === "PUT" && url.startsWith("https://r2.test/")) {
        return new Response("", { status: 200 });
      }

      if (url.endsWith("/api/upload/game/game-123/sync-html")) {
        return Response.json({
          gameId: "game-123",
          draftId: "draft-sync",
          r2Key: "games/game-123/index.html",
          gameUrl: "https://oasiz.ai/games/game-123",
        });
      }

      if (url.endsWith("/api/upload/game/game-123/thumbnail")) {
        return new Response("thumbnail rejected", { status: 400 });
      }

      throw new Error("Unexpected fetch: " + method + " " + url);
    }) as typeof fetch;

    try {
      await captureOutput(async () => {
        await runUploadCommand("kite", ["--skip-build"]);
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (previousApi === undefined) delete process.env.OASIZ_API_URL;
      else process.env.OASIZ_API_URL = previousApi;
      if (previousToken === undefined) delete process.env.OASIZ_CLI_TOKEN;
      else process.env.OASIZ_CLI_TOKEN = previousToken;
      if (previousCredentials === undefined) delete process.env.OASIZ_CREDENTIALS_PATH;
      else process.env.OASIZ_CREDENTIALS_PATH = previousCredentials;
    }

    assert.equal(calls.some((call) => call.url === "http://api.test/api/upload/game" && call.method === "POST"), false);
    assert.ok(calls.find((call) => call.url.endsWith("/init") && call.method === "POST"));
    assert.ok(calls.find((call) => call.url.endsWith("/presign") && call.method === "POST"));
    assert.ok(calls.find((call) => call.url.endsWith("/sync-html") && call.method === "POST"));
    assert.ok(calls.find((call) => call.url.endsWith("/thumbnail") && call.method === "POST"));

    const initCall = calls.find((call) => call.url.endsWith("/init"));
    assert.ok(initCall);
    const initBody = JSON.parse(initCall.body) as {
      runtimeManifest?: { runtime?: string; engine?: string; orientation?: string };
    };
    assert.equal(initBody.runtimeManifest?.runtime, "web");
    assert.equal(initBody.runtimeManifest?.engine, "phaser");
    assert.equal(initBody.runtimeManifest?.orientation, "landscape");

    const presignCall = calls.find((call) => call.url.endsWith("/presign"));
    assert.ok(presignCall);
    const presignBody = JSON.parse(presignCall.body) as {
      assets: Array<{
        path: string;
        contentType: string;
        role?: string;
        sha256?: string;
        sizeBytes?: number;
      }>;
    };
    assert.deepEqual(
      presignBody.assets.map((asset) => [asset.path, asset.contentType]).sort(),
      [
        ["assets/config.json", "application/json"],
        ["assets/index.js", "application/javascript"],
        ["images/pic.png", "image/png"],
      ],
    );
    assert.ok(presignBody.assets.every((asset) => asset.sha256 && asset.sizeBytes));

    const syncCall = calls.find((call) => call.url.endsWith("/sync-html"));
    assert.ok(syncCall);
    const syncBody = JSON.parse(syncCall.body) as {
      allAssetPaths: string[];
      assetFiles?: Array<{
        path: string;
        r2Key: string;
        role?: string;
        sha256?: string;
        sizeBytes?: number;
      }>;
      assets?: unknown;
      runtimeManifest?: { runtime?: string; engine?: string };
    };
    assert.equal("assets" in syncBody, false);
    assert.deepEqual(syncBody.allAssetPaths.sort(), ["assets/config.json", "assets/index.js", "images/pic.png"]);
    assert.equal(syncBody.runtimeManifest?.engine, "phaser");
    assert.deepEqual(
      syncBody.assetFiles?.map((asset) => [asset.path, asset.r2Key, asset.role]).sort(),
      [
        ["assets/config.json", "game-assets/game-123/assets/config.json", "asset"],
        ["assets/index.js", "game-assets/game-123/assets/index.js", "asset"],
        ["images/pic.png", "game-assets/game-123/images/pic.png", "asset"],
      ],
    );
    assert.ok(syncBody.assetFiles?.every((asset) => asset.sha256 && asset.sizeBytes));

    const jsonPut = calls.find((call) => call.method === "PUT" && call.url.includes(encodeURIComponent("assets/config.json")));
    assert.ok(jsonPut);
    assert.match(jsonPut.body, /https:\/\/cdn\.test\/game-assets\/game-123\/images\/pic\.png/);

    const rewrittenConfig = Buffer.from(String(jsonPut.body));
    const configAsset = syncBody.assetFiles?.find((asset) => asset.path === "assets/config.json");
    assert.equal(configAsset?.sha256, createHash("sha256").update(rewrittenConfig).digest("hex"));

    const jsPut = calls.find((call) => call.method === "PUT" && call.url.includes(encodeURIComponent("assets/index.js")));
    assert.ok(jsPut);
    assert.match(jsPut.body, /https:\/\/cdn\.test\/game-assets\/game-123\/assets\/config\.json/);
    assert.match(jsPut.body, /https:\/\/cdn\.test\/game-assets\/game-123\/images\/pic\.png/);
  });
});

test("Unity dry-run detects Build/index.html and OasizDefault marker behavior", async () => {
  await withTempProject(async (root) => {
    const gamePath = join(root, "Unity", "Orbit");
    await mkdir(join(gamePath, "Build"), { recursive: true });
    await writeFile(
      join(gamePath, "publish.json"),
      JSON.stringify(
        {
          title: "Orbit",
          description: "unity",
          category: "arcade",
          gameId: "unity-game",
        },
        null,
        2,
      ),
      "utf8",
    );
    const unityHtml = `<!doctype html><html><head><meta name="oasiz-template" content="OasizDefault-v1"></head><body>
<canvas id="unity-canvas"></canvas><div id="unity-warning"></div>
<script>
var buildUrl = "Build";
var loaderUrl = buildUrl + "/Build.loader.js";
var config = { dataUrl: buildUrl + "/Build.data", streamingAssetsUrl: buildUrl + "/StreamingAssets" };
var canvas = document.querySelector("#unity-canvas");
var warningBanner = document.querySelector("#unity-warning");
function unityShowBanner(msg, type) { console.log(msg, type); }
var script = document.createElement("script");
script.src = loaderUrl;
script.onload = function () { console.log("custom fullscreen"); };
document.body.appendChild(script);
</script></body></html>`;
    await writeFile(join(gamePath, "Build", "index.html"), unityHtml, "utf8");
    await writeFile(join(gamePath, "Build", "Build.loader.js"), "loader", "utf8");
    await writeFile(join(gamePath, "Build", "Build.data"), "data", "utf8");

    const output = await captureOutput(async () => {
      await runUploadCommand("Orbit", ["--dry-run"]);
    });

    assert.match(output, /Detected Unity game at Unity\/Orbit/);
    assert.match(output, /Detected OasizDefault template marker/);
    assert.match(output, /Preserving custom template loader\/fullscreen logic/);
    assert.match(output, /Type: Unity WebGL/);
    assert.match(output, /Runtime Manifest: web\/unity-webgl/);
    assert.match(output, /Assets: 2 files/);
    assert.match(output, /Game ID: unity-game/);

    const preparedHtml = await __uploadTestHooks.readUnityBundleHtml(gamePath);
    assert.match(preparedHtml, /buildUrl \+ "\/Build\.data"/);
    assert.match(preparedHtml, /custom fullscreen/);
    assert.doesNotMatch(preparedHtml, /prebootUnityLoaderSrc/);

    const loggedHtml = await __uploadTestHooks.readUnityBundleHtml(gamePath, { injectPrebootLogger: true });
    assert.match(loggedHtml, /__unity_preboot_logs/);
    assert.match(loggedHtml, /Unity loader script loaded/);
    assert.match(loggedHtml, /Unity banner:/);
  });
});

test("HTML --withlog injects preboot logger without changing dist output", async () => {
  await withTempProject(async (root) => {
    const gamePath = await writeViteFixture(root, "html-log");
    const indexPath = join(gamePath, "dist", "index.html");
    const originalHtml = await readFile(indexPath, "utf8");

    const preparedHtml = await __uploadTestHooks.readBundleHtml(gamePath, false, true);
    const diskHtml = await readFile(indexPath, "utf8");

    assert.equal(diskHtml, originalHtml);
    assert.match(preparedHtml, /__html_preboot_logs/);
    assert.match(preparedHtml, /Game Logs/);
    assert.match(preparedHtml, /LOGGER_MODE = "html"/);
    assert.match(preparedHtml, /window\.addEventListener\("error"/);
  });
});
