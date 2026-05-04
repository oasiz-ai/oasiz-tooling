import assert from "node:assert/strict";
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
  const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const source = await readFile(cliPath, "utf8");

  assert.match(source, /server\.listen\(0,\s*"localhost"/);
  assert.match(source, /server\.listen\(callbackPort,\s*"localhost"/);
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

  assert.match(source, /await requireAuthToken\(\)/);
  assert.match(source, /await readStoredCredentials\(\)/);
  assert.match(source, /process\.env\.OASIZ_EMAIL/);
  assert.match(source, /No creator email found in saved login credentials or OASIZ_EMAIL/);
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
