#!/usr/bin/env node

import { runCli } from "../dist/index.js";

try {
  await runCli(process.argv.slice(2));
} catch (error) {
  console.error(
    "[oasiz/cli] ERROR:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}
