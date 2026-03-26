import { runUploadCli } from "./upload-cli.ts";

function printHelp(): void {
  console.log("Usage: oasiz <command> [options]");
  console.log("");
  console.log("Commands:");
  console.log("  upload       Build and upload a game bundle");
  console.log("");
  console.log("Examples:");
  console.log("  oasiz upload block-blast");
  console.log("  npx @oasiz/cli upload --list");
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const [command, ...rest] = argv;

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "upload") {
    await runUploadCli(rest);
    return;
  }

  console.error(`[oasiz/cli] Unknown command: ${command}`);
  process.exitCode = 1;
}
