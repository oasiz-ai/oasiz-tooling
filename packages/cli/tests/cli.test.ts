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

test("studio login uses shared auth route and stores developer credentials", async () => {
  await withTempProject(async (root) => {
    const credentialsPath = join(root, "studio-credentials.json");
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
      const loginPromise = runCli(["login", "--studio", "--no-open"]);
      const start = Date.now();
      while (!loginUrl && Date.now() - start < 2000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(loginUrl, "expected login URL to be printed");

      const parsed = new URL(loginUrl);
      assert.equal(parsed.searchParams.get("developer"), null);
      assert.equal(parsed.searchParams.get("audience"), null);
      const callbackPort = parsed.searchParams.get("port");
      const state = parsed.searchParams.get("state");
      assert.ok(callbackPort);
      assert.ok(state);

      const callbackUrl =
        "http://localhost:" +
        callbackPort +
        "/callback?token=studio-token&email=dev%40example.com&developer=true&state=" +
        encodeURIComponent(state);
      const callbackResponse = await fetch(callbackUrl);
      assert.equal(callbackResponse.status, 200);

      await Promise.race([
        loginPromise,
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("studio login did not settle")), 2000);
        }),
      ]);

      const saved = JSON.parse(await readFile(credentialsPath, "utf8")) as {
        token?: string;
        email?: string;
        developer?: boolean;
      };
      assert.equal(saved.token, "studio-token");
      assert.equal(saved.email, "dev@example.com");
      assert.equal(saved.developer, true);
    } finally {
      console.log = originalLog;
      if (previousCredentials === undefined) delete process.env.OASIZ_CREDENTIALS_PATH;
      else process.env.OASIZ_CREDENTIALS_PATH = previousCredentials;
      if (previousWeb === undefined) delete process.env.OASIZ_WEB_URL;
      else process.env.OASIZ_WEB_URL = previousWeb;
    }
  });
});

test("studio login reports developer access errors with contact email", async () => {
  await withTempProject(async (root) => {
    const credentialsPath = join(root, "studio-credentials.json");
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
      const loginPromise = runCli(["login", "--studio", "--no-open"]).then(
        () => null,
        (error) => error as Error,
      );
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

      const message =
        "Developer access is required for Studio workflows. Email contact@oasiz.ai to join the Oasiz Developers Program.";
      const callbackUrl =
        "http://localhost:" +
        callbackPort +
        "/callback?error=" +
        encodeURIComponent(message) +
        "&state=" +
        encodeURIComponent(state);
      const callbackResponse = await fetch(callbackUrl);
      assert.equal(callbackResponse.status, 400);

      const error = await Promise.race([
        loginPromise,
        new Promise<Error>((_resolve, reject) => {
          setTimeout(() => reject(new Error("studio login did not settle")), 2000);
        }),
      ]);
      assert.ok(error);
      assert.match(error.message, /contact@oasiz\.ai/);
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
    process.env.OASIZ_CLI_TOKEN = "env-token";
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

test("create-server reads Studio env defaults", async () => {
  await withTempProject(async () => {
    const envKeys = [
      "OASIZ_CLI_TOKEN",
      "OASIZ_UPLOAD_TOKEN",
      "OASIZ_CREDENTIALS_PATH",
      "OASIZ_STUDIO_API_URL",
      "OASIZ_WORKSPACE_ID",
      "OASIZ_GAME_SERVER_SLUG",
      "OASIZ_GAME_SERVER_ROOM",
      "OASIZ_GAME_SERVER_PATH",
      "OASIZ_GAME_SERVER_ENTRYPOINT",
      "OASIZ_GAME_SERVER_BUILD_COMMAND",
      "OASIZ_GAME_SERVER_CLIENT_UPDATE_HZ",
      "OASIZ_GAME_SERVER_MIN_REPLICAS",
      "OASIZ_GAME_SERVER_MAX_REPLICAS",
      "OASIZ_GAME_SERVER_RESUME_WORKSPACE",
      "OASIZ_GAME_SERVER_DRY_RUN",
    ];
    const previous = new Map(envKeys.map((key) => [key, process.env[key]]));

    try {
      process.env.OASIZ_CLI_TOKEN = "env-token";
      delete process.env.OASIZ_UPLOAD_TOKEN;
      process.env.OASIZ_CREDENTIALS_PATH = join(tmpdir(), "missing-oasiz-env-defaults.json");
      process.env.OASIZ_STUDIO_API_URL = "https://studio.test/api/controller";
      process.env.OASIZ_WORKSPACE_ID = "ws-env";
      process.env.OASIZ_GAME_SERVER_SLUG = "skyline-aces-env";
      process.env.OASIZ_GAME_SERVER_ROOM = "skyline-room";
      process.env.OASIZ_GAME_SERVER_PATH = "server";
      process.env.OASIZ_GAME_SERVER_ENTRYPOINT = "rooms/index.ts";
      process.env.OASIZ_GAME_SERVER_BUILD_COMMAND = "npm run build";
      process.env.OASIZ_GAME_SERVER_CLIENT_UPDATE_HZ = "15";
      process.env.OASIZ_GAME_SERVER_MIN_REPLICAS = "2";
      process.env.OASIZ_GAME_SERVER_MAX_REPLICAS = "5";
      process.env.OASIZ_GAME_SERVER_RESUME_WORKSPACE = "true";
      process.env.OASIZ_GAME_SERVER_DRY_RUN = "true";

      const output = await captureOutput(async () => {
        await runCli(["create-server"]);
      });

      assert.match(output, /POST https:\/\/studio\.test\/api\/controller\/workspaces\/ws-env\/resume/);
      assert.match(output, /POST https:\/\/studio\.test\/api\/controller\/workspaces\/ws-env\/game-servers/);
      assert.match(output, /"custom_slug": "skyline-aces-env"/);
      assert.match(output, /"room_name": "skyline-room"/);
      assert.match(output, /"entrypoint": "rooms\/index.ts"/);
      assert.match(output, /"client_update_hz": 15/);
      assert.match(output, /"min_replicas": 2/);
      assert.match(output, /"max_replicas": 5/);
      assert.match(output, /"path": "server"/);
      assert.match(output, /"build_command": "npm run build"/);
    } finally {
      for (const key of envKeys) {
        const value = previous.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

test("game-server create can resume a workspace before publishing", async () => {
  await withTempProject(async (root) => {
    const previousGameServerApi = process.env.OASIZ_GAME_SERVER_API_URL;
    const previousToken = process.env.OASIZ_CLI_TOKEN;
    const previousUploadToken = process.env.OASIZ_UPLOAD_TOKEN;
    const previousCredentials = process.env.OASIZ_CREDENTIALS_PATH;
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; body: string }> = [];
    let workspaceStatusReads = 0;

    delete process.env.OASIZ_GAME_SERVER_API_URL;
    process.env.OASIZ_CLI_TOKEN = "env-token";
    delete process.env.OASIZ_UPLOAD_TOKEN;
    process.env.OASIZ_CREDENTIALS_PATH = join(root, "missing-credentials.json");
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init.method || "GET";
      const body = await requestBodyText(init.body);
      calls.push({ url, method, body });

      if (url === "https://api-stage.oasiz.ai/workspaces/0cfd10db") {
        workspaceStatusReads += 1;
        return Response.json({
          workspace_id: "0cfd10db",
          phase: workspaceStatusReads === 1 ? "Stopped" : "Starting",
        });
      }

      if (url === "https://api-stage.oasiz.ai/workspaces/0cfd10db/resume") {
        return Response.json({ workspace_id: "0cfd10db", phase: "Creating" });
      }

      if (url === "https://api-stage.oasiz.ai/workspaces/0cfd10db/game-servers") {
        return Response.json({
          workspace_id: "0cfd10db",
          scope: "workspace",
          build_id: "gs-build-test",
          slug: "arena",
          status: "building",
          url: "https://gs-0cfd10db-arena.games.studio-stage.oasiz.ai",
        });
      }

      throw new Error("Unexpected fetch: " + method + " " + url);
    }) as typeof fetch;

    let output = "";
    try {
      output = await captureOutput(async () => {
        await runCli([
          "game-server",
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
          "--resume-workspace",
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

    assert.match(output, /Resuming workspace: 0cfd10db/);
    assert.match(output, /Workspace status: Starting/);
    assert.match(output, /Build ID: gs-build-test/);
    assert.equal(calls.length, 4);
    assert.equal(calls[0].url, "https://api-stage.oasiz.ai/workspaces/0cfd10db");
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[1].url, "https://api-stage.oasiz.ai/workspaces/0cfd10db/resume");
    assert.equal(calls[1].method, "POST");
    assert.equal(calls[2].url, "https://api-stage.oasiz.ai/workspaces/0cfd10db");
    assert.equal(calls[2].method, "GET");
    assert.equal(calls[3].url, "https://api-stage.oasiz.ai/workspaces/0cfd10db/game-servers");
    assert.equal(calls[3].method, "POST");
  });
});

test("game-server create skips resume when workspace is already running", async () => {
  await withTempProject(async (root) => {
    const previousToken = process.env.OASIZ_CLI_TOKEN;
    const previousUploadToken = process.env.OASIZ_UPLOAD_TOKEN;
    const previousCredentials = process.env.OASIZ_CREDENTIALS_PATH;
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; body: string }> = [];

    process.env.OASIZ_CLI_TOKEN = "env-token";
    delete process.env.OASIZ_UPLOAD_TOKEN;
    process.env.OASIZ_CREDENTIALS_PATH = join(root, "missing-credentials.json");
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init.method || "GET";
      const body = await requestBodyText(init.body);
      calls.push({ url, method, body });

      if (url === "https://api-stage.oasiz.ai/workspaces/0cfd10db") {
        return Response.json({ workspace_id: "0cfd10db", phase: "Ready" });
      }

      if (url === "https://api-stage.oasiz.ai/workspaces/0cfd10db/game-servers") {
        return Response.json({
          workspace_id: "0cfd10db",
          scope: "workspace",
          build_id: "gs-build-test",
          slug: "arena",
          status: "building",
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
          "--workspace",
          "0cfd10db",
          "--api-url",
          "api-stage",
          "--resume-workspace",
        ]);
      });

      assert.match(output, /Workspace status: Ready/);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousToken === undefined) delete process.env.OASIZ_CLI_TOKEN;
      else process.env.OASIZ_CLI_TOKEN = previousToken;
      if (previousUploadToken === undefined) delete process.env.OASIZ_UPLOAD_TOKEN;
      else process.env.OASIZ_UPLOAD_TOKEN = previousUploadToken;
      if (previousCredentials === undefined) delete process.env.OASIZ_CREDENTIALS_PATH;
      else process.env.OASIZ_CREDENTIALS_PATH = previousCredentials;
    }

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://api-stage.oasiz.ai/workspaces/0cfd10db");
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[1].url, "https://api-stage.oasiz.ai/workspaces/0cfd10db/game-servers");
    assert.equal(calls[1].method, "POST");
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

test("test-case import posts Studio controller payload with generated artifacts", async () => {
  await withTempProject(async (root) => {
    await writeFile(join(root, "recording.json"), JSON.stringify({ width: 1280, height: 720, events: [] }), "utf8");
    await writeFile(join(root, "launch.json"), JSON.stringify({ game_id: "breakout", graphics: "high" }), "utf8");
    await writeFile(
      join(root, "appium.json"),
      JSON.stringify({ version: "oasiz-appium-v1", commands: [{ type: "tap_element", using: "name", value: "Play!" }] }),
      "utf8",
    );

    const previousToken = process.env.OASIZ_CLI_TOKEN;
    const previousUploadToken = process.env.OASIZ_UPLOAD_TOKEN;
    const previousCredentials = process.env.OASIZ_CREDENTIALS_PATH;
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; body: string; headers?: HeadersInit }> = [];

    process.env.OASIZ_CLI_TOKEN = "env-token";
    delete process.env.OASIZ_UPLOAD_TOKEN;
    process.env.OASIZ_CREDENTIALS_PATH = join(root, "missing-credentials.json");
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init.method || "GET";
      const body = await requestBodyText(init.body);
      calls.push({ url, method, body, headers: init.headers });

      return Response.json(
        {
	          id: "tc-test",
	          workspace_id: "ws-123",
	          name: "Recorded Appium",
	          game: "breakout",
	          provider: "app-percy",
	          test_type: "appium",
	          app_uri: "bs://app-build",
	          status: "draft",
	          conversion_status: "ready",
        },
        { status: 201 },
      );
    }) as typeof fetch;

    try {
      const output = await captureOutput(async () => {
        await runCli([
          "test-case",
          "import",
          "--api-url",
          "https://controller.test",
	          "--workspace",
	          "ws-123",
	          "--name",
	          "Recorded Appium",
          "--game",
          "breakout",
          "--description",
          "from recording",
          "--objective",
          "Reproduce the issue and verify the first level remains playable.",
          "--notify",
          "QA@example.com,dev@example.com",
          "--provider",
          "app-percy",
          "--app-uri",
          "bs://app-build",
	          "--replay",
	          "recording.json",
	          "--appium",
	          "appium.json",
          "--launch-manifest",
          "launch.json",
	          "--device",
	          "iPhone 14 Pro-16",
        ]);
      });

      assert.match(output, /Studio test case imported/);
      assert.match(output, /ID: tc-test/);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousToken === undefined) delete process.env.OASIZ_CLI_TOKEN;
      else process.env.OASIZ_CLI_TOKEN = previousToken;
      if (previousUploadToken === undefined) delete process.env.OASIZ_UPLOAD_TOKEN;
      else process.env.OASIZ_UPLOAD_TOKEN = previousUploadToken;
      if (previousCredentials === undefined) delete process.env.OASIZ_CREDENTIALS_PATH;
      else process.env.OASIZ_CREDENTIALS_PATH = previousCredentials;
    }

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://controller.test/test-cases");
    assert.equal(calls[0].method, "POST");
    assert.equal((calls[0].headers as Record<string, string>).Authorization, "Bearer env-token");
    const body = JSON.parse(calls[0].body) as {
      workspace_id: string;
      name: string;
      game: string;
      description: string;
      objective: string;
      notification_emails: string[];
      provider: string;
      test_type: string;
      app_uri: string;
	      replay_script: { width: number; height: number; events: unknown[] };
	      appium_script: string;
      launch_manifest: { game_id: string; graphics: string };
	      device_matrix: Array<{ browserstack_name: string }>;
	    };
	    assert.equal(body.workspace_id, "ws-123");
	    assert.equal(body.name, "Recorded Appium");
    assert.equal(body.game, "breakout");
    assert.equal(body.description, "from recording");
    assert.equal(body.objective, "Reproduce the issue and verify the first level remains playable.");
    assert.deepEqual(body.notification_emails, ["qa@example.com", "dev@example.com"]);
    assert.equal(body.provider, "app-percy");
	    assert.equal(body.test_type, "appium");
	    assert.equal(body.app_uri, "bs://app-build");
	    assert.deepEqual(body.replay_script, { width: 1280, height: 720, events: [] });
	    assert.match(body.appium_script, /oasiz-appium-v1/);
    assert.deepEqual(body.launch_manifest, {
      game_id: "breakout",
      graphics: "high",
      deep_link: "oasiz://game/breakout?e2e=true&graphics=high",
      uri: "oasiz://game/breakout?e2e=true&graphics=high",
    });
	    assert.deepEqual(body.device_matrix, [{ browserstack_name: "iPhone 14 Pro-16" }]);
	  });
	});

test("test-case import can upload an app file before updating an existing case", async () => {
  await withTempProject(async (root) => {
    await writeFile(join(root, "app.ipa"), Buffer.from("ipa"));
    await writeFile(join(root, "appium.json"), '{"version":"oasiz-appium-v1","commands":[{"type":"wait","ms":500}]}', "utf8");

    const previousToken = process.env.OASIZ_CLI_TOKEN;
    const previousUploadToken = process.env.OASIZ_UPLOAD_TOKEN;
    const previousCredentials = process.env.OASIZ_CREDENTIALS_PATH;
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; body: BodyInit | null | undefined; headers?: HeadersInit }> = [];

    process.env.OASIZ_CLI_TOKEN = "env-token";
    delete process.env.OASIZ_UPLOAD_TOKEN;
    process.env.OASIZ_CREDENTIALS_PATH = join(root, "missing-credentials.json");
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init.method || "GET";
      calls.push({ url, method, body: init.body, headers: init.headers });

	      if (url === "https://controller.test/test-apps/upload") {
	        return Response.json({ provider: "app-percy", test_type: "appium", app_uri: "bs://uploaded-app" });
	      }

      if (url === "https://controller.test/test-cases/tc-test") {
        return Response.json({
          id: "tc-test",
          workspace_id: "ws-123",
	          name: "Updated smoke",
	          provider: "app-percy",
	          test_type: "appium",
	          app_uri: "bs://uploaded-app",
          status: "draft",
        });
      }

      throw new Error("Unexpected fetch: " + method + " " + url);
    }) as typeof fetch;

    try {
      const output = await captureOutput(async () => {
        await runCli([
          "test-cases",
          "import",
          "--api-url",
          "https://controller.test/test-cases",
          "--case-id",
          "tc-test",
          "--workspace-id",
          "ws-123",
          "--name",
          "Updated smoke",
          "--app-file",
          "app.ipa",
	          "--appium-script",
	          "appium.json",
        ]);
      });

      assert.match(output, /App URI: bs:\/\/uploaded-app/);
      assert.match(output, /Studio test case updated/);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousToken === undefined) delete process.env.OASIZ_CLI_TOKEN;
      else process.env.OASIZ_CLI_TOKEN = previousToken;
      if (previousUploadToken === undefined) delete process.env.OASIZ_UPLOAD_TOKEN;
      else process.env.OASIZ_UPLOAD_TOKEN = previousUploadToken;
      if (previousCredentials === undefined) delete process.env.OASIZ_CREDENTIALS_PATH;
      else process.env.OASIZ_CREDENTIALS_PATH = previousCredentials;
    }

    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://controller.test/test-apps/upload");
    assert.equal(calls[0].method, "POST");
	    assert.equal((calls[0].headers as Record<string, string>).Authorization, "Bearer env-token");
	    assert.ok(calls[0].body instanceof FormData);
	    assert.equal(calls[0].body.get("provider"), "app-percy");
	    assert.equal(calls[0].body.get("test_type"), "appium");
	    assert.ok(calls[0].body.get("file"));

    assert.equal(calls[1].url, "https://controller.test/test-cases/tc-test");
    assert.equal(calls[1].method, "PUT");
    const updateBody = JSON.parse(await requestBodyText(calls[1].body)) as {
      workspace_id: string;
      name: string;
	      provider: string;
	      test_type: string;
	      app_uri: string;
	      appium_script: string;
	    };
    assert.equal(updateBody.workspace_id, "ws-123");
	    assert.equal(updateBody.name, "Updated smoke");
	    assert.equal(updateBody.provider, "app-percy");
	    assert.equal(updateBody.test_type, "appium");
	    assert.equal(updateBody.app_uri, "bs://uploaded-app");
	    assert.match(updateBody.appium_script, /oasiz-appium-v1/);
  });
});

test("test-case import reads Studio env defaults", async () => {
  await withTempProject(async (root) => {
    await writeFile(join(root, "recording.json"), JSON.stringify({ width: 1280, height: 720, events: [] }), "utf8");
    await writeFile(join(root, "launch.json"), JSON.stringify({ game_id: "skyline-aces", graphics: "high" }), "utf8");
    await writeFile(join(root, "appium.json"), '{"version":"oasiz-appium-v1","commands":[{"type":"wait","ms":500}]}', "utf8");
    const envKeys = [
      "OASIZ_STUDIO_API_URL",
      "OASIZ_WORKSPACE_ID",
      "OASIZ_TEST_CASE_NAME",
      "OASIZ_TEST_GAME",
      "OASIZ_TEST_DESCRIPTION",
      "OASIZ_TEST_OBJECTIVE",
      "OASIZ_TEST_NOTIFY_EMAILS",
      "OASIZ_TEST_PROVIDER",
      "OASIZ_TEST_APP_URI",
      "OASIZ_TEST_REPLAY_PATH",
      "OASIZ_TEST_APPIUM_PATH",
      "OASIZ_TEST_LAUNCH_MANIFEST",
      "APP_PERCY_DEFAULT_DEVICES",
      "OASIZ_TEST_DRY_RUN",
    ];
    const previous = new Map(envKeys.map((key) => [key, process.env[key]]));

    try {
      process.env.OASIZ_STUDIO_API_URL = "https://controller.test";
      process.env.OASIZ_WORKSPACE_ID = "ws-env";
      process.env.OASIZ_TEST_CASE_NAME = "Env smoke";
      process.env.OASIZ_TEST_GAME = "skyline-aces";
      process.env.OASIZ_TEST_DESCRIPTION = "from env";
      process.env.OASIZ_TEST_OBJECTIVE = "Verify multiplayer join works.";
      process.env.OASIZ_TEST_NOTIFY_EMAILS = "qa@example.com, dev@example.com";
      process.env.OASIZ_TEST_PROVIDER = "app-percy";
      process.env.OASIZ_TEST_APP_URI = "bs://env-app";
      process.env.OASIZ_TEST_REPLAY_PATH = "recording.json";
      process.env.OASIZ_TEST_APPIUM_PATH = "appium.json";
      process.env.OASIZ_TEST_LAUNCH_MANIFEST = "launch.json";
      process.env.APP_PERCY_DEFAULT_DEVICES = "iPhone 14 Pro-16,iPhone 12-15";
      process.env.OASIZ_TEST_DRY_RUN = "true";

      const output = await captureOutput(async () => {
        await runCli(["test-case"]);
      });
      const body = JSON.parse(output.slice(output.indexOf("{"))) as {
        workspace_id: string;
        name: string;
        game: string;
        description: string;
        objective: string;
        notification_emails: string[];
        provider: string;
        test_type: string;
        app_uri: string;
        replay_script: { width: number; height: number; events: unknown[] };
        appium_script: string;
        launch_manifest: { game_id: string; graphics: string };
        device_matrix: Array<{ browserstack_name: string }>;
      };

      assert.match(output, /POST https:\/\/controller\.test\/test-cases/);
      assert.equal(body.workspace_id, "ws-env");
      assert.equal(body.name, "Env smoke");
      assert.equal(body.game, "skyline-aces");
      assert.equal(body.description, "from env");
      assert.equal(body.objective, "Verify multiplayer join works.");
      assert.deepEqual(body.notification_emails, ["qa@example.com", "dev@example.com"]);
      assert.equal(body.provider, "app-percy");
      assert.equal(body.test_type, "appium");
      assert.equal(body.app_uri, "bs://env-app");
      assert.deepEqual(body.replay_script, { width: 1280, height: 720, events: [] });
      assert.match(body.appium_script, /oasiz-appium-v1/);
      assert.deepEqual(body.launch_manifest, {
        game_id: "skyline-aces",
        graphics: "high",
        deep_link: "oasiz://game/skyline-aces?e2e=true&graphics=high",
        uri: "oasiz://game/skyline-aces?e2e=true&graphics=high",
      });
      assert.deepEqual(body.device_matrix, [{ browserstack_name: "iPhone 14 Pro-16" }, { browserstack_name: "iPhone 12-15" }]);
    } finally {
      for (const key of envKeys) {
        const value = previous.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

test("test-case run updates an existing case, auto-detects manifest, polls, and writes results", async () => {
  await withTempProject(async (root) => {
    await mkdir(join(root, "tests", "marble"), { recursive: true });
    await writeFile(
      join(root, "tests", "marble", "appium.json"),
      '{"version":"oasiz-appium-v1","commands":[{"type":"deep_link","url":"oasiz://game/marble-madness"},{"type":"wait","ms":500}]}',
      "utf8",
    );
    await writeFile(join(root, "tests", "marble", "launch-manifest.json"), '{"game_id":"marble-madness","graphics":"high"}', "utf8");

    const previousToken = process.env.OASIZ_CLI_TOKEN;
    const previousUploadToken = process.env.OASIZ_UPLOAD_TOKEN;
    const previousCredentials = process.env.OASIZ_CREDENTIALS_PATH;
    const previousArtifactDir = process.env.OASIZ_TEST_ARTIFACTS_DIR;
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; body: string; headers?: HeadersInit }> = [];

    process.env.OASIZ_CLI_TOKEN = "env-token";
    delete process.env.OASIZ_UPLOAD_TOKEN;
    process.env.OASIZ_CREDENTIALS_PATH = join(root, "missing-credentials.json");
    process.env.OASIZ_TEST_ARTIFACTS_DIR = "run-artifacts";
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init.method || "GET";
      const body = await requestBodyText(init.body);
      calls.push({ url, method, body, headers: init.headers });

      if (url === "https://controller.test/test-cases/tc-marble" && method === "PUT") {
        return Response.json({
          id: "tc-marble",
          provider: "app-percy",
          test_type: "appium",
          app_uri: "bs://app-build",
        });
      }
      if (url === "https://controller.test/test-cases/tc-marble/run" && method === "POST") {
        return Response.json({ id: "tr-marble", status: "queued" }, { status: 201 });
      }
      if (url === "https://controller.test/test-runs/tr-marble" && method === "GET") {
        return Response.json({
          id: "tr-marble",
          case_id: "tc-marble",
          status: "failed",
          outcome: "Marble Madness blank screen reproduced",
          provider_console_url: "https://automate.browserstack.com/builds/tr-marble",
          artifacts: [
            {
              label: "session",
              kind: "session",
              url: "https://app-automate.browserstack.com/dashboard/v2/sessions/tr-marble",
            },
          ],
        });
      }

      throw new Error("Unexpected fetch: " + method + " " + url);
    }) as typeof fetch;

    try {
      const output = await captureOutput(async () => {
        await runCli([
          "test-case",
          "run",
          "--api-url",
          "https://controller.test",
          "--case-id",
          "tc-marble",
          "--test",
          "tests/marble/appium.json",
          "--app-uri",
          "bs://app-build",
          "--objective",
          "Verify Marble Madness reaches gameplay or fails at the game surface.",
          "--device",
          "iPhone 12-17",
          "--output",
          "run-result.json",
          "--poll-interval-ms",
          "1",
          "--timeout-ms",
          "1000",
        ]);
      });

    assert.match(output, /Studio test run result written/);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousToken === undefined) delete process.env.OASIZ_CLI_TOKEN;
      else process.env.OASIZ_CLI_TOKEN = previousToken;
      if (previousUploadToken === undefined) delete process.env.OASIZ_UPLOAD_TOKEN;
      else process.env.OASIZ_UPLOAD_TOKEN = previousUploadToken;
      if (previousCredentials === undefined) delete process.env.OASIZ_CREDENTIALS_PATH;
      else process.env.OASIZ_CREDENTIALS_PATH = previousCredentials;
      if (previousArtifactDir === undefined) delete process.env.OASIZ_TEST_ARTIFACTS_DIR;
      else process.env.OASIZ_TEST_ARTIFACTS_DIR = previousArtifactDir;
    }

    assert.equal(calls.length, 3);
    assert.equal(calls[0].url, "https://controller.test/test-cases/tc-marble");
    assert.equal(calls[0].method, "PUT");
    assert.equal((calls[0].headers as Record<string, string>).Authorization, "Bearer env-token");
    const updateBody = JSON.parse(calls[0].body) as {
      workspace_id?: string;
      provider: string;
      test_type: string;
      app_uri: string;
      appium_script: string;
      launch_manifest: { game_id: string; graphics: string };
      device_matrix: Array<{ browserstack_name: string }>;
    };
    assert.equal(updateBody.workspace_id, undefined);
    assert.equal(updateBody.provider, "app-percy");
    assert.equal(updateBody.test_type, "appium");
    assert.equal(updateBody.app_uri, "bs://app-build");
    assert.match(updateBody.appium_script, /oasiz-appium-v1/);
    assert.match(updateBody.appium_script, /oasiz:\/\/game\/marble-madness\?e2e=true&graphics=high/);
    assert.deepEqual(updateBody.launch_manifest, {
      game_id: "marble-madness",
      graphics: "high",
      deep_link: "oasiz://game/marble-madness?e2e=true&graphics=high",
      uri: "oasiz://game/marble-madness?e2e=true&graphics=high",
    });
    assert.deepEqual(updateBody.device_matrix, [{ browserstack_name: "iPhone 12-17" }]);

    assert.equal(calls[1].url, "https://controller.test/test-cases/tc-marble/run");
    assert.equal(calls[1].method, "POST");
    const runBody = JSON.parse(calls[1].body) as { provider: string; test_type: string; app_uri: string };
    assert.equal(runBody.provider, "app-percy");
    assert.equal(runBody.test_type, "appium");
    assert.equal(runBody.app_uri, "bs://app-build");

    const result = JSON.parse(await readFile(join(root, "run-result.json"), "utf8")) as {
      results: Array<{ case_id: string; run_id: string; status: string; outcome: string; provider_console_url: string }>;
      output_path: string;
    };
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].case_id, "tc-marble");
    assert.equal(result.results[0].run_id, "tr-marble");
    assert.equal(result.results[0].status, "failed");
    assert.equal(result.results[0].outcome, "Marble Madness blank screen reproduced");
    assert.equal(result.results[0].provider_console_url, "https://automate.browserstack.com/builds/tr-marble");
    assert.equal(result.results[0].artifact_output_dir, join(root, "run-artifacts"));
    assert.equal(result.output_path, join(root, "run-result.json"));
    assert.equal(
      await readFile(join(root, "run-artifacts", "01-session-session.url"), "utf8"),
      "https://app-automate.browserstack.com/dashboard/v2/sessions/tr-marble\n",
    );
  });
});

test("test-case run dry-run supports env arrays and generated game launch manifests", async () => {
  await withTempProject(async (root) => {
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(join(root, "tests", "first.json"), '{"version":"oasiz-appium-v1","commands":[{"type":"wait","ms":100}]}', "utf8");
    await writeFile(join(root, "tests", "second.json"), '{"version":"oasiz-appium-v1","commands":[{"type":"wait","ms":200}]}', "utf8");

    const envKeys = [
      "OASIZ_STUDIO_API_URL",
      "OASIZ_TEST_CASE_ID",
      "OASIZ_TEST_PATHS",
      "OASIZ_TEST_GAME_ID",
      "OASIZ_TEST_APP_URI",
      "OASIZ_TEST_OBJECTIVE",
      "APP_PERCY_DEFAULT_DEVICES",
      "OASIZ_TEST_DRY_RUN",
      "OASIZ_TEST_JSON",
    ];
    const previous = new Map(envKeys.map((key) => [key, process.env[key]]));

    try {
      process.env.OASIZ_STUDIO_API_URL = "https://controller.test/api/controller";
      process.env.OASIZ_TEST_CASE_ID = "tc-dry";
      process.env.OASIZ_TEST_PATHS = "tests/first.json,tests/second.json";
      process.env.OASIZ_TEST_GAME_ID = "marble-madness";
      process.env.OASIZ_TEST_APP_URI = "bs://app-build";
      process.env.OASIZ_TEST_OBJECTIVE = "Verify Marble Madness reaches gameplay.";
      process.env.APP_PERCY_DEFAULT_DEVICES = "iPhone 12-17";
      process.env.OASIZ_TEST_DRY_RUN = "true";
      process.env.OASIZ_TEST_JSON = "true";

      const output = await captureOutput(async () => {
        await runCli(["test-case", "run"]);
      });
      const result = JSON.parse(output) as {
        results: Array<{
          dry_run: boolean;
          request: { import: { body: { launch_manifest: { game_id: string; uri: string } } }; run: { body: { launch_manifest: { game_id: string } } } };
        }>;
      };

      assert.equal(result.results.length, 2);
      assert.equal(result.results[0].dry_run, true);
      assert.equal(result.results[0].request.import.body.launch_manifest.game_id, "marble-madness");
      assert.equal(result.results[0].request.import.body.launch_manifest.uri, "oasiz://game/marble-madness");
      assert.equal(result.results[0].request.import.body.launch_manifest.deep_link, "oasiz://game/marble-madness");
      assert.equal(result.results[1].request.run.body.launch_manifest.game_id, "marble-madness");
    } finally {
      for (const key of envKeys) {
        const value = previous.get(key);
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

test("test-case artifacts fetches run metadata and downloads provider artifacts", async () => {
  await withTempProject(async (root) => {
    const previousToken = process.env.OASIZ_CLI_TOKEN;
    const previousCredentials = process.env.OASIZ_CREDENTIALS_PATH;
    const previousUser = process.env.BROWSERSTACK_USERNAME;
    const previousKey = process.env.BROWSERSTACK_ACCESS_KEY;
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; method: string; headers?: HeadersInit }> = [];

    process.env.OASIZ_CLI_TOKEN = "env-token";
    process.env.OASIZ_CREDENTIALS_PATH = join(root, "missing-credentials.json");
    process.env.BROWSERSTACK_USERNAME = "bs-user";
    process.env.BROWSERSTACK_ACCESS_KEY = "bs-key";
    globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = init.method || "GET";
      calls.push({ url, method, headers: init.headers });

      if (url === "https://controller.test/test-runs/tr-artifacts" && method === "GET") {
        return Response.json({
          id: "tr-artifacts",
          status: "failed",
          outcome: "Marble Madness blank screen reproduced",
          provider_console_url: "https://app-automate.browserstack.com/dashboard/v2/sessions/session-1",
          artifacts: [
            {
              kind: "session",
              name: "BrowserStack session",
              url: "https://app-automate.browserstack.com/dashboard/v2/sessions/session-1",
            },
            {
              kind: "video",
              name: "BrowserStack session JSON",
              url: "https://api.browserstack.com/app-automate/sessions/session-1.json",
            },
            {
              kind: "device_logs",
              name: "Logs",
              url: "https://api.browserstack.com/app-automate/sessions/session-1/logs",
            },
          ],
        });
      }

      if (url === "https://api.browserstack.com/app-automate/sessions/session-1.json") {
        return Response.json({
          automation_session: {
            video_url: "https://app-automate.browserstack.com/sessions/session-1/video",
            device_logs_url: "https://api.browserstack.com/builds/build-1/sessions/session-1/devicelogs",
            appium_logs_url: "https://api.browserstack.com/builds/build-1/sessions/session-1/appiumlogs",
          },
        });
      }

      if (url.endsWith("/devicelogs")) {
        return new Response("device log body", { headers: { "content-type": "text/plain" } });
      }
      if (url.endsWith("/appiumlogs")) {
        return new Response("appium log body", { headers: { "content-type": "text/plain" } });
      }
      if (url.endsWith("/logs")) {
        return new Response("top-level log body", { headers: { "content-type": "text/plain" } });
      }

      throw new Error("Unexpected fetch: " + method + " " + url);
    }) as typeof fetch;

    try {
      const output = await captureOutput(async () => {
        await runCli([
          "test-case",
          "artifacts",
          "--api-url",
          "https://controller.test",
          "--run-id",
          "tr-artifacts",
          "--output",
          "artifacts/tr-artifacts",
        ]);
      });

      assert.match(output, /Studio test run artifacts/);
      assert.match(output, /Downloaded to:/);
    } finally {
      globalThis.fetch = originalFetch;
      if (previousToken === undefined) delete process.env.OASIZ_CLI_TOKEN;
      else process.env.OASIZ_CLI_TOKEN = previousToken;
      if (previousCredentials === undefined) delete process.env.OASIZ_CREDENTIALS_PATH;
      else process.env.OASIZ_CREDENTIALS_PATH = previousCredentials;
      if (previousUser === undefined) delete process.env.BROWSERSTACK_USERNAME;
      else process.env.BROWSERSTACK_USERNAME = previousUser;
      if (previousKey === undefined) delete process.env.BROWSERSTACK_ACCESS_KEY;
      else process.env.BROWSERSTACK_ACCESS_KEY = previousKey;
    }

    const artifactDir = join(root, "artifacts", "tr-artifacts");
    const runJson = JSON.parse(await readFile(join(artifactDir, "run.json"), "utf8")) as { id: string };
    assert.equal(runJson.id, "tr-artifacts");
    assert.equal(
      await readFile(join(artifactDir, "01-session-browserstack-session.url"), "utf8"),
      "https://app-automate.browserstack.com/dashboard/v2/sessions/session-1\n",
    );
    assert.match(await readFile(join(artifactDir, "02-video-browserstack-session-json.json"), "utf8"), /automation_session/);
    assert.equal(await readFile(join(artifactDir, "browserstack-device_logs.txt"), "utf8"), "device log body");
    assert.equal(await readFile(join(artifactDir, "browserstack-appium_logs.txt"), "utf8"), "appium log body");
    assert.equal(await readFile(join(artifactDir, "03-device_logs-logs.txt"), "utf8"), "top-level log body");

    assert.equal(calls[0].url, "https://controller.test/test-runs/tr-artifacts");
    assert.equal((calls[0].headers as Record<string, string>).Authorization, "Bearer env-token");
    const browserStackCall = calls.find((call) => call.url === "https://api.browserstack.com/app-automate/sessions/session-1.json");
    assert.ok(browserStackCall);
    assert.equal(
      (browserStackCall.headers as Record<string, string>).Authorization,
      "Basic " + Buffer.from("bs-user:bs-key").toString("base64"),
    );
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

test("studio CLI workflows require developer-scoped auth tokens", async () => {
  const authPath = fileURLToPath(new URL("../src/lib/auth.ts", import.meta.url));
  const gameServerPath = fileURLToPath(new URL("../src/game-server-cli.ts", import.meta.url));
  const testCasePath = fileURLToPath(new URL("../src/test-case-cli.ts", import.meta.url));
  const authSource = await readFile(authPath, "utf8");
  const gameServerSource = await readFile(gameServerPath, "utf8");
  const testCaseSource = await readFile(testCasePath, "utf8");
  const studioAuthMatch = authSource.match(
    /export async function resolveStudioAuthToken[\s\S]*?const stored = await readStoredCredentials\(\);/,
  );

  assert.ok(studioAuthMatch);
  assert.match(studioAuthMatch[0], /OASIZ_CLI_TOKEN/);
  assert.doesNotMatch(studioAuthMatch[0], /OASIZ_UPLOAD_TOKEN/);
  assert.match(gameServerSource, /resolveStudioAuthToken/);
  assert.match(testCaseSource, /resolveStudioAuthToken/);
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

    const presignCall = calls.find((call) => call.url.endsWith("/presign"));
    assert.ok(presignCall);
    const presignBody = JSON.parse(presignCall.body) as { assets: Array<{ path: string; contentType: string }> };
    assert.deepEqual(
      presignBody.assets.map((asset) => [asset.path, asset.contentType]).sort(),
      [
        ["assets/config.json", "application/json"],
        ["assets/index.js", "application/javascript"],
        ["images/pic.png", "image/png"],
      ],
    );

    const syncCall = calls.find((call) => call.url.endsWith("/sync-html"));
    assert.ok(syncCall);
    const syncBody = JSON.parse(syncCall.body) as { allAssetPaths: string[]; assets?: unknown };
    assert.equal("assets" in syncBody, false);
    assert.deepEqual(syncBody.allAssetPaths.sort(), ["assets/config.json", "assets/index.js", "images/pic.png"]);

    const jsonPut = calls.find((call) => call.method === "PUT" && call.url.includes(encodeURIComponent("assets/config.json")));
    assert.ok(jsonPut);
    assert.match(jsonPut.body, /https:\/\/cdn\.test\/game-assets\/game-123\/images\/pic\.png/);

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
