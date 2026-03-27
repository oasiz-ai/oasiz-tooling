import { existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { spawn } from "node:child_process";
import { stdin, stdout } from "node:process";
import {
  buildGame,
  collectAssets,
  formatBytes,
  readBundleHtml,
  readThumbnail,
  summarizeDist,
} from "./lib/build.ts";
import {
  clearStoredCredentials,
  getApiBaseUrl,
  getWebBaseUrl,
  readStoredCredentials,
  requireAuthToken,
  resolveAuthToken,
  saveStoredCredentials,
} from "./lib/auth.ts";
import {
  getMyGames,
  getUploadPreflight,
  postActivateDraft,
  postUploadGame,
  type StudioDraft,
} from "./lib/api.ts";
import {
  getGameFolders,
  getGamePath,
  isGameSlug,
  listMainTemplates,
  readMainTemplateByName,
  readPublishConfig,
  scaffoldFromTemplate,
  slugToTitle,
  validateGameFolder,
  writePublishConfig,
} from "./lib/game.ts";

type OrientationOverride = boolean | undefined;

function printHelp(): void {
  console.log("oasiz - Oasiz game CLI");
  console.log("");
  console.log("Commands:");
  console.log("  oasiz create [name]         Scaffold a new game");
  console.log("    --template <name>         Use template from package assets");
  console.log("  oasiz info                  Show all commands");
  console.log("  oasiz upload <game>         Build + upload with draft wizard");
  console.log("  oasiz versions <game>       List studio drafts for a game");
  console.log("  oasiz activate <game>       Promote draft to live version");
  console.log("  oasiz list                  List local game folders");
  console.log("  oasiz games                 List your platform games");
  console.log("  oasiz login                 Browser login via Oasiz app");
  console.log("  oasiz login --no-open       Print URL only (do not auto-open)");
  console.log("  oasiz logout                Clear saved CLI token");
  console.log("  oasiz whoami                Show auth state");
  console.log("");
  console.log("Upload flags:");
  console.log("  --draft                     Upload as draft only");
  console.log("  --activate                  Upload and make live immediately");
  console.log("  --skip-build                Skip build step and use dist/");
  console.log("  --dry-run                   Build and preview payload only");
  console.log("  horizontal | vertical       Override publish.json verticalOnly");
}

function printUploadHelp(): void {
  console.log("Usage: oasiz upload <game> [flags]");
  console.log("");
  console.log("Flags:");
  console.log("  --draft");
  console.log("  --activate");
  console.log("  --skip-build");
  console.log("  --dry-run");
  console.log("  horizontal");
  console.log("  vertical");
  console.log("");
  console.log("Examples:");
  console.log("  oasiz upload block-blast");
  console.log("  oasiz upload block-blast --dry-run");
  console.log("  oasiz upload block-blast --activate vertical");
  console.log("");
  console.log("Use `oasiz list` to see local game folders.");
}

function fail(message: string): never {
  throw new Error(message);
}

function enrichConnectionError(error: unknown, message: string): string {
  if (!message.includes("Unable to connect")) {
    return message;
  }

  const errorPath =
    typeof error === "object" &&
    error !== null &&
    "path" in error &&
    typeof (error as { path?: unknown }).path === "string"
      ? ((error as { path?: string }).path as string)
      : "";

  const lines = [message];
  if (errorPath) {
    lines.push("Target URL: " + errorPath);
  } else {
    lines.push("API base: " + getApiBaseUrl());
  }

  if (!process.env.OASIZ_API_URL) {
    lines.push("Hint: OASIZ_API_URL is not set.");
    lines.push("Set it for local backend, e.g. `export OASIZ_API_URL=http://localhost:3001`.");
  } else {
    lines.push("Hint: verify OASIZ_API_URL points to a reachable backend.");
  }

  return lines.join("\n");
}

function parseArgs(argv: string[]): {
  positionals: string[];
  flagSet: Set<string>;
  values: Map<string, string>;
} {
  const positionals: string[] = [];
  const flagSet = new Set<string>();
  const values = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("-")) {
      positionals.push(value);
      continue;
    }

    flagSet.add(value);
    const next = argv[i + 1];
    if (next && !next.startsWith("-")) {
      values.set(value, next);
      i += 1;
    }
  }

  return { positionals, flagSet, values };
}

function parseOrientation(argList: string[]): OrientationOverride {
  if (argList.includes("horizontal")) return false;
  if (argList.includes("vertical")) return true;
  return undefined;
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const deltaMs = Date.now() - date.getTime();
  const deltaMin = Math.max(1, Math.floor(deltaMs / (60 * 1000)));

  if (deltaMin < 60) {
    return deltaMin + " minute" + (deltaMin === 1 ? "" : "s") + " ago";
  }

  const deltaHours = Math.floor(deltaMin / 60);
  if (deltaHours < 48) {
    return deltaHours + " hour" + (deltaHours === 1 ? "" : "s") + " ago";
  }

  const deltaDays = Math.floor(deltaHours / 24);
  if (deltaDays < 30) {
    return deltaDays + " day" + (deltaDays === 1 ? "" : "s") + " ago";
  }

  const deltaWeeks = Math.floor(deltaDays / 7);
  if (deltaWeeks < 10) {
    return deltaWeeks + " week" + (deltaWeeks === 1 ? "" : "s") + " ago";
  }

  const deltaMonths = Math.floor(deltaDays / 30);
  return deltaMonths + " month" + (deltaMonths === 1 ? "" : "s") + " ago";
}

function sortDraftsAscending(drafts: StudioDraft[]): StudioDraft[] {
  return [...drafts].sort((a, b) => {
    const aNumber = Number(a.label.replace(/[^0-9]/g, ""));
    const bNumber = Number(b.label.replace(/[^0-9]/g, ""));
    if (Number.isFinite(aNumber) && Number.isFinite(bNumber) && aNumber !== bNumber) {
      return aNumber - bNumber;
    }

    return a.createdAt.localeCompare(b.createdAt);
  });
}

function sortDraftsDescending(drafts: StudioDraft[]): StudioDraft[] {
  return [...drafts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getLiveDraft(drafts: StudioDraft[]): StudioDraft | undefined {
  return drafts.find((draft) => draft.isLive);
}

async function askYesNo(prompt: string, defaultYes: boolean): Promise<boolean> {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(prompt)).trim().toLowerCase();
  rl.close();

  if (!answer) return defaultYes;
  if (answer === "y" || answer === "yes") return true;
  if (answer === "n" || answer === "no") return false;
  return defaultYes;
}

async function askInput(prompt: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(prompt)).trim();
  rl.close();
  return answer;
}

async function askChoice(prompt: string, min: number, max: number): Promise<number> {
  const rl = createInterface({ input: stdin, output: stdout });
  while (true) {
    const answer = (await rl.question(prompt)).trim();
    const numeric = Number(answer);
    if (Number.isInteger(numeric) && numeric >= min && numeric <= max) {
      rl.close();
      return numeric;
    }
    console.log("Please enter a number between " + min + " and " + max + ".");
  }
}

function pad(value: string, length: number): string {
  return value.padEnd(length, " ");
}

function normalizeGameSlugInput(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

function printBuildSummary(gamePath: string): void {
  const summary = summarizeDist(gamePath);
  console.log("");
  console.log("Build summary:");
  console.log("  HTML: " + formatBytes(summary.htmlBytes));
  console.log("  Assets: " + summary.assetCount + " files (" + formatBytes(summary.assetBytes) + ")");
  console.log("  Total: " + formatBytes(summary.totalBytes));
  if (summary.topAssets.length > 0) {
    console.log("  Largest files:");
    summary.topAssets.forEach((entry) => {
      console.log("    - " + entry.path + " (" + formatBytes(entry.bytes) + ")");
    });
  }
}

async function commandList(): Promise<void> {
  const folders = getGameFolders();
  if (folders.length === 0) {
    console.log("No local game folders found.");
    return;
  }

  console.log("Local games:");
  for (const folder of folders) {
    const hasPublish = existsSync(join(getGamePath(folder), "publish.json"));
    console.log("  " + (hasPublish ? "✓" : "○") + " " + folder);
  }
  console.log("");
  console.log("✓ has publish.json, ○ uses defaults");
}

async function commandCreate(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const initialGameSlug = parsed.positionals[0];
  const templateFromFlag = parsed.values.get("--template");
  const templateFromPositional = parsed.positionals[1];
  if (templateFromFlag && templateFromPositional && templateFromFlag !== templateFromPositional) {
    fail("Template mismatch. Use either --template <name> or a single template positional.");
  }

  const templateOverride = templateFromFlag || templateFromPositional;
  console.log("Create game wizard");
  console.log("");

  let gameSlug = initialGameSlug?.trim() ?? "";
  if (gameSlug) {
    const override = await askInput("1. Game name [" + gameSlug + "]: ");
    if (override) gameSlug = override;
  } else {
    gameSlug = await askInput("1. Game name: ");
  }

  const templateOptions = listMainTemplates();
  if (templateOptions.length === 0) {
    fail("No templates found. Package assets are incomplete.");
  }

  let selectedTemplate = templateOverride?.trim() ?? "";
  if (selectedTemplate) {
    if (!templateOptions.includes(selectedTemplate)) {
      fail("Unknown template: " + selectedTemplate + ". Available templates: " + templateOptions.join(", "));
    }
  } else {
    console.log("");
    console.log("2. Template choice:");
    templateOptions.forEach((option, index) => {
      console.log("  " + (index + 1) + ") " + option);
    });
    const templateIndex = await askChoice(
      "Select template [1-" + templateOptions.length + "]: ",
      1,
      templateOptions.length,
    );
    selectedTemplate = templateOptions[templateIndex - 1];
  }

  const normalizedSlug = normalizeGameSlugInput(gameSlug);
  if (normalizedSlug !== gameSlug) {
    console.log("");
    console.log("Using game slug: " + normalizedSlug);
  }

  console.log("");
  console.log("Template selected: " + selectedTemplate + ".");
  console.log("");

  await scaffoldGame(normalizedSlug, selectedTemplate);
}

async function scaffoldGame(gameSlug: string, templateName: string): Promise<void> {
  if (!gameSlug) {
    fail("Game name is required.");
  }

  if (!isGameSlug(gameSlug)) {
    fail("Invalid game name. Use lowercase letters, numbers, and hyphens only.");
  }

  const gamePath = scaffoldFromTemplate(gameSlug);
  const title = slugToTitle(gameSlug);
  const packagePath = join(gamePath, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as Record<string, unknown>;
  packageJson.name = gameSlug;
  await writeFile(packagePath, JSON.stringify(packageJson, null, 2) + "\n", "utf8");

  const mainTemplate = await readMainTemplateByName(templateName);
  const mainCode = mainTemplate.replace("__GAME_TITLE__", title);
  await writeFile(join(gamePath, "src", "main.ts"), mainCode, "utf8");

  const indexHtml =
    "<!doctype html>\n" +
    "<html lang=\"en\">\n" +
    "<head>\n" +
    "  <meta charset=\"UTF-8\" />\n" +
    "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n" +
    "  <meta name=\"mobile-web-app-capable\" content=\"yes\" />\n" +
    "  <title>" + title + "</title>\n" +
    "  <style>\n" +
    "    :root {\n" +
    "      --safe-top: 45px;\n" +
    "      --safe-bottom: 120px;\n" +
    "      --panel-bg: rgba(13, 24, 44, 0.92);\n" +
    "      --panel-border: rgba(140, 188, 255, 0.35);\n" +
    "      --text-main: #f4fbff;\n" +
    "      --text-muted: #a7bddc;\n" +
    "      --accent: #59ceff;\n" +
    "      --accent-strong: #2b9cff;\n" +
    "    }\n" +
    "    html, body {\n" +
    "      margin: 0;\n" +
    "      padding: 0;\n" +
    "      width: 100%;\n" +
    "      height: 100%;\n" +
    "      overflow: hidden;\n" +
    "      touch-action: none;\n" +
    "      font-family: \"Trebuchet MS\", \"Segoe UI\", sans-serif;\n" +
    "      background: #081225;\n" +
    "      color: var(--text-main);\n" +
    "    }\n" +
    "    body {\n" +
    "      position: relative;\n" +
    "      user-select: none;\n" +
    "    }\n" +
    "    #game-canvas {\n" +
    "      display: block;\n" +
    "      width: 100vw;\n" +
    "      height: 100vh;\n" +
    "    }\n" +
    "    .overlay {\n" +
    "      position: fixed;\n" +
    "      inset: 0;\n" +
    "      pointer-events: none;\n" +
    "      display: flex;\n" +
    "      align-items: center;\n" +
    "      justify-content: center;\n" +
    "      padding: 24px;\n" +
    "      box-sizing: border-box;\n" +
    "    }\n" +
    "    .hidden {\n" +
    "      display: none !important;\n" +
    "    }\n" +
    "    .card {\n" +
    "      pointer-events: auto;\n" +
    "      width: min(540px, 94vw);\n" +
    "      border: 1px solid var(--panel-border);\n" +
    "      background: linear-gradient(160deg, rgba(20, 35, 61, 0.96), rgba(12, 24, 44, 0.94));\n" +
    "      box-shadow: 0 30px 70px rgba(0, 0, 0, 0.45);\n" +
    "      border-radius: 24px;\n" +
    "      padding: 26px;\n" +
    "      box-sizing: border-box;\n" +
    "      text-align: center;\n" +
    "    }\n" +
    "    h1, h2 {\n" +
    "      margin: 0;\n" +
    "      line-height: 1.2;\n" +
    "      letter-spacing: 0.03em;\n" +
    "    }\n" +
    "    h1 {\n" +
    "      font-size: clamp(2rem, 7vw, 3.2rem);\n" +
    "      margin-bottom: 12px;\n" +
    "    }\n" +
    "    h2 {\n" +
    "      font-size: clamp(1.4rem, 5vw, 2rem);\n" +
    "      margin-bottom: 8px;\n" +
    "    }\n" +
    "    p {\n" +
    "      margin: 0;\n" +
    "      color: var(--text-muted);\n" +
    "      line-height: 1.55;\n" +
    "    }\n" +
    "    .ui-btn {\n" +
    "      pointer-events: auto;\n" +
    "      margin-top: 18px;\n" +
    "      min-height: 52px;\n" +
    "      border: 0;\n" +
    "      border-radius: 14px;\n" +
    "      padding: 0 22px;\n" +
    "      font-size: 16px;\n" +
    "      font-weight: 700;\n" +
    "      color: #031427;\n" +
    "      background: linear-gradient(135deg, var(--accent), var(--accent-strong));\n" +
    "      cursor: pointer;\n" +
    "      transform: translateY(0);\n" +
    "      box-shadow: 0 10px 24px rgba(35, 164, 255, 0.35);\n" +
    "      transition: transform 0.12s ease, box-shadow 0.12s ease;\n" +
    "    }\n" +
    "    .ui-btn:active {\n" +
    "      transform: translateY(2px);\n" +
    "      box-shadow: 0 4px 12px rgba(35, 164, 255, 0.22);\n" +
    "    }\n" +
    "    #hud {\n" +
    "      position: fixed;\n" +
    "      top: var(--safe-top);\n" +
    "      left: 0;\n" +
    "      right: 0;\n" +
    "      display: flex;\n" +
    "      justify-content: space-between;\n" +
    "      align-items: center;\n" +
    "      padding: 0 16px;\n" +
    "      pointer-events: none;\n" +
    "      z-index: 20;\n" +
    "      box-sizing: border-box;\n" +
    "    }\n" +
    "    .hud-badge {\n" +
    "      padding: 10px 14px;\n" +
    "      border-radius: 12px;\n" +
    "      background: var(--panel-bg);\n" +
    "      border: 1px solid var(--panel-border);\n" +
    "      font-weight: 700;\n" +
    "      letter-spacing: 0.02em;\n" +
    "      pointer-events: auto;\n" +
    "    }\n" +
    "    #settings-btn {\n" +
    "      position: fixed;\n" +
    "      top: var(--safe-top);\n" +
    "      right: 16px;\n" +
    "      width: 52px;\n" +
    "      height: 52px;\n" +
    "      border: 1px solid var(--panel-border);\n" +
    "      border-radius: 14px;\n" +
    "      background: var(--panel-bg);\n" +
    "      color: #d8efff;\n" +
    "      display: grid;\n" +
    "      place-items: center;\n" +
    "      cursor: pointer;\n" +
    "      z-index: 25;\n" +
    "      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);\n" +
    "      transform: translateY(0);\n" +
    "      transition: transform 0.12s ease;\n" +
    "    }\n" +
    "    #settings-btn:active {\n" +
    "      transform: translateY(2px);\n" +
    "    }\n" +
    "    #settings-modal {\n" +
    "      position: fixed;\n" +
    "      inset: 0;\n" +
    "      z-index: 40;\n" +
    "    }\n" +
    "    #settings-backdrop {\n" +
    "      position: absolute;\n" +
    "      inset: 0;\n" +
    "      background: rgba(0, 0, 0, 0.55);\n" +
    "    }\n" +
    "    #settings-panel {\n" +
    "      position: absolute;\n" +
    "      top: 50%;\n" +
    "      left: 50%;\n" +
    "      transform: translate(-50%, -50%);\n" +
    "      width: min(420px, 92vw);\n" +
    "      background: linear-gradient(165deg, rgba(15, 29, 52, 0.97), rgba(11, 21, 39, 0.95));\n" +
    "      border: 1px solid var(--panel-border);\n" +
    "      border-radius: 18px;\n" +
    "      padding: 20px;\n" +
    "      box-sizing: border-box;\n" +
    "      box-shadow: 0 30px 70px rgba(0, 0, 0, 0.5);\n" +
    "    }\n" +
    "    #settings-panel h3 {\n" +
    "      margin: 0 0 14px;\n" +
    "      font-size: 1.2rem;\n" +
    "    }\n" +
    "    .settings-row {\n" +
    "      display: flex;\n" +
    "      flex-direction: column;\n" +
    "      gap: 10px;\n" +
    "    }\n" +
    "    .settings-toggle {\n" +
    "      width: 100%;\n" +
    "      min-height: 52px;\n" +
    "      border-radius: 12px;\n" +
    "      border: 1px solid var(--panel-border);\n" +
    "      background: rgba(23, 39, 67, 0.84);\n" +
    "      color: var(--text-main);\n" +
    "      font-weight: 700;\n" +
    "      font-size: 15px;\n" +
    "      text-align: left;\n" +
    "      padding: 0 14px;\n" +
    "      cursor: pointer;\n" +
    "      transform: translateY(0);\n" +
    "      transition: transform 0.12s ease, border-color 0.12s ease;\n" +
    "    }\n" +
    "    .settings-toggle[data-enabled=\"true\"] {\n" +
    "      border-color: #71d5ff;\n" +
    "    }\n" +
    "    .settings-toggle:active {\n" +
    "      transform: translateY(2px);\n" +
    "    }\n" +
    "    #settings-close-btn {\n" +
    "      margin-top: 14px;\n" +
    "      width: 100%;\n" +
    "    }\n" +
    "    @media (pointer: coarse) {\n" +
    "      :root {\n" +
    "        --safe-top: 120px;\n" +
    "      }\n" +
    "      .card {\n" +
    "        width: min(560px, 95vw);\n" +
    "      }\n" +
    "      .ui-btn {\n" +
    "        min-height: 62px;\n" +
    "        font-size: 17px;\n" +
    "      }\n" +
    "      #settings-btn {\n" +
    "        width: 56px;\n" +
    "        height: 56px;\n" +
    "      }\n" +
    "      #hud {\n" +
    "        padding: 0 14px;\n" +
    "      }\n" +
    "      #settings-panel {\n" +
    "        width: min(460px, 94vw);\n" +
    "      }\n" +
    "      .settings-toggle {\n" +
    "        min-height: 58px;\n" +
    "      }\n" +
    "    }\n" +
    "  </style>\n" +
    "</head>\n" +
    "<body>\n" +
    "  <canvas id=\"game-canvas\"></canvas>\n" +
    "\n" +
    "  <div id=\"start-screen\" class=\"overlay\">\n" +
    "    <div class=\"card\">\n" +
    "      <h1 id=\"game-title\">" + title + "</h1>\n" +
    "      <p>Tap the glowing core to score points before the timer runs out.</p>\n" +
    "      <button id=\"start-btn\" class=\"ui-btn\" type=\"button\">Start Game</button>\n" +
    "    </div>\n" +
    "  </div>\n" +
    "\n" +
    "  <div id=\"hud\" class=\"hidden\">\n" +
    "    <div class=\"hud-badge\">Score: <span id=\"score-value\">0</span></div>\n" +
    "    <button id=\"end-btn\" class=\"ui-btn\" type=\"button\">End Run</button>\n" +
    "  </div>\n" +
    "\n" +
    "  <button id=\"settings-btn\" class=\"hidden\" type=\"button\" aria-label=\"Settings\">\n" +
    "    <svg width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" fill=\"none\" aria-hidden=\"true\">\n" +
    "      <path d=\"M10.325 2.317a1 1 0 0 1 1.95 0l.223 1.033a8.063 8.063 0 0 1 1.61.665l.9-.56a1 1 0 0 1 1.366.366l.974 1.689a1 1 0 0 1-.366 1.366l-.9.56c.11.53.167 1.078.167 1.64s-.057 1.11-.167 1.64l.9.56a1 1 0 0 1 .366 1.366l-.974 1.689a1 1 0 0 1-1.366.366l-.9-.56a8.063 8.063 0 0 1-1.61.665l-.223 1.033a1 1 0 0 1-1.95 0l-.223-1.033a8.063 8.063 0 0 1-1.61-.665l-.9.56a1 1 0 0 1-1.366-.366l-.974-1.689a1 1 0 0 1 .366-1.366l.9-.56A8.136 8.136 0 0 1 6.42 9.013c0-.562.057-1.11.167-1.64l-.9-.56a1 1 0 0 1-.366-1.366l.974-1.689a1 1 0 0 1 1.366-.366l.9.56a8.063 8.063 0 0 1 1.61-.665l.223-1.033z\" stroke=\"currentColor\" stroke-width=\"1.5\" />\n" +
    "      <circle cx=\"12\" cy=\"9.013\" r=\"2.75\" stroke=\"currentColor\" stroke-width=\"1.5\" />\n" +
    "    </svg>\n" +
    "  </button>\n" +
    "\n" +
    "  <div id=\"settings-modal\" class=\"hidden\">\n" +
    "    <div id=\"settings-backdrop\"></div>\n" +
    "    <div id=\"settings-panel\">\n" +
    "      <h3>Settings</h3>\n" +
    "      <div class=\"settings-row\">\n" +
    "        <button class=\"settings-toggle\" type=\"button\" data-setting=\"music\">Music: On</button>\n" +
    "        <button class=\"settings-toggle\" type=\"button\" data-setting=\"fx\">Sound FX: On</button>\n" +
    "        <button class=\"settings-toggle\" type=\"button\" data-setting=\"haptics\">Haptics: On</button>\n" +
    "      </div>\n" +
    "      <button id=\"settings-close-btn\" class=\"ui-btn\" type=\"button\">Close</button>\n" +
    "    </div>\n" +
    "  </div>\n" +
    "\n" +
    "  <div id=\"game-over-screen\" class=\"overlay hidden\">\n" +
    "    <div class=\"card\">\n" +
    "      <h2>Run Complete</h2>\n" +
    "      <p>Final score: <strong id=\"final-score\">0</strong></p>\n" +
    "      <button id=\"restart-btn\" class=\"ui-btn\" type=\"button\">Play Again</button>\n" +
    "    </div>\n" +
    "  </div>\n" +
    "\n" +
    "  <script type=\"module\" src=\"/src/main.ts\"></script>\n" +
    "</body>\n" +
    "</html>\n";

  await writeFile(join(gamePath, "index.html"), indexHtml, "utf8");

  await writePublishConfig(gamePath, {
    title,
    description: "",
    category: "arcade",
  });

  console.log("Scaffolded game at " + gameSlug + "/");
  console.log("Template: " + templateName);
  console.log("");
  console.log("Next steps:");
  console.log("  cd " + gameSlug);
  console.log("  oasiz upload " + gameSlug + " --dry-run");
}

async function resolveGameTitle(gameArg: string): Promise<string> {
  const localPath = getGamePath(gameArg);
  if (existsSync(localPath)) {
    const config = await readPublishConfig(localPath);
    return config.title;
  }

  return slugToTitle(gameArg);
}

async function commandUpload(gameSlug: string, argv: string[]): Promise<void> {
  const gamePath = validateGameFolder(gameSlug);
  const parsed = parseArgs(argv);
  const skipBuild = parsed.flagSet.has("--skip-build");
  const dryRun = parsed.flagSet.has("--dry-run");
  const forceDraft = parsed.flagSet.has("--draft");
  const forceActivate = parsed.flagSet.has("--activate");
  const orientation = parseOrientation(argv);

  if (forceDraft && forceActivate) {
    fail("Use either --draft or --activate, not both.");
  }

  const token = dryRun ? null : await requireAuthToken();
  const publishConfig = await readPublishConfig(gamePath);
  const gameTitle = publishConfig.title || slugToTitle(gameSlug);

  let preflightGameFound = false;
  let preflightDrafts: StudioDraft[] = [];
  if (!dryRun && token) {
    const preflight = await getUploadPreflight(gameTitle, token);
    preflightGameFound = Boolean(preflight.game);
    preflightDrafts = preflight.drafts || [];
    const liveDraft = getLiveDraft(preflightDrafts);

    if (preflightGameFound) {
      console.log("");
      console.log("\"" + gameTitle + "\" is on the platform - " + (liveDraft?.label || "an older version") + " is currently live.");
      console.log("");
      if (!forceDraft && !forceActivate) {
        const shouldContinue = await askYesNo("Upload as a new draft? [Y/n] ", true);
        if (!shouldContinue) {
          console.log("Upload cancelled.");
          return;
        }
      }
    } else {
      console.log("No existing canonical game found for " + gameTitle + ". This will create one.");
    }
  }

  if (!skipBuild) {
    console.log("Building " + gameSlug + "...");
    await buildGame(gamePath);
    console.log("Build complete.");
  }

  const bundleHtml = await readBundleHtml(gamePath);
  const assets = await collectAssets(gamePath);
  const thumbnailBase64 = await readThumbnail(gamePath);

  const payload = {
    title: gameTitle,
    slug: gameSlug,
    description: publishConfig.description,
    category: publishConfig.category,
    email: process.env.OASIZ_EMAIL,
    gameId: publishConfig.gameId,
    isMultiplayer: publishConfig.isMultiplayer,
    maxPlayers: publishConfig.maxPlayers,
    verticalOnly: orientation ?? publishConfig.verticalOnly,
    thumbnailBase64,
    bundleHtml,
    assets,
    activate: forceActivate,
  };

  if (dryRun) {
    console.log("");
    console.log("Dry run (no upload):");
    console.log("  Title: " + payload.title);
    console.log("  Slug: " + payload.slug);
    console.log("  Category: " + payload.category);
    console.log("  Game ID: " + (payload.gameId || "(new game)"));
    console.log("  HTML: " + formatBytes(bundleHtml.length));
    console.log("  Assets: " + Object.keys(assets).length + " files");
    printBuildSummary(gamePath);
    return;
  }

  const result = await postUploadGame(payload, token!);
  console.log("");
  console.log("Uploaded as " + result.label + (result.activated ? " (live)." : " (draft)."));

  if (!publishConfig.gameId && result.gameId) {
    await writePublishConfig(gamePath, {
      ...publishConfig,
      gameId: result.gameId,
    });
    console.log("Saved gameId to publish.json.");
  }

  const shouldAskActivate = !result.activated && !forceDraft && !forceActivate;
  if (shouldAskActivate) {
    const previousLive = getLiveDraft(preflightDrafts)?.label || "current live";
    console.log("");
    const activateNow = await askYesNo(
      "Make " + result.label + " live now? This will replace " + previousLive + " immediately. [y/N] ",
      false,
    );
    if (activateNow) {
      await postActivateDraft(result.draftId, token!);
      console.log("Activated " + result.label + ".");
    } else {
      console.log("Kept as draft.");
    }
  }
}

async function commandVersions(gameArg: string): Promise<void> {
  const token = await requireAuthToken();
  const title = await resolveGameTitle(gameArg);
  const preflight = await getUploadPreflight(title, token);

  if (!preflight.game) {
    console.log("No game found for title: " + title);
    return;
  }

  const drafts = sortDraftsAscending(preflight.drafts || []);
  const gameUrl = getWebBaseUrl() + "/games/" + preflight.game.id;
  console.log("");
  console.log(preflight.game.title + " - " + gameUrl);
  console.log("");
  console.log(pad("Label", 8) + pad("Uploaded", 20) + "Live");
  for (const draft of drafts) {
    const live = draft.isLive ? "✓ (currently live)" : "";
    console.log(pad(draft.label, 8) + pad(formatRelativeTime(draft.createdAt), 20) + live);
  }
}

async function commandActivate(gameArg: string): Promise<void> {
  const token = await requireAuthToken();
  const title = await resolveGameTitle(gameArg);
  const preflight = await getUploadPreflight(title, token);

  if (!preflight.game) {
    fail("No canonical game found for " + title + ".");
  }
  if (!preflight.drafts || preflight.drafts.length === 0) {
    fail("No drafts found for " + title + ".");
  }

  const drafts = sortDraftsDescending(preflight.drafts);
  const liveDraft = getLiveDraft(drafts);

  console.log("");
  console.log(
    preflight.game.title +
      " - " +
      drafts.length +
      " versions, " +
      (liveDraft?.label || "none") +
      " is live.",
  );
  console.log("");
  console.log("Select a version to make live:");
  drafts.forEach((draft, index) => {
    const suffix = draft.isLive ? " (live)" : "";
    console.log("  " + (index + 1) + ". " + draft.label + " (uploaded " + formatRelativeTime(draft.createdAt) + ")" + suffix);
  });
  const cancelIndex = drafts.length + 1;
  console.log("  " + cancelIndex + ". Cancel");

  const choice = await askChoice("Enter choice: ", 1, cancelIndex);
  if (choice === cancelIndex) {
    console.log("Cancelled.");
    return;
  }

  const selected = drafts[choice - 1];
  await postActivateDraft(selected.id, token);
  console.log("Activated " + selected.label + ".");
}

async function commandGames(): Promise<void> {
  const token = await requireAuthToken();
  const response = await getMyGames(token);
  const games = response.games || [];

  if (games.length === 0) {
    console.log("No canonical games found for this account.");
    return;
  }

  console.log(pad("Title", 32) + pad("Drafts", 8) + pad("Live", 10) + "Updated");
  games.forEach((game) => {
    const title = (game.title || "").slice(0, 30);
    const drafts = String(game.draftCount ?? "-");
    const live = game.liveLabel || "-";
    const updated = game.updatedAt ? formatRelativeTime(game.updatedAt) : "-";
    console.log(pad(title, 32) + pad(drafts, 8) + pad(live, 10) + updated);
  });
}

async function openInBrowser(url: string): Promise<void> {
  const platform = process.platform;

  const spawnDetached = (command: string, args: string[]): void => {
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
  };

  if (platform === "darwin") {
    spawnDetached("open", [url]);
    return;
  }
  if (platform === "linux") {
    spawnDetached("xdg-open", [url]);
    return;
  }
  if (platform === "win32") {
    spawnDetached("cmd", ["/c", "start", "", url]);
    return;
  }

  fail("Unsupported platform for open command: " + platform);
}

interface BrowserLoginResult {
  token: string;
  email?: string;
  expiresAt?: string;
}

async function findOpenPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createNetServer();

    server.once("error", (error) => {
      reject(error);
    });

    // Match the game-studio CLI so browser callbacks can resolve over either
    // loopback family on machines where localhost prefers IPv6.
    server.listen(0, "localhost", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate callback port.")));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function runBrowserLoginFlow(openBrowser: boolean): Promise<BrowserLoginResult> {
  const state = crypto.randomUUID();
  const webBase = getWebBaseUrl();
  const callbackPort = await findOpenPort();
  let settled = false;
  let resolveLogin!: (value: BrowserLoginResult) => void;
  let rejectLogin!: (error: Error) => void;
  const callbackPromise = new Promise<BrowserLoginResult>((resolve, reject) => {
    resolveLogin = resolve;
    rejectLogin = reject;
  });

  const server = createHttpServer((req, res) => {
    const url = new URL(req.url || "/", "http://localhost:" + String(callbackPort));
    if (url.pathname === "/favicon.ico") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (url.pathname !== "/callback") {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not found");
      return;
    }

    const returnedState = url.searchParams.get("state") || "";
    const token = url.searchParams.get("token") || "";
    const email = url.searchParams.get("email") || undefined;
    const expiresAt = url.searchParams.get("expiresAt") || undefined;
    const error = url.searchParams.get("error");

    if (settled) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Already handled. You can close this tab.");
      return;
    }

    if (error) {
      settled = true;
      rejectLogin(new Error("CLI auth failed: " + error));
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Login failed. You can close this tab.");
      return;
    }

    if (!token || returnedState !== state) {
      settled = true;
      rejectLogin(new Error("Invalid callback from Oasiz auth flow."));
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Invalid callback payload. You can close this tab.");
      return;
    }

    settled = true;
    const loginResult: BrowserLoginResult = { token, email, expiresAt };
    setTimeout(() => {
      resolveLogin(loginResult);
    }, 300);

    const html = [
      "<!doctype html>",
      "<html>",
      "<head>",
      "<meta charset=\"utf-8\" />",
      "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />",
      "<title>Oasiz CLI Login Complete</title>",
      "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">",
      "<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>",
      "<link href=\"https://fonts.googleapis.com/css2?family=Kodchasan:wght@600&family=Montserrat:wght@400;600;700&display=swap\" rel=\"stylesheet\">",
      "<style>",
      ":root{--bg:#090f1f;--text:#f5f7ff;--muted:#b8c2de;--line:rgba(255,255,255,.16)}",
      "html,body{height:100%;margin:0}",
      "body{font-family:Montserrat,Segoe UI,Arial,sans-serif;background:#090f1f;color:var(--text);display:grid;place-items:center;overflow:hidden}",
      ".card{position:relative;width:min(560px,calc(100vw - 32px));padding:26px;border-radius:24px;border:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.12),rgba(255,255,255,.03));backdrop-filter:blur(10px);box-shadow:0 26px 70px rgba(0,0,0,.45)}",
      ".card::after{content:\"\";position:absolute;inset:0;border-radius:24px;pointer-events:none;background:linear-gradient(120deg,rgba(255,255,255,.08),rgba(255,255,255,0) 35%)}",
      ".brand{font-family:Kodchasan,Montserrat,Segoe UI,Arial,sans-serif;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#dce5ff;opacity:.92;margin-bottom:14px}",
      ".title{margin:0;font-size:28px;line-height:1.15;letter-spacing:-.01em}",
      ".desc{margin:10px 0 0;color:var(--muted);font-size:16px;line-height:1.45}",
      ".status{display:inline-flex;align-items:center;gap:10px;margin-top:16px;padding:8px 12px;border:1px solid rgba(140,209,255,.45);border-radius:999px;background:rgba(73,165,255,.14);font-size:13px;font-weight:600;color:#d7efff}",
      ".dot{width:8px;height:8px;border-radius:50%;background:#8ef0c6;box-shadow:0 0 0 4px rgba(142,240,198,.16)}",
      ".foot{margin-top:16px;color:#98a6cc;font-size:13px}",
      "@media (max-width:480px){.title{font-size:23px}.desc{font-size:15px}}",
      "</style>",
      "</head>",
      "<body>",
      "<section class=\"card\">",
      "<div class=\"brand\">OASIZ</div>",
      "<h1 class=\"title\">CLI LOGIN COMPLETE</h1>",
      "<p class=\"desc\">Authentication finished successfully. You can close this tab and continue in your terminal.</p>",
      "<div class=\"status\"><span class=\"dot\"></span>Connected</div>",
      "<p class=\"foot\">This window can now be closed.</p>",
      "</section>",
      "</body>",
      "</html>",
    ].join("");

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(html);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(callbackPort, "localhost", () => {
      resolve();
    });
  });

  try {
    const loginUrl = webBase + "/cli-auth?port=" + String(callbackPort) + "&state=" + encodeURIComponent(state);
    console.log("Open this URL to continue login:");
    console.log("  " + loginUrl);
    if (openBrowser) {
      await openInBrowser(loginUrl);
    }

    const timeoutMs = 5 * 60 * 1000;
    const timedResult = await Promise.race([
      callbackPromise,
      new Promise<BrowserLoginResult>((_resolve, reject) => {
        setTimeout(() => reject(new Error("Timed out waiting for browser login callback.")), timeoutMs);
      }),
    ]);
    await new Promise((resolve) => {
      setTimeout(resolve, 900);
    });
    return timedResult;
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

async function commandLogin(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const token = parsed.values.get("--token");
  const email = parsed.values.get("--email");
  const noOpen = parsed.flagSet.has("--no-open");

  if (token) {
    await saveStoredCredentials({
      token,
      email,
      createdAt: new Date().toISOString(),
    });
    console.log("Saved credentials at local CLI store.");
    return;
  }

  const loginResult = await runBrowserLoginFlow(!noOpen);
  await saveStoredCredentials({
    token: loginResult.token,
    email: loginResult.email,
    createdAt: new Date().toISOString(),
  });
  console.log("Login successful.");
  if (loginResult.email) {
    console.log("Signed in as " + loginResult.email + ".");
  }
}

async function commandLogout(): Promise<void> {
  clearStoredCredentials();
  console.log("Cleared saved credentials.");
  if (process.env.OASIZ_CLI_TOKEN || process.env.OASIZ_UPLOAD_TOKEN) {
    console.log("Environment token is still set in this shell. Unset it to fully log out.");
  }
}

async function commandWhoAmI(): Promise<void> {
  const token = await resolveAuthToken();
  if (!token) {
    console.log("Not logged in.");
    return;
  }

  if (process.env.OASIZ_CLI_TOKEN) {
    console.log("Authenticated via OASIZ_CLI_TOKEN environment variable.");
    console.log("API base: " + getApiBaseUrl());
    return;
  }

  if (process.env.OASIZ_UPLOAD_TOKEN) {
    console.log("Authenticated via OASIZ_UPLOAD_TOKEN environment variable.");
    console.log("API base: " + getApiBaseUrl());
    return;
  }

  const stored = await readStoredCredentials();
  if (stored?.email) {
    console.log("Authenticated with saved CLI credentials for " + stored.email + ".");
  } else {
    console.log("Authenticated with saved CLI credentials.");
  }
  console.log("API base: " + getApiBaseUrl());
}

export async function runUploadCli(args: string[] = []): Promise<void> {
  if (args.includes("--list") || args.includes("-l")) {
    await commandList();
    return;
  }

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printUploadHelp();
    return;
  }

  const gameSlug = args[0];
  if (!gameSlug || gameSlug.startsWith("-")) {
    fail("Usage: oasiz upload <game>");
  }
  await commandUpload(gameSlug, args.slice(1));
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const command = argv[0];

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const value = argv[1];
  const rest = argv.slice(2);

  try {
    switch (command) {
      case "info":
        printHelp();
        return;
      case "create":
        await commandCreate(argv.slice(1));
        return;
      case "new":
        console.log("Warning: oasiz new is deprecated. Use oasiz create.");
        await commandCreate(argv.slice(1));
        return;
      case "upload":
        if (!value || value === "--help" || value === "-h") {
          printUploadHelp();
          return;
        }
        if (value === "--list" || value === "-l") {
          await commandList();
          return;
        }
        await commandUpload(value, rest);
        return;
      case "versions":
        if (!value) fail("Usage: oasiz versions <game>");
        await commandVersions(value);
        return;
      case "activate":
        if (!value) fail("Usage: oasiz activate <game>");
        await commandActivate(value);
        return;
      case "list":
        await commandList();
        return;
      case "games":
        await commandGames();
        return;
      case "login":
        await commandLogin(argv.slice(1));
        return;
      case "logout":
        await commandLogout();
        return;
      case "whoami":
        await commandWhoAmI();
        return;
      default:
        fail("Unknown command: " + command);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(enrichConnectionError(error, message));
  }
}
