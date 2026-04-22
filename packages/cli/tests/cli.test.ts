import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runCli } from "../src/index.ts";
import { getWebBaseUrl } from "../src/lib/auth.ts";
import { runUploadCli } from "../src/upload-cli.ts";

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
  assert.match(source, /No creator email found in saved login credentials/);
});
