import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../src/index.ts";
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
